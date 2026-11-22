import assert from "node:assert/strict";
import test,{type TestContext} from "node:test";
import express from "express";
import {once} from "node:events";
import {randomUUID} from "node:crypto";
import {setTimeout as delay} from "node:timers/promises";
import {openTaskStore,taskRoutes,workTasks,type TaskStore} from "./task-store";
import {initialObservationCheckpoint,recoverObservationRecord,type RuntimeObservationEngine} from "./runtime-observation";
import {runtimeWorkerRunner} from "./runtime-worker-runner";
import type {RuntimeServices} from "./runtime-turn";
import {observationDiscoveryClient} from "./observation-discovery-client";
import {validateTurn} from "./runtime-input";
import {emptyFilters} from "../src/domain/spatial";
import {sourcesFor} from "../src/domain/answer-sources";
import {observationCheckSkill,parseObservationCheck,type ObservationCheck,type ObservationCheckResult,type SkillExecutionRequest} from "./observation-check-contract";

const token="runtime-controlled-service-token-32bytes-only";
const check:ObservationCheck={skill:observationCheckSkill,artifactId:"observations",version:"v1",variable:"temperature",unit:"K",start:"2020-01-01",end:"2020-01-02"};
const result:ObservationCheckResult={status:"verified",matches:true,evidence:{artifactId:check.artifactId,version:check.version,sha256:"a".repeat(64),variable:check.variable,unit:"K",count:2,first:check.start,last:check.end}};
const body=()=>({query:"核对明确指定的已授权观测资料",observationCheck:check,conversationId:randomUUID(),turnId:randomUUID(),history:[],config:{executor:"codex",model:""},
  context:{filters:emptyFilters(),caseId:null,citation:null,selection:null,gridSystem:"h3",layer:"all",camera:{center:[0,0],zoom:1,reason:"controlled"}}});
async function until(read:()=>boolean|Promise<boolean>,timeout=5000){const start=Date.now();while(!await read()){if(Date.now()-start>timeout)assert.fail("condition did not become true");await delay(20);}}
async function fixture(t:TestContext,options:{lostInitial?:boolean;lostResult?:boolean;wrongDemand?:boolean;wrongContext?:boolean;pendingFinal?:boolean}={}){
  const store=openTaskStore(":memory:"),app=express(),requests:any[]=[],submitted=new Map<string,{input:any;task:any}>(),deliveries=new Map<string,any>();
  const jobs=new Map<string,SkillExecutionRequest>(),results=new Map<string,ObservationCheckResult>();let executions=0,cancels=0,acceptances=0,finalRelease=!options.pendingFinal;
  const engine:RuntimeObservationEngine={submit:async request=>{const old=jobs.get(request.requestId);if(old)assert.deepEqual(request,old);else{jobs.set(request.requestId,structuredClone(request));executions++;}},
    result:async requestId=>results.get(requestId),cancel:async requestId=>{if(jobs.has(requestId)&&!results.has(requestId))results.set(requestId,{status:"cancelled",reason:"user_cancelled"});}};
  app.use(express.json({type:["application/json","application/a2a+json"]}));
  app.use(["/message:send","/tasks"],(req,res,next)=>{if(req.get("authorization")!=="Bearer "+token){res.sendStatus(401);return;}next();});
  app.post("/message:send",(req,res)=>{
    const message=req.body.message,data=message.parts[0].data;requests.push({message:structuredClone(message),configuration:req.body.configuration});
    assert.equal(req.get("A2A-Version"),"1.0");assert.equal(message.role,"ROLE_USER");assert.equal(req.body.configuration.returnImmediately,true);
    if(data.kind==="oneearth.skill.observation-check.request.v1"){
      let saved=submitted.get(message.messageId);
      if(saved){if(JSON.stringify(saved.input)!==JSON.stringify(data.input)){res.sendStatus(409);return;}}
      else{
        const taskId=randomUUID(),requestId=randomUUID(),contextId=randomUUID();acceptances++;
        const demand={requestId,researchTaskId:options.wrongDemand?randomUUID():data.input.researchTaskId,check:data.input.check};
        saved={input:structuredClone(data.input),task:{id:taskId,contextId,status:{state:"TASK_STATE_INPUT_REQUIRED"},artifacts:[{artifactId:"demand",parts:[{data:{kind:"oneearth.discovery.event.v1",event:{seq:1,skillDemand:demand}}}]}]}};
        submitted.set(message.messageId,saved);
        if(options.lostInitial){req.socket.destroy();return;}
      }
      res.json({task:saved.task});return;
    }
    assert.equal(data.kind,"oneearth.skill.observation-check.result.v1");
    const saved=[...submitted.values()].find(s=>s.task.id===message.taskId);assert.ok(saved);assert.equal(message.contextId,saved.task.contextId);
    const demand=saved.task.artifacts[0].parts[0].data.event.skillDemand;assert.equal(data.input.requestId,demand.requestId);assert.equal(data.input.afterSeq,1);
    if(deliveries.has(message.messageId))assert.deepEqual(data.input,deliveries.get(message.messageId));
    else{
      deliveries.set(message.messageId,structuredClone(data.input));
      saved.task.artifacts.push({artifactId:"result",parts:[{data:{kind:"oneearth.discovery.event.v1",event:{seq:2,result:{observationCheckResult:data.input.result}}}}]});
      saved.task.status.state=finalRelease?"TASK_STATE_COMPLETED":"TASK_STATE_WORKING";
      if(options.lostResult){req.socket.destroy();return;}
    }
    res.json({task:saved.task});
  });
  app.get("/tasks/:id",(req,res)=>{
    const saved=[...submitted.values()].find(s=>s.task.id===req.params.id);if(!saved){res.sendStatus(404);return;}
    if(options.wrongContext){res.json({...saved.task,contextId:randomUUID()});return;}
    if(finalRelease&&deliveries.size)saved.task.status.state="TASK_STATE_COMPLETED";res.json(saved.task);
  });
  app.post(/^\/tasks\/([^/]+):cancel$/,(req,res)=>{cancels++;const saved=[...submitted.values()].find(s=>s.task.id===req.params[0]);assert.ok(saved);saved.task.status.state="TASK_STATE_CANCELED";res.json(saved.task);});
  taskRoutes(app,"/api/tasks",store,value=>validateTurn(store,value,{observationCheck:async()=>true}),
    {researchRecords:true,initialCheckpoint:initialObservationCheckpoint,recoverRecord:task=>recoverObservationRecord(store,task)});
  const server=app.listen(0,"127.0.0.1");await once(server,"listening");const address=server.address();assert.ok(address&&typeof address!=="string");const origin="http://127.0.0.1:"+address.port;
  const client=observationDiscoveryClient({base:origin,token,timeoutMs:300});
  const services={tasks:store,push:{latest:()=>({records:[]})},coverage:async()=>assert.fail("no grid attached"),researchRegionService:{locate:async()=>null},adminBoundaryDir:"/tmp",canonicalCache:new Map()} as unknown as RuntimeServices;
  const coordinator=runtimeWorkerRunner(services,engine,{client,pollMs:10});
  let stop:(()=>Promise<void>)|undefined;
  async function start(){stop=await workTasks(store,coordinator.run,{maintenance:coordinator.maintenance});}
  t.after(async()=>{await stop?.();server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));store.close();});
  const submit=async(input=body(),id=randomUUID())=>{const response=await fetch(origin+"/api/tasks",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id,input})});return{id,response};};
  return {store,origin,start,submit,requests,jobs,results,engine,client,coordinator,stop:async()=>{await stop?.();stop=undefined;},executions:()=>executions,cancels:()=>cancels,acceptances:()=>acceptances,
    deliveries:()=>deliveries.size,releaseFinal:()=>{finalRelease=true;}};
}

test("real task route/worker parks the parent, runs an ordinary queued task, and archives one exact result",async t=>{
  const f=await fixture(t);const {id,response}=await f.submit();assert.equal(response.status,202);await f.start();
  await until(()=>f.jobs.size===1);assert.equal(f.store.get(id)?.status,"running");assert.ok(f.store.step(id));
  const ordinary={...body(),query:"把地图移动到 120.2E, 30.3N"};delete (ordinary as any).observationCheck;const other=await f.submit(ordinary);assert.equal(other.response.status,202);
  await until(()=>f.store.get(other.id)?.status==="complete");assert.equal(f.store.get(id)?.status,"running","the waiting parent does not occupy the task worker");
  const moved=f.store.terminal(other.id)?.result as any;assert.deepEqual(moved.camera.center,[120.2,30.3]);assert.ok(moved.runTrace.calls.some((call:any)=>call.id==="workspace-action"));
  const requestId=[...f.jobs.keys()][0];f.results.set(requestId,result);await until(()=>f.store.get(id)?.status==="complete");
  assert.equal(f.executions(),1);assert.equal(f.acceptances(),1);assert.equal(f.deliveries(),1);
  const record=await (await fetch(f.origin+"/api/tasks/"+id+"/record")).json();assert.deepEqual(record.result.observationCheckResult,result);
  const ref=record.result.answerNotes.references[0];assert.equal(record.result.answerNotes.references.length,1);assert.match(ref.id,/^observation:[a-f0-9]{64}$/);
  assert.equal(ref.evidenceLevel,"observation-file");assert.equal(ref.referenceType,"data");assert.deepEqual(ref.observationEvidence,result.evidence);assert.equal(ref.url,undefined);
  assert.deepEqual(record.result.answerNotes.sources.map((s:any)=>s.id),[ref.id]);assert.equal(sourcesFor({answerNotes:record.result.answerNotes} as any).refs.length,1);assert.match(record.result.message,/〔1〕/);
  assert.match(record.result.message,/符合本次/);assert.ok(f.store.events(id,0).some(e=>e.workerReleased));
  assert.ok(!JSON.stringify(f.store.events(id,0)).includes(token));assert.ok(f.requests.every(r=>!JSON.stringify(r).includes(token)));
});
for(const lost of ["lostInitial","lostResult"] as const)test("lost acknowledgement reconciles one discovery Task and one engine execution: "+lost,async t=>{
  const f=await fixture(t,{[lost]:true}),{id}=await f.submit();await f.start();await until(()=>f.jobs.size===1);f.results.set([...f.jobs.keys()][0],result);
  await until(()=>f.store.get(id)?.status==="complete");assert.equal(f.acceptances(),1);assert.equal(f.executions(),1);assert.equal(f.deliveries(),1);
  const initial=f.requests.filter(r=>r.message.parts[0].data.kind.endsWith("request.v1"));assert.equal(new Set(initial.map(r=>r.message.messageId)).size,1);
});
test("worker restart recovers the durable engine wait without resubmitting the research task",async t=>{
  const f=await fixture(t),{id}=await f.submit();await f.start();await until(()=>f.jobs.size===1);await f.stop();
  assert.equal(f.store.get(id)?.status,"running");f.results.set([...f.jobs.keys()][0],result);await f.start();await until(()=>f.store.get(id)?.status==="complete");
  assert.equal(f.acceptances(),1);assert.equal(f.executions(),1);assert.ok(f.store.events(id,0).some(e=>e.stepRecovered));
});
test("parent cancellation reconciles only the accepted discovery and does not wake late results",async t=>{
  const f=await fixture(t),{id}=await f.submit();await f.start();await until(()=>f.jobs.size===1);
  assert.equal((await fetch(f.origin+"/api/tasks/"+id,{method:"DELETE"})).status,204);await until(()=>f.cancels()===1);
  f.results.set([...f.jobs.keys()][0],result);await delay(250);assert.equal(f.store.get(id)?.status,"cancelled");assert.equal(f.deliveries(),0);
  assert.equal((await fetch(f.origin+"/api/tasks/"+id+"/record")).status,404);assert.equal(f.store.step(id)?.result,undefined);
});
test("cancelling an unconfirmed initial receipt never resubmits to manufacture ownership",async t=>{
  const f=await fixture(t,{lostInitial:true}),{id}=await f.submit();await f.start();await until(()=>f.acceptances()===1);
  assert.equal((await fetch(f.origin+"/api/tasks/"+id,{method:"DELETE"})).status,204);await until(()=>!!(f.store.step(id)?.cancellation as any)?.reconciled);
  assert.equal(f.requests.length,1);assert.equal(f.cancels(),0);assert.equal(f.jobs.size,0);
});
for(const wrong of ["wrongDemand","wrongContext"] as const)test("foreign protocol identity cannot execute or cancel another task: "+wrong,async t=>{
  const f=await fixture(t,{[wrong]:true}),{id}=await f.submit();await f.start();
  if(wrong==="wrongContext")await until(()=>f.jobs.size===1);
  if(wrong==="wrongContext")f.results.set([...f.jobs.keys()][0],result);
  await until(()=>f.store.get(id)?.status==="failed");assert.equal(f.cancels(),0);if(wrong==="wrongDemand")assert.equal(f.jobs.size,0);
});
test("explicit capability input is validated without interpreting the question or client credentials",async()=>{
  const tasks=openTaskStore(":memory:");try{
    assert.equal(await validateTurn(tasks,body(),{observationCheck:async()=>true}),undefined);
    assert.match((await validateTurn(tasks,body()))!,/未获准/);
    assert.match((await validateTurn(tasks,{...body(),observationCheck:{...check,command:"cat arbitrary"}},{observationCheck:async()=>true}))!,/无效/);
    const ordinary={...body(),query:"observation-check artifact observations v1"};delete (ordinary as any).observationCheck;
    assert.equal(initialObservationCheckpoint(randomUUID(),ordinary),undefined);assert.equal(await validateTurn(tasks,ordinary),undefined);
    assert.equal(parseObservationCheck({...check,version:"../../outside"}),undefined);
  }finally{tasks.close();}
});

test("private machine operations require the service token, which never comes from browser input",async t=>{
  const f=await fixture(t),client=observationDiscoveryClient({base:f.origin,token:"not-the-authorized-service-token"});
  await assert.rejects(client.submit(randomUUID(),randomUUID(),check,new AbortController().signal),/HTTP 401/);assert.equal(f.acceptances(),0);
});

test("a returned result waits for the original discovery terminal acknowledgement without rerunning the engine",async t=>{
  const f=await fixture(t,{pendingFinal:true}),{id}=await f.submit();await f.start();await until(()=>f.jobs.size===1);
  f.results.set([...f.jobs.keys()][0],result);await until(()=>f.deliveries()===1);await delay(150);
  assert.equal(f.store.get(id)?.status,"running");assert.equal(f.executions(),1);f.releaseFinal();await until(()=>f.store.get(id)?.status==="complete");assert.equal(f.deliveries(),1);
});
test("cancelled research reopens actual saved engine material without claiming discovery completion",async t=>{
  const f=await fixture(t,{pendingFinal:true}),{id}=await f.submit();await f.start();await until(()=>f.jobs.size===1);
  f.results.set([...f.jobs.keys()][0],result);await until(()=>f.deliveries()===1);
  assert.equal((await fetch(f.origin+"/api/tasks/"+id,{method:"DELETE"})).status,204);await until(()=>!!(f.store.step(id)?.cancellation as any)?.reconciled);
  const record=await (await fetch(f.origin+"/api/tasks/"+id+"/record")).json();assert.deepEqual(record.result.observationCheckResult,result);
  assert.match(record.result.message,/研究已取消/);assert.match(record.result.message,/不代表原发现委托已完成/);assert.match(record.result.answerNotes.limitation,/不代表时段内连续有效/);
  assert.equal(record.result.answerNotes.references.length,1);assert.deepEqual(record.result.answerNotes.references[0].observationEvidence,result.evidence);
});
test("a no-read capability refusal remains a saved answer with zero file citations",async t=>{
  const f=await fixture(t),{id}=await f.submit();await f.start();await until(()=>f.jobs.size===1);f.results.set([...f.jobs.keys()][0],{status:"not_started",reason:"capacity_not_reserved"});
  await until(()=>f.store.get(id)?.status==="complete");const record=await (await fetch(f.origin+"/api/tasks/"+id+"/record")).json();
  assert.deepEqual(record.result.answerNotes.references,[]);assert.deepEqual(record.result.answerNotes.sources,[]);assert.ok(!record.result.message.includes("〔1〕"));
});
