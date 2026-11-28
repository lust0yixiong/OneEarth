import {createHash, randomUUID} from "node:crypto";
import type {Pool, PoolClient} from "pg";
import {runtimeTaskLease} from "./runtime-task-lease";
import {bindRuntimeModelBudgetOwner,runtimeModelBudgetOwnersSchema} from "./runtime-model-budget";
import {TaskConflict, taskIdPattern, type Payload, type TaskStatus} from "./task-store";

export const runtimeOperationsSchema = runtimeModelBudgetOwnersSchema+`
  ALTER TABLE runtime_tasks ADD COLUMN IF NOT EXISTS task_type text NOT NULL DEFAULT 'run'
    CHECK (task_type IN ('run', 'operation'));
  CREATE TABLE IF NOT EXISTS runtime_operations (
    operation_id uuid PRIMARY KEY REFERENCES runtime_tasks(id),
    body jsonb NOT NULL,
    admission_checkpoint jsonb NOT NULL,
    admission_wait jsonb,
    admission_transaction bigint NOT NULL DEFAULT txid_current(),
    current_step_id uuid,
    suspended boolean NOT NULL DEFAULT false,
    result jsonb
  );
  CREATE TABLE IF NOT EXISTS runtime_operation_runs (
    run_id uuid PRIMARY KEY,
    operation_id uuid NOT NULL REFERENCES runtime_operations(operation_id),
    turn_id uuid NOT NULL,
    ordinal integer NOT NULL,
    UNIQUE(operation_id, ordinal)
  );
  CREATE TABLE IF NOT EXISTS runtime_operation_steps (
    operation_id uuid NOT NULL REFERENCES runtime_operations(operation_id),
    step_id uuid NOT NULL,
    ordinal integer NOT NULL,
    wait jsonb NOT NULL,
    state text NOT NULL CHECK (state IN ('waiting', 'received', 'expired', 'cancelled', 'failed')),
    request_id uuid UNIQUE,
    receipt jsonb,
    PRIMARY KEY(operation_id, step_id),
    UNIQUE(operation_id, ordinal)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS runtime_operation_one_wait
    ON runtime_operation_steps(operation_id) WHERE state='waiting';`;

export type OperationWaitKind = "human" | "browser" | "service";
export type OperationBinding = {runId:string; conversationId:string; turnId:string};
export type OperationWait = {
  stepId:string;
  kind:OperationWaitKind;
  request:Payload;
  owner?:string;
  expiresAt?:number;
};
export type RuntimeOperationBody = {
  type:"workspace-operation";
  operationId:string;
  runId?:string;
  conversationId:string;
  turnId?:string;
  kind:string;
  input:Payload;
};
export type OperationCreate = Omit<RuntimeOperationBody,"type"> & {checkpoint?:Payload; wait?:OperationWait; wakeAt?:number};
export type RuntimeOperation = RuntimeOperationBody & {
  status:TaskStatus;
  currentStepId?:string;
  activeRunId?:string;
  activeTurnId?:string;
  checkpoint?:Payload;
  result?:Payload;
};
export type OperationReceipt = {
  operationId:string;
  stepId:string;
  kind:OperationWaitKind;
  owner?:string;
  requestId?:string;
  receiptId:string;
  payload:Payload;
  checkpoint?:Payload;
};
export type RuntimeOperationStep = OperationWait & {
  operationId:string;
  ordinal:number;
  state:"waiting" | "received" | "expired" | "cancelled" | "failed";
  requestId?:string;
  receipt?:{receiptId:string; payload:Payload; receivedAt:number; late:boolean};
};
type WaitOptions = {releaseLease?:boolean; wakeAt?:number; runId?:string};
type ReceiptOptions = {resumeRun?:OperationBinding; wake?:boolean; requireLease?:boolean};
type ReceiptResult = {status:"accepted"|"duplicate"|"late"|"conflict"|"missing"; step?:RuntimeOperationStep};
type OperationProjection = (db:PoolClient, operation:RuntimeOperation) => Promise<unknown>;
type TaskTerminal = "complete" | "failed" | "cancelled";
type Transaction = <T>(work:(client:PoolClient)=>Promise<T>)=>Promise<T>;
type Reader = Pool | PoolClient;

type OperationRow = {
  body:RuntimeOperationBody;
  status:TaskStatus;
  current_step_id:string|null;
  result:Payload|null;
  checkpoint:Payload|null;
  run_id:string|null;
  turn_id:string|null;
  lease_owner:string|null;
  lease_fence:string;
  lease_until:string|null;
  admitted_here:boolean;
};
type StepRow = {
  operation_id:string;
  ordinal:number;
  wait:OperationWait;
  state:RuntimeOperationStep["state"];
  request_id:string|null;
  receipt:(NonNullable<RuntimeOperationStep["receipt"]>&{checkpoint?:Payload; resumeRun?:OperationBinding; wake?:false})|null;
};
const terminal = (status:TaskStatus) => status !== "queued" && status !== "running";
const uuid = (id:unknown):id is string => typeof id === "string" && id === id.toLowerCase() && taskIdPattern.test(id);
const payload = (value:unknown):value is Payload => !!value && typeof value === "object" && !Array.isArray(value);
const json = (value:unknown) => JSON.stringify(value);

function operationView(row:OperationRow):RuntimeOperation {
  return {...row.body,status:row.status,
    ...(row.current_step_id?{currentStepId:row.current_step_id}:{}),
    ...(row.run_id&&row.turn_id?{activeRunId:row.run_id,activeTurnId:row.turn_id}:{}),
    ...(row.checkpoint?{checkpoint:row.checkpoint}:{}),...(row.result?{result:row.result}:{})};
}
function stepView(row:StepRow):RuntimeOperationStep {
  const {receipt}=row;
  return {...row.wait,operationId:row.operation_id,ordinal:row.ordinal,state:row.state,
    ...(row.request_id?{requestId:row.request_id}:{}),...(receipt?{receipt:{receiptId:receipt.receiptId,payload:receipt.payload,
      receivedAt:receipt.receivedAt,late:receipt.late}}:{})};
}

async function find(db:Reader,operationId:string,lock=false):Promise<OperationRow|undefined> {
  if(!uuid(operationId))return;
  if(lock&&!(await db.query("SELECT id FROM runtime_tasks WHERE id=$1 AND task_type='operation' FOR UPDATE",[operationId])).rowCount)return;
  const {rows:[row]}=await db.query<OperationRow>(`
    SELECT o.body,o.result,o.current_step_id,s.checkpoint,t.status,t.lease_owner,t.lease_fence,t.lease_until,
      attached.run_id,attached.turn_id,${lock?"o.admission_transaction=txid_current()":"false"} AS admitted_here
    FROM runtime_tasks t JOIN runtime_operations o ON o.operation_id=t.id
    LEFT JOIN runtime_steps s ON s.id=t.id
    LEFT JOIN LATERAL (SELECT run_id,turn_id FROM runtime_operation_runs WHERE operation_id=t.id ORDER BY ordinal DESC LIMIT 1) attached ON true
    WHERE t.id=$1 AND t.task_type='operation'`, [operationId]);
  return row;
}
async function findStep(db:Reader,operationId:string,stepId:string):Promise<StepRow|undefined> {
  if(!uuid(operationId)||!uuid(stepId))return;
  return (await db.query<StepRow>("SELECT * FROM runtime_operation_steps WHERE operation_id=$1 AND step_id=$2",[operationId,stepId])).rows[0];
}
function currentLease(row:OperationRow,now=Date.now()) {
  const lease=runtimeTaskLease.getStore();
  return row.status==="running" && lease?.id===row.body.operationId && lease.owner===row.lease_owner &&
    lease.fence===Number(row.lease_fence) && Number(row.lease_until)>now;
}
async function lockActiveRun(db:PoolClient,runId:string,allowUnleasedCancellation=false) {
  if(!uuid(runId))return false;
  const lease=runtimeTaskLease.getStore(),current=Date.now();
  if(lease?.id===runId){
    return !!(await db.query(`SELECT id FROM runtime_tasks WHERE id=$1 AND task_type='run' AND lease_owner=$2
      AND lease_fence=$3 AND lease_until>$4 AND (status='running' OR (status IN ('complete','failed','cancelled') AND xmin::text=mod(txid_current(),4294967296)::text)) FOR UPDATE`,
      [runId,lease.owner,lease.fence,current])).rowCount;
  }
  if(lease)return false;
  if((await db.query(`SELECT id FROM runtime_chat_messages WHERE id=$1 AND
    (status='planning' OR (status IN ('complete','failed','cancelled') AND xmin::text=mod(txid_current(),4294967296)::text)) FOR UPDATE`,[runId])).rowCount)return true;
  // An API cancellation has no worker lease. Its uncommitted terminal write
  // proves that this same transaction owns the original run's cancellation.
  return allowUnleasedCancellation&&!!(await db.query(`SELECT id FROM runtime_tasks WHERE id=$1 AND task_type='run'
    AND status='cancelled' AND xmin::text=mod(txid_current(),4294967296)::text FOR UPDATE`,[runId])).rowCount;
}
async function readForRun(db:Reader,runId:string) {
  if(!uuid(runId))return;
  const {rows:[binding]}=await db.query<{operation_id:string}>("SELECT operation_id FROM runtime_operation_runs WHERE run_id=$1",[runId]);
  return binding&&readOperation(db,binding.operation_id);
}
async function readOperation(db:Reader,operationId:string){
  const row=await find(db,operationId);
  return row&&operationView(row);
}
async function readInTransaction(db:PoolClient,operationId:string,lock=false){
  const row=await find(db,operationId,lock);
  return row&&operationView(row);
}
async function stepsInTransaction(db:Reader,operationId:string){
  if(!uuid(operationId))return [];
  return (await db.query<StepRow>("SELECT * FROM runtime_operation_steps WHERE operation_id=$1 ORDER BY ordinal",[operationId])).rows.map(stepView);
}
async function readStepInTransaction(db:PoolClient,operationId:string,stepId:string,lock=false) {
  if(lock&&!await find(db,operationId,true))return;
  const step=await findStep(db,operationId,stepId);
  return step&&stepView(step);
}
async function linkRun(db:PoolClient,operation:OperationRow,binding:OperationBinding) {
  const {operationId,conversationId}=operation.body;
  if(!uuid(binding.runId)||!uuid(binding.turnId)||binding.runId===operationId||binding.turnId===operationId||binding.conversationId!==conversationId)
    throw new TaskConflict("操作与续行轮次归属不一致。");
  const {rows:[saved]}=await db.query<{operation_id:string;turn_id:string}>(`
    INSERT INTO runtime_operation_runs (run_id,operation_id,turn_id,ordinal)
    SELECT $1,$2,$3,COALESCE(max(ordinal),0)+1 FROM runtime_operation_runs WHERE operation_id=$2
    ON CONFLICT(run_id) DO NOTHING RETURNING operation_id,turn_id`,[binding.runId,operationId,binding.turnId]);
  if(saved){
    await bindRuntimeModelBudgetOwner(db,binding.runId,operation.body.runId??operationId);
    return true;
  }
  const {rows:[existing]}=await db.query<{operation_id:string;turn_id:string}>("SELECT operation_id,turn_id FROM runtime_operation_runs WHERE run_id=$1",[binding.runId]);
  if(existing?.operation_id!==operationId||existing.turn_id!==binding.turnId)throw new TaskConflict("该轮次已关联另一项操作。");
  return false;
}
async function linkRunInTransaction(db:PoolClient,operationId:string,binding:OperationBinding) {
  const operation=await find(db,operationId,true);
  if(!operation||terminal(operation.status))return false;
  return linkRun(db,operation,binding);
}
async function setCheckpoint(db:PoolClient,operationId:string,checkpoint:Payload|undefined,wakeAt:number|null) {
  if(checkpoint===undefined){
    await db.query("UPDATE runtime_steps SET wake_at=$2 WHERE id=$1",[operationId,wakeAt]);
  }else{
    await db.query(`INSERT INTO runtime_steps(id,checkpoint,wake_at) VALUES ($1,$2::jsonb,$3) ON CONFLICT(id)
      DO UPDATE SET checkpoint=EXCLUDED.checkpoint,wake_at=EXCLUDED.wake_at`,[operationId,json(checkpoint),wakeAt]);
  }
}
async function release(db:PoolClient,operationId:string,now:number) {
  await db.query(`UPDATE runtime_tasks SET status='running',updated=$2,lease_owner=NULL,lease_until=NULL,
    recovered_fence=lease_fence WHERE id=$1`,[operationId,now]);
}
function nextWake(wait:OperationWait,wakeAt?:number) {
  if(wakeAt!==undefined&&(!Number.isSafeInteger(wakeAt)||wakeAt<0))throw Error("操作续行时间无效。");
  if(wait.expiresAt===undefined)return wakeAt??null;
  return Math.min(wait.expiresAt,wakeAt??wait.expiresAt);
}

async function createInTransaction(db:PoolClient,input:OperationCreate) {
  const {operationId,runId,conversationId,turnId,kind,input:operationInput,checkpoint={},wait}=input;
  if(!uuid(operationId)||!uuid(conversationId)||turnId!==undefined&&!uuid(turnId)||runId!==undefined&&
    (!uuid(runId)||!turnId||runId===operationId)||turnId===operationId||
    !/^[\w.-]{1,128}$/u.test(kind)||!payload(operationInput)||!payload(checkpoint))throw Error("操作标识或输入无效。");
  const body:RuntimeOperationBody={type:"workspace-operation",operationId,kind,input:operationInput,conversationId,
    ...(runId?{runId}:{}),...(turnId?{turnId}:{})};
  // Keep operation markers out of legacy SQL which indexes run bodies by conversation.
  const marker=json({type:body.type,operationId}),fingerprint=createHash("sha256").update(marker).digest("hex"),now=Date.now();
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended(($1::uuid)::text,7142530))",[operationId]);
  const inserted=await db.query(`INSERT INTO runtime_tasks(id,body,fingerprint,status,created,updated,task_type)
    SELECT $1,$2,$3,'queued',$4,$4,'operation' WHERE NOT EXISTS(SELECT 1 FROM runtime_chat_messages WHERE id=$1)
    ON CONFLICT(id) DO NOTHING`,[operationId,marker,fingerprint,now]);
  if(!inserted.rowCount){
    const same=await db.query(`SELECT operation_id FROM runtime_operations WHERE operation_id=$1
      AND body=$2::jsonb AND admission_checkpoint=$3::jsonb AND admission_wait IS NOT DISTINCT FROM $4::jsonb`,
    [operationId,json(body),json(checkpoint),wait?json(wait):null]);
    if(!same.rowCount)throw new TaskConflict("该编号已用于不同操作。");
    return (await readOperation(db,operationId))!;
  }
  await db.query("INSERT INTO runtime_operations(operation_id,body,admission_checkpoint,admission_wait) VALUES ($1,$2::jsonb,$3::jsonb,$4::jsonb)",
    [operationId,json(body),json(checkpoint),wait?json(wait):null]);
  await bindRuntimeModelBudgetOwner(db,operationId,runId??operationId);
  await setCheckpoint(db,operationId,checkpoint,now);
  if(runId&&turnId)await linkRun(db,(await find(db,operationId,true))!,{runId,conversationId,turnId});
  if(wait)await waitInTransaction(db,operationId,wait,checkpoint,{wakeAt:input.wakeAt});
  return (await readOperation(db,operationId))!;
}

async function waitInTransaction(db:PoolClient,operationId:string,wait:OperationWait,checkpoint:Payload,options:WaitOptions={}) {
  if(!uuid(wait.stepId)||wait.stepId===operationId||!payload(wait.request)||!payload(checkpoint)||
    !["human","browser","service"].includes(wait.kind)||wait.owner!==undefined&&(!wait.owner||wait.owner.length>512)||
    wait.expiresAt!==undefined&&(!Number.isSafeInteger(wait.expiresAt)||wait.expiresAt<0))throw Error("操作待办内容无效。");
  const wakeAt=nextWake(wait,options.wakeAt);
  if(options.runId&&!await lockActiveRun(db,options.runId))return;
  const operation=await find(db,operationId,true);
  if(!operation||terminal(operation.status))return;
  const owned=currentLease(operation),initial=operation.admitted_here&&operation.status==="queued";
  const attached=options.runId!==undefined&&options.runId===operation.run_id&&!operation.lease_owner;
  if(!owned&&!initial&&!attached)return;
  const prior=await findStep(db,operationId,wait.stepId);
  if(prior){
    const same=await db.query("SELECT 1 FROM runtime_operation_steps WHERE operation_id=$1 AND step_id=$2 AND wait=$3::jsonb",[operationId,wait.stepId,json(wait)]);
    if(!same.rowCount)throw new TaskConflict("该步编号已用于不同待办。");
    // A retried request can never reopen a resolved step or change its checkpoint.
    return stepView(prior);
  }
  if(operation.current_step_id)throw new TaskConflict("原操作仍有待办，不能替换其身份。");
  const {rows:[saved]}=await db.query<StepRow>(`INSERT INTO runtime_operation_steps(operation_id,step_id,ordinal,wait,state)
    SELECT $1,$2,COALESCE(max(ordinal),0)+1,$3::jsonb,'waiting' FROM runtime_operation_steps WHERE operation_id=$1 RETURNING *`,
    [operationId,wait.stepId,json(wait)]);
  const park=!owned||options.releaseLease!==false;
  await db.query("UPDATE runtime_operations SET current_step_id=$2,suspended=$3 WHERE operation_id=$1",[operationId,wait.stepId,park]);
  await setCheckpoint(db,operationId,checkpoint,wakeAt);
  if(park)await release(db,operationId,Date.now());
  return stepView(saved);
}

async function prepareDispatchInTransaction(db:PoolClient,operationId:string,stepId:string) {
  const operation=await find(db,operationId,true);
  if(!operation||operation.current_step_id!==stepId||!currentLease(operation))return;
  const step=await findStep(db,operationId,stepId);
  if(step?.state!=="waiting"||step.wait.kind!=="service"||
    step.wait.expiresAt!==undefined&&step.wait.expiresAt<=Date.now())return;
  if(step.request_id)return {requestId:step.request_id,first:false};
  const requestId=randomUUID();
  await db.query("UPDATE runtime_operation_steps SET request_id=$3 WHERE operation_id=$1 AND step_id=$2",[operationId,stepId,requestId]);
  return {requestId,first:true};
}

async function rescheduleInTransaction(db:PoolClient,operationId:string,stepId:string,wakeAt:number,checkpoint?:Payload) {
  const operation=await find(db,operationId,true);
  if(!operation||operation.current_step_id!==stepId||!currentLease(operation))return false;
  const step=await findStep(db,operationId,stepId);
  if(step?.state!=="waiting")return false;
  await db.query("UPDATE runtime_operations SET suspended=true WHERE operation_id=$1",[operationId]);
  await setCheckpoint(db,operationId,checkpoint,nextWake(step.wait,wakeAt));
  await release(db,operationId,Date.now());
  return true;
}

async function receiptInTransaction(db:PoolClient,receipt:OperationReceipt,options:ReceiptOptions={}):Promise<ReceiptResult> {
  const {operationId,stepId,receiptId,payload:fact,checkpoint}=receipt;
  if(typeof receiptId!=="string"||!receiptId||receiptId.length>256||!payload(fact)||checkpoint!==undefined&&!payload(checkpoint))return {status:"conflict"};
  const operation=await find(db,operationId,true);
  const step=operation&&await findStep(db,operationId,stepId);
  if(!operation||!step||receipt.kind!==step.wait.kind||receipt.owner!==step.wait.owner||
    receipt.requestId!==(step.request_id??undefined)||receipt.kind==="service"&&!step.request_id)return {status:"missing"};
  const lease=runtimeTaskLease.getStore();
  if((options.requireLease||receipt.kind==="service"&&lease?.id===operationId)&&!currentLease(operation))return {status:"conflict"};
  const continuation={...(checkpoint!==undefined?{checkpoint}:{}),...(options.resumeRun?{resumeRun:options.resumeRun}:{}),
    ...(options.wake===false?{wake:false as const}:{})};
  if(step.receipt){
    const same=await db.query(`SELECT 1 FROM runtime_operation_steps WHERE operation_id=$1 AND step_id=$2
      AND receipt - ARRAY['receivedAt','late'] = $3::jsonb`,[operationId,stepId,json({receiptId,payload:fact,...(step.receipt.late?{}:continuation)})]);
    return {status:same.rowCount?"duplicate":"conflict",step:stepView(step)};
  }
  const now=Date.now();
  const active=!terminal(operation.status)&&step.state==="waiting"&&operation.current_step_id===stepId;
  const expired=active&&step.wait.expiresAt!==undefined&&step.wait.expiresAt<=now;
  const late=!active||expired;
  const state=expired?"expired":late?step.state:"received";
  const receiptValue={receiptId,payload:fact,receivedAt:now,late,...(late?{}:continuation)};
  await db.query("UPDATE runtime_operation_steps SET state=$3,receipt=$4::jsonb WHERE operation_id=$1 AND step_id=$2",
    [operationId,stepId,state,json(receiptValue)]);
  if(active){
    if(!late&&options.resumeRun&&!await linkRun(db,operation,options.resumeRun))throw new TaskConflict("续行需要一个新的轮次编号。");
    const wake=late||options.wake!==false;
    await db.query("UPDATE runtime_operations SET current_step_id=NULL,suspended=$2 WHERE operation_id=$1",[operationId,!wake]);
    await setCheckpoint(db,operationId,late?undefined:checkpoint,wake?now:null);
    if(!wake)await release(db,operationId,now);
  }
  return {status:late?"late":"accepted",step:stepView({...step,state,receipt:receiptValue})};
}

async function expireInTransaction(db:PoolClient,operationId:string,stepId:string) {
  const operation=await find(db,operationId,true);
  if(!operation||operation.current_step_id!==stepId||!currentLease(operation))return;
  const step=await findStep(db,operationId,stepId);
  if(step?.state!=="waiting"||step.wait.expiresAt===undefined||step.wait.expiresAt>Date.now())return;
  await db.query("UPDATE runtime_operations SET current_step_id=NULL WHERE operation_id=$1",[operationId]);
  await db.query("UPDATE runtime_operation_steps SET state='expired' WHERE operation_id=$1 AND step_id=$2",[operationId,stepId]);
  return stepView({...step,state:"expired"});
}

async function finishLocked(db:PoolClient,operation:OperationRow,status:TaskTerminal,result?:Payload,project?:OperationProjection) {
  const {operationId}=operation.body;
  if(terminal(operation.status)||status==="complete"&&operation.current_step_id)return false;
  if(operation.current_step_id)await db.query(`UPDATE runtime_operation_steps SET state=$3
    WHERE operation_id=$1 AND step_id=$2 AND state='waiting'`,[operationId,operation.current_step_id,status]);
  await db.query("UPDATE runtime_operations SET current_step_id=NULL,suspended=false,result=$2::jsonb WHERE operation_id=$1",
    [operationId,result===undefined?null:json(result)]);
  await db.query("UPDATE runtime_tasks SET status=$2,updated=$3,lease_owner=NULL,lease_until=NULL WHERE id=$1",[operationId,status,Date.now()]);
  await setCheckpoint(db,operationId,undefined,null);
  if(project)await project(db,operationView({...operation,status,result:result??null,current_step_id:null}));
  return true;
}
async function finishInTransaction(db:PoolClient,operationId:string,status:TaskTerminal,result?:Payload,project?:OperationProjection) {
  const operation=await find(db,operationId,true);
  if(!operation||!currentLease(operation))return false;
  return finishLocked(db,operation,status,result,project);
}
function completeInTransaction(db:PoolClient,operationId:string,result:Payload,project?:OperationProjection) {
  return finishInTransaction(db,operationId,"complete",result,project);
}
async function completeFromRunInTransaction(db:PoolClient,operationId:string,runId:string,result:Payload,status:TaskTerminal="complete") {
  if(!await lockActiveRun(db,runId,status==="cancelled"))return false;
  const operation=await find(db,operationId,true);
  if(!operation||operation.run_id!==runId||operation.lease_owner)return false;
  return finishLocked(db,operation,status,result);
}
async function cancelInTransaction(db:PoolClient,operationId:string,result?:Payload) {
  const operation=await find(db,operationId,true);
  return !!operation&&finishLocked(db,operation,"cancelled",result);
}
async function cancelForRunInTransaction(db:PoolClient,runId:string) {
  const linked=await readForRun(db,runId);
  const operation=linked&&await find(db,linked.operationId,true);
  return !!operation&&operation.run_id===runId&&finishLocked(db,operation,"cancelled");
}

export const runtimeOperationTransactions = {
  createInTransaction,readInTransaction,readForRunInTransaction:readForRun,readStepInTransaction,stepsInTransaction,linkRunInTransaction,
  waitInTransaction,prepareDispatchInTransaction,rescheduleInTransaction,receiptInTransaction,expireInTransaction,
  finishInTransaction,completeInTransaction,completeFromRunInTransaction,cancelInTransaction,cancelForRunInTransaction,
};
export function postgresRuntimeOperations(pool:Pool,transaction:Transaction) {
  return {...runtimeOperationTransactions,
    transaction,
    create:(input:OperationCreate)=>transaction(db=>createInTransaction(db,input)),
    read:(operationId:string)=>readOperation(pool,operationId),
    readForRun:(runId:string)=>readForRun(pool,runId),
    readStep:async(operationId:string,stepId:string)=>{const row=await findStep(pool,operationId,stepId);return row&&stepView(row);},
    steps:(operationId:string)=>stepsInTransaction(pool,operationId),
    wait:(operationId:string,wait:OperationWait,checkpoint:Payload,options?:WaitOptions)=>transaction(db=>waitInTransaction(db,operationId,wait,checkpoint,options)),
    prepareDispatch:(operationId:string,stepId:string)=>transaction(db=>prepareDispatchInTransaction(db,operationId,stepId)),
    reschedule:(operationId:string,stepId:string,wakeAt:number,checkpoint?:Payload)=>transaction(db=>rescheduleInTransaction(db,operationId,stepId,wakeAt,checkpoint)),
    receipt:(input:OperationReceipt,options?:ReceiptOptions)=>transaction(db=>receiptInTransaction(db,input,options)),
    expire:(operationId:string,stepId:string)=>transaction(db=>expireInTransaction(db,operationId,stepId)),
    complete:(operationId:string,result:Payload)=>transaction(db=>completeInTransaction(db,operationId,result)),
    cancel:(operationId:string,result?:Payload)=>transaction(db=>cancelInTransaction(db,operationId,result)),
  };
}
export type RuntimeOperationsStore = ReturnType<typeof postgresRuntimeOperations>;
export type RuntimeOperations = RuntimeOperationsStore;
export type OperationView = RuntimeOperation;
export type OperationStep = RuntimeOperationStep;
