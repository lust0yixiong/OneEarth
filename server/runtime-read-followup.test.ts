import test,{type TestContext} from "node:test";
import assert from "node:assert/strict";
import {once} from "node:events";
import {randomUUID} from "node:crypto";
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from "node:fs";
import path from "node:path";
import {tmpdir} from "node:os";
import express from "express";
import {runForegroundTurn,resumePlannedTurn,type RuntimeTurnInput,type RuntimeServices} from "./runtime-turn";
import {openTaskStore} from "./task-store";
import {emptyFilters} from "../src/domain/spatial";
import type {SearchRun} from "../src/domain/types";

const source="https://example.org/fictional-report.pdf",independent="https://example.org/fictional-validation";
const natural="这张图的归一化用了什么输入？缺少的不确定度依据会怎样影响比较？";
const decision=(action:string,gap:string|null=null,targets:string[]=[])=>({action,reason:"use actual material within original scope",gap,targets,clarification:null});
const readRun=(round=0):SearchRun=>({engine:"PDF 原文",query:source,requestUrl:source,status:"done",hits:[{url:source,title:"Fictional sensor report",snippet:"actual bounded read",pageExcerpt:round?"The fictional appendix defines uncertainty as an instrument bound; no recomputation was done.":"The fictional chart normalizes two instrument inputs. This sampled window does not state their uncertainty.",stage:"pdf-excerpt",readBy:"platform",readAt:"2026-01-01T00:00:0"+round+"Z"}]});
async function fixture(t:TestContext,{lostDiscovery=false,readFails=false,emptyRead=false,initialAction="read",locatorMode=false}:{locatorMode?:boolean;lostDiscovery?:boolean;readFails?:boolean;emptyRead?:boolean;initialAction?:"read"|"search"}={}){
 const dir=mkdtempSync(path.join(tmpdir(),"oneearth-read-followup-")),responses=path.join(dir,"responses.json"),callsFile=path.join(dir,"calls.jsonl");
 const saved={PATH:process.env.PATH,ONEEARTH_DISCOVERY_URL:process.env.ONEEARTH_DISCOVERY_URL,ONEEARTH_DISCOVERY_PROTOCOL:process.env.ONEEARTH_DISCOVERY_PROTOCOL};const originalFetch=globalThis.fetch;
 writeFileSync(path.join(dir,"codex"),`#!${process.execPath}\nimport fs from 'node:fs';let prompt='';for await(const chunk of process.stdin)prompt+=chunk;fs.appendFileSync(${JSON.stringify(callsFile)},JSON.stringify({prompt})+'\\n');let settings=JSON.parse(fs.readFileSync(${JSON.stringify(responses)},'utf8'));let value;if(prompt.startsWith('仅做本轮'))value=settings.initialAction==='search'?{decide:{kind:'search',goal:'Study the original chart question',targets:[]}}:{decide:{kind:'read',targets:['web:${source}']}};else if(prompt.includes('你负责决定同一轮研究任务的下一步')){value=settings.steps.shift();fs.writeFileSync(${JSON.stringify(responses)},JSON.stringify(settings));}else {const at=prompt.lastIndexOf('\\n{'),input=JSON.parse(prompt.slice(at+1));value={message:'仅据虚构原报告与实际交回的资料说明限制。'+input.webResults.map(r=>'['+r.ref+']').join(''),sections:[],limitation:'没有测量或重新计算。',followUp:'',researchNotes:[],calculationRequests:[]};}process.stdout.write(JSON.stringify(value));\n`,{mode:0o700});
 process.env.PATH=dir+path.delimiter+(saved.PATH||"");process.env.ONEEARTH_DISCOVERY_PROTOCOL="a2a";
 const app=express();app.use(express.json({type:"application/a2a+json"}));const requests:any[]=[],jobs=new Map<string,any>();let reads=0,finds=0,dropped=false;
 app.post("/message:send",(req,res)=>{
  const message=req.body.message,data=message.parts[0].data;requests.push({messageId:message.messageId,taskId:message.taskId,kind:data.kind,input:data.input});
  let task=jobs.get(message.messageId);
  if(!task){
   const id=randomUUID(),contextId=randomUUID();let event:any;
   if(data.kind==="oneearth.source.read.v1"){
    assert.equal(data.input.targets.length,1);assert.ok([source,...(locatorMode?[independent]:[])].includes(data.input.targets[0].url));
    if(readFails){res.status(503).type("application/a2a+json").json({error:{code:503,message:"controlled precise-read service failure"}});return;}
    const round=reads++;
    const target=data.input.targets[0],run=readRun(round);
    if(locatorMode){
     run.query=target.url;run.requestUrl=target.url;
     run.hits=run.hits.map(hit=>({...hit,url:target.url,availableLocators:[{kind:"table" as const,value:"rates",label:"Measured rates"},{kind:"section" as const,value:"sampling",label:"Sampling procedure"},{kind:"figure" as const,value:"profile",label:"Observed profile"},{kind:"equation" as const,value:"normalization",label:"Normalization relation"}],
      ...(target.locators?.length?{pageExcerpt:"CONTROLLED_LOCATED_FACT: measured rate = 0.4; normalization uses actual input X.",locatorResults:target.locators.map((locator:any)=>({...locator,status:"found",excerpt:"CONTROLLED_LOCATED_FACT: measured rate = 0.4; normalization uses actual input X."}))}:{})}));
    }
    event={seq:1,sourceReadResult:{searches:emptyRead?[]:[run],papers:[],issues:[]}};
   }else{
    assert.equal(data.kind,"oneearth.discovery.request.v1");finds++;
    event={seq:1,result:{plan:{questionMode:"preserve",dataQuestion:data.input.query,dataNeed:null,researchIntent:{purpose:data.input.query,task:data.input.researchGoal,region:null,time:null,months:[]},paper:{name:"",facets:[],region:[]},hainaQueries:[],web:[]},papers:[],haina:[],searches:[{engine:"DeepSeek Search",query:"fictional instrument uncertainty",status:"done",hits:[{url:independent,title:"Fictional independent validation",snippet:"An independent candidate; no body was read."}]}],issues:[],sourceStatus:[{source:"网络检索",status:"done",count:1,detail:"controlled reply"}]}};
   }
   task={id,contextId,status:{state:"TASK_STATE_COMPLETED"},artifacts:[{artifactId:"receipt-"+id,parts:[{data:{kind:"oneearth.discovery.event.v1",event}}]}]};jobs.set(message.messageId,task);
  }
  if(lostDiscovery&&!dropped&&data.kind==="oneearth.discovery.request.v1"){dropped=true;req.socket.destroy();return;}
  res.type("application/a2a+json").json({task});
 });
 const server=app.listen(0,"127.0.0.1");await once(server,"listening");const address=server.address();assert.ok(address&&typeof address!=="string");const origin="http://127.0.0.1:"+address.port;process.env.ONEEARTH_DISCOVERY_URL=origin;
 globalThis.fetch=(url,init)=>{assert.equal(new URL(String(url)).origin,origin,"no real model/source/network request");return originalFetch(url,init);};
 const tasks=openTaskStore(":memory:"),services={tasks,push:{latest:()=>({records:[]})},coverage:async()=>assert.fail("no grid supplied"),researchRegionService:{locate:async()=>null},adminBoundaryDir:dir,canonicalCache:new Map()} as unknown as RuntimeServices;
 t.after(async()=>{globalThis.fetch=originalFetch;tasks.close();for(const [key,value] of Object.entries(saved)){if(value===undefined)delete process.env[key];else process.env[key]=value;}server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));rmSync(dir,{recursive:true,force:true});});
 const calls=()=>{try{return readFileSync(callsFile,"utf8").trim().split("\n").filter(Boolean).map(line=>JSON.parse(line));}catch{return [];}};
 return {requests,tasks,jobs,calls,counts:()=>({reads,finds}),async run(query:string,steps:unknown[]){
  writeFileSync(responses,JSON.stringify({steps,initialAction}));
  const id=randomUUID(),body:RuntimeTurnInput={query,context:{caseId:null,filters:emptyFilters(),selection:null,citation:null,attachedScope:[{kind:"reference",number:1,messageId:randomUUID(),reference:{kind:"web",url:source,title:"Fictional sensor report"}}],gridSystem:"h3",layer:"all",camera:{center:[0,0],zoom:1,reason:"controlled"}},history:[],config:{executor:"codex",model:""},conversationId:randomUUID(),turnId:randomUUID()};
  const parent=new AbortController(),first=await runForegroundTurn(services,id,body,parent.signal,()=>{});assert.equal(first.kind,"research");if(first.kind!=="research")throw Error("not handed off");
  tasks.submit(id,body);tasks.claim();const outcome=await resumePlannedTurn(services,id,body,first.checkpoint,parent.signal,event=>tasks.append(id,event));
  assert.equal(outcome.error,undefined);tasks.finish(id,"complete",outcome);return {id,body,outcome,result:outcome.result as any};
 }};
}

test("a natural chart question can read, obtain one independent accepted Task and archive both real material layers",async t=>{
 const f=await fixture(t,{lostDiscovery:true}),r=await f.run(natural,[decision("discover","independent uncertainty basis"),decision("answer")]);
 assert.deepEqual(f.counts(),{reads:1,finds:1});assert.equal(f.requests.filter(request=>request.kind==="oneearth.discovery.request.v1").length,2,"lost acknowledgement reuses one business identity");
 const request=f.requests.find(request=>request.kind==="oneearth.discovery.request.v1")!;assert.equal(request.messageId,r.id);assert.equal(request.input.query,natural);assert.equal(request.input.continuation,undefined);assert.equal(request.input.evidenceGap,"independent uncertainty basis");
 assert.equal(request.input.researchGoal,firstPlanGoal(f.calls()));assert.equal(request.input.config,undefined);
 const bindings=f.tasks.events(r.id,0).filter(event=>event.discoveryBinding).map(event=>event.discoveryBinding as any);assert.ok(bindings.some(binding=>binding.discoveryId===f.jobs.get(r.id).id&&binding.messageId===r.id));
 assert.notEqual(f.jobs.get(r.id).id,r.id);assert.notEqual(f.requests[0].messageId,r.id);
 assert.ok(r.result.resultBatch.itemIds.some((id:string)=>id.includes("fictional-validation")));assert.equal(r.result.resultBatch.query,natural);
 const synthesis=f.calls().find((call:any)=>call.prompt.includes('"currentResultBatch"')&&call.prompt.includes('"catalogue"'))!;assert.ok(synthesis);const payload=JSON.parse(synthesis.prompt.slice(synthesis.prompt.lastIndexOf("\n{")+1));
 assert.equal(payload.turnAction.action,"read");assert.equal(payload.executionScope.discoveryDelegated,true);assert.ok(payload.webResults.some((hit:any)=>hit.pageExcerpt?.includes("sampled window")));assert.ok(payload.webResults.some((hit:any)=>hit.url===independent));
 const saved=f.tasks.terminal(r.id) as any;assert.deepEqual(saved.result.resultBatch,r.result.resultBatch);const materials=f.tasks.materialEvents(r.id);assert.ok(materials.some((event:any)=>event.researchMaterials.searches.some((run:SearchRun)=>run.hits.some(hit=>hit.url===source))));assert.ok(materials.some((event:any)=>event.researchMaterials.searches.some((run:SearchRun)=>run.hits.some(hit=>hit.url===independent))));
 t.diagnostic(JSON.stringify({runtimeTask:r.id,readMessage:f.requests[0].messageId,discoveryTask:f.jobs.get(r.id).id,discoveryMessages:f.requests.filter(q=>q.kind==="oneearth.discovery.request.v1").map(q=>q.messageId),batch:r.result.resultBatch.batchId,executedToolRequests:f.counts()}));
});
function firstPlanGoal(calls:any[]){const first=calls.find(call=>call.prompt.startsWith("仅做本轮"));return JSON.parse(first.prompt.slice(first.prompt.lastIndexOf("\n{")+1)).question;}

test("the same natural question with only-this-source retains its first read and makes zero independent requests",async t=>{
 const f=await fixture(t),r=await f.run(natural+"仅依据本报告，不另查。",[decision("discover","independent uncertainty basis"),decision("answer")]);
 assert.deepEqual(f.counts(),{reads:1,finds:0});assert.equal(r.result.resultBatch,undefined);assert.ok(r.result.answerNotes.searches.some((run:SearchRun)=>run.hits.some(hit=>hit.pageExcerpt?.includes("sampled window"))));
 const reviewers=f.calls().filter((call:any)=>call.prompt.includes("你负责决定同一轮研究任务的下一步"));assert.equal(reviewers.length,2);const second=JSON.parse(reviewers[1].prompt.slice(reviewers[1].prompt.lastIndexOf("\n{")+1));assert.equal(second.previousFailure.toolAttempted,false);assert.ok(!second.actions.includes("discover"));
});

test("same-source local reread gets a new precise Task only for a different bound gap",async t=>{
 const f=await fixture(t),r=await f.run(natural+"仅依据本报告，不另查。",[decision("read","the uncertainty definition missing from the initial window",["W1"]),decision("answer")]);
 assert.deepEqual(f.counts(),{reads:2,finds:0});assert.notEqual(f.requests[0].messageId,f.requests[1].messageId);assert.equal(f.requests[1].input.question,natural+"仅依据本报告，不另查。\nthe uncertainty definition missing from the initial window");assert.equal(r.result.answerNotes.searches.length,2);
});

test("an excluded channel or uncertain first read never starts independent discovery or repeats the source blindly",async t=>{
 const f=await fixture(t,{readFails:true});const r=await f.run(natural+"仅依据本报告，不另查。",[decision("read","same source again",["W1"]),decision("answer")]);
 assert.deepEqual(f.counts(),{reads:0,finds:0});assert.equal(new Set(f.requests.map(request=>request.messageId)).size,1,"only bounded transport retries for the original submission, no new research read");assert.equal(r.result.resultBatch,undefined);const reviewer=f.calls().find((call:any)=>call.prompt.includes("你负责决定同一轮研究任务的下一步"));assert.match(reviewer.prompt,/precise-read service|提交失败|HTTP 503/);
});

test("an empty successful precise reply still receives one evidence decision with truthful no-material status",async t=>{
 const f=await fixture(t,{emptyRead:true}),r=await f.run(natural+"仅依据本报告，不另查。",[decision("answer")]);
 assert.deepEqual(f.counts(),{reads:1,finds:0});const reviewers=f.calls().filter((call:any)=>call.prompt.includes("你负责决定同一轮研究任务的下一步"));assert.equal(reviewers.length,1);
 const payload=JSON.parse(reviewers[0].prompt.slice(reviewers[0].prompt.lastIndexOf("\n{")+1));assert.equal(payload.materials.web.length,0);assert.match(payload.materials.issues.join(" "),/未取得新的/);assert.match(payload.materials.issues.join(" "),/未确认成功读取/);assert.equal(r.result.resultBatch,undefined);
});

test("a model's proposed gap is sanitized before its new discovery wire, without rewriting actual source identity",async t=>{
 const f=await fixture(t),r=await f.run(natural,[decision("discover","independent basis https://example.org/metadata?sig=controlled-secret"),decision("answer")]);
 const request=f.requests.find(request=>request.kind==="oneearth.discovery.request.v1")!;assert.doesNotMatch(request.input.evidenceGap,/controlled-secret|[?&]sig=/);assert.equal(request.input.query,natural);assert.equal(f.requests[0].input.targets[0].url,source);assert.equal(r.result.answerNotes.searches.find((run:SearchRun)=>run.engine==="PDF 原文").query,source);
});

test("an initial search outside a report-only scope is rejected before any discovery request",async t=>{
 const f=await fixture(t,{initialAction:"search"}),r=await f.run(natural+"仅依据本报告，不另查。",
  [decision("read","original report chart source",["W1"]),decision("answer")]);
 assert.deepEqual(f.counts(),{reads:1,finds:0});
 assert.equal(r.result.resultBatch,undefined);
 assert.deepEqual(f.requests.map(request=>request.kind),["oneearth.source.read.v1"]);
 const review=f.calls().find((call:any)=>call.prompt.includes("你负责决定同一轮研究任务的下一步"));
 const input=JSON.parse(review.prompt.slice(review.prompt.lastIndexOf("\n{")+1));
 assert.equal(input.previousFailure.kind,"decision");assert.equal(input.previousFailure.toolAttempted,false);
 assert.ok(!input.actions.includes("discover"));assert.deepEqual(input.materials.exactReadTargets.map((target:any)=>target.url),[source]);
 assert.ok(r.result.answerNotes.searches.some((run:SearchRun)=>run.hits.some(hit=>hit.url===source)));
});


test("two invalid evidence fields followed by a third valid four-position decision reach the real exact-source A2A route",async t=>{
 const f=await fixture(t,{locatorMode:true});
 const positions=[{kind:"table",value:"rates"},{kind:"section",value:"sampling"},{kind:"figure",value:"profile"},{kind:"equation",value:"normalization"}];
 const r=await f.run(natural+"仅依据本报告，不另查。",[
  {...decision("read","missing exact field",["W999"]),locators:positions},
  {...decision("read","missing exact field",["W1"]),locators:[{kind:"wrong",value:"rates"}]},
  {action:"read",gap:"the exact measured method fields",targets:["W1"],locators:positions,clarification:null},decision("answer")]);
 assert.deepEqual(f.counts(),{reads:2,finds:0});assert.deepEqual(f.requests[1].input.targets,[{kind:"web",url:source,title:"Fictional sensor report",locators:positions}]);
 assert.notEqual(f.requests[0].messageId,f.requests[1].messageId);assert.ok(f.tasks.events(r.id,0).filter(event=>event.sourceReadBinding).length>=2);
 const reviewers=f.calls().filter((call:any)=>call.prompt.includes("你负责决定同一轮研究任务的下一步"));assert.equal(reviewers.length,4);
 const third=JSON.parse(reviewers[2].prompt.slice(reviewers[2].prompt.lastIndexOf("\n{")+1));assert.equal(third.previousFailure.diagnostic.field,"locators[0].kind");assert.equal(third.resources.remainingLocatorReads,4);assert.equal(third.resources.remainingAcquisitions,2);assert.ok(third.materials.web[0].availableLocators.some((locator:any)=>locator.kind==="table"));
 const saved=f.tasks.terminal(r.id) as any;assert.ok(saved.result.answerNotes.searches.some((run:SearchRun)=>run.hits.some(hit=>hit.locatorResults?.length===4)));assert.ok(saved.result.answerNotes.searches.some((run:SearchRun)=>run.hits.some(hit=>hit.pageExcerpt?.includes("sampled window"))));
 assert.ok(f.tasks.materialEvents(r.id).some((event:any)=>event.researchMaterials.searches.some((run:SearchRun)=>run.hits.some(hit=>hit.locatorResults?.length===4))));
});

test("after two external acquisitions the same accepted research can still locate within its original obtained source",async t=>{
 const f=await fixture(t,{locatorMode:true}),positions=[{kind:"table",value:"rates"}],r=await f.run(natural,[decision("discover","independent uncertainty basis"),decision("read","read the new independent source",["W2"]),{action:"read",gap:"the original measured rate",targets:["W1"],locators:positions,clarification:null},decision("answer")]);
 assert.deepEqual(f.counts(),{reads:3,finds:1});const requests=f.requests.filter(request=>request.kind==="oneearth.source.read.v1");assert.deepEqual(requests.map(request=>request.input.targets[0].url),[source,independent,source]);assert.deepEqual(requests[2].input.targets[0].locators,positions);
 const reviewers=f.calls().filter((call:any)=>call.prompt.includes("你负责决定同一轮研究任务的下一步"));const third=JSON.parse(reviewers[2].prompt.slice(reviewers[2].prompt.lastIndexOf("\n{")+1));assert.equal(third.resources.remainingAcquisitions,0);assert.equal(third.resources.remainingLocatorReads,4);assert.ok(third.actions.includes("read"));assert.ok(!third.actions.includes("discover"));
 const budget=JSON.parse(r.result.runTrace.calls.find((call:any)=>call.id==="research-budget").output);assert.deepEqual({external:budget.acquisitions,locator:budget.locatorReads,tools:budget.toolAttempts},{external:2,locator:1,tools:3});assert.ok(r.result.resultBatch.itemIds.some((id:string)=>id.includes("fictional-validation")));
 const saved=f.tasks.terminal(r.id) as any;assert.ok(saved.result.answerNotes.searches.some((run:SearchRun)=>run.hits.some(hit=>hit.locatorResults?.length===1)));assert.ok(f.tasks.events(r.id,0).some(event=>event.discoveryBinding));
});
