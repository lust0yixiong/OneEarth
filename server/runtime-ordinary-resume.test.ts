import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {spawn} from "node:child_process";
import {fileURLToPath} from "node:url";
import {once} from "node:events";
import {randomUUID} from "node:crypto";
import {mkdtemp,writeFile,readFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {openTaskStore,workTasks,type TaskStore} from "./task-store";
import {postgresTaskStore} from "./postgres-task-store";
import {runtimeWorkerRunner} from "./runtime-worker-runner";
import {closeRuntimeModelCapacity} from "./runtime-model-capacity";
import type {RuntimeServices,RuntimeTurnInput} from "./runtime-turn";
import {emptyFilters} from "../src/domain/spatial";
import {discoveryRequestFingerprint} from "./discovery-request-fingerprint";
import type {PaperRecord} from "../src/domain/paper-record";
const fixture=process.env.ONEEARTH_RUNTIME_TEST_DATABASE_URL;
const paper:PaperRecord={id:"earthnano:"+"a".repeat(64),dsKey:"doi:10.9999/controlled",papers:1,paperTitle:"Controlled publication",studyContext:"",points:[],need:{product:"Controlled authorized material",name:"Dataset",type:"Dataset",source:"文献资料",status:"Published",detail:"Controlled catalogue metadata only",profile:{role:"data",spatial:"coverage",coverage:"world",access:"Public",limitation:"Only catalogue metadata"},tabs:[{kind:"table",label:"论文用法（本页）",rows:[["paper","use","x","","paper-id","dataset-id"]]}]}};
const plan={action:"search",goal:"查找已授权的资料",evidenceNeed:"discover",targets:[],reason:"需要实际材料",clarification:null,researchIntent:{purpose:"查找已授权的资料",task:"查找已授权的资料",region:null,time:null,months:[]},conversationContext:"查找已授权的资料",evidenceGap:"需要实际来源记录"};
function input():RuntimeTurnInput{return {query:"查找已授权的资料",conversationId:randomUUID(),turnId:randomUUID(),history:[],config:{executor:"codex",model:"gpt-6-luna"},context:{filters:emptyFilters(),caseId:null,selection:null,citation:null,gridSystem:"h3",layer:"all",camera:{center:[0,0],zoom:1,reason:"controlled"}}};}

for(const mode of ["accepted-restart","lost-accepted","missing-resend","unknown-no-resend","cancel-after-accept"] as const)test("ordinary production worker durable A2A: "+mode,{timeout:25000},async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),"oe-ordinary-resume-")),log=path.join(dir,"model-log.jsonl"),prior={path:process.env.PATH,discovery:process.env.ONEEARTH_DISCOVERY_URL,recovery:process.env.ONEEARTH_DISCOVERY_RECOVERY_TOKEN,runtime:process.env.ONEEARTH_RUNTIME_DATABASE_URL};
 if(fixture)process.env.ONEEARTH_RUNTIME_DATABASE_URL=fixture;
 const cli=`#!${process.execPath}\nimport fs from 'node:fs';import {createHash} from 'node:crypto';let prompt='';for await(const part of process.stdin)prompt+=part;let kind='plan',answer=${JSON.stringify(plan)};
if(prompt.includes('"remainingModelCalls"')&&prompt.includes('"exactReadTargets"')){kind='evidence';answer={action:'answer',targets:[],gap:null,clarification:null,reason:'已有材料足够给目录层答复'};}
else if(prompt.includes('calculationRequests')&&prompt.includes('sections')){kind='answer';let value;try{value=JSON.parse(prompt.slice(prompt.lastIndexOf('\\n')+1));}catch{}const ref=value?.catalogue?.[0]?.ref||'S1';answer={message:'已取得受控目录记录。['+ref+']',sections:[],limitation:'仅目录元数据，未读取原始文件。',followUp:'',researchNotes:[],calculationRequests:[]};}
fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({kind,hash:createHash('sha256').update(prompt).digest('hex')})+'\\n');process.stdout.write(JSON.stringify(answer));`;
 await writeFile(path.join(dir,"codex"),cli,{mode:0o700});process.env.PATH=dir+path.delimiter+(prior.path||"");process.env.ONEEARTH_DISCOVERY_RECOVERY_TOKEN="controlled-recovery-token-".repeat(2);
 let ready=false,accepted=false,posts=0,gets=0,lookups=0,cancels=0;const dId=randomUUID(),contextId=randomUUID(),submissions:any[]=[];
 const app=express();app.use(express.json({type:"application/a2a+json"}));
 const material={plan:{dataQuestion:"查找已授权的资料",questionMode:"preserve",dataNeed:null,paper:{region:[],facets:[]},web:[],researchIntent:plan.researchIntent,conversationContext:plan.conversationContext,hainaQueries:[],paperQueries:[],webQueries:[]},papers:[paper],haina:[],searches:[],sourceStatus:[{source:"文献资料",status:"done",count:1}],issues:[]};
 const task=()=>({id:dId,contextId,status:{state:cancels?"TASK_STATE_CANCELED":ready?"TASK_STATE_COMPLETED":"TASK_STATE_WORKING"},artifacts:ready?[{artifactId:"actual-result",parts:[{data:{kind:"oneearth.discovery.event.v1",event:{seq:1,result:material}}}]}]:[]});
 app.post("/message:send",(req,res)=>{posts++;submissions.push(req.body);assert.equal(req.body.configuration.returnImmediately,true);if(posts===1&&(mode==="lost-accepted"||mode==="missing-resend"||mode==="unknown-no-resend")){accepted=mode!=="missing-resend";res.destroy();return;}accepted=true;res.type("application/a2a+json").json({task:task()});});
 app.get("/internal/discovery-delegations/:messageId",(req,res)=>{lookups++;assert.equal(req.params.messageId,submissions[0].message.messageId);const data=submissions[0].message.parts[0].data;assert.equal(req.headers["x-oneearth-request-fingerprint"],discoveryRequestFingerprint(data.kind,data.input));assert.equal(req.headers.authorization,"Bearer "+process.env.ONEEARTH_DISCOVERY_RECOVERY_TOKEN);if(mode==="unknown-no-resend"){res.status(404).json({error:"ordinary not found"});return;}res.status(accepted?200:404).json(accepted?{taskId:dId,idempotentReplay:true}:{code:"DELEGATION_NOT_FOUND",idempotentReplay:true});});
 app.get("/tasks/:id",(req,res)=>{gets++;assert.equal(req.params.id,dId);res.type("application/a2a+json").json(task());});
 app.post("/tasks/:id\\:cancel",(req,res)=>{cancels++;res.type("application/a2a+json").json(task());});
 const server=app.listen(0,"127.0.0.1");await once(server,"listening");const address=server.address();assert.ok(address&&typeof address!=="string");process.env.ONEEARTH_DISCOVERY_URL="http://127.0.0.1:"+address.port;
 let tasks:TaskStore=fixture?await postgresTaskStore("runtime"):openTaskStore(path.join(dir,"runtime.sqlite")),stop:(()=>Promise<void>)|undefined;
 t.after(async()=>{await stop?.();await tasks.close();await closeRuntimeModelCapacity();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));for(const [name,value] of [["PATH",prior.path],["ONEEARTH_DISCOVERY_URL",prior.discovery],["ONEEARTH_DISCOVERY_RECOVERY_TOKEN",prior.recovery],["ONEEARTH_RUNTIME_DATABASE_URL",prior.runtime]])if(value===undefined)delete process.env[name!];else process.env[name!]=value;await rm(dir,{recursive:true,force:true});});
 const id=randomUUID(),body=input();await tasks.submit(id,body);
 async function start(){
  if(fixture){
   const child=spawn(process.execPath,["--import","tsx",fileURLToPath(new URL("./runtime-worker.ts",import.meta.url))],{cwd:fileURLToPath(new URL("../",import.meta.url)),env:{...process.env,ONEEARTH_STATE_DIR:path.join(dir,"worker-state")},stdio:["ignore","ignore","pipe"]});
   let error="";child.stderr.on("data",chunk=>{error=(error+chunk).slice(-2000);});const exited=new Promise<void>((resolve,reject)=>{child.once("error",reject);child.once("exit",code=>code===0?resolve():reject(Error("controlled worker stopped: "+code+" "+error)));});
   stop=async()=>{child.kill("SIGTERM");await exited;};return;
  }
  const services={tasks,push:{latest:()=>({records:[]})},coverage:async()=>undefined,researchRegionService:{locate:async()=>null},adminBoundaryDir:dir,canonicalCache:new Map()} as unknown as RuntimeServices;const runner=runtimeWorkerRunner(services);stop=await workTasks(tasks,runner.run,{maintenance:runner.maintenance});}
 async function until(predicate:()=>Promise<boolean>){for(let i=0;i<180;i++){if(await predicate())return;await new Promise(r=>setTimeout(r,30));}const terminal=await tasks.terminal(id);assert.fail("worker did not settle: "+JSON.stringify({status:(await tasks.get(id))?.status,error:terminal?.error,step:await tasks.step?.(id)}));}
 await start();
 await until(async()=>posts===1&&!!(await tasks.step?.(id))?.delegations);
 if(mode==="unknown-no-resend"){await until(async()=>(await tasks.get(id))?.status==="failed");assert.equal(posts,1);assert.ok(lookups>=1);return;}
 await until(async()=>!!((await tasks.step?.(id))?.delegations as any[])?.[0]?.binding);
 if(mode==="cancel-after-accept"){
  assert.equal(await tasks.finish(id,"cancelled",{error:"任务已取消。",code:"cancelled"}),true);const terminal=JSON.stringify(await tasks.terminal(id));
  await until(async()=>cancels>0);assert.equal((await tasks.get(id))?.status,"cancelled");assert.equal(JSON.stringify(await tasks.terminal(id)),terminal);assert.equal(posts,1);return;
 }
 const short=randomUUID(),shortBody={...input(),query:"把地图移动到 120.2E, 30.3N"};await tasks.submit(short,shortBody);await until(async()=>(await tasks.get(short))?.status==="complete");assert.equal((await tasks.get(id))?.status,"running");
 if(mode==="accepted-restart"){await stop!();stop=undefined;await tasks.close();tasks=fixture?await postgresTaskStore("runtime"):openTaskStore(path.join(dir,"runtime.sqlite"));ready=true;await start();}else ready=true;
 await until(async()=>["complete","failed"].includes((await tasks.get(id))?.status||""));const terminal=await tasks.terminal(id);assert.equal((await tasks.get(id))?.status,"complete",JSON.stringify({error:terminal?.error,code:terminal?.code}));
 const models=(await readFile(log,"utf8")).trim().split("\n").map(row=>JSON.parse(row));assert.equal(models.filter(row=>row.kind==="plan").length,1,"completed original planner must not run twice");assert.equal(posts,mode==="missing-resend"?2:1);if(posts===2)assert.deepEqual(submissions[0],submissions[1]);
 assert.ok(gets>=1);if(mode.startsWith("lost")||mode==="missing-resend")assert.ok(lookups>=1);assert.ok((terminal?.result as any)?.paperRecords?.some((row:any)=>row.id===paper.id));
 console.log(JSON.stringify({mode,posts,gets,lookups,modelKinds:models.map(row=>row.kind),sameTaskId:id,workerReleasedForOtherTask:true}));
});
