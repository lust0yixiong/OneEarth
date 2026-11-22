import assert from "node:assert/strict";
import test from "node:test";
import {execFileSync} from "node:child_process";
import {mkdtempSync,rmSync} from "node:fs";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {setTimeout as delay} from "node:timers/promises";
import {postgresTaskStore} from "./postgres-task-store";
import {workTasks,TaskConflict,type TaskStore} from "./task-store";
import {initialObservationCheckpoint,type RuntimeObservationEngine} from "./runtime-observation";
import {runtimeWorkerRunner} from "./runtime-worker-runner";
import type {RuntimeServices} from "./runtime-turn";
import type {observationDiscoveryClient,ObservationTask} from "./observation-discovery-client";
import {observationCheckSkill,type ObservationCheck,type ObservationCheckResult} from "./observation-check-contract";
import {emptyFilters} from "../src/domain/spatial";
import {productDatabase} from "./product-database";

const pgBin=process.env.ONEEARTH_A2A_TEST_PG_BIN;
test("isolated PostgreSQL preserves parked research, releases the production worker, and resumes original bindings",{skip:!pgBin&&"set ONEEARTH_A2A_TEST_PG_BIN",timeout:30000},async t=>{
  assert.ok(pgBin);const dir=mkdtempSync("/tmp/oe-runtime-steps-"),data=path.join(dir,"pg"),old=process.env.ONEEARTH_RUNTIME_DATABASE_URL;
  const pg=(command:string,args:string[])=>execFileSync(path.join(pgBin,command),args,{stdio:"pipe",encoding:"utf8"});
  let started=false,store:TaskStore|undefined,stop:(()=>Promise<void>)|undefined;
  t.after(async()=>{await stop?.();await store?.close();if(old===undefined)delete process.env.ONEEARTH_RUNTIME_DATABASE_URL;else process.env.ONEEARTH_RUNTIME_DATABASE_URL=old;
    if(started)pg("pg_ctl",["-D",data,"-m","fast","-w","stop"]);rmSync(dir,{recursive:true,force:true});});
  pg("initdb",["-D",data,"-U","oneearth_fixture","-A","trust","--no-locale","--encoding=UTF8"]);
  pg("pg_ctl",["-D",data,"-l",path.join(dir,"postgres.log"),"-o",'-c listen_addresses= -k "'+dir+'"',"-w","start"]);started=true;
  process.env.ONEEARTH_RUNTIME_DATABASE_URL="postgresql://oneearth_fixture@localhost/postgres?host="+encodeURIComponent(dir);
  store=await postgresTaskStore("runtime");
  const id=randomUUID(),check:ObservationCheck={skill:observationCheckSkill,artifactId:"real-pg-check",version:"A",variable:"t",unit:"K",start:"2020-01-01",end:"2020-01-02"};
  const body={query:"核对已明确授权的版本",observationCheck:check,conversationId:randomUUID(),turnId:randomUUID(),history:[],config:{executor:"codex",model:""},
    context:{filters:emptyFilters(),caseId:null,citation:null,selection:null,gridSystem:"h3",layer:"all",camera:{center:[0,0],zoom:1,reason:"controlled"}}};
  const remote:ObservationTask={taskId:randomUUID(),contextId:randomUUID(),state:"TASK_STATE_INPUT_REQUIRED",events:[{seq:7,artifactId:"demand",skillDemand:{requestId:randomUUID(),researchTaskId:id,check}}]};
  const demand=remote.events[0].skillDemand!,result:ObservationCheckResult={status:"verified",matches:true,evidence:{artifactId:check.artifactId,version:check.version,sha256:"b".repeat(64),variable:"t",unit:"K",count:2,first:check.start,last:check.end}};
  let submitted=0,accepted=0,obtained:ObservationCheckResult|undefined,delivered=0;
  const messages=new Set<string>();
  const client:ReturnType<typeof observationDiscoveryClient>={submit:async message=>{if(!messages.has(message)){messages.add(message);accepted++;}return structuredClone(remote);},
    snapshot:async()=>structuredClone(remote),deliver:async(_binding,_message,input)=>{assert.equal(input.afterSeq,7);assert.equal(input.requestId,demand.requestId);assert.deepEqual(input.result,result);delivered++;
      remote.state="TASK_STATE_COMPLETED";remote.events.push({seq:8,artifactId:"result",result});return structuredClone(remote);},cancel:async()=>"TASK_STATE_CANCELED"};
  const engine:RuntimeObservationEngine={submit:async request=>{assert.equal(request.requestId,demand.requestId);assert.equal(request.discoveryTaskId,remote.taskId);assert.equal(request.expectedSha256,"b".repeat(64));if(!submitted)submitted++;},result:async()=>obtained,cancel:async()=>{}};
  async function start(){const services={tasks:store!,push:{latest:()=>({records:[]})},coverage:async()=>assert.fail(),researchRegionService:{locate:async()=>null},adminBoundaryDir:dir,canonicalCache:new Map()} as unknown as RuntimeServices;
    const runner=runtimeWorkerRunner(services,engine,{client,pollMs:20});stop=await workTasks(store!,runner.run,{maintenance:runner.maintenance});}
  async function until(read:()=>Promise<boolean>){const start=Date.now();while(!await read()){if(Date.now()-start>6000)assert.fail("persistent worker did not advance");await delay(20);}}
  const checkpoint=initialObservationCheckpoint(id,body,"b".repeat(64))!;await store.submit(id,body,checkpoint);await start();await until(async()=>submitted===1);
  const originalMessage=(await store.step!(id))!.initialMessageId;
  assert.equal((await store.submit(id,body,initialObservationCheckpoint(id,body,"c".repeat(64)))).status,"running");assert.equal((await store.step!(id))!.initialMessageId,originalMessage);assert.equal((await store.step!(id))!.expectedSha256,"b".repeat(64));
  await assert.rejects(async()=>{await store!.submit(id,{...body,query:"conflicting"});},TaskConflict);
  const ordinary=randomUUID(),normal={...body,query:"把地图移动到 120.2E, 30.3N"};delete (normal as any).observationCheck;await store.submit(ordinary,normal);
  await until(async()=>(await store!.get(ordinary))?.status==="complete");assert.equal((await store.get(id))?.status,"running");
  assert.deepEqual(((await store.terminal(ordinary))!.result as any).camera.center,[120.2,30.3]);
  await stop!();stop=undefined;await store.close();store=await postgresTaskStore("runtime");obtained=result;await start();
  await until(async()=>(await store!.get(id))?.status==="complete");assert.equal(accepted,1);assert.equal(submitted,1);assert.equal(delivered,1);
  assert.deepEqual(((await store.terminal(id))!.result as any).observationCheckResult,result);
  const audit=productDatabase("RUNTIME");try{
    const references=(await audit.query("SELECT reference FROM runtime_references WHERE task_id=$1",[id])).rows;
    assert.equal(references.length,1);assert.equal(references[0].reference.evidenceLevel,"observation-file");assert.deepEqual(references[0].reference.observationEvidence,result.evidence);
  }finally{await audit.end();}
  assert.ok((await store.events(id,0)).some(row=>row.stepRecovered));assert.equal((await store.step!(id))!.initialMessageId,originalMessage);
  await stop!();stop=undefined;const savedCheckpoint=(await store.step!(id))!;
  const stoppedId=randomUUID();await store.submit(stoppedId,body,initialObservationCheckpoint(stoppedId,body,"b".repeat(64)));
  // The cancellation and checkpoint updates share the parent row lock.
  const picked=await store.claim();assert.equal(picked?.id,stoppedId);
  await store.park!(stoppedId,savedCheckpoint,Date.now()+10000);await store.finish(stoppedId,"cancelled",{code:"cancelled"});
  assert.equal(await store.park!(stoppedId,{kind:"test"},Date.now(),{shouldNotAppear:true}),false);
  assert.equal(await store.saveStep!(stoppedId,{...savedCheckpoint,result:{status:"verified",matches:false,evidence:{...result.evidence,sha256:"c".repeat(64)}}}),false);
  assert.ok(!(await store.events(stoppedId,0)).some(row=>row.shouldNotAppear));
  const indexed=productDatabase("RUNTIME");try{
    const rows=(await indexed.query("SELECT reference FROM runtime_references WHERE task_id=$1",[stoppedId])).rows;assert.equal(rows.length,1);assert.deepEqual(rows[0].reference.observationEvidence,result.evidence);
    assert.match(((await store.terminal(stoppedId))!.result as any).message,/研究已取消/);
    const emptyId=randomUUID();await store.submit(emptyId,body,initialObservationCheckpoint(emptyId,body,"b".repeat(64)));assert.equal((await store.claim())?.id,emptyId);await store.finish(emptyId,"cancelled",{code:"cancelled"});
    assert.equal(await store.saveStep!(emptyId,savedCheckpoint),false);await store.cancelStep!(emptyId,{reconciled:true},{result:savedCheckpoint.cancelledResult});
    assert.equal((await store.terminal(emptyId))!.result,undefined);assert.equal((await indexed.query("SELECT 1 FROM runtime_references WHERE task_id=$1",[emptyId])).rowCount,0);
  }finally{await indexed.end();}
});
