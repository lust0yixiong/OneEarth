import {hostname} from "node:os";
import {randomUUID} from "node:crypto";
import type {Pool} from "pg";
import {productDatabase} from "./product-database";

export const runtimeLeaseMs=15000;
export class ModelCapacityUnavailable extends Error {constructor(){super("模型执行容量暂满；本次没有启动模型请求。");}}
function number(value:string|undefined,fallback:number,min:number,max:number){const parsed=value===undefined?fallback:Number(value);if(!Number.isSafeInteger(parsed)||parsed<min||parsed>max)throw Error("运行时模型并发配置无效。");return parsed;}
export function runtimeModelLimits(){const total=number(process.env.ONEEARTH_RUNTIME_MODEL_CONCURRENCY,3,1,32),foreground=number(process.env.ONEEARTH_RUNTIME_FOREGROUND_RESERVED,1,1,total);return {total,foreground};}
export async function createRuntimeModelCapacity(pool:Pick<Pool,"query"|"connect">,limits=runtimeModelLimits()){
 const migration=await pool.connect();
 try{
  await migration.query("BEGIN");await migration.query("SET LOCAL lock_timeout='5000ms'");await migration.query("SELECT pg_advisory_xact_lock(7142540)");
  await migration.query(`CREATE TABLE IF NOT EXISTS runtime_model_slots(slot integer PRIMARY KEY,owner uuid,role text,task_id uuid,lease_until bigint NOT NULL DEFAULT 0)`);
  await migration.query("ALTER TABLE runtime_model_slots ADD COLUMN IF NOT EXISTS owner_host text;ALTER TABLE runtime_model_slots ADD COLUMN IF NOT EXISTS owner_pid integer;ALTER TABLE runtime_model_slots ADD COLUMN IF NOT EXISTS child_pid integer");
  for(let slot=0;slot<limits.total;slot++)await migration.query("INSERT INTO runtime_model_slots(slot) VALUES($1) ON CONFLICT DO NOTHING",[slot]);
  await migration.query("COMMIT");
 }catch(error){await migration.query("ROLLBACK").catch(()=>{});throw error;}finally{migration.release();}
 return {async acquire(role:"foreground"|"background",taskId?:string){
  const owner=randomUUID(),client=await pool.connect();
  try{
   await client.query("BEGIN");
   const {rows}=await client.query<{slot:number;owner:string|null;owner_host:string|null;owner_pid:number|null;child_pid:number|null}>(`SELECT slot,owner,owner_host,owner_pid,child_pid FROM runtime_model_slots WHERE slot<$1 AND ($2='foreground' OR slot>=$3)
    AND (owner IS NULL OR lease_until<(extract(epoch FROM clock_timestamp())*1000)::bigint) ORDER BY owner IS NOT NULL,slot FOR UPDATE SKIP LOCKED`,[limits.total,role,limits.foreground]);
   const alive=(pid:number|null)=>{if(!pid)return false;try{process.kill(pid,0);return true;}catch(error){return (error as NodeJS.ErrnoException).code!=="ESRCH";}};
   const slot=rows.find(row=>!row.owner||row.owner_host===hostname()&&!!row.owner_pid&&!alive(row.owner_pid)&&!alive(row.child_pid));
   if(!slot)throw new ModelCapacityUnavailable();
   await client.query("UPDATE runtime_model_slots SET owner=$2,role=$3,task_id=$4,lease_until=(extract(epoch FROM clock_timestamp())*1000)::bigint+$5,owner_host=$6,owner_pid=$7,child_pid=NULL WHERE slot=$1",[slot.slot,owner,role,taskId??null,runtimeLeaseMs,hostname(),process.pid]);
   await client.query("COMMIT");
   return {async attachProcess(pid:number){
     if(!Number.isSafeInteger(pid)||pid<=0||!(await pool.query("UPDATE runtime_model_slots SET child_pid=$3 WHERE slot=$1 AND owner=$2 AND lease_until>(extract(epoch FROM clock_timestamp())*1000)::bigint",[slot.slot,owner,pid])).rowCount)throw new ModelCapacityUnavailable();
    },async renew(){return !!(await pool.query(`UPDATE runtime_model_slots SET lease_until=(extract(epoch FROM clock_timestamp())*1000)::bigint+$3
    WHERE slot=$1 AND owner=$2 AND lease_until>(extract(epoch FROM clock_timestamp())*1000)::bigint`,[slot.slot,owner,runtimeLeaseMs])).rowCount;},
    async release(){await pool.query("UPDATE runtime_model_slots SET owner=NULL,role=NULL,task_id=NULL,lease_until=0,owner_host=NULL,owner_pid=NULL,child_pid=NULL WHERE slot=$1 AND owner=$2",[slot.slot,owner]);}};
  }catch(error){await client.query("ROLLBACK").catch(()=>{});throw error;}finally{client.release();}
 }};
}
let singleton:ReturnType<typeof createRuntimeModelCapacity>|undefined;
let ownedPool:Pool|undefined;
/** Discovery has its own static allocation; only runtime roles receive this DB. */
export function runtimeModelCapacity(){
 if(!process.env.ONEEARTH_RUNTIME_DATABASE_URL)return;
 if(!singleton){const pool=ownedPool=productDatabase("RUNTIME");const attempt=createRuntimeModelCapacity(pool);singleton=attempt;
  void attempt.catch(()=>{if(singleton===attempt){singleton=undefined;ownedPool=undefined;}void pool.end().catch(()=>{});});}
 return singleton;
}
export async function closeRuntimeModelCapacity(){const pool=ownedPool;ownedPool=undefined;singleton=undefined;await pool?.end();}
