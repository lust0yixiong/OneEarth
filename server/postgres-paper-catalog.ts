import {randomUUID} from "node:crypto";
import type {Pool,PoolClient} from "pg";
import {validPaperRecord,type PaperRecord} from "../src/domain/paper-record";
import type {PaperMapEntry,PaperProjectionHead,PaperProjectionResult} from "./paper-projection-contract";

export type CatalogStatus = {complete:boolean;source:string;sourceTotal:number|null;filteredOut:number;updatedAt:string|null};
export type PaperCatalogSnapshot = {records:PaperRecord[];published:{dsKey:string;id:string}[];catalog:CatalogStatus};
const emptyStatus: CatalogStatus = {complete:false,source:"文献资料已查询记录",sourceTotal:null,filteredOut:0,updatedAt:null};
type Head = {
  initialized:boolean; clock:string; floor:string; revision_token:string; generation_token:string; generation:string;
  published_count:string; version_count:string; catalog:CatalogStatus; migration_id:string|null;
};
export class PaperCatalogUninitialized extends Error {
  constructor() {super("论文发布目录尚未初始化，请先迁移旧目录或显式初始化新库。");}
}
export class PaperCatalogBaseUnavailable extends Error {
  constructor() {super("论文投影的增量基准已不可用，请重新读取完整投影。");}
}
export class PaperCatalogGenerationChanged extends Error {
  constructor() {super("论文目录版本集合已变化，请获取最新发布头后重新分页。");}
}

type CatalogPage = {records:PaperRecord[];nextCursor:string|null;total:number;catalog:CatalogStatus&{total:number};cached:true;revision:string};
export type PaperCatalogStorage = {
  getMany(ids:string[]):Promise<PaperRecord[]>;
  page(cursor:string,limit:number):Promise<CatalogPage>;
  beginLookup():Promise<string>;
  publishLookup(records:PaperRecord[],stamp:string):Promise<unknown>;
};

function visibleHead(h:Head):PaperProjectionHead {
  return {revision:h.revision_token,generation:h.generation_token,
    publishedCount:Number(h.published_count),versionCount:Number(h.version_count)};
}
function checkRecords(records:PaperRecord[]) {
  if (!records.every(record=>validPaperRecord(record) && !record.catalogSummary))
    throw Error("论文记录缺少完整的文献资料依据。");
}

export async function inspectPaperCatalog(pool:Pick<Pool,"query">) {
  const {rows} = await pool.query<{name:string|null}>("SELECT to_regclass('paper_catalog_head')::text AS name");
  if (rows[0].name) {
    const row = (await pool.query<Head>("SELECT * FROM paper_catalog_head WHERE singleton")).rows[0];
    if (row?.initialized) return {initialized:true,...visibleHead(row),catalog:row.catalog};
  }
  return {initialized:false,revision:null,generation:null,publishedCount:0,versionCount:0};
}

export async function postgresPaperCatalog(pool:Pool,{initializeSchema=true}:{initializeSchema?:boolean}={}) {
  async function transaction<T>(work:(db:PoolClient)=>Promise<T>, readOnly=false) {
    const db = await pool.connect();
    try {
      await db.query(readOnly ? "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY" : "BEGIN");
      const result = await work(db);
      await db.query("COMMIT");
      return result;
    } catch(error) {
      await db.query("ROLLBACK").catch(()=>{});
      throw error;
    } finally {db.release();}
  }
  if (initializeSchema) await transaction(async db=>{
    await db.query("SELECT pg_advisory_xact_lock(7142532::bigint)");
    await db.query(`
      CREATE TABLE IF NOT EXISTS paper_catalog_head (
        singleton boolean PRIMARY KEY CHECK(singleton),
        initialized boolean NOT NULL DEFAULT false, clock bigint NOT NULL DEFAULT 0, floor bigint NOT NULL DEFAULT 0,
        revision_token uuid NOT NULL, generation_token uuid NOT NULL, generation bigint NOT NULL DEFAULT 0,
        published_count bigint NOT NULL DEFAULT 0, version_count bigint NOT NULL DEFAULT 0,
        catalog jsonb NOT NULL, migration_id text
      );
      CREATE TABLE IF NOT EXISTS paper_catalog_versions (
        id text COLLATE "C" PRIMARY KEY, ds_key text COLLATE "C" NOT NULL, record jsonb NOT NULL,
        last_changed_generation bigint NOT NULL, UNIQUE(ds_key,id)
      );
      CREATE TABLE IF NOT EXISTS paper_catalog_current (
        ds_key text COLLATE "C" PRIMARY KEY, id text COLLATE "C" NOT NULL, watermark bigint NOT NULL,
        FOREIGN KEY(ds_key,id) REFERENCES paper_catalog_versions(ds_key,id)
      );
      CREATE INDEX IF NOT EXISTS paper_catalog_versions_changes ON paper_catalog_versions(last_changed_generation,id);
      CREATE TABLE IF NOT EXISTS paper_catalog_generations (
        generation bigint PRIMARY KEY, token uuid NOT NULL UNIQUE
      );`);
    await db.query(`INSERT INTO paper_catalog_head(singleton,revision_token,generation_token,catalog)
      VALUES(true,$1,$2,$3::jsonb) ON CONFLICT(singleton) DO NOTHING`,[randomUUID(),randomUUID(),JSON.stringify(emptyStatus)]);
  });

  async function head(db:Pick<Pool,"query">,lock=false,initialized=true):Promise<Head> {
    const row = (await db.query<Head>("SELECT * FROM paper_catalog_head WHERE singleton"+(lock ? " FOR UPDATE" : ""))).rows[0];
    if (initialized && !row.initialized) throw new PaperCatalogUninitialized();
    return row;
  }
  const nextGeneration = (h:Head) => (BigInt(h.generation)+1n).toString();
  async function advance(db:PoolClient,next:string) {
    const token=randomUUID();
    await db.query("INSERT INTO paper_catalog_generations VALUES($1,$2)",[next,token]);
    await db.query("DELETE FROM paper_catalog_generations WHERE generation <= $1::bigint-128",[next]);
    return token;
  }
  async function archive(db:PoolClient,records:PaperRecord[],generation:string) {
    let inserted = 0;
    for (let i=0;i<records.length;i+=250) {
      const values = JSON.stringify(records.slice(i,i+250).map(record=>({ds_key:record.dsKey,id:record.id,record})));
      const source = "jsonb_to_recordset($1::jsonb) AS x(ds_key text,id text,record jsonb)";
      inserted += (await db.query(`INSERT INTO paper_catalog_versions(id,ds_key,record,last_changed_generation)
        SELECT id,ds_key,record,$2 FROM ${source} ON CONFLICT(id) DO NOTHING`,[values,generation])).rowCount ?? 0;
      const conflict = await db.query(`SELECT 1 FROM ${source} JOIN paper_catalog_versions v ON v.id=x.id
        WHERE (v.ds_key,v.record) IS DISTINCT FROM (x.ds_key,x.record) LIMIT 1`,[values]);
      if (conflict.rowCount) throw Error("同一论文内容 ID 对应不同记录，已保留原版本。");
    }
    return inserted;
  }
  async function replacement(db:PoolClient,h:Head,snapshot:PaperCatalogSnapshot,migrationId?:string) {
    const next=nextGeneration(h),versions = await archive(db,snapshot.records,next);
    const watermark = (BigInt(h.clock)+1n).toString();
    await db.query(`CREATE TEMP TABLE paper_replacement (
      ds_key text COLLATE "C" PRIMARY KEY,id text COLLATE "C" NOT NULL) ON COMMIT DROP`);
    for (let i=0;i<snapshot.published.length;i+=500) {
      const links=snapshot.published.slice(i,i+500);
      await db.query("INSERT INTO paper_replacement SELECT * FROM unnest($1::text[],$2::text[])",[
        links.map(link=>link.dsKey),links.map(link=>link.id),
      ]);
    }
    const changed = (await db.query<{changed:boolean}>(`
      SELECT EXISTS(SELECT 1 FROM paper_replacement n FULL JOIN paper_catalog_current c USING(ds_key)
        WHERE n.id IS DISTINCT FROM c.id) OR $1::jsonb IS DISTINCT FROM $2::jsonb AS changed`,
      [JSON.stringify(h.catalog),JSON.stringify(snapshot.catalog)])).rows[0].changed || !h.initialized;
    if (changed) await db.query(`WITH changed AS (
      SELECT c.id AS old_id,n.id AS new_id FROM paper_replacement n FULL JOIN paper_catalog_current c USING(ds_key)
      WHERE n.id IS DISTINCT FROM c.id)
      UPDATE paper_catalog_versions SET last_changed_generation=$1
      WHERE id IN (SELECT old_id FROM changed UNION SELECT new_id FROM changed)`,[next]);
    await db.query("DELETE FROM paper_catalog_current");
    await db.query("INSERT INTO paper_catalog_current SELECT ds_key,id,$1 FROM paper_replacement",[watermark]);
    const generationChanged=changed || versions>0;
    const saved = (await db.query<Head>(`UPDATE paper_catalog_head SET initialized=true,clock=$1,floor=$1,catalog=$2::jsonb,
      published_count=$3,version_count=version_count+$4,revision_token=$5,generation=$6,generation_token=$7,
      migration_id=COALESCE($8,migration_id) WHERE singleton RETURNING *`,[
      watermark,JSON.stringify(snapshot.catalog),snapshot.published.length,versions,changed ? randomUUID() : h.revision_token,
      generationChanged ? next : h.generation,generationChanged ? await advance(db,next) : h.generation_token,migrationId ?? null,
    ])).rows[0];
    return visibleHead(saved);
  }
  async function legacyExists(db:PoolClient) {
    return (await db.query<{table:string|null}>("SELECT to_regclass('discovery_papers')::text AS table")).rows[0].table !== null;
  }

  return {
    async beginLookup() {
      const result = await pool.query<{clock:string}>(`UPDATE paper_catalog_head SET clock=clock+1
        WHERE singleton AND initialized RETURNING clock`);
      if (!result.rowCount) throw new PaperCatalogUninitialized();
      return result.rows[0].clock;
    },
    async publishLookup(records:PaperRecord[],stamp:string) {
      checkRecords(records);
      if (!records.length) return;
      await transaction(async db=>{
        const h = await head(db,true);
        if (!/^\d+$/.test(stamp) || BigInt(stamp)<1n || BigInt(stamp)>BigInt(h.clock))
          throw Error("论文查询水位无效。");
        const next=nextGeneration(h),versions = await archive(db,records,next);
        const changes = new Set<string>();
        let added=0;
        if (BigInt(stamp)>BigInt(h.floor)) {
          const unique = new Map(records.map(record=>[record.dsKey,record]));
          const current = (await db.query<{ds_key:string;id:string;watermark:string}>(`
            SELECT ds_key,id,watermark FROM paper_catalog_current WHERE ds_key=ANY($1::text[])`,[[...unique.keys()]])).rows;
          const byKey = new Map(current.map(row=>[row.ds_key,row]));
          for (const record of unique.values()) {
            const old=byKey.get(record.dsKey);
            if (old && BigInt(old.watermark)>=BigInt(stamp)) continue;
            await db.query(`INSERT INTO paper_catalog_current(ds_key,id,watermark) VALUES($1,$2,$3)
              ON CONFLICT(ds_key) DO UPDATE SET id=EXCLUDED.id,watermark=EXCLUDED.watermark`,[record.dsKey,record.id,stamp]);
            if (!old) added++;
            if (old?.id !== record.id) {
              changes.add(record.id);
              if (old) changes.add(old.id);
            }
          }
        }
        if (changes.size) await db.query("UPDATE paper_catalog_versions SET last_changed_generation=$1 WHERE id=ANY($2::text[])",
          [next,[...changes]]);
        if (changes.size || versions) await db.query(`UPDATE paper_catalog_head SET published_count=published_count+$1,
          version_count=version_count+$2,revision_token=$3,generation=$4,generation_token=$5,
          catalog=CASE WHEN $1::bigint>0 THEN jsonb_set(catalog,'{complete}','false'::jsonb) ELSE catalog END WHERE singleton`,
          [added,versions,changes.size ? randomUUID() : h.revision_token,next,await advance(db,next)]);
      });
    },
    async replaceCatalog(records:PaperRecord[],info:Omit<CatalogStatus,"complete">) {
      checkRecords(records);
      if (new Set(records.map(r=>r.dsKey)).size !== records.length || !Number.isSafeInteger(info.sourceTotal) ||
        !Number.isSafeInteger(info.filteredOut) || info.filteredOut<0 || records.length+info.filteredOut!==info.sourceTotal)
        throw Error("全量目录的记录数、去重或证据校验未通过。");
      return transaction(async db=>replacement(db,await head(db,true),{
        records,published:records.map(r=>({dsKey:r.dsKey,id:r.id})),catalog:{...info,complete:true},
      }));
    },
    async initializeEmpty() {
      return transaction(async db=>{
        const h = await head(db,true,false);
        if (h.initialized) {
          if (h.migration_id === "empty") return visibleHead(h);
          throw Error("论文发布目录已经存在。");
        }
        if (await legacyExists(db) && (await db.query("SELECT 1 FROM discovery_papers LIMIT 1")).rowCount)
          throw Error("发现库存在旧论文记录，请使用旧目录快照迁移。");
        return replacement(db,h,{records:[],published:[],catalog:emptyStatus},"empty");
      });
    },
    async importLegacy(snapshot:PaperCatalogSnapshot,digest:string) {
      checkRecords(snapshot.records);
      return transaction(async db=>{
        const h = await head(db,true,false);
        const id = "sqlite-v2:"+digest;
        if (h.migration_id === id) return {...visibleHead(h),alreadyImported:true};
        if (h.initialized) throw Error("目标库已经初始化，旧快照不能覆盖当前发布。");
        const records = [...snapshot.records];
        // Older task archives can supply exact IDs only. Publish exclusively the SQLite head.
        if (await legacyExists(db)) {
          const known = new Set(records.map(record=>record.id));
          const legacy = (await db.query<{id:string;record:unknown}>("SELECT id,record FROM discovery_papers")).rows;
          for (const row of legacy) if (!known.has(row.id)) {
            if (!validPaperRecord(row.record) || row.id!==row.record.id || row.record.catalogSummary)
              throw Error("旧发现任务含无效论文记录，未发布不完整迁移。");
            records.push(row.record);
          }
        }
        const result = await replacement(db,h,{...snapshot,records},id);
        return {...result,alreadyImported:false};
      });
    },
    async getMany(ids:string[]) {
      await head(pool);
      if (!ids.length) return [];
      const {rows} = await pool.query<{record:PaperRecord}>(`
        SELECT p.record FROM unnest($1::text[]) WITH ORDINALITY AS x(id,i)
        JOIN paper_catalog_versions p ON p.id=x.id ORDER BY x.i`,[ids]);
      return rows.map(row=>row.record);
    },
    async page(cursor:string,limit:number):Promise<CatalogPage> {
      return transaction(async db=>{
        const h=await head(db),current=visibleHead(h);
        const {rows} = await db.query<{ds_key:string;record:PaperRecord}>(`
          SELECT c.ds_key,v.record FROM paper_catalog_current c JOIN paper_catalog_versions v ON v.id=c.id
          WHERE c.ds_key>$1 ORDER BY c.ds_key LIMIT $2`,[cursor,limit+1]);
        const selected=rows.slice(0,limit);
        return {records:selected.map(row=>row.record),nextCursor:rows.length>limit ? selected.at(-1)!.ds_key : null,
          total:current.publishedCount,catalog:{...h.catalog,total:current.publishedCount},cached:true,revision:current.revision};
      },true);
    },
    async status() {
      const row=await head(pool);
      return {...row.catalog,total:Number(row.published_count),...visibleHead(row)};
    },
    async projectionHead():Promise<PaperProjectionResult> {
      return {operation:"head",...visibleHead(await head(pool))};
    },
    async projectionPage(generation:string,cursor:string,limit:number,baseGeneration?:string):Promise<PaperProjectionResult> {
      return transaction(async db=>{
        const h=await head(db),current=visibleHead(h);
        if (current.generation!==generation) throw new PaperCatalogGenerationChanged();
        let base:string|undefined;
        if (baseGeneration !== undefined) {
          base = (await db.query<{generation:string}>("SELECT generation FROM paper_catalog_generations WHERE token::text=$1",
            [baseGeneration])).rows[0]?.generation;
          if (!base || BigInt(base)>BigInt(h.generation)) throw new PaperCatalogBaseUnavailable();
        }
        const {rows}=await db.query<{record:PaperRecord;published:boolean}>(`
          SELECT v.record,c.id IS NOT NULL AS published FROM paper_catalog_versions v
          LEFT JOIN paper_catalog_current c ON c.ds_key=v.ds_key AND c.id=v.id
          WHERE v.id>$1 ${base ? "AND v.last_changed_generation>$3" : ""} ORDER BY v.id LIMIT $2`,
          base ? [cursor,limit+1,base] : [cursor,limit+1]);
        const entries=rows.slice(0,limit).map(({record,published}): PaperMapEntry=>{
          const {area,areaBasis,coverage,extent,role,spatial,utcWindow,years}=record.need.profile!;
          return {id:record.id,dsKey:record.dsKey,title:record.need.product,type:record.need.type,
            source:record.need.source,points:record.points,profile:{area,areaBasis,coverage,extent,role,spatial,utcWindow,years},published};
        });
        return {operation:"page",...current,...(baseGeneration!==undefined ? {baseGeneration} : {}),entries,
          nextCursor:rows.length>limit ? entries.at(-1)!.id : null};
      },true);
    },
    async archiveRecords(records:PaperRecord[]) {
      checkRecords(records);
      if (!records.length) return;
      await transaction(async db=>{
        const h=await head(db,true),next=nextGeneration(h),versions=await archive(db,records,next);
        if (versions) await db.query(`UPDATE paper_catalog_head SET version_count=version_count+$1,generation=$2,generation_token=$3
          WHERE singleton`,[versions,next,await advance(db,next)]);
      });
    },
    async importDiscoveryHistory() {
      return transaction(async db=>{
        const h=await head(db,true,false);
        const id="v1-discovery-history";
        if (h.migration_id===id) return {...visibleHead(h),alreadyImported:true};
        if (h.initialized) throw Error("目标库已经初始化，旧任务历史不能覆盖当前发布。");
        const records=new Map<string,PaperRecord>(),byKey=new Map<string,string>();
        if (await legacyExists(db)) {
          for (const {id,record} of (await db.query<{id:string;record:unknown}>("SELECT id,record FROM discovery_papers")).rows) {
            if (!validPaperRecord(record) || record.id!==id || record.catalogSummary) throw Error("旧发现任务含无效论文记录。");
            records.set(id,record);
          }
          const terminal=(await db.query<{papers:PaperRecord[]}>(`
            SELECT e.payload->'result'->'papers' AS papers FROM discovery_tasks t JOIN LATERAL (
              SELECT seq,payload FROM discovery_events WHERE id=t.id ORDER BY seq DESC LIMIT 1
            ) e ON true WHERE t.status='complete' AND jsonb_typeof(e.payload->'result'->'papers')='array' ORDER BY e.seq`)).rows;
          for (const row of terminal) {
            checkRecords(row.papers);
            for (const record of row.papers) {if (!records.has(record.id)) records.set(record.id,record);byKey.set(record.dsKey,record.id);}
          }
        }
        const result=await replacement(db,h,{
          records:[...records.values()],published:[...byKey].map(([dsKey,id])=>({dsKey,id})),
          catalog:{...emptyStatus,source:"旧发现任务终态有限回放，历史正式发布不可恢复"},
        },id);
        return {...result,alreadyImported:false};
      });
    },
    async exportSnapshot():Promise<PaperCatalogSnapshot> {
      return transaction(async db=>{
        const h=await head(db);
        const versions=await db.query<{record:PaperRecord}>("SELECT record FROM paper_catalog_versions ORDER BY id");
        const links=await db.query<{dsKey:string;id:string}>('SELECT ds_key AS "dsKey",id FROM paper_catalog_current ORDER BY ds_key');
        return {records:versions.rows.map(row=>row.record),published:links.rows,catalog:h.catalog};
      },true);
    },
  };
}
export type PostgresPaperCatalog = Awaited<ReturnType<typeof postgresPaperCatalog>>;
