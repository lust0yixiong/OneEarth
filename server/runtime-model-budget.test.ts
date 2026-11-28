import assert from "node:assert/strict";
import {createHash,randomUUID} from "node:crypto";
import test from "node:test";
import {Pool} from "pg";
import {createRuntimeModelCapacity} from "./runtime-model-capacity";
import {modelUsage,reserveRuntimeModelRequest,runtimeModelBudgetLimits} from "./runtime-model-budget";
import {postgresTaskStore} from "./postgres-task-store";
import {TaskConflict} from "./task-store";

const fixture=process.env.ONEEARTH_MODEL_BUDGET_TEST_DATABASE_URL;

test("provider usage is separate from byte accounting and requires consistent terminal counts",()=>{
  assert.deepEqual(modelUsage({input_tokens:4,output_tokens:9,total_tokens:13}),{inputTokens:4,outputTokens:9});
  assert.equal(modelUsage({input_tokens:4,output_tokens:9,total_tokens:12}),undefined);
  assert.equal(modelUsage({input_tokens:-1,output_tokens:2,total_tokens:1}),undefined);
});

test("foreground and resumed worker reserve the same durable run budget atomically", {skip:!fixture}, async t=>{
  assert.ok(fixture);
  assert.match(new URL(fixture).pathname,/(?:^|[-_])test(?:[-_]|$)/);
  const foregroundPool=new Pool({connectionString:fixture}),workerPool=new Pool({connectionString:fixture});
  let api:Awaited<ReturnType<Awaited<ReturnType<typeof createRuntimeModelCapacity>>["acquire"]>>|undefined;
  let worker:typeof api;
  t.after(async()=>{
    await Promise.allSettled([api?.release(),worker?.release()]);
    await Promise.all([foregroundPool.end(),workerPool.end()]);
  });
  const caps=await createRuntimeModelCapacity(foregroundPool,{total:3,foreground:1});
  const workerCaps=await createRuntimeModelCapacity(workerPool,{total:3,foreground:1});
  const taskId=randomUUID(),otherId=randomUUID();
  api=await caps.acquire("foreground",taskId);
  const background=worker=await workerCaps.acquire("background",taskId);
  const first=Buffer.from('{"input":"previous"}'),retry=Buffer.from('{"input":"authorized resumed step"}');
  const receipt=await api.reserveRequest(first,"responses-api");
  assert.ok(receipt);await receipt.recordUsage({inputTokens:11,outputTokens:4});
  const attempts=await Promise.allSettled(Array.from({length:runtimeModelBudgetLimits.requestCount},()=>background.reserveRequest(retry,"responses-relay")));
  assert.equal(attempts.filter(attempt=>attempt.status==="fulfilled").length,runtimeModelBudgetLimits.requestCount-1);
  assert.equal(attempts.filter(attempt=>attempt.status==="rejected").length,1);
  await assert.rejects(api.reserveRequest(retry,"responses-api"),/累计/);
  const rows=(await foregroundPool.query(`
    SELECT ordinal,transport,input_bytes,input_sha256,provider_input_tokens,provider_output_tokens
    FROM runtime_model_request_receipts WHERE task_id=$1 ORDER BY ordinal`,[taskId])).rows;
  assert.equal(rows.length,runtimeModelBudgetLimits.requestCount);
  assert.deepEqual(rows[0],{ordinal:1,transport:"responses-api",input_bytes:first.length,
    input_sha256:createHash("sha256").update(first).digest("hex"),provider_input_tokens:"11",provider_output_tokens:"4"});
  assert.ok(rows.slice(1).every(row=>row.input_bytes===retry.length&&row.provider_input_tokens===null&&row.provider_output_tokens===null));
  const fresh=await caps.acquire("foreground",otherId);
  try{assert.ok(await fresh.reserveRequest(retry,"cli-visible-input"));}
  finally{await fresh.release();}
  await assert.rejects(fresh.reserveRequest(retry,"cli-visible-input"),/名额已失效/);
  const independent=await foregroundPool.query("SELECT requests FROM runtime_model_budgets WHERE task_id=$1",[otherId]);
  assert.equal(independent.rows[0]?.requests,1);
});


test("operation continuations and worker execution share the original model ledger and retain each actual lease identity", {skip:!fixture}, async t=>{
  assert.ok(fixture);
  assert.match(new URL(fixture).pathname,/(?:^|[-_])test(?:[-_]|$)/);
  const previous=process.env.ONEEARTH_RUNTIME_DATABASE_URL;
  process.env.ONEEARTH_RUNTIME_DATABASE_URL=fixture;
  const pool=new Pool({connectionString:fixture}),tasks=await postgresTaskStore("runtime");
  const caps=await createRuntimeModelCapacity(pool,{total:4,foreground:1});
  const owned:Awaited<ReturnType<typeof caps.acquire>>[]=[];
  t.after(async()=>{
    await Promise.allSettled(owned.map(lease=>lease.release()));
    await Promise.all([pool.end(),tasks.close()]);
    if(previous===undefined)delete process.env.ONEEARTH_RUNTIME_DATABASE_URL;
    else process.env.ONEEARTH_RUNTIME_DATABASE_URL=previous;
  });
  const acquire=async(role:"foreground"|"background",taskId:string)=>{
    const lease=await caps.acquire(role,taskId);owned.push(lease);return lease;
  };
  const ids={root:randomUUID(),child:randomUUID(),op:randomUUID(),other:randomUUID(),otherOp:randomUUID()};
  const thread=randomUUID(),stepId=randomUUID(),body=Buffer.from('{"input":"fixed"}');
  const origin=await acquire("foreground",ids.root);
  const original=await origin.reserveRequest(body,"responses-api");
  await original?.recordUsage({inputTokens:5,outputTokens:2});
  await tasks.operations.create({operationId:ids.op,runId:ids.root,conversationId:thread,turnId:randomUUID(),
    kind:"research",input:{},wait:{stepId,kind:"human",request:{}}});
  const answer={operationId:ids.op,stepId,kind:"human" as const,receiptId:"answer",payload:{answer:"continue"}};
  // This separate operation already has an independent model ledger. Rebinding
  // it must fail rather than hiding the reservation under the origin alias.
  await tasks.operations.create({operationId:ids.otherOp,runId:ids.other,conversationId:randomUUID(),turnId:randomUUID(),kind:"other",input:{}});
  const other=await acquire("background",ids.other);
  await other.reserveRequest(body,"responses-api");
  await assert.rejects(tasks.operations.receipt(answer,{resumeRun:{runId:ids.other,conversationId:thread,turnId:randomUUID()},wake:false}),TaskConflict);
  assert.equal((await tasks.operations.readStep(ids.op,stepId))?.state,"waiting");
  assert.equal((await tasks.operations.readForRun(ids.other))?.operationId,ids.otherOp);
  const usedId=randomUUID(),usedLease=await acquire("background",usedId);
  await usedLease.reserveRequest(body,"responses-relay");
  await usedLease.release();
  await assert.rejects(tasks.operations.receipt(answer,{resumeRun:{runId:usedId,conversationId:thread,turnId:randomUUID()},wake:false}),/累计模型预算/u);
  assert.equal(await tasks.operations.readForRun(usedId),undefined);
  assert.equal((await tasks.operations.readStep(ids.op,stepId))?.state,"waiting");
  assert.equal((await tasks.operations.receipt(answer,{resumeRun:{runId:ids.child,conversationId:thread,turnId:randomUUID()},wake:false})).status,"accepted");
  const child=await acquire("background",ids.child),kernel=await acquire("background",ids.op);
  const {rows:[wrongLease]}=await pool.query<{slot:number;owner:string}>("SELECT slot,owner FROM runtime_model_slots WHERE task_id=$1",[ids.child]);
  await assert.rejects(reserveRuntimeModelRequest(pool,ids.root,body,"responses-api",wrongLease),/名额已失效/u);
  await child.reserveRequest(body,"responses-api");
  await kernel.reserveRequest(body,"cli-visible-input");
  const limit=runtimeModelBudgetLimits.requestCount;
  const writers=[origin,child,kernel];
  const attempts=await Promise.allSettled(Array.from({length:limit},(_,index)=>writers[index%3].reserveRequest(body,"responses-api")));
  assert.equal(attempts.filter(attempt=>attempt.status==="fulfilled").length,limit-3);
  await assert.rejects(origin.reserveRequest(body,"responses-api"),/累计模型预算/u);
  await assert.rejects(child.reserveRequest(body,"responses-api"),/累计模型预算/u);
  await assert.rejects(kernel.reserveRequest(body,"responses-api"),/累计模型预算/u);
  await other.reserveRequest(body,"responses-api");
  const directId=randomUUID();
  await tasks.operations.create({operationId:directId,conversationId:randomUUID(),kind:"direct",input:{}});
  await kernel.release();
  const direct=await acquire("background",directId);
  await direct.reserveRequest(body,"cli-visible-input");
  const {rows}=await pool.query(`SELECT ordinal,execution_task_id,provider_input_tokens FROM runtime_model_request_receipts
    WHERE task_id=$1 ORDER BY ordinal`,[ids.root]);
  assert.equal(rows.length,limit);
  assert.deepEqual(rows.slice(0,3).map(row=>row.execution_task_id),[ids.root,ids.child,ids.op]);
  assert.equal(rows[0].provider_input_tokens,"5");
  assert.deepEqual(rows.map(row=>row.ordinal),Array.from({length:limit},(_,index)=>index+1));
  const budget=async(id:string)=>(await pool.query<{requests:number}>("SELECT requests FROM runtime_model_budgets WHERE task_id=$1",[id])).rows[0]?.requests;
  assert.equal(await budget(ids.root),limit);
  assert.equal(await budget(ids.child),undefined);
  assert.equal(await budget(ids.op),undefined);
  assert.equal(await budget(ids.other),2);
  assert.equal(await budget(directId),1);
  for(const operationId of [ids.op,ids.otherOp,directId])assert.equal(await tasks.operations.cancel(operationId),true);
});
