import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {once} from "node:events";
import {randomUUID} from "node:crypto";
import {spawn} from "node:child_process";
import {mkdtemp,writeFile,readFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {EventSchema} from "@ag-ui/core/schemas";
import {agUiWorkbench} from "./ag-ui-workbench";
import {prepareRuntimeChat} from "./runtime-chat-turn";
import {postgresTaskStore} from "./postgres-task-store";
import {taskStatusRoutes} from "./task-store";
import {closeRuntimeModelCapacity} from "./runtime-model-capacity";
import {emptyFilters} from "../src/domain/spatial";
import type {RuntimeServices} from "./runtime-turn";
const fixture=process.env.ONEEARTH_AGUI_TEST_DATABASE_URL;

test("research native resume reuses the actual A2A wait, archived purpose, source authorization and checkpoint",{skip:!fixture,timeout:20000},async t=>{
 assert.ok(fixture);const old={runtime:process.env.ONEEARTH_RUNTIME_DATABASE_URL,path:process.env.PATH,discovery:process.env.ONEEARTH_DISCOVERY_URL};process.env.ONEEARTH_RUNTIME_DATABASE_URL=fixture;
 const dir=await mkdtemp(path.join(tmpdir(),"oe-native-research-resume-")),log=path.join(dir,"calls"),query="仅文献资料核对原研究目录",remoteId=randomUUID(),contextId=randomUUID();
 const cli=`#!${process.execPath}\nimport fs from 'node:fs';let p='';for await(const b of process.stdin)p+=b;let kind='plan',a={decide:{kind:'search',goal:'核对原研究目录',targets:[]}};if(p.includes('只输出action、reason、proposedQuestion、clarification')){kind='guard';a={action:'supplement',reason:'补充原条件，不改变范围',proposedQuestion:null,clarification:null};}else if(p.includes('remainingModelCalls')){kind='evidence';a={action:'answer',targets:[],gap:null,clarification:null,reason:'当前没有可引用条目，只说明结果限制'};}else if(p.includes('calculationRequests')){kind='answer';a={message:'本次原目录委托未返回可引用条目。',sections:[],limitation:'只说明本次受托范围，不推断资料不存在。',followUp:'',researchNotes:[],calculationRequests:[]};}fs.appendFileSync(${JSON.stringify(log)},kind+'\\n');process.stdout.write(JSON.stringify(a));`;
 await writeFile(path.join(dir,"codex"),cli,{mode:0o700});process.env.PATH=dir+path.delimiter+(old.path||"");
 const tasks=await postgresTaskStore("runtime"),requests:any[]=[];let waitingSeq=1;
 const remotes=new Map<string,{contextId:string;resumes:number;waitTwice:boolean}>();
 const ordinary="请问此工作台能否接收普通消息？";
 const plan={dataQuestion:query,questionMode:"preserve",dataNeed:null,paper:{region:[],facets:[]},web:[],researchIntent:{purpose:query,task:query,region:null,time:null,months:[]},conversationContext:query,hainaQueries:[],paperQueries:[],webQueries:[]};
 const partial={plan,papers:[],haina:[],searches:[],sourceStatus:[{source:"文献资料",status:"done",count:0}],issues:[],clarification:"请补充本次目录需要的时段。",clarificationOptions:[{id:"period-a",label:"原时段"},{id:"period-b",label:"另一时段"}]};
 const complete={plan,papers:[],haina:[],searches:[],sourceStatus:[{source:"文献资料",status:"done",count:0}],issues:[]};
 const secondPrompt={...partial,clarification:"请选择仍需确认的原时段。"};
 const artifact=(artifactId:string,event:Record<string,unknown>)=>({artifactId,parts:[{data:{kind:"oneearth.discovery.event.v1",event}}]});
 const source={id:"source-paper",area:"literature"};
 const snapshot=(id:string)=>{
  const remote=remotes.get(id)!;
  const awaiting=remote.resumes<(remote.waitTwice?2:1);
  return {id,contextId:remote.contextId,status:{state:awaiting?"TASK_STATE_INPUT_REQUIRED":"TASK_STATE_COMPLETED"},artifacts:[
   artifact("initial-wait",{seq:waitingSeq,result:partial}),...(remote.resumes>0?[
    artifact("paper-start",{seq:waitingSeq+1,researchProgressFact:{...source,status:"running"}}),
    artifact("paper-end",{seq:waitingSeq+2,researchProgressFact:{...source,status:"timeout",error:"PRIVATE transport detail"}}),
    artifact("invalid-progress",{seq:waitingSeq+3,researchProgressFact:{id:"forged",area:"reading",status:"done",count:1}}),
    artifact("result",{seq:waitingSeq+4,result:remote.waitTwice?secondPrompt:complete}),
   ]:[]),...(remote.waitTwice&&remote.resumes>1?[artifact("last-result",{seq:waitingSeq+5,result:complete})]:[])]};
 };
 const provider=express();provider.use(express.json({type:"application/a2a+json"}));
 provider.post("/message:send",(req,res)=>{
  const {message}=req.body;requests.push(req.body);
  if(message.taskId){
   const remote=remotes.get(message.taskId);
   assert.ok(remote);assert.equal(message.contextId,remote.contextId);
   assert.deepEqual(message.parts[0].data.input,{continuedFrom:message.taskId,clarificationReply:{text:"原时段\n同时保留原限定。",afterSeq:remote.resumes===0?1:5}});
   remote.resumes++;res.json({task:snapshot(message.taskId)});return;
  }
  const id=remotes.size?randomUUID():remoteId;
  remotes.set(id,{contextId:remotes.size?randomUUID():contextId,resumes:0,waitTwice:remotes.size>0});
  res.json({task:snapshot(id)});
 });
 provider.get("/tasks/:id",(req,res)=>res.json(snapshot(req.params.id)));
 const upstream=provider.listen(0,"127.0.0.1");await once(upstream,"listening");const pa=upstream.address();assert.ok(pa&&typeof pa!=="string");process.env.ONEEARTH_DISCOVERY_URL="http://127.0.0.1:"+pa.port;
 const services={tasks,push:{latest:()=>({records:[]})},coverage:async()=>undefined,researchRegionService:{locate:async()=>null},adminBoundaryDir:dir,canonicalCache:new Map()} as unknown as RuntimeServices;
 const app=express();app.use(express.json());const native=await agUiWorkbench(app,tasks,(id,input)=>(input as {query?:string}).query===ordinary
  ?Promise.resolve({kind:"foreground",run:async()=>({kind:"reply",payload:{result:{message:"可继续普通消息。"}}})})
  :prepareRuntimeChat(services,id,input,id=>tasks.chat.latestCompleted(id),{publicAnswer:true}));taskStatusRoutes(app,"/api/tasks",tasks,{researchRecords:true,chatIdentity:true,readInterrupt:id=>tasks.chat.agUiInterrupt(id),onCancelled:id=>native.cancel(id)});const server=app.listen(0,"127.0.0.1");await once(server,"listening");const sa=server.address();assert.ok(sa&&typeof sa!=="string");const base="http://127.0.0.1:"+sa.port;
 const worker=spawn(process.execPath,["--import","tsx",fileURLToPath(new URL("./runtime-worker.ts",import.meta.url))],{cwd:fileURLToPath(new URL("../",import.meta.url)),env:{...process.env,ONEEARTH_STATE_DIR:path.join(dir,"worker")},stdio:["ignore","ignore","pipe"]});let errors="";worker.stderr!.on("data",chunk=>{errors=(errors+chunk).slice(-2000);});const exited=new Promise<void>((resolve,reject)=>{worker.once("error",reject);worker.once("exit",code=>code===0?resolve():reject(Error("controlled worker exit "+code+" "+errors)));});
 t.after(async()=>{worker.kill("SIGTERM");await exited;await native.close();server.closeAllConnections();upstream.closeAllConnections();await Promise.all([new Promise<void>(r=>server.close(()=>r())),new Promise<void>(r=>upstream.close(()=>r()))]);await tasks.close();await closeRuntimeModelCapacity();for(const [key,value] of [["ONEEARTH_RUNTIME_DATABASE_URL",old.runtime],["PATH",old.path],["ONEEARTH_DISCOVERY_URL",old.discovery]])if(value===undefined)delete process.env[key!];else process.env[key!]=value;await rm(dir,{recursive:true,force:true});});
 const threadId=randomUUID(),id=randomUUID(),context={filters:emptyFilters(),caseId:null,selection:null,citation:null,gridSystem:"h3",layer:"all",camera:{center:[0,0],zoom:1,reason:"controlled"}},config={executor:"codex",model:"gpt-6-luna"};
 const initial={protocolVersion:"1.0",runId:id,threadId,messages:[{id:randomUUID(),role:"user",content:query}],tools:[],context:[],state:{},forwardedProps:{oneearth:{version:1,submission:{context,config,deepseekTools:{search:false,fetch:false}}}}};
 const post=(body:unknown)=>fetch(base+"/api/ag-ui",{method:"POST",headers:{"Content-Type":"application/json",Accept:"text/event-stream"},body:JSON.stringify(body)});
 const decode=(text:string)=>text.split("\n\n").filter(x=>x.startsWith("data: ")).map(x=>EventSchema.parse(JSON.parse(x.slice(6)))) as any[];
 const response=await post(initial);assert.equal(response.status,200);const first=decode(await response.text());assert.equal(first.at(-1).outcome.type,"interrupt");const persisted=await tasks.chat.agUiInterrupt(id);assert.ok(persisted&&persisted.kind!=="question-check");assert.equal(persisted.prompt.kind,"research");assert.equal(requests.length,1);
 const card=await(await fetch(base+"/api/tasks/"+id+"/record")).json();
 assert.equal(card.interrupt.status,"pending");assert.equal(card.result.discoveryClarification,true);
 const operation=first.at(-1).outcome.interrupts[0].metadata.oneearth.operation;
 assert.deepEqual(card.interrupt.operation,operation);
 const independent={...initial,runId:randomUUID(),messages:[{...initial.messages[0],id:randomUUID()}]};
 const independentResponse=await post(independent);assert.equal(independentResponse.status,200);
 const independentEnd=decode(await independentResponse.text()).at(-1);
 const otherOperation=independentEnd.outcome.interrupts[0].metadata.oneearth.operation;
 assert.notEqual(otherOperation.operationId,operation.operationId);assert.notEqual(otherOperation.stepId,operation.stepId);
 assert.equal((await tasks.chat.agUiInterrupt(id))?.status,"pending");
 assert.equal((await tasks.chat.agUiInterrupt(independent.runId))?.status,"pending");
 const unrelated={...initial,runId:randomUUID(),messages:[{id:randomUUID(),role:"user",content:ordinary}]};
 const ordinaryResponse=await post(unrelated);assert.equal(ordinaryResponse.status,200);
 assert.equal(decode(await ordinaryResponse.text()).at(-1).outcome,undefined);assert.equal(requests.length,2);

 const submission={context,config,operationReply:operation,deepseekTools:{search:true,fetch:true}};
 const reply={...initial,runId:randomUUID(),messages:[{id:randomUUID(),role:"user",content:"原时段\n同时保留原限定。"}],
  forwardedProps:{oneearth:{version:1,submission}},resume:[{interruptId:id,status:"resolved",payload:{optionId:"period-a",text:"同时保留原限定。"}}]};
 const before=await readFile(log,"utf8");
 const wrongStep={...reply,forwardedProps:{oneearth:{version:1,submission:{...submission,operationReply:{...operation,stepId:otherOperation.stepId}}}}};
 const wrongThread={...reply,threadId:randomUUID()};
 const withoutOperation={...reply,forwardedProps:{oneearth:{version:1,submission:{context,config,previousTaskId:id}}}};
 for(const invalid of [wrongStep,wrongThread,withoutOperation])assert.equal((await post(invalid)).status,409);
 // Changed actual provider watermark is rejected before admission/model.
 waitingSeq=2;assert.equal((await post(reply)).status,409);waitingSeq=1;
 assert.equal(await tasks.get(reply.runId),undefined);assert.equal(await readFile(log,"utf8"),before);assert.equal(requests.length,2);
 const resumed=await post(reply);assert.equal(resumed.status,200,await(resumed.status===200?Promise.resolve(""):resumed.text()));
 const final=decode(await resumed.text());assert.equal(final.at(-1).type,"RUN_FINISHED");assert.equal(final.at(-1).outcome,undefined);
 assert.equal(requests.length,3);assert.equal(requests[0].message.parts[0].data.input.deepseekTools.fetch,false);
 assert.equal(requests[2].message.parts[0].data.input.deepseekTools,undefined);
 assert.equal(requests[2].message.taskId,remoteId);assert.equal(requests[2].message.messageId,reply.runId);
 assert.equal((await tasks.chat.agUiInterrupt(independent.runId))?.status,"pending");
 const progress=final.filter(frame=>frame.type==="STATE_SNAPSHOT").map(frame=>frame.snapshot.oneearth.researchProgress);
 assert.equal(progress.length,6);assert.ok(progress.every(value=>value.runId===reply.runId));
 assert.deepEqual(progress.slice(0,2).map(value=>[value.revision,value.actions[0].area,value.actions[0].status]),[[1,"literature","running"],[2,"literature","timeout"]]);
 assert.deepEqual(progress.at(-1).actions.map((value:any)=>[value.area,value.status]),[["literature","timeout"],["catalog","done"],["synthesis","done"]]);
 assert.equal(progress[0].actions[0].id,progress[1].actions[0].id);
 assert.doesNotMatch(JSON.stringify(progress),/PRIVATE|forged|source-paper/);
 const originalStatus=await (await fetch(base+"/api/tasks/"+id)).json();
 const resumedStatus=await (await fetch(base+"/api/tasks/"+reply.runId)).json();
 const resumedRecord=await (await fetch(base+"/api/tasks/"+reply.runId+"/record")).json();
 assert.equal(originalStatus.researchProgress,undefined);
 assert.equal(resumedStatus.conversationId,threadId);assert.equal(resumedStatus.turnId,reply.messages[0].id);
 assert.deepEqual(resumedStatus.researchProgress,progress.at(-1));assert.deepEqual(resumedRecord.researchProgress,progress.at(-1));
 assert.equal((await tasks.chat.agUiInterrupt(id))?.resumedBy,reply.runId);assert.equal((await post(reply)).status,409);assert.equal(requests.length,3);assert.equal((await tasks.get(id))?.status,"complete");assert.equal((await tasks.get(reply.runId))?.status,"complete");
 const bound=await tasks.operations.readForRun(reply.runId),steps=await tasks.operations.steps(operation.operationId);
 assert.equal(bound?.operationId,operation.operationId);assert.equal(bound?.activeRunId,reply.runId);
 assert.equal(bound?.status,"complete");assert.equal(steps.length,1);
 assert.equal(steps[0].receipt?.receiptId,reply.runId);assert.equal(steps[0].state,"received");
 const replyTo=(parent:string,operationReply:typeof operation)=>({...reply,runId:randomUUID(),
  messages:[{...reply.messages[0],id:randomUUID()}],forwardedProps:{oneearth:{version:1,submission:{...submission,operationReply}}},
  resume:[{...reply.resume[0],interruptId:parent}]});
 const secondReply=replyTo(independent.runId,otherOperation);
 const secondResponse=await post(secondReply);assert.equal(secondResponse.status,200);
 const secondEnd=decode(await secondResponse.text()).at(-1);assert.equal(secondEnd.outcome?.type,"interrupt");
 const secondStep=secondEnd.outcome.interrupts[0].metadata.oneearth.operation;
 assert.equal(secondStep.operationId,otherOperation.operationId);assert.notEqual(secondStep.stepId,otherOperation.stepId);
 assert.equal((await tasks.chat.agUiInterrupt(independent.runId))?.resumedBy,secondReply.runId);
 assert.equal((await tasks.operations.readForRun(secondReply.runId))?.currentStepId,secondStep.stepId);
 assert.equal((await post(replyTo(independent.runId,otherOperation))).status,409);
 assert.equal(requests.length,4);
 const lastReply=replyTo(secondReply.runId,secondStep),lastResponse=await post(lastReply);
 assert.equal(lastResponse.status,200);assert.equal(decode(await lastResponse.text()).at(-1).outcome,undefined);
 assert.equal(requests.length,5);
 assert.equal(requests[3].message.taskId,requests[4].message.taskId);assert.notEqual(requests[4].message.taskId,remoteId);
 assert.equal(requests[4].message.messageId,lastReply.runId);
 assert.equal((await tasks.operations.readForRun(lastReply.runId))?.status,"complete");
 assert.deepEqual((await tasks.operations.steps(otherOperation.operationId)).map(step=>[step.state,step.receipt?.receiptId]),
  [["received",secondReply.runId],["received",lastReply.runId]]);
 const cancellable={...initial,runId:randomUUID(),messages:[{...initial.messages[0],id:randomUUID()}]};
 const cancellableResponse=await post(cancellable);assert.equal(cancellableResponse.status,200);
 const cancelStep=decode(await cancellableResponse.text()).at(-1).outcome.interrupts[0].metadata.oneearth.operation;
 const queued=replyTo(cancellable.runId,cancelStep);
 assert.ok(worker.kill("SIGSTOP"));
 try{
  const admitted=await post(queued);assert.equal(admitted.status,200);
  assert.equal((await tasks.get(queued.runId))?.status,"queued");
  const cancelled=await fetch(base+"/api/tasks/"+queued.runId,{method:"DELETE"});
  assert.equal(cancelled.status,204);
  assert.deepEqual(decode(await admitted.text()).at(-1).outcome,{type:"cancelled"});
  const nativeEvents=await tasks.chat.agUiEvents(queued.runId);
  assert.equal(nativeEvents.filter(({event})=>event.type==="RUN_FINISHED"||event.type==="RUN_ERROR").length,1);
  assert.equal((await tasks.get(queued.runId))?.status,"cancelled");
  assert.equal((await tasks.get(cancellable.runId))?.status,"complete");
  assert.equal((await tasks.operations.readForRun(queued.runId))?.status,"cancelled");
  assert.equal((await tasks.operations.steps(cancelStep.operationId))[0].receipt?.receiptId,queued.runId);
  assert.equal(requests.length,6);
 }finally{worker.kill("SIGCONT");}
 console.log(JSON.stringify({sameA2ATask:true,originalCheckpoint:1,combinedChoiceAndText:true,sourceAndToolBoundaryNotExpanded:true,
  independentPending:true,ordinaryAlongsidePending:true,staleWaitZeroModelAndNoAdmission:true,repeatedUpstreamWaitSameOperation:true,queuedContinuationCancelledWithoutRemoteSubmit:true,delegationRequests:6}));
});
