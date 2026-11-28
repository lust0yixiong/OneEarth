import {readOneEarthAgUiInterruptRecord} from "../src/domain/native-ag-ui";
import test,{type TestContext} from "node:test";
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
import {productDatabase} from "./product-database";
import {taskStatusRoutes} from "./task-store";
import {closeRuntimeModelCapacity} from "./runtime-model-capacity";
import {emptyFilters} from "../src/domain/spatial";
import type {RuntimeServices} from "./runtime-turn";
import type {QuestionDecision} from "../src/domain/types";

const fixture=process.env.ONEEARTH_AGUI_TEST_DATABASE_URL;
const check={originalQuestion:"仅文献资料核对已登记的观测目录。",proposedQuestion:"仅文献资料核对已登记目录的明确产品版本。"};
const edited="仅文献资料解释已登记目录中的变量字段。";
const config={executor:"codex",model:"gpt-6-luna"},context={filters:emptyFilters(),caseId:null,selection:null,citation:null,gridSystem:"h3",layer:"all",camera:{center:[0,0],zoom:1,reason:"controlled"}};
async function setup(t:TestContext,runtimeParent=false){
 assert.ok(fixture);const old={runtime:process.env.ONEEARTH_RUNTIME_DATABASE_URL,path:process.env.PATH,discovery:process.env.ONEEARTH_DISCOVERY_URL};process.env.ONEEARTH_RUNTIME_DATABASE_URL=fixture;
 const dir=await mkdtemp(path.join(tmpdir(),"oe-native-question-check-")),log=path.join(dir,"calls"),remote=randomUUID(),remoteContext=randomUUID(),threadId=randomUUID(),parentId=randomUUID();let waitingSeq=1,confirmed=false,selectedQuestion="",first=true;const requests:any[]=[];
 const cli=`#!${process.execPath}\nimport fs from 'node:fs';let p='';for await(const b of process.stdin)p+=b;let v;try{v=JSON.parse(p.slice(p.lastIndexOf('\\n')+1));}catch{}const q=v?.question||${JSON.stringify(check.originalQuestion)};let a,kind='plan';if(p.includes('输出唯一decide分支'))a={decide:{kind:'search',goal:q,targets:[]}};else if(p.includes('remainingModelCalls')){kind='evidence';a={action:'answer',targets:[],gap:null,clarification:null,reason:'仅说明受托目录返回情况'};}else if(p.includes('calculationRequests')){kind='answer';a={message:'已按所确认的问题核对本次目录，未返回可引用条目。',sections:[],limitation:'不把本次空结果推断为资料不存在。',followUp:'',researchNotes:[],calculationRequests:[]};}else a={action:'search',goal:q,evidenceNeed:'discover',targets:[],reason:'沿实际确认的研究问题继续',clarification:null,researchIntent:{purpose:q,task:q,region:null,time:null,months:[]},conversationContext:q,evidenceGap:'核对所确认问题的实际目录'};fs.appendFileSync(${JSON.stringify(log)},kind+'\\n');process.stdout.write(JSON.stringify(a));`;
 await writeFile(path.join(dir,"codex"),cli,{mode:0o700});process.env.PATH=dir+path.delimiter+(old.path||"");
 const tasks=await postgresTaskStore("runtime"),audit=productDatabase("RUNTIME");
 const result=(question:string,mode="preserve")=>({plan:{dataQuestion:question,questionMode:mode,dataNeed:null,paper:{region:[],facets:[]},web:[],researchIntent:{purpose:question,task:question,region:null,time:null,months:[]},conversationContext:question,hainaQueries:[],paperQueries:[],webQueries:[]},papers:[],haina:[],searches:[],sourceStatus:[{source:"文献资料",status:"done",count:0}],issues:[]});
 const snapshot=()=>({id:remote,contextId:remoteContext,status:{state:confirmed?"TASK_STATE_COMPLETED":"TASK_STATE_INPUT_REQUIRED"},artifacts:runtimeParent?[{artifactId:"new-task-result",parts:[{data:{kind:"oneearth.discovery.event.v1",event:{seq:1,result:result(selectedQuestion,"confirmed")}}}]}]:[{artifactId:"question",parts:[{data:{kind:"oneearth.discovery.event.v1",event:{seq:waitingSeq,result:{...result(check.originalQuestion,"reframe"),questionCheck:check}}}}]},...(confirmed?[{artifactId:"confirmed-result",parts:[{data:{kind:"oneearth.discovery.event.v1",event:{seq:waitingSeq+1,result:result(selectedQuestion,"confirmed")}}}]}]:[])]});
 const provider=express();provider.use(express.json({type:"application/a2a+json"}));provider.post("/message:send",(req,res)=>{requests.push(req.body);const message=req.body.message,input=message.parts[0].data.input;
  if(runtimeParent){assert.equal(message.taskId,undefined);assert.equal(input.decision,undefined);assert.equal(input.continuedFrom,undefined);selectedQuestion=input.query;confirmed=true;}
  else if(message.taskId){assert.equal(message.taskId,remote);assert.equal(message.contextId,remoteContext);assert.equal(input.continuedFrom,remote);assert.equal(input.query,check.originalQuestion);assert.equal(input.decision.checkMessageId,parentId);assert.equal(input.decision.originalQuestion,check.originalQuestion);
   const original=requests[0].message.parts[0].data.input;
   assert.deepEqual(input.scope,original.scope);assert.deepEqual(input.deepseekTools,original.deepseekTools);
   selectedQuestion=input.decision.dataQuestion;confirmed=true;}
  res.json({task:snapshot()});});provider.get("/tasks/:id",(_req,res)=>res.json(snapshot()));
 const upstream=provider.listen(0,"127.0.0.1");await once(upstream,"listening");const pa=upstream.address();assert.ok(pa&&typeof pa!=="string");process.env.ONEEARTH_DISCOVERY_URL="http://127.0.0.1:"+pa.port;
 const services={tasks,push:{latest:()=>({records:[]})},coverage:async()=>undefined,researchRegionService:{locate:async()=>null},adminBoundaryDir:dir,canonicalCache:new Map()} as unknown as RuntimeServices;
 const app=express();app.use(express.json());const native=await agUiWorkbench(app,tasks,(id,body)=>{if(runtimeParent&&first){first=false;return Promise.resolve({kind:"foreground" as const,run:async()=>({kind:"reply" as const,payload:{result:{message:"请确认要继续的研究问题。",questionCheck:check,runtimeQuestionCheck:true}}})});}return prepareRuntimeChat(services,id,body,id=>tasks.chat.latestCompleted(id),{publicAnswer:true});});taskStatusRoutes(app,"/api/tasks",tasks,{researchRecords:true,readInterrupt:id=>tasks.chat.agUiInterrupt(id),onCancelled:id=>native.cancel(id)});
 const server=app.listen(0,"127.0.0.1");await once(server,"listening");const sa=server.address();assert.ok(sa&&typeof sa!=="string");const base="http://127.0.0.1:"+sa.port;
 const worker=spawn(process.execPath,["--import","tsx",fileURLToPath(new URL("./runtime-worker.ts",import.meta.url))],{cwd:fileURLToPath(new URL("../",import.meta.url)),env:{...process.env,ONEEARTH_STATE_DIR:path.join(dir,"worker")},stdio:["ignore","ignore","pipe"]});let errors="";worker.stderr!.on("data",bytes=>{errors=(errors+bytes).slice(-1000);});const exited=new Promise<void>((resolve,reject)=>{worker.once("error",reject);worker.once("exit",code=>code===0?resolve():reject(Error("controlled worker exit "+code+" "+errors)));});
 t.after(async()=>{worker.kill("SIGTERM");await exited;await native.close();server.closeAllConnections();upstream.closeAllConnections();await Promise.all([new Promise<void>(r=>server.close(()=>r())),new Promise<void>(r=>upstream.close(()=>r()))]);await tasks.close();await audit.end();await closeRuntimeModelCapacity();for(const [key,value] of [["ONEEARTH_RUNTIME_DATABASE_URL",old.runtime],["PATH",old.path],["ONEEARTH_DISCOVERY_URL",old.discovery]])if(value===undefined)delete process.env[key!];else process.env[key!]=value;await rm(dir,{recursive:true,force:true});});
 const input=(id=parentId)=>({protocolVersion:"1.0",runId:id,threadId,messages:[{id:randomUUID(),role:"user",content:check.originalQuestion}],tools:[],context:[],state:{},forwardedProps:{oneearth:{version:1,submission:{context,config,deepseekTools:{search:false,fetch:false}}}}});
 const post=(body:unknown)=>fetch(base+"/api/ag-ui",{method:"POST",headers:{"Content-Type":"application/json",Accept:"text/event-stream"},body:JSON.stringify(body)});
 const decode=(text:string)=>text.split("\n\n").filter(line=>line.startsWith("data: ")).map(line=>EventSchema.parse(JSON.parse(line.slice(6)))) as any[];
 const parent=input(),response=await post(parent);assert.equal(response.status,200);const events=decode(await response.text()),end=events.at(-1);assert.equal(end.type,"RUN_FINISHED");assert.equal(end.outcome.type,"interrupt");assert.equal(end.outcome.interrupts[0].reason,"oneearth.question-check");assert.equal(end.outcome.interrupts[0].id,parentId);
 const card=await(await fetch(base+"/api/tasks/"+parentId+"/record")).json();
 const operation=end.outcome.interrupts[0].metadata?.oneearth.operation;
 if(runtimeParent)assert.equal(operation,undefined);
 else assert.ok(operation?.operationId&&operation?.stepId);
 assert.deepEqual(card.interrupt,{id:parentId,status:"pending",kind:"question-check",questionCheck:check,...(operation?{operation}:{})});
 assert.deepEqual(readOneEarthAgUiInterruptRecord(card.interrupt,parentId),card.interrupt);
 assert.equal(card.result.clarificationPrompt,undefined);assert.deepEqual(card.result.questionCheck,check);
 const reopen=await postgresTaskStore("runtime");assert.deepEqual(await reopen.chat.agUiInterrupt(parentId),card.interrupt);await reopen.close();
 const resume=(payload:unknown)=>({...input(randomUUID()),forwardedProps:{oneearth:{version:1,submission:{context,config,previousTaskId:parentId,deepseekTools:{search:false,fetch:false},...(operation?{operationReply:operation}:{})}}},resume:[{interruptId:parentId,status:"resolved",payload}]});
 const count=async()=>{try{return(await readFile(log,"utf8")).trim().split("\n").filter(Boolean).length;}catch{return 0;}};
 return {tasks,audit,parentId,remote,threadId,requests,resume,post,decode,count,card,setSeq:(value:number)=>{waitingSeq=value;},selected:()=>selectedQuestion};
}

for(const choice of ["original","proposed","edited"] as const)test("native QuestionCheck keeps original three-way approval: "+choice,{skip:!fixture,timeout:20000},async t=>{
 const f=await setup(t),before=await f.count(),requestCount=f.requests.length;
 for(const payload of [{choice:"original",dataQuestion:check.originalQuestion},{choice:"proposed",dataQuestion:check.proposedQuestion},{choice:"edited"},{choice:"edited",dataQuestion:"   "},{choice:"edited",dataQuestion:" ".repeat(4000)+"bounded"},{choice:"edited",dataQuestion:"bad\0value"},{choice:"proposed",originalQuestion:check.originalQuestion},{choice:"original",checkMessageId:randomUUID()},{choice:"approve"}]){const response=await f.post(f.resume(payload));assert.equal(response.status,400);}
 const changed=f.resume({choice:"original"});changed.messages[0].content=check.proposedQuestion;assert.equal((await f.post(changed)).status,409);
 const foreign=f.resume({choice:"original"});foreign.threadId=randomUUID();assert.equal((await f.post(foreign)).status,409);
 const wrongParent=f.resume({choice:"original"});wrongParent.forwardedProps.oneearth.submission.previousTaskId=randomUUID();assert.equal((await f.post(wrongParent)).status,409);
 f.setSeq(2);assert.equal((await f.post(f.resume({choice:"original"}))).status,409);f.setSeq(1);assert.equal(await f.count(),before);assert.equal(f.requests.length,requestCount);
 const payload=choice==="edited"?{choice,dataQuestion:"  "+edited+"  "}:{choice},wire=f.resume(payload);let response:globalThis.Response;
 if(choice==="proposed")wire.forwardedProps.oneearth.submission.deepseekTools={search:true,fetch:true};
 if(choice==="edited"){const other={...wire,runId:randomUUID(),messages:[{...wire.messages[0],id:randomUUID()}]};const responses=await Promise.all([f.post(wire),f.post(other)]);assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);if(responses[0].status===200)response=responses[0];else{wire.runId=other.runId;wire.messages=other.messages;response=responses[1];}}
 else response=await f.post(wire);
 assert.equal(response.status,200);const final=f.decode(await response.text());assert.equal(final.at(-1).type,"RUN_FINISHED");assert.equal(final.at(-1).outcome,undefined);assert.equal(f.requests.length,2);assert.equal(f.selected(),choice==="original"?check.originalQuestion:choice==="proposed"?check.proposedQuestion:edited);
 const body=JSON.parse((await f.tasks.get(wire.runId))!.body),decision=body.questionDecision as QuestionDecision;assert.equal(body.query,check.originalQuestion);assert.equal(decision.choice,choice);assert.equal(decision.checkMessageId,f.parentId);assert.equal(decision.originalQuestion,check.originalQuestion);assert.equal(decision.dataQuestion,f.selected());assert.equal(body.clarificationAnswer,undefined);
 const stored=(await f.audit.query("SELECT answer_id FROM runtime_clarification_answers WHERE parent_task_id=$1",[f.parentId])).rows;assert.deepEqual(stored,[{answer_id:wire.runId}]);const record=await f.tasks.chat.agUiInterrupt(f.parentId);assert.equal(record?.status,"resolved");assert.equal(record?.resumedBy,wire.runId);
 const replay=await f.post(wire);assert.equal(replay.status,409);assert.equal((await replay.json()).code,"RUN_ALREADY_ACCEPTED");const after=await f.count();
 const {resume:_resumption,...rawMirror}=f.resume({choice:"original"});(rawMirror.forwardedProps.oneearth.submission as Record<string,unknown>).questionDecision={checkMessageId:f.parentId,originalQuestion:check.originalQuestion,dataQuestion:check.proposedQuestion,choice:"proposed"};
 assert.equal((await f.post(rawMirror)).status,400);assert.equal(await f.tasks.get(rawMirror.runId),undefined);
 assert.equal((await f.post(f.resume({choice:"proposed"}))).status,409);assert.equal(await f.count(),after);assert.equal(f.requests.length,2);
 console.log(JSON.stringify({choice,actualTaskStable:f.remote,originalQuestionUnchanged:true,decisionFromArchive:true,invalidZeroModel:true,delegationRequests:2,oneParentClaim:true}));
});

test("a persisted runtime-origin QuestionCheck starts one new delegation with the selected goal and no provider approval mirror",{skip:!fixture,timeout:20000},async t=>{
 // The parent is a controlled trusted runtime output; continuation then uses
 // the real normal HTTP/PG/worker path, not a special product fixture branch.
 const f=await setup(t,true),wire=f.resume({choice:"proposed"}),response=await f.post(wire);assert.equal(response.status,200);const events=f.decode(await response.text());assert.equal(events.at(-1).type,"RUN_FINISHED");assert.equal(events.at(-1).outcome,undefined);assert.equal(f.requests.length,1);assert.equal(f.selected(),check.proposedQuestion);assert.equal((await f.tasks.chat.agUiInterrupt(f.parentId))?.resumedBy,wire.runId);
});


test("explicit native abandonment of QuestionCheck consumes only the question and preserves its original archive",{skip:!fixture,timeout:20000},async t=>{
 const f=await setup(t),before=await f.count(),wire={...f.resume(undefined),resume:[{interruptId:f.parentId,status:"cancelled"}]};
 const response=await f.post(wire);assert.equal(response.status,200);const events=f.decode(await response.text());assert.deepEqual(events.at(-1).outcome,{type:"cancelled"});assert.equal((await f.tasks.get(wire.runId))?.status,"cancelled");assert.equal(await f.count(),before);assert.equal(f.requests.length,1);
 const card=await f.tasks.chat.agUiInterrupt(f.parentId);assert.ok(card&&card.kind==="question-check");assert.equal(card.status,"cancelled");assert.deepEqual(card.questionCheck,check);assert.equal(card.resumedBy,wire.runId);
 const archived=randomUUID();await f.tasks.submit(archived,{query:check.originalQuestion,conversationId:randomUUID(),turnId:randomUUID(),history:[],context,config});await f.tasks.finish(archived,"complete",{result:{message:"旧版确认记录",questionCheck:check}});assert.equal(await f.tasks.chat.agUiInterrupt(archived),undefined);assert.deepEqual((await f.tasks.terminal(archived))?.result && ((await f.tasks.terminal(archived))!.result as any).questionCheck,check);
});
