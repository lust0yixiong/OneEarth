import {createHash} from "node:crypto";
import type {PaperDatasetEvidence} from "../src/domain/paper-record";
import pg, { type PoolConfig, type PoolClient } from "pg";

export type ResearchQuestion={paperId:string;rqId:string;datasetId:string;paperTitle:string;question:string};
export type AssertionDatasetRow={
  ds_key:string;title:string|null;version:string|null;publisher:string|null;abstract:string|null;
  extent_geographic_bbox:unknown;extent_temporalelement:string|null;online_resources:unknown;
  paper_id:string|null;paper_doi:string|null;n_papers:number|null;dataset_id:string|null;
  usage_paper_id:string|null;paper_title:string|null;role_function:string|null;variables:string|null;study_context:string|null;
  questions:ResearchQuestion[];official:{source:string;spatial:string|null;temporal:string|null}[];
};
export function assertionPgConfig(env:NodeJS.ProcessEnv=process.env):PoolConfig|undefined {
  if(!env.ONEEARTH_ASSERTION_PG_HOST)return;
  return {host:env.ONEEARTH_ASSERTION_PG_HOST,port:Number(env.ONEEARTH_ASSERTION_PG_PORT||5432),
    database:env.ONEEARTH_ASSERTION_PG_DATABASE,user:env.ONEEARTH_ASSERTION_PG_USER,password:env.ONEEARTH_ASSERTION_PG_PASSWORD,
    ssl:false,max:2,connectionTimeoutMillis:8000,application_name:"oneearth-readonly",
    options:"-c default_transaction_read_only=on -c statement_timeout=15000 -c lock_timeout=2000 -c idle_in_transaction_session_timeout=30000"};
}
const QUESTION_SELECT=`SELECT m.paper_id AS "paperId",m.rq_id AS "rqId",m.dataset_id AS "datasetId",
  r.paper_title AS "paperTitle",r.task_text AS question FROM public.rc_member m
  JOIN public.rc_recipe r ON r.paper_id=m.paper_id AND r.rq_id=m.rq_id
  WHERE m.ds_key=$1 AND (m.paper_id,m.rq_id,m.dataset_id)>($2,$3,$4)
  ORDER BY m.paper_id,m.rq_id,m.dataset_id LIMIT $5`;
const PAGE_SELECT=`WITH page AS (SELECT * FROM public.dataset_metadata WHERE ds_key=ANY($1::text[]))
  SELECT m.ds_key,m.title,m.version,m.publisher,left(m.abstract,800) AS abstract,m.extent_geographic_bbox,
    m.extent_temporalelement,m.online_resources,m.paper_id,m.paper_doi,x.n_papers,
    u.dataset_id,u.paper_id AS usage_paper_id,split_part(u.paper_head,' ; ',1) AS paper_title,
    left(u.role_function,800) AS role_function,left(u.variables,500) AS variables,left(u.study_context,1200) AS study_context,
    COALESCE(q.questions,'[]'::json) AS questions,COALESCE(o.official,'[]'::json) AS official
  FROM page m LEFT JOIN public.ds_axis_meta x ON x.ds_key=m.ds_key
  LEFT JOIN LATERAL (SELECT e.* FROM public.ev_axis e WHERE e.ds_key=m.ds_key
    AND NULLIF(btrim(e.paper_id),'') IS NOT NULL AND NULLIF(btrim(e.dataset_id),'') IS NOT NULL
    ORDER BY (e.paper_id=m.paper_id) DESC NULLS LAST,e.doc_id,e.paper_id,e.dataset_id LIMIT 1) u ON true
  LEFT JOIN LATERAL (SELECT json_agg(v) AS questions FROM (
    SELECT a.paper_id AS "paperId",a.rq_id AS "rqId",a.dataset_id AS "datasetId",r.paper_title AS "paperTitle",r.task_text AS question
    FROM public.rc_member a JOIN public.rc_recipe r ON r.paper_id=a.paper_id AND r.rq_id=a.rq_id
    WHERE u.paper_id IS NOT NULL AND a.ds_key=m.ds_key ORDER BY a.paper_id,a.rq_id,a.dataset_id LIMIT 3) v) q ON true
  LEFT JOIN LATERAL (SELECT json_agg(json_build_object('source',d.source,'spatial',d.spatial,'temporal',d.temporal)
      ORDER BY d.source,d.spatial::text,d.temporal::text) AS official
    FROM public.ds_meta d WHERE d.ds_key=m.ds_key) o ON true
  ORDER BY m.ds_key COLLATE "C"`;

const METADATA_KEYS=`SELECT DISTINCT ds_key COLLATE "C" AS ds_key FROM public.dataset_metadata ORDER BY ds_key`;
function keyDigest(keys:string[]){
  const digest=createHash("sha256");
  for(const key of keys)digest.update(key+"\n");
  return digest.digest("hex");
}

/** Only fixed SELECTs are exposed; every source read uses both a read-only session and transaction. */
export function assertionReader(config:PoolConfig,pool:Pick<pg.Pool,"connect"|"end">=new pg.Pool(config)) {
  async function read<T>(work:(client:PoolClient)=>Promise<T>) {
    const client=await pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const status=await client.query("SELECT current_setting('transaction_read_only') AS transaction_read_only,current_setting('default_transaction_read_only') AS default_transaction_read_only");
      if(status.rows[0]?.transaction_read_only!=="on" || status.rows[0]?.default_transaction_read_only!=="on")throw Error("来源连接未处于只读状态，已停止读取。");
      return await work(client);
    } finally {try{await client.query("ROLLBACK");}finally{client.release();}}
  }
  return {
    snapshot:async(accept:(rows:AssertionDatasetRow[],loaded:number,total:number)=>Promise<void>|void)=>read(async client=>{
      const sourceClock=(await client.query<{snapshot:string;checkedAt:Date}>(
        `SELECT txid_current_snapshot()::text AS snapshot,transaction_timestamp() AS "checkedAt"`)).rows[0];
      const keys=(await client.query<{ds_key:string|null}>(METADATA_KEYS)).rows.map(row=>row.ds_key);
      if(!keys.every((key):key is string=>typeof key==="string"&&key.startsWith("doi:")&&key.length>4&&key.length<=1000)||
        new Set(keys).size!==keys.length)
        throw Error("源元数据含无效或重复 DOI 身份，已保留原目录。");
      for(let offset=0;offset<keys.length;offset+=250){
        const page=keys.slice(offset,offset+250);
        const rows=(await client.query<AssertionDatasetRow>(PAGE_SELECT,[page])).rows;
        if(rows.length!==page.length||rows.some((row,i)=>row.ds_key!==page[i]))
          throw Error("断言源分页与固定 metadata 身份清单不一致，已保留原目录。");
        await accept(rows,offset+rows.length,keys.length);
      }
      return {total:keys.length,metadataSha:keyDigest(keys),readOnly:true,
        checkedAt:sourceClock.checkedAt.toISOString(),sourceSnapshot:sourceClock.snapshot};
    }),
    questions:async(dsKey:string,cursor="")=>read(async client=>{
      let after=["","",""];
      if(cursor){const decoded=JSON.parse(Buffer.from(cursor,"base64url").toString());if(!Array.isArray(decoded)||decoded.length!==3||!decoded.every(v=>typeof v==="string"&&v.length<=500))throw Error("研究问题游标无效。");after=decoded;}
      const rows=(await client.query<ResearchQuestion>(QUESTION_SELECT,[dsKey,...after,51])).rows;
      const items=rows.slice(0,50),last=items.at(-1);
      return {items,nextCursor:rows.length>50&&last?Buffer.from(JSON.stringify([last.paperId,last.rqId,last.datasetId])).toString("base64url"):null};
    }),
    evidence:async(dsKey:string,identities:{paperId:string;datasetId:string}[]):Promise<PaperDatasetEvidence>=>read(async client=>{
      const dataset=await client.query(`SELECT title,abstract AS description,publisher,version,
        spatial_resolution AS "spatialResolution",temporal_resolution AS "temporalResolution",
        resource_type AS "resourceType" FROM public.dataset_metadata WHERE ds_key=$1 LIMIT 1`,[dsKey]);
      const pairs=JSON.stringify(identities.slice(0,30));
      const usages=await client.query(`SELECT e.paper_id AS "paperId",e.dataset_id AS "datasetId",
        split_part(e.paper_head,' ; ',1) AS title,e.abstract,
        e.role_function AS usage,e.variables,e.study_context AS context
        FROM public.ev_axis e
        JOIN jsonb_to_recordset($2::jsonb) AS x("paperId" text,"datasetId" text)
          ON e.paper_id=x."paperId" AND e.dataset_id=x."datasetId"
        WHERE e.ds_key=$1 ORDER BY e.doc_id LIMIT 30`,[dsKey,pairs]);
      const quotes=await client.query(`SELECT l.paper_id AS "paperId",l.dataset_id AS "datasetId",
        q.block_id AS "blockId",q.section,q.quote,array_agg(DISTINCT l.claim_kind) AS claims
        FROM public.ev_quote_link l
        JOIN public.ev_quote q ON q.paper_id=l.paper_id AND q.block_id=l.block_id
        JOIN jsonb_to_recordset($2::jsonb) AS x("paperId" text,"datasetId" text)
          ON l.paper_id=x."paperId" AND l.dataset_id=x."datasetId"
        WHERE EXISTS(SELECT 1 FROM public.ev_axis e
          WHERE e.ds_key=$1 AND e.paper_id=l.paper_id AND e.dataset_id=l.dataset_id)
        GROUP BY l.paper_id,l.dataset_id,q.block_id,q.section,q.quote
        ORDER BY l.paper_id,l.dataset_id,q.block_id LIMIT 300`,[dsKey,pairs]);
      const methods=await client.query(`SELECT DISTINCT m.paper_id AS "paperId",s.step_id AS "stepId",
        s.step_name AS name,s.purpose,s.method,s.step_order AS "order"
        FROM public.rc_member_step m
        JOIN public.rc_step s ON s.paper_id=m.paper_id AND s.rq_id=m.rq_id AND s.step_id=m.step_id
        JOIN jsonb_to_recordset($2::jsonb) AS x("paperId" text,"datasetId" text) ON m.paper_id=x."paperId"
        WHERE m.ds_key=$1 AND EXISTS(SELECT 1 FROM public.ev_axis e
          WHERE e.ds_key=$1 AND e.paper_id=x."paperId" AND e.dataset_id=x."datasetId")
        ORDER BY m.paper_id,s.step_order,s.step_id LIMIT 200`,[dsKey,pairs]);
      return {dataset:dataset.rows[0]||null,papers:usages.rows.map(u=>({...u,
        quotes:quotes.rows.filter(q=>q.paperId===u.paperId && q.datasetId===u.datasetId),
        methods:methods.rows.filter(step=>step.paperId===u.paperId)}))};
    }),
    close:()=>pool.end(),
  };
}
let reader:ReturnType<typeof assertionReader>|undefined;
export function configuredAssertionReader() {
  const config=assertionPgConfig();
  return config ? reader??=assertionReader(config) : undefined;
}
