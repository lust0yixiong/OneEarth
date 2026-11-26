import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {once} from "node:events";
import {randomUUID} from "node:crypto";
import {spawn,type ChildProcess} from "node:child_process";
import {mkdtemp,writeFile,rm} from "node:fs/promises";
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
import type {PaperRecord} from "../src/domain/paper-record";
const fixture=process.env.ONEEARTH_AGUI_TEST_DATABASE_URL;
const latch=()=>{let resolve!:()=>void;const promise=new Promise<void>(done=>resolve=done);return {promise,resolve};};
const context={filters:emptyFilters(),caseId:null,selection:null,citation:null,gridSystem:"h3",layer:"all",camera:{center:[0,0] as [number,number],zoom:1,reason:"controlled"}};
const config={executor:"codex",model:"gpt-6-luna"};
const paper:PaperRecord={id:"earthnano:"+"b".repeat(64),dsKey:"doi:10.9999/native-cancel",papers:1,paperTitle:"Controlled metadata record",studyContext:"",points:[],need:{product:"Controlled dataset",name:"Dataset",type:"Dataset",source:"文献资料",status:"Published",detail:"Metadata only",profile:{role:"data",spatial:"coverage",coverage:"world",access:"Public",limitation:"Metadata only"},tabs:[]}};

for(const order of ["cancel-first-late-stop","complete-first","cancel-first-remote-completes"] as const)test("native run cancellation ordering with two physical workers: "+order,{skip:!fixture,timeout:25000},async t=>{
 assert.ok(fixture);assert.match(new URL(fixture).pathname,/native_agui.*(?:module_runtime|m2)/);
 const old={runtime:process.env.ONEEARTH_RUNTIME_DATABASE_URL,path:process.env.PATH,discovery:process.env.ONEEARTH_DISCOVERY_URL};process.env.ONEEARTH_RUNTIME_DATABASE_URL=fixture;
 const dir=await mkdtemp(path.join(tmpdir(),"oe-native-cancel-")),tasks=await postgresTaskStore("runtime");let ready=false,remoteState="TASK_STATE_WORKING",submits=0,stops=0,mutations=0;const stopGate=latch(),stopEntered=latch(),remoteId=randomUUID(),remoteContext=randomUUID();
 const cli=`#!${process.execPath}\nlet p='';for await(const b of process.stdin)p+=b;let a;if(p.includes('输出唯一decide分支'))a={decide:{kind:'search',goal:'核对受控目录',targets:[]}};else if(p.includes('remainingModelCalls'))a={action:'answer',targets:[],gap:null,clarification:null,reason:'已有受控目录记录'};else{let v;try{v=JSON.parse(p.slice(p.lastIndexOf('\\n')+1));}catch{}const ref=v?.catalogue?.[0]?.ref||'S1';a={message:'仅取得受控目录元数据。['+ref+']',sections:[],limitation:'未读取原始数据。',followUp:'',researchNotes:[],calculationRequests:[]};}process.stdout.write(JSON.stringify(a));`;
 await writeFile(path.join(dir,"codex"),cli,{mode:0o700});process.env.PATH=dir+path.delimiter+(old.path||"");
 const query="仅文献资料核对受控目录",intent={purpose:query,task:query,region:null,time:null,months:[]};
 const material={plan:{dataQuestion:query,questionMode:"preserve",dataNeed:null,paper:{region:[],facets:[]},web:[],researchIntent:intent,conversationContext:query,hainaQueries:[],paperQueries:[],webQueries:[]},papers:[paper],haina:[],searches:[],sourceStatus:[{source:"文献资料",status:"done",count:1}],issues:[]};
 const snapshot=()=>({id:remoteId,contextId:remoteContext,status:{state:remoteState},artifacts:ready?[{artifactId:"real-result",parts:[{data:{kind:"oneearth.discovery.event.v1",event:{seq:1,result:material}}}]}]:[]});
 const provider=express();provider.use(express.json({type:"application/a2a+json"}));provider.post("/message:send",(_req,res)=>{submits++;res.json({task:snapshot()});});provider.get("/tasks/:id",(_req,res)=>res.json(snapshot()));
 provider.post(/^\/tasks\/([^/]+):cancel$/,async(_req,res)=>{stops++;stopEntered.resolve();if(order==="cancel-first-late-stop")await stopGate.promise;if(remoteState==="TASK_STATE_WORKING"){mutations++;remoteState="TASK_STATE_CANCELED";}res.json(snapshot());});
 const upstream=provider.listen(0,"127.0.0.1");await once(upstream,"listening");const pa=upstream.address();assert.ok(pa&&typeof pa!=="string");process.env.ONEEARTH_DISCOVERY_URL="http://127.0.0.1:"+pa.port;
 const services={tasks,push:{latest:()=>({records:[]})},coverage:async()=>undefined,researchRegionService:{locate:async()=>null},adminBoundaryDir:dir,canonicalCache:new Map()} as unknown as RuntimeServices;
 const app=express();app.use(express.json());const native=await agUiWorkbench(app,tasks,(id,input)=>prepareRuntimeChat(services,id,input,id=>tasks.chat.latestCompleted(id),{publicAnswer:true}));taskStatusRoutes(app,"/api/tasks",tasks,{researchRecords:true,onCancelled:id=>native.cancel(id)});
 const server=app.listen(0,"127.0.0.1");await once(server,"listening");const addr=server.address();assert.ok(addr&&typeof addr!=="string");const base="http://127.0.0.1:"+addr.port;
 const workers:ChildProcess[]=[],exits:Promise<void>[]=[];
 for(let i=0;i<2;i++){
  const child=spawn(process.execPath,["--import","tsx",fileURLToPath(new URL("./runtime-worker.ts",import.meta.url))],{cwd:fileURLToPath(new URL("../",import.meta.url)),env:{...process.env,ONEEARTH_STATE_DIR:path.join(dir,"worker-"+i),ONEEARTH_OBSERVATION_COORDINATOR:i?"false":"true"},stdio:["ignore","ignore","pipe"]});let error="";child.stderr!.on("data",bytes=>{error=(error+bytes).slice(-1000);});workers.push(child);exits.push(new Promise((resolve,reject)=>{child.once("error",reject);child.once("exit",code=>code===0?resolve():reject(Error("controlled worker exit "+code+" "+error)));}));
 }
 t.after(async()=>{stopGate.resolve();for(const child of workers)child.kill("SIGTERM");await Promise.allSettled(exits);await native.close();server.closeAllConnections();upstream.closeAllConnections();await Promise.all([new Promise<void>(r=>server.close(()=>r())),new Promise<void>(r=>upstream.close(()=>r()))]);await tasks.close();await closeRuntimeModelCapacity();for(const [key,value] of [["ONEEARTH_RUNTIME_DATABASE_URL",old.runtime],["PATH",old.path],["ONEEARTH_DISCOVERY_URL",old.discovery]])if(value===undefined)delete process.env[key!];else process.env[key!]=value;await rm(dir,{recursive:true,force:true});});
 async function until(check:()=>Promise<boolean>){for(let i=0;i<240;i++){if(await check())return;await new Promise(r=>setTimeout(r,20));}assert.fail("controlled native state did not settle");}
 const id=randomUUID(),threadId=randomUUID(),turnId=randomUUID(),input={protocolVersion:"1.0",runId:id,threadId,messages:[{id:turnId,role:"user",content:query}],tools:[],context:[],state:{},forwardedProps:{oneearth:{version:1,submission:{context,config}}}};
 const response=await fetch(base+"/api/ag-ui",{method:"POST",headers:{"Content-Type":"application/json",Accept:"text/event-stream"},body:JSON.stringify(input)});assert.equal(response.status,200);const stream=response.text();
 await until(async()=>!!((await tasks.step?.(id))?.delegations as any[])?.[0]?.binding);assert.equal(submits,1);
 const deletes=()=>Promise.all([0,1,2].map(()=>fetch(base+"/api/tasks/"+id,{method:"DELETE"})));
 if(order==="complete-first"){
  ready=true;remoteState="TASK_STATE_COMPLETED";await until(async()=>(await tasks.get(id))?.status==="complete");assert.deepEqual((await deletes()).map(r=>r.status),[409,409,409]);
 }else{
  const results=await deletes();assert.deepEqual(results.map(r=>r.status).sort(),[204,409,409]);
  if(order==="cancel-first-remote-completes"){ready=true;remoteState="TASK_STATE_COMPLETED";}
 }
 const frames=(await stream).split("\n\n").filter(s=>s.startsWith("data: ")).map(s=>EventSchema.parse(JSON.parse(s.slice(6))));const ending=frames.filter(event=>event.type==="RUN_FINISHED"||event.type==="RUN_ERROR");assert.equal(ending.length,1);assert.equal(ending[0].type,"RUN_FINISHED");
 const business=await tasks.terminal(id),eventCount=(await tasks.chat.agUiEvents(id)).length;
 if(order==="complete-first"){assert.ok(!("outcome" in ending[0])||ending[0].outcome?.type!=="cancelled");assert.equal(stops,0);assert.equal(mutations,0);assert.ok((business?.result as any).paperRecords.some((p:any)=>p.id===paper.id));}
 else{
  assert.deepEqual(ending[0].outcome,{type:"cancelled"});assert.equal((await tasks.get(id))?.status,"cancelled");
  if(order==="cancel-first-late-stop"){await stopEntered.promise;assert.equal((await tasks.runtimeStatus!(id)).remoteStop?.state,"pending");stopGate.resolve();}
  await until(async()=>(await tasks.runtimeStatus!(id)).remoteStop?.state==="confirmed");
  assert.equal(JSON.stringify(await tasks.terminal(id)),JSON.stringify(business));assert.equal((await tasks.chat.agUiEvents(id)).length,eventCount);assert.equal(await tasks.recordRemoteStop!(id,{discoveryTaskId:remoteId,state:"unconfirmed"}),false);assert.equal(mutations,order==="cancel-first-late-stop"?1:0);
  const other=randomUUID();assert.equal((await tasks.runtimeStatus!(other)).remoteStop,undefined);
 }
 assert.equal(submits,1);assert.ok(mutations<=1);assert.equal((await fetch(base+"/api/ag-ui",{method:"POST",headers:{"Content-Type":"application/json",Accept:"text/event-stream"},body:JSON.stringify(input)})).status,409);
 console.log(JSON.stringify({order,physicalWorkers:2,submits,stopRequests:stops,remoteBusinessTransitions:mutations,standardEndings:ending.length,originalRunId:id,lateReceiptNeverReopensStream:true}));
});
