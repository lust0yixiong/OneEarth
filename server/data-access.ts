import {DatabaseSync,type SQLInputValue} from "node:sqlite";
import {createHash} from "node:crypto";
import {Router} from "express";
import {accessDatasetKey,accessMembership,validAccessSection,type AccessCatalogues,type AccessPage,type AccessQuery,type AccessRow,type AccessSection} from "../src/domain/data-access";
import {discoverableAsset,assetIdentity,observationAsset,registerObservations,type Asset} from "../src/domain/datasets";
import {observationById,type Observation} from "../src/domain/push-observations";
import {paperRecords} from "../src/domain/paper-record";
import {hasLocalMaterial,canMapAsset} from "../src/domain/results";
import {sourceLabels} from "../src/domain/catalog";

interface Entry {asset:AccessRow["asset"];identity:string;observation?:Observation;papers:number;evidenceKinds:string[];mappable:boolean}
export function dataAccessIndex(file:string){
  const db=new DatabaseSync(file);
  db.exec(`PRAGMA journal_mode=WAL;PRAGMA busy_timeout=3000;
    CREATE TABLE IF NOT EXISTS access_records(id TEXT PRIMARY KEY,dataset_key TEXT NOT NULL,title TEXT NOT NULL,
      entities INTEGER NOT NULL,clues INTEGER NOT NULL,timely INTEGER NOT NULL,types TEXT NOT NULL,origins TEXT NOT NULL,
      local INTEGER NOT NULL,mappable INTEGER NOT NULL,restricted INTEGER NOT NULL,year_start INTEGER,year_end INTEGER,
      observed TEXT,received TEXT,payload TEXT NOT NULL,signature TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS access_dataset_key ON access_records(dataset_key);
    CREATE INDEX IF NOT EXISTS access_section_title ON access_records(entities,clues,timely,title COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS access_received ON access_records(timely,received DESC,id DESC);
    CREATE INDEX IF NOT EXISTS access_identity ON access_records(json_extract(payload,'$.identity'));
    CREATE TABLE IF NOT EXISTS access_state(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE VIRTUAL TABLE IF NOT EXISTS access_fts USING fts5(id UNINDEXED,body,tokenize='trigram');`);
  if(Number(db.prepare("PRAGMA user_version").get()?.user_version)<2){
    db.exec("DROP TABLE access_fts;CREATE VIRTUAL TABLE access_fts USING fts5(id UNINDEXED,body,tokenize='trigram');UPDATE access_records SET signature='';PRAGMA user_version=2;");
  }
  let revision=Number(db.prepare("SELECT value FROM access_state WHERE key='revision'").get()?.value)||0;
  let snapshot=db.prepare("SELECT value FROM access_state WHERE key='snapshot'").get()?.value;
  let initialized=!!db.prepare("SELECT value FROM access_state WHERE key='revision'").get()||!!db.prepare("SELECT 1 AS present FROM access_records LIMIT 1").get();
  let writing=false,closed=false,writer:DatabaseSync|undefined;
  function* replacement(connection:DatabaseSync,items:Iterable<Asset>,observations?:Iterable<Observation>,publication?:AccessCatalogues,preserveOrigins:readonly string[]=[]){
    const put=connection.prepare("INSERT OR REPLACE INTO access_records VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
    const putText=connection.prepare("INSERT INTO access_fts(rowid,id,body) VALUES (?,?,?)"),removeText=connection.prepare("DELETE FROM access_fts WHERE rowid=?");
    const remove=connection.prepare("DELETE FROM access_records WHERE id=?");
    const old=new Map(connection.prepare("SELECT rowid,id,signature,origins FROM access_records").all().map(r=>[String(r.id),{signature:String(r.signature),rowid:r.rowid,origins:JSON.parse(String(r.origins)) as string[]}]));
    let changed=false,count=0;
    connection.exec("BEGIN IMMEDIATE");
    try{
      function write(a:Asset,r=observationById(a.id)){
        if(a.origins.some(origin=>preserveOrigins.includes(origin))||(r?r.test:!discoverableAsset(a)))return;
        const membership=accessMembership(a),paper=paperRecords.get(a.id);
        const {tabs:_tabs,...rest}=a;
        const asset={...rest,description:a.description.slice(0,2400),profile:a.profile?{...a.profile,area:undefined}:undefined};
        const mappable=!!r||!!paper?.points.length||!!a.profile?.area||a.profile?.extent==="world"||(!paper&&canMapAsset(a));
        const entry:Entry={asset,identity:assetIdentity(a),observation:r,papers:paper?.papers||0,mappable,
          evidenceKinds:[...(paper?.assertionCatalogKind?["数据集元数据"]:[]),...((paper?paper.assertionCatalogKind!=="metadata-only"&&paper.papers>0:a.paperSource||a.paperSources?.length)?["论文用法"]:[]),...(a.origins.includes("public")?["发布方目录"]:[])]};
        const datasetKey=accessDatasetKey(a);
        const doi=datasetKey.startsWith("doi:")?datasetKey:undefined;
        const body=[a.title,a.description,a.source,a.datasetId,a.canonicalId,doi,a.version,a.holding?.channelName,a.profile?.coverage,...a.categories,...entry.evidenceKinds,r?.satellite,r?.collection,r?.sourceName].filter(Boolean).join(" ");
        const payload=JSON.stringify(entry),signature=createHash("sha256").update(payload).update("\n"+body).digest("hex");
        const prior=old.get(a.id);old.delete(a.id);if(prior?.signature===signature)return;
        const years=a.profile?.years;
        const inserted=put.run(a.id,datasetKey,a.title,Number(membership.entities),Number(membership.clues),Number(membership.timely),JSON.stringify(a.categories),JSON.stringify(a.origins),
          Number(hasLocalMaterial(a)),Number(mappable),Number(a.holding?.access==="restricted"||a.profile?.spatial==="restricted"||a.profile?.role==="request"),
          years?.[0]??null,years?.[1]??null,r?.observedAt??null,r?.receivedAt??null,payload,signature);
        if(prior)removeText.run(prior.rowid);
        putText.run(inserted.lastInsertRowid,a.id,body);changed=true;
      }
      for(const a of items){if(!observations||!a.origins.includes("constellation"))write(a);if(++count%128===0)yield;}
      for(const r of observations||[]){write(observationAsset(r),r);if(++count%128===0)yield;}
      for(const [id,prior] of old){if(prior.origins.some(origin=>preserveOrigins.includes(origin)))continue;remove.run(id);removeText.run(prior.rowid);changed=true;if(++count%128===0)yield;}
      const next=revision+Number(changed),metadata=publication?JSON.stringify(publication):snapshot;
      connection.prepare("INSERT OR REPLACE INTO access_state VALUES ('revision',?)").run(String(next));
      if(metadata!==undefined)connection.prepare("INSERT OR REPLACE INTO access_state VALUES ('snapshot',?)").run(metadata);
      connection.exec("COMMIT");revision=next;snapshot=metadata;initialized=true;
    }catch(error){connection.exec("ROLLBACK");throw error;}
  }
  function finishClose(){if(closed&&!writing){writer?.close();db.close();}}
  function replace(items:Iterable<Asset>,observations?:Iterable<Observation>,publication?:AccessCatalogues,preserveOrigins:readonly string[]=[]){
    if(closed||writing)throw Error("数据索引正在更新或已关闭。");
    for(const _ of replacement(db,items,observations,publication,preserveOrigins)){ /* synchronous compatibility for small local callers */ }
  }
  async function replaceAsync(items:Iterable<Asset>,observations?:Iterable<Observation>,publication?:AccessCatalogues,preserveOrigins:readonly string[]=[]){
    if(closed||writing)throw Error("数据索引正在更新或已关闭。");
    writing=true;
    try{
      // A separate WAL writer lets readers see only the last committed generation.
      if(file!==":memory:"&&!writer){writer=new DatabaseSync(file);writer.exec("PRAGMA journal_mode=WAL;PRAGMA busy_timeout=3000;");}
      for(const _ of replacement(writer||db,items,observations,publication,preserveOrigins)){
        if(closed)throw Error("数据索引已关闭。");
        if(writer)await new Promise<void>(resolve=>setImmediate(resolve));
      }
    }finally{writing=false;finishClose();}
  }
  function search(q:AccessQuery):AccessPage{
    const conditions:string[]=[],args:SQLInputValue[]=[];
    const query=q.query.trim();
    if(query){
      const terms=[...new Set(query.split(/\s+/))],long=terms.filter(t=>[...t].length>=3),short=terms.filter(t=>[...t].length<3);
      if(long.length){conditions.push("r.id IN (SELECT id FROM access_fts WHERE body MATCH ?)");args.push(long.map(t=>'"'+t.replace(/"/g,'""')+'"').join(" AND "));}
      for(const term of short){conditions.push("r.id IN (SELECT id FROM access_fts WHERE instr(lower(body),lower(?))>0)");args.push(term);}
    }
    if(q.type){conditions.push("EXISTS (SELECT 1 FROM json_each(r.types) WHERE value=?)");args.push(q.type);}
    if(q.source){conditions.push("EXISTS (SELECT 1 FROM json_each(r.origins) WHERE value=?)");args.push(q.source);}
    for(const ids of [q.ids,q.savedIds])if(ids){conditions.push("r.id IN (SELECT value FROM json_each(?))");args.push(JSON.stringify(ids));}
    if(q.savedIdentities){conditions.push("json_extract(r.payload,'$.identity') IN (SELECT value FROM json_each(?))");args.push(JSON.stringify(q.savedIdentities));}
    if(q.capability){conditions.push(q.capability==="map"?"r.mappable=1":q.capability==="request"?"r.restricted=1":"r.local=1");}
    if(q.scope?.period){conditions.push("r.year_start IS NOT NULL AND r.year_start<=? AND coalesce(r.year_end,9999)>=?");args.push(q.scope.period[1],q.scope.period[0]);}
    if(q.scope?.utcWindow&&q.section==="timely"){conditions.push("r.observed>=? AND r.observed<?");args.push(new Date(q.scope.utcWindow[0]).toISOString(),new Date(q.scope.utcWindow[1]).toISOString());}
    const where=conditions.length?conditions.join(" AND "):"1";
    const counts={entities:0,clues:0,timely:0};
    for(const section of Object.keys(counts) as AccessSection[])counts[section]=Number(db.prepare(`SELECT count(DISTINCT r.dataset_key) AS n FROM access_records r WHERE ${where} AND r.${section}=1`).get(...args)!.n);
    const pages=Math.max(1,Math.ceil(counts[q.section]/q.limit)),page=Math.min(q.page,pages-1);
    const sectionWhere=where+` AND r.${q.section}=1`;
    const keys=db.prepare(`SELECT r.dataset_key FROM access_records r WHERE ${sectionWhere} GROUP BY r.dataset_key ORDER BY ${q.section==="timely"?"max(r.received) DESC,r.dataset_key DESC":"min(r.title) COLLATE NOCASE,r.dataset_key"} LIMIT ? OFFSET ?`).all(...args,q.limit,page*q.limit);
    const rows:AccessRow[]=keys.map(({dataset_key})=>{
      const matching=db.prepare(`SELECT r.payload FROM access_records r WHERE ${sectionWhere} AND r.dataset_key=? ORDER BY r.title,r.id`).all(...args,String(dataset_key)).map(r=>JSON.parse(String(r.payload)) as Entry);
      const related=db.prepare("SELECT payload FROM access_records WHERE dataset_key=? ORDER BY entities DESC,title,id").all(String(dataset_key)).map(r=>JSON.parse(String(r.payload)) as Entry);
      const main=matching[0];
      return {key:String(dataset_key),asset:main.asset,ids:matching.map(r=>r.asset.id),relatedIds:related.map(r=>r.asset.id),evidenceKinds:[...new Set(related.flatMap(r=>r.evidenceKinds))],
        papers:Math.max(...related.map(r=>r.papers)),entityId:related.find(r=>r.asset.holding)?.asset.id,observation:main.observation,mappable:main.mappable};
    });
    const types=db.prepare(`SELECT DISTINCT t.value AS value FROM access_records r,json_each(r.types) t WHERE r.${q.section}=1 ORDER BY t.value`).all().map(r=>String(r.value));
    const sourceIds=db.prepare(`SELECT DISTINCT o.value AS value FROM access_records r,json_each(r.origins) o WHERE r.${q.section}=1 ORDER BY o.value`).all().map(r=>String(r.value));
    const channels=q.section==="timely"?db.prepare(`SELECT json_extract(r.payload,'$.observation.sourceId') AS source_id,
      json_extract(r.payload,'$.observation.sourceName') AS name,count(*) AS n,max(r.received) AS latest FROM access_records r WHERE ${sectionWhere} GROUP BY source_id,name ORDER BY latest DESC`).all(...args)
      .map(r=>({id:String(r.source_id),name:String(r.name),count:Number(r.n),latest:String(r.latest)})):[];
    return {rows,total:counts[q.section],page,pages,limit:q.limit,counts,types,sources:sourceIds.map(id=>({id,label:sourceLabels[id]||id})),channels,revision,checkedAt:new Date().toISOString()};
  }
  return {replace,replaceAsync,search,initialized:()=>initialized,snapshot:()=>snapshot?JSON.parse(String(snapshot)) as AccessCatalogues:undefined,close:()=>{closed=true;finishClose();}};
}
export function dataAccessRouter(index:ReturnType<typeof dataAccessIndex>,refresh:()=>void|Promise<void>,streamStatus?:()=>{configured:number;sources:{id:string;name:string}[]},catalogueStatus?:()=>AccessCatalogues){
  const router=Router();
  router.post("/search",async(req,res)=>{
    const q=req.body;
    if(!q||!validAccessSection(q.section)||![q.query,q.type,q.source].every(s=>typeof s==="string"&&s.length<=1000)||
      !Number.isSafeInteger(q.page)||q.page<0||!Number.isSafeInteger(q.limit)||q.limit<1||q.limit>60||
      ![undefined,"","map","request","local"].includes(q.capability)||
      [q.ids,q.savedIds,q.savedIdentities].some(ids=>ids!==undefined&&(!Array.isArray(ids)||ids.length>50000||ids.some((id:unknown)=>typeof id!=="string"||id.length>500)))||
      q.scope?.period&&(!Array.isArray(q.scope.period)||q.scope.period.length!==2||!q.scope.period.every(Number.isFinite))||
      q.scope?.utcWindow&&(!Array.isArray(q.scope.utcWindow)||q.scope.utcWindow.length!==2||!q.scope.utcWindow.every(Number.isFinite)))
      {res.status(400).json({error:"数据触达查询条件无效。"});return;}
    try{await refresh();if(res.destroyed)return;const page=index.search(q);registerObservations(page.rows.flatMap(r=>r.observation?[r.observation]:[]));
      res.set("Cache-Control","no-store").json({...page,stream:streamStatus?.(),catalogues:catalogueStatus?.()});}
    catch{res.status(503).json({error:"数据索引暂时无法读取，请重试。"});}
  });
  return router;
}
