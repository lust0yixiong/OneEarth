import assert from "node:assert/strict";
import {createHash,randomUUID} from "node:crypto";
import test from "node:test";
import {Pool} from "pg";
import {createRuntimeModelCapacity} from "./runtime-model-capacity";
import {modelUsage,runtimeModelBudgetLimits} from "./runtime-model-budget";

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
