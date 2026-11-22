import assert from "node:assert/strict";
import test,{type TestContext} from "node:test";
import {randomUUID} from "node:crypto";
import {once} from "node:events";
import {setTimeout as delay} from "node:timers/promises";
import {mkdtempSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import express from "express";
import {queryPapers,readSourcesThroughA2A,DiscoveryA2AError,discoveryA2ACancellation} from "./discovery-a2a-client";
import {runtimePaperRoutes} from "./runtime-paper-routes";
import {runtimeMaterialHistory} from "./runtime-material-history";
import {runtimeTurnPapers} from "./runtime-turn-papers";
import {openTaskStore} from "./task-store";
import {executeTurn,type RuntimeServices} from "./runtime-turn";
import {emptyFilters} from "../src/domain/spatial";
import {researchExecutor} from "./research-executor";
import {TaskCancelled} from "./task-cancellation";
import {assetById,assets} from "../src/domain/datasets";
import type {PaperRecord} from "../src/domain/paper-record";
import type {PaperQuery,SourceReadInput,SourceReadResult} from "./discovery-materials-contract";

const record=(letter="a"):PaperRecord=>({id:"earthnano:"+letter.repeat(64),dsKey:"doi:10.9999/same-dataset",papers:1,paperTitle:"Controlled material "+letter,studyContext:"",points:[],
  need:{name:"Controlled material",product:"Controlled data "+letter,type:"论文抽取线索",detail:"Original acquired detail "+letter,status:"used",source:"文献资料",datasetId:"doi:10.9999/same-dataset",
    profile:{role:"data",spatial:"nonspatial",coverage:"unknown",access:"public",limitation:"fixture"},
    tabs:[{kind:"table",label:"论文用法（本页）",rows:[["paper","input","field","","paper-1","dataset-1"]]}]}});
const url="https://example.org/controlled-original.pdf",otherUrl="https://example.org/unselected";
const sourceInput=():SourceReadInput=>({question:"Read this exact page only",targets:[{kind:"web",url,title:"Original paper",discoveredBy:"user"},{kind:"paper",id:record().id}],deepseekFetch:false});
const material=():SourceReadResult=>({papers:[record()],searches:[{engine:"PDF 原文",query:url,requestUrl:url,status:"done",hits:[{url,title:"Original paper",snippet:"actual source excerpt",pageExcerpt:"Actual acquired source paragraph",stage:"pdf-excerpt",readAt:"2026-11-22T00:00:00Z"}]}],issues:[],
  paperEvidence:[{id:record().id,readAt:"2026-11-22T00:00:00Z",evidence:{dataset:null,papers:[]}}]});
const list=(records=[record()])=>({records,nextCursor:null,total:records.length,catalog:{complete:true,source:"fixture",sourceTotal:records.length,filteredOut:0,updatedAt:null},cached:true});
const respond=(res:express.Response,body:unknown,status=200)=>res.status(status).type("application/a2a+json").send(JSON.stringify(body));
async function listen(t:TestContext,app:express.Express){
  const server=app.listen(0,"127.0.0.1");await once(server,"listening");const address=server.address();assert.ok(address&&typeof address!=="string");
  t.after(async()=>{server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));});
  return "http://127.0.0.1:"+address.port;
}
async function provider(t:TestContext,options:{malformed?:"task"|"operation";lostReceipt?:boolean;lostDirect?:boolean;working?:boolean;progress?:boolean;foreign?:boolean;openResult?:boolean;error?:boolean;disconnect?:boolean;stream?:boolean}={}){
  const app=express();app.use(express.json({type:"application/a2a+json"}));const requests:any[]=[],tasks=new Map<string,any>(),accepted=new Map<string,any>();
  let jobs=0,gets=0,cancels=0,subscriptions=0;
  const snapshot=(task:any)=>structuredClone(task);
  const complete=(task:any)=>{
    task.status={state:"TASK_STATE_COMPLETED"};
    const result=material();if(options.foreign)result.searches[0].query=otherUrl;
    const event=options.openResult?{result:{plan:{},papers:[],haina:[],searches:[],sourceStatus:[],issues:[]}}:{sourceReadResult:result};
    task.artifacts=[{artifactId:"stable-material",parts:[{data:{kind:"oneearth.discovery.event.v1",event:{seq:10,...event}}}]}];
  };
  app.post("/message:send",(req,res)=>{
    requests.push({body:req.body,headers:req.headers});const {message}=req.body,data=message.parts[0].data;
    if(options.error){respond(res,{error:{code:503,message:"provider unavailable"}},503);return;}
    if(data.kind==="oneearth.paper.query.v1"){
      if(options.lostDirect){req.socket.destroy();return;}
      const input:PaperQuery=data.input;
      const value=input.operation==="records"?input.ids.flatMap(id=>id===record().id?[record()]:[]):input.operation==="list"?list():
        input.operation==="search"?{records:[record()],cached:false,incomplete:["bounded fixture"]}:input.operation==="questions"?{items:[],nextCursor:"next-question"}:{dataset:null,papers:[]};
      if(options.malformed==="task"){respond(res,{task:{id:"not-a-direct-message"}});return;}
      respond(res,{message:{messageId:randomUUID(),role:"ROLE_AGENT",parts:[{data:{kind:"oneearth.paper.result.v1",operation:options.malformed==="operation"?"search":input.operation,value}}]}});return;
    }
    assert.equal(data.kind,"oneearth.source.read.v1");
    let task=accepted.get(message.messageId);
    if(!task){task={id:randomUUID(),contextId:randomUUID(),status:{state:"TASK_STATE_WORKING"},artifacts:[]};accepted.set(message.messageId,task);tasks.set(task.id,task);jobs++;
      if(!options.working&&!options.disconnect&&!options.stream&&!options.progress)complete(task);
      if(options.lostReceipt){req.socket.destroy();return;}}
    respond(res,{task:snapshot(task)});
  });
  app.get("/tasks/:id",(req,res)=>{gets++;respond(res,snapshot(tasks.get(req.params.id)));});
  app.post(/^\/tasks\/([^/]+):subscribe$/,(req,res)=>{
    subscriptions++;const task=tasks.get(req.params[0]);res.type("text/event-stream");res.write("data: "+JSON.stringify({task:snapshot(task)})+"\n\n");
    if(options.progress){
      const actual=material();
      for(const [seq,event] of [[1,{sourceReadProgress:{papers:actual.papers}}],[2,{sourceReadProgress:{paperEvidence:actual.paperEvidence}}],[3,{stage:"actual web read completed",searches:actual.searches}]] as const){
        const artifact={artifactId:"progress-"+seq,parts:[{data:{kind:"oneearth.discovery.event.v1",event:{seq,...event}}}]};task.artifacts.push(artifact);
        res.write("data: "+JSON.stringify({artifactUpdate:{taskId:task.id,contextId:task.contextId,artifact,lastChunk:true}})+"\n\n");
      }
      return;
    }
    if(options.working)return;
    complete(task);
    if(options.disconnect){res.end();return;}
    res.write("data: "+JSON.stringify({artifactUpdate:{taskId:task.id,contextId:task.contextId,artifact:task.artifacts[0],lastChunk:true}})+"\n\n");
    res.end("data: "+JSON.stringify({statusUpdate:{taskId:task.id,contextId:task.contextId,status:task.status}})+"\n\n");
  });
  app.post(/^\/tasks\/([^/]+):cancel$/,(req,res)=>{cancels++;const task=tasks.get(req.params[0]);task.status={state:"TASK_STATE_CANCELED"};respond(res,snapshot(task));});
  const origin=await listen(t,app),previous=process.env.ONEEARTH_DISCOVERY_URL;process.env.ONEEARTH_DISCOVERY_URL=origin;
  t.after(()=>{if(previous===undefined)delete process.env.ONEEARTH_DISCOVERY_URL;else process.env.ONEEARTH_DISCOVERY_URL=previous;});
  return {origin,requests,tasks,counts:()=>({jobs,gets,cancels,subscriptions})};
}

test("paper queries are model-free direct Messages and preserve existing values for all operations",async t=>{
  const service=await provider(t),signal=new AbortController().signal;
  assert.deepEqual(await queryPapers({operation:"records",ids:[record().id,record("b").id]},signal),[record()]);
  assert.deepEqual(await queryPapers({operation:"list",cursor:"",limit:500,view:"map"},signal),list());
  assert.deepEqual(await queryPapers({operation:"questions",id:record().id,cursor:"old-cursor"},signal),{items:[],nextCursor:"next-question"});
  assert.deepEqual(await queryPapers({operation:"evidence",id:record().id},signal),{dataset:null,papers:[]});
  assert.deepEqual(await queryPapers({operation:"search",query:" explicit name "},signal),{records:[record()],cached:false,incomplete:["bounded fixture"]});
  for(const request of service.requests){assert.equal(request.headers["a2a-version"],"1.0");assert.match(request.headers["content-type"],/application\/a2a\+json/);
    assert.equal(request.body.message.role,"ROLE_USER");assert.equal(request.body.message.taskId,undefined);assert.equal(request.body.configuration,undefined);assert.equal(request.body.message.parts[0].data.input.config,undefined);}
  assert.equal(service.counts().jobs,0);assert.equal(service.counts().subscriptions,0);
});
for(const malformed of ["task","operation"] as const)test("direct paper query rejects a mismatched "+malformed+" response",async t=>{
  await provider(t,{malformed});await assert.rejects(queryPapers({operation:"records",ids:[record().id]},new AbortController().signal),DiscoveryA2AError);
});

test("runtime public routes preserve list paging, gzip, batch omissions, search and independent details",async t=>{
  const service=await provider(t),app=express();app.use(express.json());app.use("/api/paper-records",runtimePaperRoutes());const origin=await listen(t,app);
  let res=await fetch(origin+"/api/paper-records?view=map&limit=2&cursor=published-cursor",{headers:{"Accept-Encoding":"gzip"}});
  assert.equal(res.status,200);assert.equal(res.headers.get("cache-control"),"no-store");assert.equal(res.headers.get("content-encoding"),"gzip");assert.deepEqual(await res.json(),list());
  assert.deepEqual(service.requests[0].body.message.parts[0].data.input,{operation:"list",cursor:"published-cursor",limit:2,view:"map"});
  res=await fetch(origin+"/api/paper-records?ids="+record("b").id);assert.deepEqual(await res.json(),[],"public exact IDs never scan a private runtime archive");
  res=await fetch(origin+"/api/paper-records/"+record().id+"/questions?cursor=q1");assert.equal((await res.json()).nextCursor,"next-question");
  res=await fetch(origin+"/api/paper-records/"+record().id+"/evidence");assert.deepEqual(await res.json(),{dataset:null,papers:[]});
  assert.equal(service.requests.filter(r=>r.body.message.parts[0].data.input.operation==="search").length,0);
  res=await fetch(origin+"/api/paper-records/search",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({query:"a dataset"})});assert.equal(res.status,200);
  const count=service.requests.length;
  for(const path of ["?ids=invalid","?limit=501","?cursor=a&cursor=b"]){assert.equal((await fetch(origin+"/api/paper-records"+path)).status,400);}
  assert.equal(service.requests.length,count);assert.equal(service.counts().jobs,0);
});

test("provider failure is explicit, including the search records[] compatibility value",async t=>{
  await provider(t,{error:true});const app=express();app.use(express.json());app.use("/api/paper-records",runtimePaperRoutes());const origin=await listen(t,app);
  const res=await fetch(origin+"/api/paper-records/search",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({query:"name"})});
  assert.equal(res.status,503);assert.deepEqual((await res.json()).records,[]);
});

for(const options of [{},{lostReceipt:true},{disconnect:true},{stream:true}])test("source read restores only the accepted Task and actual materials "+JSON.stringify(options),async t=>{
  const service=await provider(t,options),bindings:any[]=[],events:any[]=[];
  const result=await readSourcesThroughA2A(randomUUID(),Object.assign(sourceInput(),{config:{executor:"forbidden"},initialPlan:"forbidden"}),new AbortController().signal,e=>events.push(e),
    {onAccepted:async b=>{bindings.push(b);},onCheckpoint:async b=>{bindings.push(b);}});
  assert.deepEqual(result,material());assert.equal(service.counts().jobs,1);assert.equal(bindings.at(-1).lastSeq,10);
  assert.notEqual(bindings[0].discoveryId,bindings[0].messageId);assert.equal(events.filter(e=>e.sourceReadResult).length,1);
  const sent=service.requests[0].body;assert.equal(sent.configuration.returnImmediately,true);assert.deepEqual(sent.message.parts[0].data.input,sourceInput());
  if(options.lostReceipt)assert.equal(service.requests[0].body.message.messageId,service.requests[1].body.message.messageId);
  if(options.disconnect){assert.equal(service.counts().subscriptions,1);assert.ok(service.counts().gets>=2);}
});
for(const options of [{foreign:true},{openResult:true}])test("source read rejects foreign or wrong-business terminal materials "+JSON.stringify(options),async t=>{
  await provider(t,options);await assert.rejects(readSourcesThroughA2A(randomUUID(),sourceInput(),new AbortController().signal,()=>{}),DiscoveryA2AError);
});

test("source cancellation uses the verified accepted identity",async t=>{
  const service=await provider(t,{working:true}),controller=new AbortController(),scope=discoveryA2ACancellation(controller.signal);
  const read=readSourcesThroughA2A(randomUUID(),sourceInput(),controller.signal,()=>{},{onAccepted:async()=>{controller.abort(new TaskCancelled());}},scope);
  await assert.rejects(read);await scope.close();assert.equal(service.counts().cancels,1);
});

test("runtime executor delegates exact targets and never fetches or parses source URLs itself",async t=>{
  const service=await provider(t),executor=researchExecutor({executor:"codex",model:""},{search:false,fetch:false},new AbortController().signal),saved:SourceReadResult[]=[];
  t.after(()=>executor.close());
  const result=await executor.read({action:"read",targets:[{key:"web:"+url,kind:"web",url,title:"Original paper",basis:"citation"},{key:record().id,kind:"asset",id:record().id,url:"https://example.org/dataset-landing-page",title:"Paper",basis:"citation"}]} as any,
    sourceInput().question,{stage:()=>{},report:()=>{},onResult:async value=>{saved.push(value);}});
  assert.deepEqual(result,material().searches);assert.equal(saved.length,1);assert.equal(service.counts().jobs,1);
  assert.deepEqual(service.requests[0].body.message.parts[0].data.input.targets,sourceInput().targets.map(({discoveredBy,...target}:any)=>target));
});

test("same-conversation archives retain exact old versions, pagination, source times and partial evidence without discovery",async()=>{
  const tasks=openTaskStore(":memory:"),id=randomUUID(),conversationId=randomUUID();
  try{
    tasks.submit(id,{conversationId});tasks.claim();for(let i=0;i<140;i++)tasks.append(id,{stage:"progress"});
    tasks.append(id,{researchMaterials:material()});tasks.finish(id,"failed",{error:"synthesis interrupted"});
    const before=JSON.stringify(tasks.events(id,128));
    const saved=await runtimeMaterialHistory(tasks,conversationId,[id]);assert.deepEqual(saved.papers,[record()]);
    assert.equal(saved.searches[0].hits[0].previousRead,true);assert.equal(saved.searches[0].hits[0].readAt,"2026-11-22T00:00:00Z");assert.ok(saved.searches[0].cacheStoredAt);
    assert.deepEqual(saved.paperEvidence,material().paperEvidence);
    assert.deepEqual(await runtimeMaterialHistory(tasks,"foreign",[id]),{papers:[],searches:[],paperEvidence:[]});
    assert.equal(JSON.stringify(tasks.events(id,128)),before);
  }finally{tasks.close();}
});

test("per-turn paper hydration publishes nothing and drops private in-memory identities afterwards",()=>{
  const old=record("e"),current=record("f"),context=runtimeTurnPapers();
  assert.equal(assetById.has(old.id),false);context.remember([old,current]);assert.equal(context.get(old.id),old);
  assert.ok(!assets.some(a=>a.id===old.id||a.id===current.id));assert.equal(assetById.get(old.id)?.description,old.need.detail);
  context.close();assert.equal(assetById.has(old.id),false);assert.equal(assetById.has(current.id),false);
});

for(const operation of ["search","records"] as const)test("uncertain direct "+operation+" transport has bounded, operation-safe retries",async t=>{
  const service=await provider(t,{lostDirect:true});
  await assert.rejects(queryPapers(operation==="search"?{operation,query:"explicit search"}:{operation,ids:[record().id]},new AbortController().signal));
  assert.equal(service.requests.length,operation==="search"?1:3);
});

for(const status of ["complete","failed","cancelled"] as const)test("material history avoids progress scans for "+status+" parents",async t=>{
  const store=openTaskStore(":memory:"),id=randomUUID(),conversationId=randomUUID();
  try{
    store.submit(id,{conversationId});store.claim();
    for(let i=0;i<358;i++)store.append(id,{call:{id:"progress-"+i,output:"x".repeat(5600)}});
    store.append(id,{researchMaterials:material()});store.finish(id,status,status==="complete"?{result:{paperRecords:[record()],runTrace:{searches:material().searches}}}:{error:"interrupted"});
    let cursor=0,oldRows=0,oldBytes=0;
    for(;;){const rows=store.events(id,cursor);oldRows+=rows.length;oldBytes+=Buffer.byteLength(JSON.stringify(rows));if(rows.length<128)break;cursor=rows.at(-1)!.seq;}
    let progressRows=0,materialRows=0,terminalRows=0;
    const tasks={...store,events(taskId:string,after:number){const rows=store.events(taskId,after);progressRows+=rows.length;return rows;},
      terminal(taskId:string){const row=store.terminal(taskId);if(row)terminalRows++;return row;},
      materialEvents(taskId:string){const rows=store.materialEvents(taskId);materialRows+=rows.length;return rows;}};
    const saved=await runtimeMaterialHistory(tasks,conversationId,[id],{paperIds:[record().id],includeSources:status!=="complete"});
    assert.deepEqual(saved.papers,[record()]);assert.equal(oldRows,362);assert.ok(oldBytes>2_000_000);
    assert.equal(progressRows,0);assert.equal(terminalRows,1);assert.equal(materialRows,status==="complete"?0:1);
    t.diagnostic(JSON.stringify({status,before:{rows:oldRows,bytes:oldBytes},after:{terminalRows,materialRows,progressRows}}));
  }finally{store.close();}
});

test("a plain turn with no context, parent, or selected paper sends no new catalogue or source delegation",async t=>{
  const service=await provider(t),directory=mkdtempSync(path.join(tmpdir(),"oneearth-plain-turn-")),previous=process.env.PATH;
  const plan={action:"respond",goal:"问候",evidenceNeed:"none",targets:[],reason:"一般问候无需资料",clarification:null,
    researchIntent:{purpose:"问候",task:"问候",region:null,time:null,months:[]},conversationContext:"问候",evidenceGap:null};
  const answer={message:"你好，可以一起讨论研究问题。",sections:[],limitation:"",followUp:"",researchNotes:[],calculationRequests:[]};
  const historicalAnswer={...answer,message:"已保存的原来源节选可以复用。[S1]",researchNotes:[{ref:"S1",note:"saved excerpt"}]};
  const historicalPlan={...plan,goal:"解释已保存的原来源节选",evidenceNeed:"existing",targets:["web:"+url]};
  writeFileSync(path.join(directory,"codex"),`#!/usr/bin/env node\nlet input='';for await(const c of process.stdin)input+=c;process.stdout.write(JSON.stringify(input.includes('先决定本轮要做什么')?(input.includes('解释此前')?${JSON.stringify(historicalPlan)}:${JSON.stringify(plan)}):input.includes('Actual acquired source paragraph')?${JSON.stringify(historicalAnswer)}:${JSON.stringify(answer)}));\n`,{mode:0o700});
  process.env.PATH=directory+path.delimiter+previous;const tasks=openTaskStore(":memory:");
  t.after(()=>{tasks.close();rmSync(directory,{recursive:true,force:true});if(previous===undefined)delete process.env.PATH;else process.env.PATH=previous;});
  const id=randomUUID(),body={query:"你好",conversationId:randomUUID(),turnId:randomUUID(),history:[],config:{executor:"codex" as const,model:""},
    context:{filters:emptyFilters(),caseId:null,citation:null,selection:null,gridSystem:"h3" as const,layer:"all" as const,camera:{center:[0,0] as [number,number],zoom:1,reason:"fixture"}}};
  tasks.submit(id,body);tasks.claim();
  const services={tasks,push:{latest(){return{records:[]};}},coverage:async()=>assert.fail(),researchRegionService:{locate:async()=>null},adminBoundaryDir:directory,canonicalCache:new Map()} as unknown as RuntimeServices;
  const result=await executeTurn(services,id,body,new AbortController().signal,event=>tasks.append(id,event));
  assert.equal(result.error,undefined);assert.ok((result.result as any).message);assert.equal(service.requests.length,0);
  tasks.finish(id,"complete",result);
  const parentId=randomUUID();tasks.submit(parentId,{conversationId:body.conversationId});tasks.claim();
  tasks.append(parentId,{researchMaterials:material()});tasks.finish(parentId,"failed",{error:"worker interrupted after acquisition"});
  const nextId=randomUUID(),next={...body,query:"解释此前已保存的节选。",previousTaskId:parentId,turnId:randomUUID()};
  tasks.submit(nextId,next);tasks.claim();
  const restored=await executeTurn(services,nextId,next,new AbortController().signal,event=>tasks.append(nextId,event));
  assert.equal(restored.error,undefined);assert.equal(service.requests.length,0);
  assert.equal((restored.result as any).conversationEvidence[0].readAt,"2026-11-22T00:00:00Z");
  assert.equal((restored.result as any).answerNotes.references[0].url,url);
});

for(const reason of ["user-cancel","worker-interrupted","persistence-failure"] as const)test("received source progress is archived before terminal delivery under "+reason,async t=>{
  const service=await provider(t,{progress:true}),tasks=openTaskStore(":memory:"),id=randomUUID(),conversationId=randomUUID(),controller=new AbortController();
  tasks.submit(id,{conversationId});tasks.claim();
  const executor=researchExecutor({executor:"codex",model:""},{search:false,fetch:false},controller.signal);
  t.after(async()=>{await executor.close();tasks.close();});
  const read=executor.read({action:"read",targets:[{key:"web:"+url,kind:"web",url,title:"Source",basis:"citation"},{key:record().id,kind:"asset",id:record().id,url:otherUrl,title:"Paper",basis:"citation"}]} as any,
    "Read only selected sources",{stage:()=>{},report:()=>{},options:{onAccepted:async binding=>{tasks.append(id,{sourceReadBinding:binding});}},onResult:async value=>{
      if(reason==="persistence-failure"&&value.paperEvidence?.length)throw Error("controlled storage failure");
      tasks.append(id,{researchMaterials:value});
    }});
  const settled=read.then(()=>({error:undefined}),error=>({error}));
  const deadline=Date.now()+2500;
  for(;;){
    const rows=tasks.materialEvents(id),ready=reason==="persistence-failure"?rows.some(e=>(e.researchMaterials as any).papers.length):
      rows.some(e=>(e.researchMaterials as any).searches.length);
    if(ready)break;assert.ok(Date.now()<deadline,"progress was not archived");await delay(5);
  }
  if(reason==="persistence-failure"){
    const result=await settled;assert.equal((result.error as DiscoveryA2AError).reason,"RUNTIME_PERSISTENCE_FAILED");tasks.finish(id,"failed",{error:"storage failure"});
  }else{
    tasks.finish(id,reason==="user-cancel"?"cancelled":"failed",{error:reason});controller.abort(reason==="user-cancel"?new TaskCancelled():undefined);
    assert.ok((await settled).error);
  }
  const saved=await runtimeMaterialHistory(tasks,conversationId,[id]);assert.deepEqual(saved.papers,[record()]);
  if(reason!=="persistence-failure"){
    assert.deepEqual(saved.paperEvidence,material().paperEvidence);assert.equal(saved.searches[0].hits[0].pageExcerpt,"Actual acquired source paragraph");
    assert.equal(saved.searches[0].hits[0].previousRead,true);
  }
  assert.equal(service.counts().cancels,reason==="user-cancel"?1:0);assert.equal(service.counts().jobs,1);
  assert.equal(service.requests.length,1);assert.equal(tasks.get(id)?.status,reason==="user-cancel"?"cancelled":"failed");
});
