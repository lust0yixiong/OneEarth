import assert from "node:assert/strict";
import test,{type TestContext} from "node:test";
import express from "express";
import {once} from "node:events";
import {randomUUID} from "node:crypto";
import {mkdtemp,writeFile,readFile,rm} from "node:fs/promises";
import path from "node:path";
import {setTimeout as delay} from "node:timers/promises";
import {openTaskStore,taskRoutes,workTasks,TaskParked,type TaskStore} from "./task-store";
import {validateTurn} from "./runtime-input";
import {emptyFilters} from "../src/domain/spatial";
import {prepareObservationResearch,hasObservationResearch,observationMaterialsRoutes,observationOrdinaryInput,type ObservationAuthority} from "./runtime-observation-authority";
import {recoverObservationResearchRecord} from "./runtime-observation-research";
import {runtimeWorkerRunner} from "./runtime-worker-runner";
import type {RuntimeServices} from "./runtime-turn";
import type {RuntimeObservationEngine} from "./runtime-observation";
import {observationDiscoveryClient,type ObservationTask} from "./observation-discovery-client";
import {modelObservationEvidence,observationResearchKind,type ObservationResearchResult} from "./observation-research-contract";
import {observationCheckSkill,skillResultKind,type ObservationEvidence,type ObservationRequest,type ObservationCheckResult,type SkillExecutionRequest} from "./observation-check-contract";
import type {PinnedObservationMaterial} from "./observation-artifacts";

const token="natural-runtime-controlled-service-token-32bytes";
const material:PinnedObservationMaterial={artifactId:"weather",version:"A",title:"已授权站点观测",variables:["temperature"],sha256:"a".repeat(64)};
const evidence:ObservationEvidence={artifactId:"weather",version:"A",variable:"temperature",sha256:material.sha256,unit:"K",count:2,first:"2020-01-01",last:"2020-01-03"};
const describe:ObservationRequest={skill:observationCheckSkill,artifactId:"weather",version:"A",variable:"temperature",purpose:"describe"};
const body=():any=>({query:"这份资料的温度单位和记录起止是什么？",conversationId:randomUUID(),turnId:randomUUID(),history:[],config:{executor:"codex",model:""},
  context:{filters:emptyFilters(),caseId:null,citation:null,selection:null,gridSystem:"h3",layer:"all",camera:{center:[0,0],zoom:1,reason:"controlled"},
    attachedScope:[{kind:"observation",artifactId:"weather",version:"A",title:"客户端标题不可作模型依据"}]}});
async function until(read:()=>boolean|Promise<boolean>,timeout=6000){const start=Date.now();while(!await read()){if(Date.now()-start>timeout)assert.fail("natural durable worker did not advance");await delay(20);}}
function saveParent(store:TaskStore,conversationId:string,e:ObservationEvidence=evidence){
  const id=randomUUID(),input={...body(),conversationId};return Promise.resolve(store.submit(id,input)).then(async()=>{assert.equal((await store.claim())?.id,id);await store.finish(id,"complete",{result:{message:"原始已读事实",observationCheckResult:{status:"verified",evidence:e}}});return id;});
}

async function fixture(t:TestContext,options:{final?:ObservationResearchResult;check?:ObservationRequest;lostInitial?:boolean;lostReply?:boolean;pendingFinal?:boolean;alterDemand?:(d:any)=>any;alterAnswer?:(answer:any)=>any}={}){
  const tasks=openTaskStore(":memory:"),app=express();let grants=[structuredClone(material)],grantReads=0,release=!options.pendingFinal;
  const authority:ObservationAuthority=async()=>{grantReads++;return structuredClone(grants);};
  const jobs=new Map<string,SkillExecutionRequest>(),results=new Map<string,ObservationCheckResult>(),requests:any[]=[],accepted=new Map<string,{input:any;task:any}>();let cancels=0,deliveries=0;
  const engine:RuntimeObservationEngine={submit:async request=>{if(jobs.has(request.requestId))assert.deepEqual(request,jobs.get(request.requestId));else jobs.set(request.requestId,structuredClone(request));},result:async id=>results.get(id),cancel:async id=>{if(jobs.has(id)&&!results.has(id))results.set(id,{status:"cancelled",reason:"cancelled"});}};
  app.use(express.json({type:["application/json","application/a2a+json"]}));
  app.use(observationMaterialsRoutes(authority));
  app.use(["/message:send","/tasks"],(req,res,next)=>{if(req.get("authorization")!=="Bearer "+token){res.sendStatus(401);return;}next();});
  app.post("/message:send",(req,res)=>{
    const {message,configuration}=req.body,data=message.parts[0].data;requests.push(structuredClone(req.body));
    assert.equal(req.get("A2A-Version"),"1.0");assert.equal(configuration.returnImmediately,true);assert.equal(message.role,"ROLE_USER");
    if(data.kind===observationResearchKind){
      let saved=accepted.get(message.messageId);
      if(saved){assert.deepEqual(data.input,saved.input);}else{
        const demand=options.alterDemand?.({requestId:randomUUID(),researchTaskId:data.input.researchTaskId,check:options.check??describe})??{requestId:randomUUID(),researchTaskId:data.input.researchTaskId,check:options.check??describe};
        const event=options.final?{result:{observationResearchResult:options.final}}:{skillDemand:demand};
        saved={input:structuredClone(data.input),task:{id:randomUUID(),contextId:randomUUID(),status:{state:options.final?"TASK_STATE_COMPLETED":"TASK_STATE_INPUT_REQUIRED"},artifacts:[{artifactId:"first",parts:[{data:{kind:"oneearth.discovery.event.v1",event:{seq:4,...event}}}]}]}};
        accepted.set(message.messageId,saved);if(options.lostInitial){req.socket.destroy();return;}
      }
      res.json({task:saved.task});return;
    }
    assert.equal(data.kind,skillResultKind);const saved=[...accepted.values()].find(s=>s.task.id===message.taskId);assert.ok(saved);assert.equal(message.contextId,saved.task.contextId);
    const demand=saved.task.artifacts[0].parts[0].data.event.skillDemand;assert.equal(data.input.requestId,demand.requestId);assert.equal(data.input.afterSeq,4);
    if(!saved.task.artifacts.some((a:any)=>a.artifactId==="final")){
      deliveries++;const r=data.input.result;
      let answer=r.status==="verified"?{action:"answer",basedOn:"read",evidence:modelObservationEvidence(r.evidence),...(r.matches!==undefined?{matches:r.matches}:{})}:{action:"unavailable",reason:r.reason};
      answer=options.alterAnswer?.(answer)??answer;
      saved.task.artifacts.push({artifactId:"final",parts:[{data:{kind:"oneearth.discovery.event.v1",event:{seq:5,result:{observationResearchResult:answer}}}}]});saved.task.status.state=release?"TASK_STATE_COMPLETED":"TASK_STATE_WORKING";
      if(options.lostReply){req.socket.destroy();return;}
    }
    res.json({task:saved.task});
  });
  app.get("/tasks/:id",(req,res)=>{const s=[...accepted.values()].find(s=>s.task.id===req.params.id);if(!s){res.sendStatus(404);return;}if(release&&s.task.artifacts.length>1)s.task.status.state="TASK_STATE_COMPLETED";res.json(s.task);});
  app.post(/^\/tasks\/([^/]+):cancel$/,(req,res)=>{const s=[...accepted.values()].find(s=>s.task.id===req.params[0]);assert.ok(s);cancels++;s.task.status.state="TASK_STATE_CANCELED";res.json(s.task);});
  taskRoutes(app,"/api/tasks",tasks,input=>validateTurn(tasks,input),{researchRecords:true,prepareWhen:input=>hasObservationResearch(tasks,input),prepare:(id,input)=>prepareObservationResearch(tasks,id,input,authority),recoverRecord:task=>recoverObservationResearchRecord(tasks,task)});
  const server=app.listen(0,"127.0.0.1");await once(server,"listening");const address=server.address();assert.ok(address&&typeof address!=="string");const origin="http://127.0.0.1:"+address.port;
  const client=observationDiscoveryClient({base:origin,token}),services={tasks,push:{latest:()=>({records:[]})},coverage:async()=>assert.fail("no spatial scope"),researchRegionService:{locate:async()=>null},adminBoundaryDir:"/tmp",canonicalCache:new Map()} as unknown as RuntimeServices;
  const runner=runtimeWorkerRunner(services,engine,{client,authority,pollMs:10});let stop:(()=>Promise<void>)|undefined;
  const submit=async(input=body(),id=randomUUID())=>({id,response:await fetch(origin+"/api/tasks",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id,input})})});
  t.after(async()=>{await stop?.();server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));tasks.close();});
  return {tasks,origin,runner,requests,jobs,results,accepted,submit,authority,start:async()=>{stop=await workTasks(tasks,runner.run,{maintenance:runner.maintenance});},stop:async()=>{await stop?.();stop=undefined;},
    grants:(value:PinnedObservationMaterial[])=>{grants=value;},grantReads:()=>grantReads,cancels:()=>cancels,deliveries:()=>deliveries,release:()=>{release=true;}};
}

test("natural API freezes trusted material and server-only digest; list projects only approved metadata",async t=>{
  const f=await fixture(t),input=body(),{id,response}=await f.submit(input);assert.equal(response.status,202);
  assert.deepEqual(f.tasks.step(id)?.materials,[material]);assert.equal(f.grantReads(),1);
  const list=await (await fetch(f.origin+"/api/observation-materials")).json();assert.deepEqual(list,{materials:[{artifactId:material.artifactId,version:material.version,title:material.title,variables:material.variables}]});assert.ok(!JSON.stringify(list).includes(material.sha256));
  f.grants([]);assert.equal((await f.submit(input,id)).response.status,202);assert.equal(f.grantReads(),2,"same UUID does not reread registry");assert.deepEqual(f.tasks.step(id)?.materials,[material]);
  assert.equal((await f.submit({...input,query:"changed"},id)).response.status,409);
});

test("natural describe releases the production worker, keeps no sentinel compare fields, and reopens one real receipt",async t=>{
  const f=await fixture(t),{id}=await f.submit();await f.start();await until(()=>f.jobs.size===1);
  const job=[...f.jobs.values()][0];assert.deepEqual(job.check,describe);assert.equal(job.modelAuthorized,true);assert.equal(job.expectedSha256,material.sha256);
  const ordinary=body();delete ordinary.context.attachedScope;ordinary.query="把地图移动到 120.2E, 30.3N";const other=await f.submit(ordinary);await until(()=>f.tasks.get(other.id)?.status==="complete");
  assert.equal(f.tasks.get(id)?.status,"running");assert.equal(f.tasks.step(id)?.phase,"engine");assert.deepEqual((f.tasks.terminal(other.id)?.result as any).camera.center,[120.2,30.3]);
  f.results.set(job.requestId,{status:"verified",evidence});await until(()=>f.tasks.get(id)?.status==="complete");
  const record=await (await fetch(f.origin+"/api/tasks/"+id+"/record")).json();assert.equal(record.result.observationResearchResult.basedOn,"read");assert.equal(record.result.observationCheckResult.matches,undefined);
  assert.equal(record.result.answerNotes.references.length,1);assert.deepEqual(record.result.answerNotes.references[0].observationEvidence,evidence);assert.match(record.result.message,/单位为「K」/);assert.match(record.result.message,/非空记录共 2 条/);assert.ok(!record.result.message.includes("符合本次"));
  const wire=f.requests[0].message.parts[0].data.input;assert.equal(wire.materials[0].title,material.title);assert.equal(wire.materials[0].sha256,undefined);assert.equal(wire.config,undefined);assert.ok(!JSON.stringify(f.requests[0]).includes(material.sha256));
});
for(const lost of ["lostInitial","lostReply"] as const)test("natural stable message identity reconciles lost acknowledgement: "+lost,async t=>{
  const f=await fixture(t,{[lost]:true}),{id}=await f.submit();await f.start();await until(()=>f.jobs.size===1);f.results.set([...f.jobs.keys()][0],{status:"verified",evidence});await until(()=>f.tasks.get(id)?.status==="complete");
  assert.equal(f.accepted.size,1);assert.equal(f.jobs.size,1);assert.equal(f.deliveries(),1);assert.equal(new Set(f.requests.filter(r=>r.message.parts[0].data.kind===observationResearchKind).map(r=>r.message.messageId)).size,1);
});
test("natural actual receipt survives restart on original external task and waterline",async t=>{
  const f=await fixture(t),{id}=await f.submit();await f.start();await until(()=>f.jobs.size===1);await f.stop();const saved=f.tasks.step(id)!;
  f.results.set([...f.jobs.keys()][0],{status:"verified",evidence});await f.start();await until(()=>f.tasks.get(id)?.status==="complete");assert.equal(f.accepted.size,1);assert.equal(f.tasks.step(id)?.afterSeq,saved.afterSeq);assert.deepEqual(f.tasks.step(id)?.binding,saved.binding);assert.ok(f.tasks.events(id,0).some(e=>e.stepRecovered));
});
for(const count of [2,0])test("unattached same-conversation follow-up reuses only a matching trusted actual receipt, count="+count,async t=>{
  const e={...evidence,count,...(count?{}:{first:null,last:null})};
  const f=await fixture(t,{final:{action:"answer",basedOn:"archive",evidence:modelObservationEvidence(e),matches:true}}),input=body();input.previousTaskId=await saveParent(f.tasks,input.conversationId,e);delete input.context.attachedScope;
  assert.equal(await hasObservationResearch(f.tasks,input),true);const {id,response}=await f.submit(input);assert.equal(response.status,202);await f.start();await until(()=>f.tasks.get(id)?.status==="complete");
  assert.equal(f.jobs.size,0);const output=f.tasks.terminal(id)?.result as any;assert.equal(output.observationCheckResult.matches,undefined);assert.equal(output.observationResearchResult.matches,undefined);assert.equal(output.answerNotes.references.length,1);assert.match(output.message,/此前保存的读据/);assert.match(output.answerNotes.limitation,/本轮未重新读取文件/);assert.ok(!output.message.includes("符合本次"));if(!count)assert.match(output.message,/没有非空记录/);
  const wire=f.requests[0].message.parts[0].data.input;assert.deepEqual(wire.evidence,[modelObservationEvidence(e)]);assert.ok(!JSON.stringify(wire).includes(material.sha256));
});
test("foreign previous task and frontend history cannot establish observation authority",async t=>{
  const f=await fixture(t),input=body();delete input.context.attachedScope;input.previousTaskId=await saveParent(f.tasks,randomUUID());
  assert.equal(await hasObservationResearch(f.tasks,input),false);const {id}=await f.submit({...input,query:"把地图移动到 120.2E, 30.3N"});assert.equal(f.tasks.step(id),undefined);await f.start();await until(()=>f.tasks.get(id)?.status==="complete");assert.equal(f.requests.length,0);assert.equal(f.grantReads(),0);
});
for(const change of ["revoke","sha","variable"] as const)test("unattached persisted evidence is not disclosed after current authorization changes: "+change,async t=>{
  const f=await fixture(t),input=body();input.previousTaskId=await saveParent(f.tasks,input.conversationId);delete input.context.attachedScope;
  f.grants(change==="revoke"?[]:[{...material,...(change==="sha"?{sha256:"b".repeat(64)}:{variables:["other"]})}]);
  input.query="把地图移动到 120.2E, 30.3N";const {id,response}=await f.submit(input);assert.equal(response.status,202);assert.equal(f.tasks.step(id)?.ordinaryFallback,true);
  await f.start();await until(()=>f.tasks.get(id)?.status==="complete");assert.deepEqual((f.tasks.terminal(id)?.result as any).camera.center,[120.2,30.3]);assert.equal(f.requests.length,0);
});
test("ordinary prior answer needs no registry query or new observation checkpoint",async t=>{
  const f=await fixture(t),input=body();delete input.context.attachedScope;const parent=randomUUID();f.tasks.submit(parent,{...input});f.tasks.claim();f.tasks.finish(parent,"complete",{result:{message:"ordinary"}});input.previousTaskId=parent;input.query="把地图移动到 120.2E, 30.3N";
  const {id}=await f.submit(input);assert.equal(f.tasks.step(id),undefined);await f.start();await until(()=>f.tasks.get(id)?.status==="complete");assert.equal(f.grantReads(),0);assert.equal(f.requests.length,0);
});
for(const value of [null,{},"bad",[null],[{kind:"observation",artifactId:"weather",version:"A",title:"x",sha256:material.sha256}]])test("malformed or expanded client attachment returns 400 without preparing an authority: "+JSON.stringify(value),async t=>{
  const f=await fixture(t),input=body();input.context.attachedScope=value;assert.equal((await f.submit(input)).response.status,400);assert.equal(f.grantReads(),0);
});
test("observation attachment never bypasses stored human confirmation validation",async t=>{
  const f=await fixture(t),input=body();input.questionDecision={checkMessageId:randomUUID(),choice:"proposed",originalQuestion:input.query,dataQuestion:"另一个目的"};assert.equal((await f.submit(input)).response.status,400);assert.equal(f.grantReads(),0);assert.equal(f.requests.length,0);
});
for(const action of ["clarify","general"] as const)test("provider action "+action+" uses no observation read or fabricated receipt",async t=>{
  const f=await fixture(t,{final:action==="clarify"?{action,message:"请说明要核对哪个变量。"}:{action}}),input=body();if(action==="general")input.query="把地图移动到 120.2E, 30.3N";
  const {id}=await f.submit(input);await f.start();await until(()=>f.tasks.get(id)?.status==="complete");const result=f.tasks.terminal(id)?.result as any;assert.equal(f.jobs.size,0);
  if(action==="general"){assert.equal(f.tasks.step(id),undefined);assert.deepEqual(result.camera.center,[120.2,30.3]);assert.ok(f.tasks.events(id,0).some(e=>(e.observationResearchDecision as any)?.action==="general"));}
  else{assert.equal(result.clarification,true);assert.deepEqual(result.answerNotes.references,[]);assert.equal(result.observationCheckResult,undefined);}
});
for(const wrong of ["foreign","variable","digest","matches","fabricated"] as const)test("untrusted demand or answer cannot fabricate a read: "+wrong,async t=>{
  const f=await fixture(t,{...(wrong==="foreign"?{alterDemand:d=>({...d,researchTaskId:randomUUID()})}:{}),...(wrong==="variable"?{check:{...describe,variable:"secret"}}:{}),...(wrong==="fabricated"?{final:{action:"answer",basedOn:"archive",evidence:modelObservationEvidence(evidence)}}:{}),...(wrong==="matches"?{alterAnswer:a=>({...a,matches:true})}:{})});
  const {id}=await f.submit();await f.start();if(wrong==="digest"||wrong==="matches"){await until(()=>f.jobs.size===1);f.results.set([...f.jobs.keys()][0],{status:"verified",evidence:{...evidence,...(wrong==="digest"?{sha256:"b".repeat(64)}:{})}});}
  await until(()=>f.tasks.get(id)?.status==="failed");
  if(wrong==="matches"){const kept=f.tasks.terminal(id)?.result as any;assert.deepEqual(kept.observationCheckResult,{status:"verified",evidence});assert.match(kept.message,/不代表原发现委托已完成/);}
  else assert.equal(f.tasks.terminal(id)?.result,undefined);
  if(["foreign","variable","fabricated"].includes(wrong))assert.equal(f.jobs.size,0);if(wrong==="digest")assert.equal(f.deliveries(),0);
});

test("natural cancel after durable receipt preserves its one reference; late new results cannot be adopted",async t=>{
  const f=await fixture(t,{pendingFinal:true}),{id}=await f.submit();await f.start();await until(()=>f.jobs.size===1);f.results.set([...f.jobs.keys()][0],{status:"verified",evidence});await until(()=>f.deliveries()===1);
  assert.equal((await fetch(f.origin+"/api/tasks/"+id,{method:"DELETE"})).status,204);await until(()=>!!(f.tasks.step(id)?.cancellation as any)?.reconciled);
  const record=await (await fetch(f.origin+"/api/tasks/"+id+"/record")).json();assert.equal(record.result.answerNotes.references.length,1);assert.match(record.result.message,/研究已取消/);assert.match(record.result.message,/不代表原发现委托已完成/);
  assert.equal(f.tasks.saveStep(id,{...f.tasks.step(id),result:{status:"verified",evidence:{...evidence,count:100}}}),false);assert.deepEqual((f.tasks.terminal(id)?.result as any).answerNotes.references[0].observationEvidence,evidence);
});
test("natural cancel before a receipt has zero evidence and does not deliver a late result",async t=>{
  const f=await fixture(t),{id}=await f.submit();await f.start();await until(()=>f.jobs.size===1);assert.equal((await fetch(f.origin+"/api/tasks/"+id,{method:"DELETE"})).status,204);await until(()=>!!(f.tasks.step(id)?.cancellation as any)?.reconciled);f.results.set([...f.jobs.keys()][0],{status:"verified",evidence});await delay(150);assert.equal(f.deliveries(),0);assert.equal((await fetch(f.origin+"/api/tasks/"+id+"/record")).status,404);
});
test("natural current model grant revocation before send/engine/delivery prevents new external disclosure",async t=>{
  for(const phase of ["submit","engine","deliver"]){
    const f=await fixture(t),{id}=await f.submit();let picked=f.tasks.claim()!;
    if(phase!=="submit"){assert.ok(await f.runner.run(picked,new AbortController().signal,()=>{}) instanceof TaskParked);await delay(20);picked=f.tasks.claim()!;}
    if(phase==="deliver"){f.results.set((picked.checkpoint as any).requestId,{status:"verified",evidence});assert.ok(await f.runner.run(picked,new AbortController().signal,()=>{}) instanceof TaskParked);await delay(20);picked=f.tasks.claim()!;}
    f.grants([]);const value=await f.runner.run(picked,new AbortController().signal,()=>{});assert.ok(!(value instanceof TaskParked));f.tasks.finish(id,"complete",value);assert.equal(f.deliveries(),0);assert.equal(f.tasks.terminal(id)?.result&&((f.tasks.terminal(id)?.result as any).answerNotes.references.length),0);if(phase==="submit")assert.equal(f.requests.length,0);if(phase==="engine")assert.equal(f.jobs.size,0);
  }
});

test("natural comparison uses the provider's persisted exact demand, rather than inventing describe conditions",async t=>{
  const check:ObservationRequest={skill:observationCheckSkill,artifactId:"weather",version:"A",variable:"temperature",unit:"K",start:"2020-01-01",end:"2020-01-02"};
  const f=await fixture(t,{check}),{id}=await f.submit({...body(),query:"单位是K且记录起止覆盖2020年1月1日至2日吗？"});await f.start();await until(()=>f.jobs.size===1);
  assert.deepEqual([...f.jobs.values()][0].check,check);f.results.set([...f.jobs.keys()][0],{status:"verified",matches:true,evidence});await until(()=>f.tasks.get(id)?.status==="complete");
  const record=f.tasks.terminal(id)?.result as any;assert.equal(record.observationCheckResult.matches,true);assert.deepEqual(record.observationCheck,check);assert.match(record.message,/符合本次指定的单位和记录起止边界/);assert.match(record.answerNotes.limitation,/不代表时段内连续有效/);
});
test("natural cancellation with an unconfirmed initial receipt does not resubmit or cancel an unknown Task",async t=>{
  const f=await fixture(t,{lostInitial:true}),{id}=await f.submit();await f.start();await until(()=>f.accepted.size===1);
  assert.equal((await fetch(f.origin+"/api/tasks/"+id,{method:"DELETE"})).status,204);await until(()=>!!(f.tasks.step(id)?.cancellation as any)?.reconciled);
  assert.equal(f.requests.length,1);assert.equal(f.cancels(),0);assert.equal(f.jobs.size,0);
});
test("client-provided digest and ungranted material cannot create a natural checkpoint",async t=>{
  const f=await fixture(t);assert.equal((await f.submit({...body(),expectedSha256:material.sha256})).response.status,400);assert.equal(f.grantReads(),0);
  const input=body();input.context.attachedScope[0].artifactId="ungranted";assert.equal((await f.submit(input)).response.status,400);assert.equal(f.requests.length,0);
});
test("general releases the checkpoint before ordinary execution so a crash cannot replay it",async t=>{
  const f=await fixture(t,{final:{action:"general"}}),input=body();input.query="把地图移动到 120.2E, 30.3N";const {id}=await f.submit(input);
  const picked=f.tasks.claim()!;assert.ok(await f.runner.run(picked,new AbortController().signal,()=>{}) instanceof TaskParked);await delay(20);
  const general=f.tasks.claim()!;const clear=f.tasks.clearStep.bind(f.tasks);let cleared=false;
  f.tasks.clearStep=taskId=>{cleared=clear(taskId);throw Error("controlled process interruption just after atomic clear");};
  await assert.rejects(f.runner.run(general,new AbortController().signal,()=>{}),/controlled process interruption/);assert.equal(cleared,true);assert.equal(f.tasks.step(id),undefined);
  f.tasks.recoverInterrupted();assert.equal(f.tasks.get(id)?.status,"failed");assert.equal(f.tasks.terminal(id)?.code,"worker_interrupted");assert.equal(f.tasks.claim(),undefined);
});

test("unavailable transition removes browser prose, source mirrors, citations and the private parent before normal planning",async()=>{
  const input=body();input.previousTaskId=randomUUID();input.history=[{role:"assistant",text:"SENSITIVE_OLD_OBSERVATION_FACT",conversationContext:"SENSITIVE_OLD_CONTEXT",conversationReferences:[{kind:"asset",id:"observation:old",title:"OLD",source:"file",evidenceLevel:"observation-file",observationEvidence:evidence}]}];
  input.context.citation={title:"OLD",scope:"file",body:"SENSITIVE_OLD_CITATION"};input.context.candidateIds=["observation:old"];
  input.context.attachedScope.push({kind:"reference",number:1,messageId:randomUUID(),reference:input.history[0].conversationReferences[0]});
  const original=JSON.stringify(input),safe=observationOrdinaryInput(input,true);
  assert.equal(safe.query,input.query);assert.equal(safe.previousTaskId,undefined);assert.equal(safe.context.citation,null);assert.deepEqual(safe.context.candidateIds,[]);assert.deepEqual(safe.context.attachedScope,[]);
  assert.ok(!JSON.stringify(safe).includes("SENSITIVE"));assert.ok(!JSON.stringify(safe).includes(material.sha256));assert.match(safe.history[0].text,/此前观测资料现在不可用/);assert.equal(JSON.stringify(input),original);
});
test("a newly authorized explicit object carries only its own metadata and matching server receipts",async t=>{
  const next={artifactId:"new-weather",version:"B",title:"当前新对象",variables:["rain"],sha256:"b".repeat(64)};
  const f=await fixture(t,{final:{action:"clarify",message:"请说明新资料的用途。"}}),input=body();input.previousTaskId=await saveParent(f.tasks,input.conversationId);input.history=[{role:"assistant",text:"SENSITIVE_OLD_FACT"}];input.context.attachedScope=[{kind:"observation",artifactId:next.artifactId,version:next.version,title:"client"}];f.grants([next]);
  const {id,response}=await f.submit(input);assert.equal(response.status,202);assert.deepEqual(f.tasks.step(id)?.history,[]);await f.start();await until(()=>f.tasks.get(id)?.status==="complete");
  const wire=f.requests[0].message.parts[0].data.input;assert.deepEqual(wire.materials,[{artifactId:next.artifactId,version:next.version,title:next.title,variables:next.variables}]);assert.deepEqual(wire.evidence,[]);assert.ok(!JSON.stringify(wire).includes("SENSITIVE"));assert.ok(!JSON.stringify(wire).includes(JSON.stringify(material.artifactId)));
  const original=f.tasks.terminal(input.previousTaskId)?.result as any;assert.deepEqual(original.observationCheckResult.evidence,evidence,"revocation does not rewrite the old record");
});

for(const dependent of [true,false])test("production normal model prompt after revocation excludes both browser and persisted old facts: dependent="+dependent,async t=>{
  const dir=await mkdtemp("/tmp/oe-natural-model-stub-"),log=path.join(dir,"prompts.jsonl"),oldPath=process.env.PATH;
  const question=dependent?"刚才那份资料的单位是什么？":"什么是线性插值？";
  const planned={action:dependent?"search":"respond",evidenceNeed:dependent?"discover":"none",goal:question,targets:[],reason:"受控语义规划",clarification:null,evidenceGap:dependent?"需原文件事实":null,
    observationUse:dependent?"unavailable":"unrelated",researchIntent:{purpose:question,task:question,region:null,time:null,months:[]},conversationContext:question};
  await writeFile(path.join(dir,"codex"),"#!"+process.execPath+"\nconst fs=require('node:fs');let prompt='';process.stdin.on('data',c=>prompt+=c);process.stdin.on('end',()=>{const a=process.argv.slice(2),s=JSON.parse(fs.readFileSync(a[a.indexOf('--output-schema')+1],'utf8'));fs.appendFileSync("+JSON.stringify(log)+",JSON.stringify({prompt,schema:s})+'\\n');process.stdout.write(JSON.stringify(s.properties.action?"+JSON.stringify(planned)+":{message:'线性插值在两个已知点之间按直线估算。',sections:[],limitation:'这是一般概念说明。',followUp:'',researchNotes:[],calculationRequests:[]}));});",{mode:0o700});
  process.env.PATH=dir+path.delimiter+oldPath;t.after(async()=>{process.env.PATH=oldPath;await rm(dir,{recursive:true,force:true});});
  const f=await fixture(t),input=body();input.query=question;delete input.context.attachedScope;
  const parentId=randomUUID();f.tasks.submit(parentId,{...input});f.tasks.claim();f.tasks.finish(parentId,"complete",{result:{message:"SECRET_PERSISTED_OBSERVATION_FACT",conversationContext:"SECRET_PERSISTED_CONTEXT",observationCheckResult:{status:"verified",evidence},
    answerNotes:{references:[{kind:"asset",id:"observation:private",title:"SECRET_PERSISTED_TITLE",source:"file",evidenceLevel:"observation-file",observationEvidence:evidence}]}}});
  input.previousTaskId=parentId;input.history=[{role:"assistant",text:"SECRET_BROWSER_OBSERVATION_FACT",conversationContext:"SECRET_BROWSER_CONTEXT"}];input.context.citation={title:"SECRET_CITATION",scope:"file",body:"SECRET_BODY"};f.grants([]);
  const {id,response}=await f.submit(input);assert.equal(response.status,202);await f.start();await until(()=>f.tasks.get(id)?.status==="complete");
  const received=(await readFile(log,"utf8")).trim().split("\n").map(line=>JSON.parse(line));assert.equal(received.length,dependent?1:2,"only the existing planner and ordinary synthesis may run");
  for(const {prompt} of received){assert.ok(!prompt.includes("SECRET_"));assert.ok(!prompt.includes(material.sha256));assert.ok(!prompt.includes("observation:private"));assert.ok(!prompt.includes('"artifactId":"weather"'));}
  assert.ok(received[0].schema.required.includes("observationUse"));assert.equal(f.requests.length,0);assert.equal(f.jobs.size,0);const output=f.tasks.terminal(id)?.result as any;
  if(dependent){assert.equal(output.observationMaterialsUnavailable,true);assert.match(output.message,/现在不可用/);assert.equal(output.answerNotes,undefined);}
  else{assert.match(output.message,/线性插值/);assert.deepEqual(output.answerNotes.references,[]);}
  assert.equal((f.tasks.terminal(parentId)?.result as any).message,"SECRET_PERSISTED_OBSERVATION_FACT");
});
