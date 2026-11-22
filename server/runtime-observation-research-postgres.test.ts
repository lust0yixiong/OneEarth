import assert from "node:assert/strict";
import test from "node:test";
import {execFileSync} from "node:child_process";
import {mkdtempSync,rmSync} from "node:fs";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {setTimeout as delay} from "node:timers/promises";
import {once} from "node:events";
import express from "express";
import {postgresTaskStore} from "./postgres-task-store";
import {productDatabase} from "./product-database";
import {taskRoutes,workTasks,type TaskStore} from "./task-store";
import {prepareObservationResearch,hasObservationResearch} from "./runtime-observation-authority";
import {recoverObservationResearchRecord} from "./runtime-observation-research";
import {runtimeWorkerRunner} from "./runtime-worker-runner";
import type {RuntimeObservationEngine} from "./runtime-observation";
import type {RuntimeServices} from "./runtime-turn";
import type {observationDiscoveryClient,ObservationTask} from "./observation-discovery-client";
import {modelObservationEvidence} from "./observation-research-contract";
import {observationCheckSkill,type ObservationCheckResult,type SkillExecutionRequest} from "./observation-check-contract";
import {validateTurn} from "./runtime-input";
import {emptyFilters} from "../src/domain/spatial";

const pgBin=process.env.ONEEARTH_A2A_TEST_PG_BIN;
test("natural production PG route/worker freezes authority, releases, reopens and reuses an unattached same-chat receipt",{skip:!pgBin&&"set ONEEARTH_A2A_TEST_PG_BIN",timeout:30000},async t=>{
  assert.ok(pgBin);const dir=mkdtempSync("/tmp/oe-natural-runtime-pg-"),data=path.join(dir,"pg"),old=process.env.ONEEARTH_RUNTIME_DATABASE_URL;
  const pg=(command:string,args:string[])=>execFileSync(path.join(pgBin,command),args,{stdio:"pipe",encoding:"utf8"});
  let started=false,store:TaskStore|undefined,stop:(()=>Promise<void>)|undefined,server:ReturnType<express.Express["listen"]>|undefined;
  t.after(async()=>{await stop?.();server?.closeAllConnections();if(server)await new Promise<void>(r=>server!.close(()=>r()));await store?.close();if(old===undefined)delete process.env.ONEEARTH_RUNTIME_DATABASE_URL;else process.env.ONEEARTH_RUNTIME_DATABASE_URL=old;
    if(started)pg("pg_ctl",["-D",data,"-m","fast","-w","stop"]);rmSync(dir,{recursive:true,force:true});});
  pg("initdb",["-D",data,"-U","oneearth_fixture","-A","trust","--no-locale","--encoding=UTF8"]);
  pg("pg_ctl",["-D",data,"-l",path.join(dir,"postgres.log"),"-o",'-c listen_addresses= -k "'+dir+'"',"-w","start"]);started=true;
  process.env.ONEEARTH_RUNTIME_DATABASE_URL="postgresql://oneearth_fixture@localhost/postgres?host="+encodeURIComponent(dir);store=await postgresTaskStore("runtime");
  const material={artifactId:"pg-weather",version:"A",title:"PG私有观测",variables:["t"],sha256:"d".repeat(64)},authority=async()=>[structuredClone(material)];
  const result:ObservationCheckResult={status:"verified",evidence:{artifactId:material.artifactId,version:"A",variable:"t",sha256:material.sha256,unit:"K",count:0,first:null,last:null}};
  const input:any={query:"这份数据的单位和非空记录是什么？",conversationId:randomUUID(),turnId:randomUUID(),history:[],config:{executor:"codex",model:""},
    context:{filters:emptyFilters(),caseId:null,citation:null,selection:null,gridSystem:"h3",layer:"all",camera:{center:[0,0],zoom:1,reason:"controlled"},attachedScope:[{kind:"observation",artifactId:material.artifactId,version:"A",title:"客户端"}]}};
  const remotes=new Map<string,ObservationTask>(),messages=new Map<string,ObservationTask>(),jobs=new Map<string,SkillExecutionRequest>();let obtained:ObservationCheckResult|undefined,delivered=0;
  const client:ReturnType<typeof observationDiscoveryClient>={submit:async()=>assert.fail("natural route cannot use explicit request kind"),
    submitResearch:async(messageId,request)=>{
      if(messages.has(messageId))return structuredClone(messages.get(messageId)!);
      assert.ok(!JSON.stringify(request).includes(material.sha256));
      const event:ObservationTask["events"][number]=request.evidence.length?{seq:9,artifactId:"reused",researchResult:{action:"answer" as const,basedOn:"archive" as const,evidence:request.evidence[0]}}:
        {seq:7,artifactId:"demand",skillDemand:{requestId:randomUUID(),researchTaskId:request.researchTaskId,check:{skill:observationCheckSkill,artifactId:material.artifactId,version:"A",variable:"t",purpose:"describe" as const}}};
      const task:ObservationTask={taskId:randomUUID(),contextId:randomUUID(),state:request.evidence.length?"TASK_STATE_COMPLETED":"TASK_STATE_INPUT_REQUIRED",events:[event]};
      messages.set(messageId,task);remotes.set(task.taskId,task);return structuredClone(task);
    },snapshot:async binding=>{const remote=remotes.get(binding.taskId)!;assert.equal(binding.contextId,remote.contextId);return structuredClone(remote);},
    deliver:async(binding,_message,value)=>{const remote=remotes.get(binding.taskId)!;assert.equal(value.afterSeq,7);assert.deepEqual(value.result,result);delivered++;remote.state="TASK_STATE_COMPLETED";
      remote.events.push({seq:8,artifactId:"answer",researchResult:{action:"answer",basedOn:"read",evidence:modelObservationEvidence((value.result as Extract<ObservationCheckResult,{status:"verified"}>).evidence)}});return structuredClone(remote);},cancel:async()=>"TASK_STATE_CANCELED"};
  const engine:RuntimeObservationEngine={submit:async request=>{assert.equal(request.modelAuthorized,true);assert.equal(request.expectedSha256,material.sha256);if(jobs.has(request.requestId))assert.deepEqual(request,jobs.get(request.requestId));else jobs.set(request.requestId,structuredClone(request));},result:async()=>obtained,cancel:async()=>{}};
  // Build actual production routes against the current store; reopening the
  // store replaces this indirection without changing its semantics.
  const proxy=new Proxy({} as TaskStore,{get:(_target,key)=>{const method=(store as any)[key];return typeof method==="function"?method.bind(store):method;}});
  const api=express();api.use(express.json());taskRoutes(api,"/api/tasks",proxy,value=>validateTurn(proxy,value),{researchRecords:true,prepareWhen:value=>hasObservationResearch(proxy,value),prepare:(id,value)=>prepareObservationResearch(proxy,id,value,authority),recoverRecord:task=>recoverObservationResearchRecord(proxy,task)});
  server=api.listen(0,"127.0.0.1");await once(server,"listening");const address=server.address();assert.ok(address&&typeof address!=="string");const origin="http://127.0.0.1:"+address.port;
  const submit=async(body:any,id=randomUUID())=>({id,response:await fetch(origin+"/api/tasks",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id,input:body})})});
  async function start(){const services={tasks:store!,push:{latest:()=>({records:[]})},coverage:async()=>assert.fail(),researchRegionService:{locate:async()=>null},adminBoundaryDir:dir,canonicalCache:new Map()} as unknown as RuntimeServices;
    const runner=runtimeWorkerRunner(services,engine,{client,authority,pollMs:20});stop=await workTasks(store!,runner.run,{maintenance:runner.maintenance});}
  async function until(read:()=>Promise<boolean>){const start=Date.now();while(!await read()){if(Date.now()-start>6000)assert.fail("natural PG worker did not advance");await delay(20);}}
  const {id,response}=await submit(input);assert.equal(response.status,202);await start();await until(async()=>jobs.size===1);
  const pinned=await store.step!(id);assert.deepEqual(pinned!.materials,[material]);assert.equal((await store.get(id))?.status,"running");
  const ordinary={...input,query:"把地图移动到 120.2E, 30.3N",context:{...input.context,attachedScope:[]}};const other=await submit(ordinary);await until(async()=>(await store!.get(other.id))?.status==="complete");assert.equal((await store.get(id))?.status,"running");
  await stop!();stop=undefined;await store.close();store=await postgresTaskStore("runtime");obtained=result;await start();await until(async()=>(await store!.get(id))?.status==="complete");
  assert.equal(messages.size,1);assert.equal(jobs.size,1);assert.equal(delivered,1);assert.deepEqual((await store.step!(id))!.binding,pinned!.binding);
  const record=await (await fetch(origin+"/api/tasks/"+id+"/record")).json();assert.deepEqual(record.result.observationCheckResult,result);assert.equal(record.result.answerNotes.references.length,1);assert.match(record.result.message,/没有非空记录/);
  const follow={...input,query:"继续说明这份资料的单位。",previousTaskId:id,turnId:randomUUID(),context:{...input.context,attachedScope:[]}};const second=await submit(follow);assert.equal(second.response.status,202);await until(async()=>(await store!.get(second.id))?.status==="complete");assert.equal(jobs.size,1);assert.equal(messages.size,2);assert.equal(delivered,1);
  const reused=(await store.terminal(second.id))!.result as any;assert.equal(reused.observationResearchResult.basedOn,"archive");assert.match(reused.message,/此前保存的读据/);
  const audit=productDatabase("RUNTIME");try{for(const taskId of [id,second.id]){const refs=(await audit.query("SELECT reference FROM runtime_references WHERE task_id=$1",[taskId])).rows;assert.equal(refs.length,1);assert.deepEqual(refs[0].reference.observationEvidence,result.evidence);}}finally{await audit.end();}
  assert.ok((await store.events(id,0)).some(e=>e.stepRecovered));
});
