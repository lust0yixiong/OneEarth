import test from "node:test";
import assert from "node:assert/strict";
import {execFileSync,spawn} from "node:child_process";
import {once} from "node:events";
import express from "express";
import {reconcileRuntimeStops} from "./runtime-step";
import {mkdtempSync,rmSync} from "node:fs";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {postgresTaskStore} from "./postgres-task-store";
import {productDatabase} from "./product-database";
import {createRuntimeModelCapacity,ModelCapacityUnavailable} from "./runtime-model-capacity";
import {runtimeTaskLease} from "./runtime-task-lease";

const bin=process.env.ONEEARTH_A2A_TEST_PG_BIN,fixture=process.env.ONEEARTH_RUNTIME_TEST_DATABASE_URL;
test("independent runtime processes share model reservations and task claims are fenced across cancellation and expiry",{skip:!bin&&!fixture&&"set ONEEARTH_RUNTIME_TEST_DATABASE_URL or ONEEARTH_A2A_TEST_PG_BIN",timeout:45000},async t=>{
 const dir=mkdtempSync("/tmp/oe-runtime-lease-"),data=path.join(dir,"pg"),old=process.env.ONEEARTH_RUNTIME_DATABASE_URL;
 const pg=(name:string,args:string[])=>execFileSync(path.join(bin!,name),args,{stdio:"pipe"});let started=false;
 if(!fixture){assert.ok(bin);pg("initdb",["-D",data,"-U","oneearth_fixture","-A","trust","--no-locale","--encoding=UTF8"]);pg("pg_ctl",["-D",data,"-l",path.join(dir,"pg.log"),"-o",'-c listen_addresses= -k "'+dir+'"',"-w","start"]);started=true;}
 process.env.ONEEARTH_RUNTIME_DATABASE_URL=fixture??"postgresql://oneearth_fixture@localhost/postgres?host="+encodeURIComponent(dir);
 const a=await postgresTaskStore("runtime"),b=await postgresTaskStore("runtime"),audit=productDatabase("RUNTIME");
 if(fixture){await audit.query("TRUNCATE runtime_tasks,runtime_chat_messages CASCADE");await audit.query("DROP TABLE IF EXISTS runtime_model_slots");}
 t.after(async()=>{await a.close();await b.close();await audit.end();if(old===undefined)delete process.env.ONEEARTH_RUNTIME_DATABASE_URL;else process.env.ONEEARTH_RUNTIME_DATABASE_URL=old;if(started)pg("pg_ctl",["-D",data,"-m","fast","-w","stop"]);rmSync(dir,{recursive:true,force:true});});
 await Promise.all([a.recoverInterrupted(),b.recoverInterrupted()]);
 const capacity=await createRuntimeModelCapacity(audit,{total:3,foreground:1}),one=await capacity.acquire("background"),two=await capacity.acquire("background");
 await assert.rejects(capacity.acquire("background"),ModelCapacityUnavailable);
 const child=`import {productDatabase} from ${JSON.stringify(new URL('./product-database.ts',import.meta.url).href)};import {createRuntimeModelCapacity,ModelCapacityUnavailable} from ${JSON.stringify(new URL('./runtime-model-capacity.ts',import.meta.url).href)};const pool=productDatabase('RUNTIME');try{const capacity=await createRuntimeModelCapacity(pool,{total:3,foreground:1});try{const lease=await capacity.acquire('background');await lease.release();console.log('UNEXPECTED');}catch(error){if(!(error instanceof ModelCapacityUnavailable))throw error;console.log('BLOCKED');}}finally{await pool.end();}`;
 assert.match(execFileSync(process.execPath,["--import","tsx","--input-type=module","-e",child],{env:{...process.env},encoding:"utf8"}),/BLOCKED/);
 const foreground=await capacity.acquire("foreground");await assert.rejects(capacity.acquire("foreground"),ModelCapacityUnavailable);
 assert.equal(Number((await audit.query("SELECT count(*) AS n FROM runtime_model_slots WHERE lease_until>0")).rows[0].n),3);
 await one.release();const again=await capacity.acquire("background");await Promise.all([two.release(),foreground.release(),again.release()]);
 // Expired time alone never proves a paused process or orphan CLI is gone.
 const liveA=await capacity.acquire("background"),liveB=await capacity.acquire("background");
 const held=spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore"});await once(held,"spawn");held.kill("SIGSTOP");
 await audit.query("UPDATE runtime_model_slots SET lease_until=0,owner_pid=$1,child_pid=NULL WHERE owner IS NOT NULL AND role='background'",[held.pid]);
 await assert.rejects(capacity.acquire("background"),ModelCapacityUnavailable);
 held.kill("SIGKILL");await once(held,"exit");
 const reclaimed=await capacity.acquire("background");await reclaimed.release();await liveA.release();await liveB.release();
 const orphan=spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore"});await once(orphan,"spawn");
 const orphanLease=await capacity.acquire("background"),blockedLease=await capacity.acquire("background");await orphanLease.attachProcess(orphan.pid!);
 await audit.query("UPDATE runtime_model_slots SET lease_until=0,owner_pid=2147483647 WHERE child_pid=$1",[orphan.pid]);
 await assert.rejects(capacity.acquire("background"),ModelCapacityUnavailable);
 orphan.kill("SIGKILL");await once(orphan,"exit");const afterOrphan=await capacity.acquire("background");await afterOrphan.release();await orphanLease.release();await blockedLease.release();
 const id=randomUUID();await a.submit(id,{query:"same authorized input"},{kind:"controlled-step",value:0});const first=await a.claim();assert.equal(first?.id,id);assert.ok(first.lease);
 assert.equal(await b.claim(),undefined);await runtimeTaskLease.run(first.lease,()=>a.saveStep!(id,{kind:"controlled-step",value:1}));
 await audit.query("UPDATE runtime_tasks SET lease_until=0 WHERE id=$1",[id]);await b.recoverInterrupted();const resumed=await b.claim();assert.equal(resumed?.id,id);assert.ok(resumed.lease);assert.ok(resumed.lease.fence>first.lease.fence);
 await runtimeTaskLease.run(first.lease,async()=>{await a.append(id,{staleOwner:true});assert.equal(await a.saveStep!(id,{kind:"bad"}),false);assert.equal(await a.park!(id,{kind:"bad"},Date.now()),false);assert.equal(await a.finish(id,"complete",{result:{message:"stale"}}),false);});
 assert.equal(await a.renewLease!(first.lease),false);await a.releaseLease!(first.lease);assert.equal(await b.renewLease!(resumed.lease),true);
 await runtimeTaskLease.run(resumed.lease,()=>b.append(id,{discoveryBinding:{discoveryId:"remote-one",messageId:id,state:"TASK_STATE_WORKING"}}));
 await runtimeTaskLease.run(resumed.lease,()=>b.append(id,{sourceReadBinding:{discoveryId:"remote-two",messageId:randomUUID(),state:"TASK_STATE_WORKING"}}));
 assert.equal(await a.finish(id,"cancelled",{error:"任务已取消。",code:"cancelled"}),true);
 assert.equal(await runtimeTaskLease.run(resumed.lease,()=>b.finish(id,"complete",{result:{message:"late"}})),false);assert.equal((await a.get(id))?.status,"cancelled");assert.ok(!(await a.events(id,0)).some(e=>e.staleOwner));
 const terminal=JSON.stringify(await a.terminal(id));assert.equal((await a.runtimeStatus!(id)).remoteStop?.state,"pending");
 assert.equal(await a.recordRemoteStop!(id,{discoveryTaskId:"remote-one",state:"confirmed",remoteState:"TASK_STATE_CANCELED"}),true);
 const eventCount=(await a.events(id,0)).length;
 assert.equal(await a.recordRemoteStop!(id,{discoveryTaskId:"remote-one",state:"unconfirmed"}),false);assert.equal((await a.events(id,0)).length,eventCount);
 assert.equal((await a.runtimeStatus!(id)).remoteStop?.discoveryTaskId,"remote-two");
 assert.equal(await a.recordRemoteStop!(id,{discoveryTaskId:"remote-two",state:"unconfirmed"}),true);assert.equal((await a.runtimeStatus!(id)).remoteStop?.state,"unconfirmed");assert.equal(JSON.stringify(await a.terminal(id)),terminal);
 const ids=[randomUUID(),randomUUID(),randomUUID()];for(const id of ids)await a.submit(id,{query:id},{kind:"controlled-step"});
 const x=await a.claim(),y=await b.claim();assert.ok(x?.lease&&y?.lease);assert.equal(await a.claim(),undefined);
 await runtimeTaskLease.run(x.lease,()=>a.park!(x.id,{kind:"controlled-step"},Date.now()+10000,{runtimePhase:{phase:"waiting-discovery"}}));assert.equal((await a.claim())?.id,ids[2]);
 for(const pending of ids)await a.finish(pending,"cancelled",{error:"fixture cleanup",code:"cancelled"});
 // Both real PG clients observe the same pending stop, but only one owns HTTP reconciliation.
 const stopId=randomUUID(),remote=randomUUID(),oldDiscovery=process.env.ONEEARTH_DISCOVERY_URL;
 await a.submit(stopId,{query:"controlled cancellation"});const stoppedClaim=await a.claim();assert.equal(stoppedClaim?.id,stopId);assert.ok(stoppedClaim.lease);
 await runtimeTaskLease.run(stoppedClaim.lease,()=>a.append(stopId,{discoveryBinding:{discoveryId:remote,messageId:stopId,state:"TASK_STATE_WORKING"}}));
 await a.finish(stopId,"cancelled",{error:"任务已取消。",code:"cancelled"});const originalTerminal=JSON.stringify(await a.terminal(stopId));let cancelCalls=0;
 const app=express(),snapshot=()=>({id:remote,status:{state:cancelCalls?"TASK_STATE_CANCELED":"TASK_STATE_WORKING"},artifacts:[]});
 app.get("/tasks/:id",async(_req,res)=>{await new Promise(resolve=>setTimeout(resolve,40));res.json(snapshot());});
 app.post("/tasks/:id\\:cancel",(_req,res)=>{cancelCalls++;res.json(snapshot());});const server=app.listen(0,"127.0.0.1");await once(server,"listening");const address=server.address();assert.ok(address&&typeof address!=="string");process.env.ONEEARTH_DISCOVERY_URL="http://127.0.0.1:"+address.port;
 try{await Promise.all([reconcileRuntimeStops(a),reconcileRuntimeStops(b)]);assert.equal(cancelCalls,1);assert.equal((await a.runtimeStatus!(stopId)).remoteStop?.state,"confirmed");assert.equal(JSON.stringify(await a.terminal(stopId)),originalTerminal);}
 finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));if(oldDiscovery===undefined)delete process.env.ONEEARTH_DISCOVERY_URL;else process.env.ONEEARTH_DISCOVERY_URL=oldDiscovery;}
 console.log(JSON.stringify({expiredLiveProcessNotReclaimed:true,orphanChildNotReclaimed:true,parallelStopSingleRequest:true,runtimeModelSlots:3,foregroundReserved:1,backgroundSlots:2,independentProcessBlocked:true,staleFenceRejected:true,cancelFinishAtomic:true,parkReleasedSlot:true}));
});
