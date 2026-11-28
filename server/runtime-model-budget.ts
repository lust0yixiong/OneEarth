import {createHash,randomUUID} from "node:crypto";
import type {Pool,PoolClient} from "pg";
import {TaskConflict} from "./task-store";

// Preserve the existing relay ceiling for serialized JSON, including escaping
// and provider wrappers. The synthesis prompt itself still has its own 256 KiB cap.
const requestBytes=512*1024;
// Existing stage ceilings: 4 foreground decisions, 1 public body, 1 initial
// background decision, 8 evidence decisions, 1 answer, 3 repairs, 2 calculation steps.
const requestCount=4+1+1+8+1+3+2;
export const runtimeModelBudgetLimits={requestBytes,requestCount,totalBytes:requestCount*requestBytes};
export type ModelRequestKind="responses-api"|"responses-relay"|"cli-visible-input";
export type ModelUsage={inputTokens:number;outputTokens:number};
export type ModelRequestReservation={recordUsage:(usage:ModelUsage)=>Promise<void>};
export type ReserveModelRequest=(body:Buffer,kind:ModelRequestKind)=>Promise<ModelRequestReservation|undefined>;

export function modelUsage(value:unknown):ModelUsage|undefined {
  if(!value||typeof value!=="object")return;
  const usage=value as {input_tokens?:number;output_tokens?:number;total_tokens?:number};
  const {input_tokens:inputTokens,output_tokens:outputTokens,total_tokens:total}=usage;
  if(typeof inputTokens!=="number"||typeof outputTokens!=="number"||!Number.isSafeInteger(inputTokens)||
    !Number.isSafeInteger(outputTokens)||!Number.isSafeInteger(total)||inputTokens<0||outputTokens<0||total!==inputTokens+outputTokens)return;
  return {inputTokens,outputTokens};
}

export function assertRuntimeModelRequestSize(bytes:number) {
  if(bytes>runtimeModelBudgetLimits.requestBytes)throw Error("本次模型请求超过完整输入字节预算，未发送。");
}

// Both the task store and the model capacity process can start first. Serialize
// their creation of the shared mapping under the same migration lock.
export const runtimeModelBudgetOwnersSchema=`
  SELECT pg_advisory_xact_lock(7142542);
  CREATE TABLE IF NOT EXISTS runtime_model_budget_owners (
    execution_task_id uuid PRIMARY KEY, owner_id uuid NOT NULL
  );
  CREATE TABLE IF NOT EXISTS runtime_model_budgets (
    task_id uuid PRIMARY KEY, requests integer NOT NULL, input_bytes integer NOT NULL
  );`;

export const runtimeModelBudgetSchema=runtimeModelBudgetOwnersSchema+`
  CREATE TABLE IF NOT EXISTS runtime_model_request_receipts (
    id uuid PRIMARY KEY, task_id uuid NOT NULL REFERENCES runtime_model_budgets(task_id),
    ordinal integer NOT NULL, transport text NOT NULL, input_bytes integer NOT NULL,
    input_sha256 text NOT NULL, reserved_at timestamptz NOT NULL DEFAULT now(),
    provider_input_tokens bigint, provider_output_tokens bigint, UNIQUE(task_id,ordinal)
  );
  ALTER TABLE runtime_model_request_receipts ADD COLUMN IF NOT EXISTS execution_task_id uuid;
`;

/** Attach an admitted operation task or continuation before it can dispatch.
 * A live or previously used independent task cannot be moved to a new ledger. */
export async function bindRuntimeModelBudgetOwner(db:PoolClient,executionId:string,ownerId:string) {
  const bound=await db.query(`INSERT INTO runtime_model_budget_owners AS binding(execution_task_id,owner_id)
    SELECT $1::uuid,$2::uuid WHERE $1::uuid=$2::uuid OR NOT EXISTS (SELECT 1 FROM runtime_model_budgets WHERE task_id=$1::uuid)
    ON CONFLICT(execution_task_id) DO UPDATE SET owner_id=binding.owner_id
    WHERE binding.owner_id=EXCLUDED.owner_id`,[executionId,ownerId]);
  if(!bound.rowCount)throw new TaskConflict("该执行已有不同的累计模型预算归属。");
}

/** Reserve exactly one dispatch or inspected CLI spawn. Unknown outcomes keep
 * their reservation. A recovered fold that reuses a result never dispatches. */
export async function reserveRuntimeModelRequest(pool:Pick<Pool,"query">,taskId:string,body:Buffer,kind:ModelRequestKind,lease:{slot:number;owner:string}):Promise<ModelRequestReservation> {
  assertRuntimeModelRequestSize(body.length);
  const id=randomUUID(),hash=createHash("sha256").update(body).digest("hex");
  const saved=await pool.query(`
    WITH active_lease AS (
      SELECT 1 FROM runtime_model_slots WHERE slot=$8 AND owner=$9 AND task_id=$1
        AND lease_until>(extract(epoch FROM clock_timestamp())*1000)::bigint FOR SHARE
    ), execution_owner AS (
      INSERT INTO runtime_model_budget_owners AS binding(execution_task_id,owner_id)
      SELECT $1,$1 WHERE EXISTS(SELECT 1 FROM active_lease)
      ON CONFLICT(execution_task_id) DO UPDATE SET owner_id=binding.owner_id RETURNING owner_id
    ), reserved AS (
      INSERT INTO runtime_model_budgets AS budget(task_id,requests,input_bytes)
      SELECT owner_id,1,$2 FROM execution_owner
      ON CONFLICT(task_id) DO UPDATE SET requests=budget.requests+1,input_bytes=budget.input_bytes+EXCLUDED.input_bytes
      WHERE budget.requests<$3 AND budget.input_bytes+EXCLUDED.input_bytes<=$4
      RETURNING task_id,requests
    )
    INSERT INTO runtime_model_request_receipts(id,task_id,ordinal,transport,input_bytes,input_sha256,execution_task_id)
    SELECT $5,task_id,requests,$6,$2,$7,$1 FROM reserved`,
    [taskId,body.length,runtimeModelBudgetLimits.requestCount,runtimeModelBudgetLimits.totalBytes,id,kind,hash,lease.slot,lease.owner]);
  if(!saved.rowCount)throw Error("本轮累计模型预算不足或执行名额已失效，未发送请求。");
  return {async recordUsage(usage){
    await pool.query(`UPDATE runtime_model_request_receipts SET provider_input_tokens=$2,provider_output_tokens=$3
      WHERE id=$1 AND provider_input_tokens IS NULL`,[id,usage.inputTokens,usage.outputTokens]);
  }};
}
