import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {once} from "node:events";
import {setTimeout as delay} from "node:timers/promises";
import test from "node:test";
import express from "express";
import {Pool} from "pg";
import {discoveryDelegationLookupPath,discoveryRequestFingerprint} from "./discovery-request-fingerprint";
import {postgresTaskStore} from "./postgres-task-store";
import {runtimeWorkerRunner} from "./runtime-worker-runner";
import type {RuntimeServices} from "./runtime-turn";
import {workTasks} from "./task-store";

const database=process.env.ONEEARTH_WORKSPACE_DISCOVERY_TEST_DATABASE_URL;
const lookupToken="workspace-discovery-recovery-fixture-only";
const businessKind="oneearth.discovery.request.v1";
const active="TASK_STATE_WORKING",done="TASK_STATE_COMPLETED",stopped="TASK_STATE_CANCELED",inputRequired="TASK_STATE_INPUT_REQUIRED";
const acceptedUrl="https://archive.example.test/datasets/source";
const signedUrl="https://archive.example.test/datasets/source?token=workspace-private-fixture";
const dataset=(id:string,url:string)=>({id,source:"海纳",title:"控制资料 "+id,kind:"dataset",url});
const result={plan:{},papers:[],haina:[dataset("original-dataset",acceptedUrl),dataset("signed-dataset",signedUrl)],searches:[],
  sourceStatus:[{source:"海纳",status:"done",count:2}],issues:[]};

async function waitFor<T>(read:()=>Promise<T|undefined>){
  const end=Date.now()+8000;
  while(Date.now()<=end){const value=await read();if(value!==undefined)return value;await delay(50);}
  assert.fail("workspace discovery fixture did not reach the expected state");
}

test("workspace discovery worker recovers a lost A2A receipt and owns cancellation without a Chat run",{skip:!database,timeout:22000},async t=>{
  assert.ok(database);
  const url=new URL(database);
  assert.equal(url.hostname,"127.0.0.1");
  assert.match(url.pathname,/(?:^|_)test(?:_|$)/u);
  const priorDatabase=process.env.ONEEARTH_RUNTIME_DATABASE_URL,priorDiscovery=process.env.ONEEARTH_DISCOVERY_URL,
    priorToken=process.env.ONEEARTH_DISCOVERY_RECOVERY_TOKEN;
  const reset=(key:string,value:string|undefined)=>{if(value===undefined)delete process.env[key];else process.env[key]=value;};
  process.env.ONEEARTH_RUNTIME_DATABASE_URL=database;
  process.env.ONEEARTH_DISCOVERY_RECOVERY_TOKEN=lookupToken;
  t.after(()=>{
    reset("ONEEARTH_RUNTIME_DATABASE_URL",priorDatabase);
    reset("ONEEARTH_DISCOVERY_URL",priorDiscovery);
    reset("ONEEARTH_DISCOVERY_RECOVERY_TOKEN",priorToken);
  });
  const app=express();
  app.use(express.json({type:"application/a2a+json"}));
  const adapters=new Map<string,{id:string;contextId:string;status:{state:string};artifacts:unknown[];fingerprint:string;query:string}>();
  const posts:string[]=[],lookups:string[]=[],cancellations:string[]=[];
  const methodErrors:string[]=[];
  const json=(res:express.Response,value:unknown,status=200)=>res.status(status).type("application/a2a+json").send(JSON.stringify(value));
  app.post("/message:send",(req,res)=>{
    const message=req.body?.message,part=message?.parts?.[0]?.data,input=part?.input;
    if(req.get("A2A-Version")!=="1.0"||part?.kind!==businessKind||message?.taskId||input?.runtimeWebToolGrant!==undefined||
        input?.deepseekTools?.search!==false||input?.deepseekTools?.fetch!==false||input?.history?.length||input?.references?.length){
      methodErrors.push("unexpected discovery envelope");return json(res,{message:"invalid request"},400);
    }
    const messageId=message.messageId;
    posts.push(messageId);
    if(adapters.has(messageId))return json(res,{message:"duplicate delegation"},409);
    const id=randomUUID(),query=input.query,terminal=query==="recover discovery"||query==="needs input";
    const task={id,contextId:id,status:{state:terminal?(query==="needs input"?inputRequired:done):active},
      artifacts:terminal?[{artifactId:id+":1",parts:[{data:{kind:"oneearth.discovery.event.v1",event:{seq:1,result}}}]}]:[],
      fingerprint:discoveryRequestFingerprint(businessKind,input),query};
    adapters.set(messageId,task);
    if(query==="recover discovery"){req.socket.destroy();return;}
    return json(res,{task});
  });
  app.get(discoveryDelegationLookupPath+"/:messageId",(req,res)=>{
    const messageId=String(req.params.messageId);
    lookups.push(messageId);
    const task=adapters.get(messageId);
    if(req.get("Authorization")!=="Bearer "+lookupToken||!task||req.get("X-OneEarth-Request-Fingerprint")!==task.fingerprint){
      methodErrors.push("unexpected read-only lookup identity");return res.sendStatus(403);
    }
    return res.json({taskId:task.id,idempotentReplay:true});
  });
  app.get("/tasks/:taskId",(req,res)=>{
    const task=[...adapters.values()].find(value=>value.id===req.params.taskId);
    return task?json(res,task):json(res,{message:"not found"},404);
  });
  app.post(/^\/tasks\/([^/]+):cancel$/,(req,res)=>{
    const task=[...adapters.values()].find(value=>value.id===req.params[0]);
    if(!task)return json(res,{message:"not found"},404);
    cancellations.push(task.id);task.status.state=stopped;
    return json(res,task);
  });
  const server=app.listen(0,"127.0.0.1");
  await once(server,"listening");
  const endpoint=server.address();
  assert.ok(endpoint&&typeof endpoint!=="string");
  process.env.ONEEARTH_DISCOVERY_URL=`http://127.0.0.1:${endpoint.port}`;
  t.after(()=>new Promise<void>(resolve=>{server.close(()=>resolve());server.closeAllConnections();}));
  const tasks=await postgresTaskStore("runtime"),audit=new Pool({connectionString:database});
  const services={tasks,coverage:()=>assert.fail("unscoped discovery should not read coverage")} as unknown as RuntimeServices;
  const runner=runtimeWorkerRunner(services,undefined,{operations:tasks.operations,
    workspaceDiscoveryProjection:async()=>assert.fail("standalone operations have no Chat projection")});
  let stop=await workTasks(tasks,runner.run,{maintenance:runner.maintenance});
  t.after(async()=>{await stop();await Promise.all([tasks.close(),audit.end()]);});
  const conversationId=randomUUID();
  async function submit(query:string){
    const operationId=randomUUID(),stepId=randomUUID();
    assert.equal((await tasks.operations.create({operationId,conversationId,kind:"discover-materials",
      input:{query,actionId:randomUUID(),researchRevision:0},checkpoint:{stepId,phase:"discover"},
      wait:{stepId,kind:"service",request:{},expiresAt:Date.now()+15000},wakeAt:Date.now()})).currentStepId,stepId);
    return {operationId,stepId};
  }
  const final=async(operationId:string)=>await waitFor(async()=>{
    const operation=await tasks.operations.read(operationId);
    return operation&&operation.status!=="queued"&&operation.status!=="running"?operation:undefined;
  });

  const recovered=await submit("recover discovery");
  const persisted=await final(recovered.operationId);
  assert.equal(persisted.status,"complete");
  const state=await tasks.operations.readStep(recovered.operationId,recovered.stepId);
  const messageId=state?.requestId;
  assert.ok(messageId);
  assert.deepEqual(posts,[messageId]);
  assert.deepEqual(lookups,[messageId]);
  assert.equal(state?.state,"received");
  assert.equal((state?.receipt?.payload.binding as any)?.discoveryId,adapters.get(messageId)?.id);
  assert.deepEqual(persisted.result,{result:{batchId:recovered.operationId,query:"recover discovery",complete:true,items:[
    {kind:"dataset",id:"original-dataset",title:"控制资料 original-dataset",source:"海纳",url:acceptedUrl},
    {kind:"dataset",id:"signed-dataset",title:"控制资料 signed-dataset",source:"海纳"},
  ]}});

  const interrupt=await submit("needs input");
  const partial=await final(interrupt.operationId);
  assert.equal(partial.status,"complete");
  assert.equal((partial.result?.result as any)?.complete,false);
  assert.match((partial.result?.result as any)?.limitation,/等待补充/u);
  const interruptedStep=await tasks.operations.readStep(interrupt.operationId,interrupt.stepId);
  assert.equal((interruptedStep?.receipt?.payload.binding as any)?.state,inputRequired);
  assert.equal((interruptedStep?.receipt?.payload.binding as any)?.lastSeq,1);

  const cancelled=await submit("cancel discovery");
  const bound=await waitFor(async()=>{
    const checkpoint=await tasks.step?.(cancelled.operationId);
    return (checkpoint?.delegation as {binding?:{discoveryId:string}}|undefined)?.binding?.discoveryId;
  });
  assert.equal(await tasks.operations.cancel(cancelled.operationId),true);
  assert.equal(await tasks.operations.cancel(cancelled.operationId),false);
  await stop();
  stop=await workTasks(tasks,runner.run,{maintenance:runner.maintenance});
  await waitFor(async()=>{
    const status=await tasks.runtimeStatus?.(cancelled.operationId);
    return status?.remoteStops?.some(stop=>stop.discoveryTaskId===bound&&stop.state==="confirmed")?true:undefined;
  });
  assert.deepEqual(cancellations,[bound]);
  assert.equal((await tasks.operations.read(cancelled.operationId))?.status,"cancelled");
  assert.equal((await tasks.operations.readStep(cancelled.operationId,cancelled.stepId))?.state,"cancelled");
  assert.equal((await audit.query("SELECT count(*)::int AS count FROM runtime_operation_runs WHERE operation_id=ANY($1::uuid[])",
    [[recovered.operationId,interrupt.operationId,cancelled.operationId]])).rows[0].count,0);
  assert.equal((await audit.query("SELECT count(*)::int AS count FROM runtime_chat_messages WHERE id=ANY($1::uuid[])",
    [[recovered.operationId,interrupt.operationId,cancelled.operationId]])).rows[0].count,0);
  assert.deepEqual(methodErrors,[]);
});
