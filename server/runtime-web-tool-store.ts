import {createHash,randomBytes,randomUUID} from "node:crypto";
import {Pool,type PoolClient} from "pg";
import {productDatabase} from "./product-database";
import type {ChatModel} from "../src/domain/chat-model";
import {publicPage} from "./fetch-pages";
import {webToolGrantPattern,type WebToolCall,type WebToolOperation,type WebToolReceipt} from "./web-tool-contract";

export type WebGrantInput={researchTaskId:string;messageId:string;kind:"discovery"|"source-read";allowSearch:boolean;allowFetch:boolean;
  deepseekSearch:boolean;deepseekFetch:boolean;urls?:string[];nativeModel?:ChatModel};
export type RuntimeWebToolAuthority={reserve(input:WebGrantInput):Promise<string>;bind(token:string,taskId:string):Promise<void>;revoke(token:string):Promise<void>};
type Policy=Omit<WebGrantInput,"researchTaskId"|"messageId"|"kind">;
type Grant={digest:string;research_id:string;message_id:string;discovery_id:string|null;kind:WebGrantInput["kind"];expires:string;revoked:boolean;policy:Policy};
export type WebToolClaim={callId:string;lease:string;operation:WebToolOperation;nativeModel?:ChatModel;sourceSnapshotScope?:string};
export class WebToolAccessError extends Error{constructor(readonly status:number,message:string){super(message);}}
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const hash=(v:string)=>createHash("sha256").update(v).digest("hex");
const canonical=(v:unknown):string=>JSON.stringify(v,(_key,value)=>value&&typeof value==="object"&&!Array.isArray(value)?Object.fromEntries(Object.keys(value).sort().map(k=>[k,value[k]])):value);
const unavailable:WebToolReceipt={state:"failed",error:{message:"上次工具执行中断，结果未知；未自动重新执行。",code:"WEB_TOOL_OUTCOME_UNKNOWN"}};
const cancelled:WebToolReceipt={state:"failed",error:{message:"本轮工具授权已结束或研究任务已停止。",code:"WEB_TOOL_GRANT_ENDED"}};
const normalizedUrl=(raw:string)=>{const value=publicPage(raw);if(!value)throw new WebToolAccessError(403,"只允许公开来源地址。");const u=new URL(value);u.hash="";return u.href;};
function authorize(grant:Grant,call:WebToolCall){
  if(call.taskId!==grant.discovery_id||call.messageId!==grant.message_id)throw new WebToolAccessError(403,"工具请求不属于本次已受理委托。");
  const p=grant.policy,op=call.operation;
  if(op.kind==="search"){
    if(!p.allowSearch||grant.kind==="source-read"||op.provider==="DeepSeek Search"&&!p.deepseekSearch)throw new WebToolAccessError(403,"本轮没有该 Search 供应的执行许可。");
  }else if(op.kind==="native-search"){
    if(!p.allowSearch||grant.kind==="source-read"||p.nativeModel?.executor!=="codex"||p.nativeModel.provider&&p.nativeModel.provider!=="native")throw new WebToolAccessError(403,"本轮没有已授权的原生搜索执行器。");
  }else{
    if(!p.allowFetch||op.provider==="DeepSeek Fetch"&&!p.deepseekFetch)throw new WebToolAccessError(403,"本轮没有该 Fetch 供应的执行许可。");
    if(op.locators&&grant.kind!=="source-read")throw new WebToolAccessError(403,"明确位置仅用于已授权 URL 的定向补读。");
    if(grant.kind==="source-read"){
      if(op.provider==="Zenodo 索引")throw new WebToolAccessError(403,"定向 URL 补读未授权归档索引或附件发现。");
      const urls=p.urls||[],url=normalizedUrl(op.url),identity=normalizedUrl(op.hit.url);
      if(!urls.includes(url)||!urls.includes(identity)||op.locators&&url!==identity)
        throw new WebToolAccessError(403,"定向补读只能读取本轮明确指定的 URL。");
      // The exact-URL authority does not authorize discovery-supplied DOI or
      // landing-page metadata to trigger a different source fallback.
      return {...op,hit:{title:op.hit.title,url:op.hit.url,snippet:op.hit.snippet,discoveredBy:op.hit.discoveredBy}} satisfies WebToolOperation;
    }
  }
  return op;
}

/** Private runtime receipts. No bearer token is persisted, emitted or logged. */
export async function runtimeWebToolStore(options:{pool?:Pool;now?:()=>number;ttlMs?:number;maxQueued?:number;maxCallsPerGrant?:number}={}){
  const pool=options.pool??productDatabase("RUNTIME"),now=options.now??Date.now,ttl=options.ttlMs??15*60_000;
  const maxQueued=options.maxQueued??256,maxCalls=options.maxCallsPerGrant??128;
  if(![maxQueued,maxCalls].every(n=>Number.isSafeInteger(n)&&n>0&&n<=4096))throw Error("Invalid web tool admission budget");
  if(!Number.isSafeInteger(ttl)||ttl<1000||ttl>60*60_000)throw Error("Invalid web tool grant lifetime");
  await transaction(async db=>{await db.query("SELECT pg_advisory_xact_lock($1::bigint)",[BigInt("0x"+hash("oneearth.runtime.web-tool.schema.v1").slice(0,15)).toString()]);
    await db.query(`CREATE TABLE IF NOT EXISTS runtime_web_tool_grants(
    digest text PRIMARY KEY,research_id uuid NOT NULL REFERENCES runtime_tasks(id),message_id uuid NOT NULL,
    discovery_id uuid,kind text NOT NULL CHECK(kind IN ('discovery','source-read')),expires bigint NOT NULL,
    revoked boolean NOT NULL DEFAULT false,policy jsonb NOT NULL);
    CREATE INDEX IF NOT EXISTS runtime_web_tool_grants_parent ON runtime_web_tool_grants(research_id);
    CREATE TABLE IF NOT EXISTS runtime_web_tool_calls(
      call_id uuid PRIMARY KEY,grant_digest text NOT NULL REFERENCES runtime_web_tool_grants(digest),fingerprint text NOT NULL,input jsonb NOT NULL,
      state text NOT NULL CHECK(state IN ('queued','running','complete','failed')),lease uuid,receipt jsonb,created bigint NOT NULL);
    CREATE INDEX IF NOT EXISTS runtime_web_tool_calls_queued ON runtime_web_tool_calls(state,created);`);});
  let owner:PoolClient|undefined,healthy=true;
  const lock=hash("oneearth.runtime.web-tool.coordinator.v1").slice(0,15);
  const admissionLock=BigInt("0x"+hash("oneearth.runtime.web-tool.admission.v1").slice(0,15)).toString();
  async function transaction<T>(fn:(db:PoolClient)=>Promise<T>){const db=await pool.connect();try{await db.query("BEGIN");const value=await fn(db);await db.query("COMMIT");return value;}catch(error){await db.query("ROLLBACK").catch(()=>{});throw error;}finally{db.release();}}
  function available(){if(!healthy)throw new WebToolAccessError(503,"运行时工具执行通道暂时不可用。");}
  async function discardEnded(db:PoolClient){
    await db.query(`UPDATE runtime_web_tool_calls c SET state='failed',lease=NULL,receipt=$2::jsonb
      FROM runtime_web_tool_grants g,runtime_tasks t WHERE c.grant_digest=g.digest AND t.id=g.research_id
      AND c.state IN ('queued','running') AND (g.revoked OR g.expires<=$1 OR t.status<>'running')`,[now(),JSON.stringify(cancelled)]);
  }
  async function activeGrant(db:PoolClient,digest:string):Promise<Grant>{
    const read=(await db.query<Grant>("SELECT * FROM runtime_web_tool_grants WHERE digest=$1",[digest])).rows[0];
    if(!read)throw new WebToolAccessError(403,"工具授权无效。");
    const root=(await db.query<{status:string}>("SELECT status FROM runtime_tasks WHERE id=$1 FOR UPDATE",[read.research_id])).rows[0];
    const current=(await db.query<Grant>("SELECT * FROM runtime_web_tool_grants WHERE digest=$1 FOR UPDATE",[digest])).rows[0];
    if(!current||root?.status!=="running"||current.revoked||Number(current.expires)<=now())throw new WebToolAccessError(403,"本轮工具授权已结束或研究任务已停止。");
    return current;
  }
  return {
    async reserve(input:WebGrantInput){
      available();if(!uuid.test(input.researchTaskId)||!uuid.test(input.messageId)||!["discovery","source-read"].includes(input.kind))throw Error("Invalid runtime delegation identity");
      if(![input.allowSearch,input.allowFetch,input.deepseekSearch,input.deepseekFetch].every(v=>typeof v==="boolean"))throw Error("Invalid runtime tool permission");
      const token=randomBytes(32).toString("base64url"),urls=[...new Set((input.urls||[]).map(normalizedUrl))];
      if(input.kind==="source-read"&&(!urls.length||urls.length>3||input.allowSearch))throw Error("Exact read grant requires only one to three explicit URLs");
      const nativeModel=input.nativeModel?.executor==="codex"&&(!input.nativeModel.provider||input.nativeModel.provider==="native")?
        {executor:"codex" as const,provider:"native" as const,model:input.nativeModel.model}:undefined;
      const policy:Policy={allowSearch:input.allowSearch,allowFetch:input.allowFetch,deepseekSearch:input.deepseekSearch,deepseekFetch:input.deepseekFetch,
        ...(input.kind==="source-read"?{urls}:{}),...(nativeModel?{nativeModel}:{})};
      await transaction(async db=>{const root=(await db.query<{status:string}>("SELECT status FROM runtime_tasks WHERE id=$1 FOR UPDATE",[input.researchTaskId])).rows[0];
        if(root?.status!=="running")throw new WebToolAccessError(403,"研究任务已停止，不能授予新工具许可。");
        await db.query("INSERT INTO runtime_web_tool_grants(digest,research_id,message_id,kind,expires,policy) VALUES($1,$2,$3,$4,$5,$6::jsonb)",[hash(token),input.researchTaskId,input.messageId,input.kind,now()+ttl,JSON.stringify(policy)]);});
      return token;
    },
    async bind(token:string,taskId:string){
      available();if(!webToolGrantPattern.test(token)||!uuid.test(taskId))throw new WebToolAccessError(403,"发现受理身份无效。");
      await transaction(async db=>{const grant=await activeGrant(db,hash(token));if(grant.discovery_id&&grant.discovery_id!==taskId)throw new WebToolAccessError(409,"工具授权已经绑定另一受理任务。");
        await db.query("UPDATE runtime_web_tool_grants SET discovery_id=$2 WHERE digest=$1",[grant.digest,taskId]);});
    },
    async revoke(token:string){if(!webToolGrantPattern.test(token))return;await pool.query("UPDATE runtime_web_tool_grants SET revoked=true WHERE digest=$1",[hash(token)]);},
    async request(token:string,call:WebToolCall):Promise<WebToolReceipt>{
      available();if(!webToolGrantPattern.test(token))throw new WebToolAccessError(403,"工具授权无效。");
      return transaction(async db=>{
        const grant=await activeGrant(db,hash(token));
        if(call.messageId!==grant.message_id)throw new WebToolAccessError(403,"工具请求不属于本次委托。");
        if(!grant.discovery_id)throw new WebToolAccessError(425,"原发现委托尚未确认受理，请稍后查询。");
        const operation=authorize(grant,call),fingerprint=hash(canonical(call));
        await db.query("SELECT pg_advisory_xact_lock($1::bigint)",[admissionLock]);
        await discardEnded(db);
        const old=(await db.query<{grant_digest:string;fingerprint:string;receipt:WebToolReceipt|null}>("SELECT grant_digest,fingerprint,receipt FROM runtime_web_tool_calls WHERE call_id=$1",[call.callId])).rows[0];
        if(old){if(old.grant_digest!==grant.digest||old.fingerprint!==fingerprint)throw new WebToolAccessError(409,"同一工具调用编号已经用于不同输入。");return old.receipt??{state:"pending"};}
        const count=(await db.query<{queued:string;own:string}>("SELECT count(*) FILTER(WHERE state IN ('queued','running')) AS queued,count(*) FILTER(WHERE grant_digest=$1) AS own FROM runtime_web_tool_calls",[grant.digest])).rows[0];
        if(Number(count.queued)>=maxQueued||Number(count.own)>=maxCalls)throw new WebToolAccessError(429,"本轮工具调用预算或执行队列已满。");
        await db.query(`INSERT INTO runtime_web_tool_calls(call_id,grant_digest,fingerprint,input,state,created) VALUES($1,$2,$3,$4::jsonb,'queued',$5)`,[call.callId,grant.digest,fingerprint,JSON.stringify({...call,operation}),now()]);
        return {state:"pending"};
      });
    },
    async coordinate(onLost:()=>void){
      if(owner)throw Error("Web tool coordinator already attached");const conn=await pool.connect();
      try{if(!(await conn.query("SELECT pg_try_advisory_lock($1::bigint) AS locked",[BigInt("0x"+lock).toString()])).rows[0].locked)throw Error("A runtime web tool coordinator already exists");
        owner=conn;conn.on("error",()=>{healthy=false;onLost();});
        await pool.query("UPDATE runtime_web_tool_calls SET state='failed',lease=NULL,receipt=$1::jsonb WHERE state='running'",[JSON.stringify(unavailable)]);
      }catch(error){conn.release(true);owner=undefined;throw error;}
    },
    async claim():Promise<WebToolClaim|undefined>{
      available();return transaction(async db=>{await db.query("SELECT pg_advisory_xact_lock($1::bigint)",[admissionLock]);await discardEnded(db);
        const row=(await db.query<{call_id:string;input:WebToolCall;policy:Policy;kind:WebGrantInput["kind"];research_id:string}>(`SELECT c.call_id,c.input,g.policy,g.kind,g.research_id FROM runtime_web_tool_calls c
        JOIN runtime_web_tool_grants g ON g.digest=c.grant_digest JOIN runtime_tasks t ON t.id=g.research_id
        WHERE c.state='queued' AND NOT g.revoked AND g.discovery_id IS NOT NULL AND g.expires>$1 AND t.status='running'
        ORDER BY c.created,c.call_id LIMIT 1 FOR UPDATE OF c SKIP LOCKED`,[now()])).rows[0];if(!row)return;
        const lease=randomUUID();await db.query("UPDATE runtime_web_tool_calls SET state='running',lease=$2 WHERE call_id=$1",[row.call_id,lease]);
        return {callId:row.call_id,lease,operation:row.input.operation,nativeModel:row.policy.nativeModel,
          ...(row.kind==="source-read"?{sourceSnapshotScope:row.research_id}:{})};});
    },
    async active(call:WebToolClaim){
      available();return !!(await pool.query(`SELECT 1 FROM runtime_web_tool_calls c JOIN runtime_web_tool_grants g ON g.digest=c.grant_digest JOIN runtime_tasks t ON t.id=g.research_id
        WHERE c.call_id=$1 AND c.lease=$2 AND c.state='running' AND NOT g.revoked AND g.expires>$3 AND t.status='running'`,[call.callId,call.lease,now()])).rowCount;
    },
    async finish(call:WebToolClaim,receipt:Exclude<WebToolReceipt,{state:"pending"}>){
      available();if(Buffer.byteLength(JSON.stringify(receipt))>2*1024*1024)receipt={state:"failed",error:{message:"工具结果超过保存限制。",code:"WEB_TOOL_RESULT_LIMIT"}};
      await transaction(async db=>{const row=(await db.query<{grant_digest:string}>("SELECT grant_digest FROM runtime_web_tool_calls WHERE call_id=$1",[call.callId])).rows[0];if(!row)return;
        let value:WebToolReceipt=receipt;try{await activeGrant(db,row.grant_digest);}catch(error){if(!(error instanceof WebToolAccessError))throw error;value=cancelled;}
        await db.query("UPDATE runtime_web_tool_calls SET state=$3,receipt=$4::jsonb,lease=NULL WHERE call_id=$1 AND lease=$2 AND state='running'",[call.callId,call.lease,value.state,JSON.stringify(value)]);});
    },
    async close(){healthy=false;owner?.release();owner=undefined;await pool.end();},
  };
}
export type RuntimeWebToolStore=Awaited<ReturnType<typeof runtimeWebToolStore>>;
