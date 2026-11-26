import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {once} from "node:events";
import {randomUUID} from "node:crypto";
import {setTimeout as delay} from "node:timers/promises";
import {EventSchema} from "@ag-ui/core/schemas";
import {agUiWorkbench} from "./ag-ui-workbench";
import {postgresTaskStore} from "./postgres-task-store";
import {productDatabase} from "./product-database";
import {taskStatusRoutes,TaskParked,type Payload} from "./task-store";
import {createRuntimeStep} from "./runtime-step";
import {runtimeTaskLease} from "./runtime-task-lease";
import type {RuntimeTurnInput} from "./runtime-turn-handoff";
import {nativeAgUiStepLabels} from "../src/domain/native-agui-progress";
import {emptyFilters} from "../src/domain/spatial";

const fixture=process.env.ONEEARTH_AGUI_TEST_DATABASE_URL;
const latch=()=>{let resolve!:()=>void;const promise=new Promise<void>(r=>resolve=r);return {promise,resolve};};
const result={message:"本轮只验证持久运行阶段，没有请求模型或外部来源。"};
type Control={ready:ReturnType<typeof latch>;release:ReturnType<typeof latch>;mode:"research"|"no-checkpoint"|"reply"|"held"};

async function live(response:Response){
 assert.equal(response.status,200);assert.match(response.headers.get("content-type")||"",/text\/event-stream/);
 const frames:any[]=[],reader=response.body!.getReader(),decoder=new TextDecoder();let pending="";
 const done=(async()=>{for(;;){const {value,done}=await reader.read();if(done)break;pending+=decoder.decode(value,{stream:true});for(;;){const end=pending.indexOf("\n\n");if(end<0)break;const line=pending.slice(0,end);pending=pending.slice(end+2);if(line.startsWith("data: "))frames.push(EventSchema.parse(JSON.parse(line.slice(6))));}}assert.equal(pending,"");})();
 return {frames,done};
}
function assertBalanced(frames:any[]){
 let open:string|undefined;
 for(const frame of frames){
  if(frame.type==="STEP_STARTED"){assert.equal(open,undefined);assert.ok(Object.hasOwn(nativeAgUiStepLabels,frame.stepName));open=frame.stepName;}
  if(frame.type==="STEP_FINISHED"){assert.equal(frame.stepName,open);open=undefined;}
  if(frame.type==="RUN_FINISHED"||frame.type==="RUN_ERROR")assert.equal(open,undefined);
 }
 assert.equal(open,undefined);assert.equal(frames.filter(frame=>["RUN_FINISHED","RUN_ERROR"].includes(frame.type)).length,1);
 assert.doesNotMatch(JSON.stringify(frames),/PRIVATE_|Authorization|relay|secret|providerReasoning|https:\/\/|\/Users\//);
}

test("native HTTP streams only persisted lifecycle steps across park, recovery and one original ending",{skip:!fixture,timeout:20000},async t=>{
 assert.ok(fixture);assert.match(new URL(fixture).pathname,/native_agui.*progress/);
 const original=process.env.ONEEARTH_RUNTIME_DATABASE_URL;process.env.ONEEARTH_RUNTIME_DATABASE_URL=fixture;
 const tasks=await postgresTaskStore("runtime"),other=await postgresTaskStore("runtime"),db=productDatabase("RUNTIME"),controls=new Map<string,Control>();
 const app=express();app.use(express.json());
 const native=await agUiWorkbench(app,tasks,async id=>({kind:"foreground",async run(_id,signal,emit){
  const control=controls.get(id)!;control.ready.resolve();
  emit({stage:"PRIVATE_STAGE",call:{input:"PRIVATE_INPUT",output:"PRIVATE_OUTPUT"},providerReasoning:[{text:"PRIVATE_THOUGHT"}]});
  await Promise.race([control.release.promise,new Promise<never>((_resolve,reject)=>{if(signal.aborted)reject(signal.reason);else signal.addEventListener("abort",()=>reject(signal.reason),{once:true});})]);
  signal.throwIfAborted();
  if(control.mode==="reply")return {kind:"reply",payload:{result}};
  return {kind:"research",handoff:{kind:"controlled-no-model"},...(control.mode==="no-checkpoint"?{}:{checkpoint:{kind:"controlled-checkpoint"}})};
 }}));
 taskStatusRoutes(app,"/api/tasks",tasks,{researchRecords:true,chatIdentity:true,onCancelled:id=>native.cancel(id)});
 const server=app.listen(0,"127.0.0.1");await once(server,"listening");const address=server.address();assert.ok(address&&typeof address!=="string");const origin="http://127.0.0.1:"+address.port;
 t.after(async()=>{for(const c of controls.values())c.release.resolve();await native.close();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await other.close();await tasks.close();await db.end();if(original===undefined)delete process.env.ONEEARTH_RUNTIME_DATABASE_URL;else process.env.ONEEARTH_RUNTIME_DATABASE_URL=original;});
 async function until(check:()=>boolean|Promise<boolean>){for(let i=0;i<200;i++){if(await check())return;await delay(5);}assert.fail("controlled original lifecycle did not advance");}
 async function begin(mode:Control["mode"]="research"){
  const id=randomUUID(),threadId=randomUUID(),turnId=randomUUID(),control={mode,ready:latch(),release:latch()};controls.set(id,control);
  const input={protocolVersion:"1.0",runId:id,threadId,messages:[{id:turnId,role:"user",content:"核对原任务的阶段状态。"}],tools:[],context:[],state:{},forwardedProps:{oneearth:{version:1,submission:{context:{filters:emptyFilters(),caseId:null,selection:null,citation:null,gridSystem:"h3",layer:"all",camera:{center:[0,0],zoom:1,reason:"controlled"}},config:{executor:"codex",model:"gpt-6-luna"}}}}};
  const stream=await live(await fetch(origin+"/api/ag-ui",{method:"POST",headers:{"Content-Type":"application/json",Accept:"text/event-stream"},body:JSON.stringify(input)}));await control.ready.promise;
  await until(()=>stream.frames.some(frame=>frame.type==="STEP_STARTED"&&frame.stepName==="foreground"));assert.equal((await tasks.get(id))?.status,"running");assert.equal(stream.frames[0].type,"RUN_STARTED");
  return {id,threadId,turnId,control,stream};
 }
 async function queued(run:Awaited<ReturnType<typeof begin>>){run.control.release.resolve();await until(()=>run.stream.frames.some(frame=>frame.type==="STEP_STARTED"&&frame.stepName==="research-queued"));assert.equal((await tasks.get(run.id))?.status,"queued");}
 async function claim(id:string){const claimed=await tasks.claim();assert.equal(claimed?.id,id);assert.ok(claimed.lease);return claimed as typeof claimed&{body:RuntimeTurnInput};}
 const first=await begin();await queued(first);let selected=await claim(first.id);await until(()=>first.stream.frames.some(frame=>frame.stepName==="research-executing"));
 // Each waiting state is persisted by RuntimeStep.park, which releases the
 // claimed lease; the standard STEP remains open while the task is parked.
 for(const operation of ["discover","read","discover"] as const){
  await runtimeTaskLease.run(selected.lease,async()=>{const step=await createRuntimeStep(tasks,first.id,selected.body,selected.checkpoint,new AbortController().signal,()=>{});await assert.rejects(step.park("waiting-discovery",operation),TaskParked);});
  const name=operation==="read"?"source-read-wait":"discovery-wait";await until(()=>first.stream.frames.at(-1)?.type==="STEP_STARTED"&&first.stream.frames.at(-1)?.stepName===name);
  const count=(await tasks.chat.agUiEvents(first.id)).length;await Promise.all([tasks.append(first.id,{runtimePhase:{phase:"waiting-discovery",operation},stage:"PRIVATE_WAIT"}),other.append(first.id,{runtimePhase:{phase:"waiting-discovery",operation}})]);assert.equal((await tasks.chat.agUiEvents(first.id)).length,count);
  const saved=await tasks.step!(first.id);await tasks.park!(first.id,saved!,Date.now(),{runtimePhase:{phase:"waiting-discovery",operation}});selected=await claim(first.id);await until(()=>first.stream.frames.at(-1)?.type==="STEP_STARTED"&&first.stream.frames.at(-1)?.stepName==="research-resuming");
 }
 // A genuinely expired checkpoint is recoverable; repeated maintenance and
 // the following claim do not duplicate the same already-open resuming STEP.
 await db.query("UPDATE runtime_tasks SET lease_until=0 WHERE id=$1",[first.id]);const before=(await tasks.chat.agUiEvents(first.id)).length;await other.recoverInterrupted();await other.recoverInterrupted();assert.equal((await tasks.chat.agUiEvents(first.id)).length,before);assert.equal(await runtimeTaskLease.run(selected.lease,()=>tasks.finish(first.id,"complete",{result})),false);
 selected=await claim(first.id);assert.equal(await runtimeTaskLease.run(selected.lease,()=>tasks.finish(first.id,"complete",{result})),true);await first.stream.done;assertBalanced(first.stream.frames);
 const starts=first.stream.frames.filter(frame=>frame.type==="STEP_STARTED").map(frame=>frame.stepName);assert.deepEqual(starts,["foreground","research-queued","research-executing","discovery-wait","research-resuming","source-read-wait","research-resuming","discovery-wait","research-resuming"]);
 assert.deepEqual((await tasks.terminal(first.id))?.result,result);assert.equal(await tasks.chat.latestCompleted(first.threadId),first.id);const archive=await(await fetch(origin+"/api/tasks/"+first.id+"/record")).json();assert.equal(archive.id,first.id);assert.equal(archive.turnId,first.turnId);assert.deepEqual(archive.result,result);
 assert.equal((await db.query("SELECT public_step FROM runtime_agui_runs WHERE id=$1",[first.id])).rows[0].public_step,null);const settled=(await tasks.chat.agUiEvents(first.id)).length;await tasks.append(first.id,{runtimePhase:{phase:"executing"}});await tasks.chat.append(first.id,{chatPhase:"foreground"});assert.equal(await tasks.finish(first.id,"failed",{error:"PRIVATE_LATE"}),false);assert.equal((await tasks.chat.agUiEvents(first.id)).length,settled);
 // Business failure closes the source-read wait, but no private error/stage
 // or tool/model content is emitted as a standard progress field.
 const failed=await begin();await queued(failed);const failedClaim=await claim(failed.id);await runtimeTaskLease.run(failedClaim.lease,()=>tasks.park!(failed.id,{kind:"controlled-checkpoint"},Date.now()+10000,{runtimePhase:{phase:"waiting-discovery",operation:"read"},stage:"PRIVATE_READ"}));await until(()=>failed.stream.frames.at(-1)?.stepName==="source-read-wait");await tasks.finish(failed.id,"failed",{error:"PRIVATE_INTERNAL_FAILURE",code:"controlled_failure"});await failed.stream.done;assertBalanced(failed.stream.frames);assert.equal(failed.stream.frames.at(-1).type,"RUN_ERROR");assert.equal((await tasks.terminal(failed.id))?.code,"controlled_failure");
 // DELETE has one original ending. Late remote-stop rows never reopen STEP,
 // replace the business terminal or add another standard ending.
 const cancelled=await begin();await queued(cancelled);const cancelClaim=await claim(cancelled.id),remote=randomUUID();await runtimeTaskLease.run(cancelClaim.lease,async()=>{await tasks.append(cancelled.id,{discoveryBinding:{transport:"a2a",messageId:cancelled.id,discoveryId:remote,state:"TASK_STATE_WORKING"}});await tasks.park!(cancelled.id,{kind:"controlled-checkpoint"},Date.now()+10000,{runtimePhase:{phase:"waiting-discovery",operation:"discover"}});});
 await until(()=>cancelled.stream.frames.at(-1)?.stepName==="discovery-wait");assert.equal((await fetch(origin+"/api/tasks/"+cancelled.id,{method:"DELETE"})).status,204);await cancelled.stream.done;assertBalanced(cancelled.stream.frames);assert.deepEqual(cancelled.stream.frames.at(-1).outcome,{type:"cancelled"});const terminal=await tasks.terminal(cancelled.id),publicCount=(await tasks.chat.agUiEvents(cancelled.id)).length;assert.equal((await tasks.runtimeStatus!(cancelled.id)).remoteStop?.state,"pending");await tasks.recordRemoteStop!(cancelled.id,{discoveryTaskId:remote,state:"confirmed",remoteState:"TASK_STATE_CANCELED"});assert.deepEqual(await tasks.terminal(cancelled.id),terminal);assert.equal((await tasks.chat.agUiEvents(cancelled.id)).length,publicCount);assert.equal((await tasks.runtimeStatus!(first.id)).remoteStop,undefined);
 // The old early-interruption branch has no checkpoint to resume. Its exact
 // failed business update must also close the native stream in that transaction.
 const interrupted=await begin("no-checkpoint");await queued(interrupted);await claim(interrupted.id);await until(()=>interrupted.stream.frames.at(-1)?.stepName==="research-executing");await db.query("UPDATE runtime_tasks SET lease_until=0 WHERE id=$1",[interrupted.id]);await other.recoverInterrupted();await Promise.race([interrupted.stream.done,delay(1500).then(()=>assert.fail("failed original native stream remained open"))]);assertBalanced(interrupted.stream.frames);assert.equal(interrupted.stream.frames.at(-1).type,"RUN_ERROR");assert.equal(interrupted.stream.frames.at(-1).code,"worker_interrupted");assert.equal((await tasks.get(interrupted.id))?.status,"failed");assert.equal((await tasks.terminal(interrupted.id))?.code,"worker_interrupted");const ended=(await tasks.chat.agUiEvents(interrupted.id)).length;await other.recoverInterrupted();assert.equal((await tasks.chat.agUiEvents(interrupted.id)).length,ended);
 // Foreground-only replies retain the same native message and one closed STEP.
 const ordinary=await begin("reply");ordinary.control.release.resolve();await ordinary.stream.done;assertBalanced(ordinary.stream.frames);assert.deepEqual(ordinary.stream.frames.filter(frame=>frame.type.startsWith("STEP_")).map(frame=>[frame.type,frame.stepName]),[["STEP_STARTED","foreground"],["STEP_FINISHED","foreground"]]);
 // Concurrent original runs retain independent phase slots and streams.
 const foreground=await begin("reply"),background=await begin();await queued(background);const parallel=await claim(background.id);await runtimeTaskLease.run(parallel.lease,()=>tasks.park!(background.id,{kind:"controlled-checkpoint"},Date.now()+10000,{runtimePhase:{phase:"waiting-discovery",operation:"read"}}));await until(()=>background.stream.frames.at(-1)?.stepName==="source-read-wait");assert.deepEqual(foreground.stream.frames.filter(frame=>frame.type.startsWith("STEP_")).map(frame=>[frame.type,frame.stepName]),[["STEP_STARTED","foreground"]]);foreground.control.release.resolve();await foreground.stream.done;await tasks.finish(background.id,"failed",{error:"PRIVATE_PARALLEL",code:"controlled_failure"});await background.stream.done;assertBalanced(foreground.stream.frames);assertBalanced(background.stream.frames);
 // Namespace compatibility: a legacy non-native task has no AG-UI run to
 // project into, and its original queue/terminal behavior stays unchanged.
 const legacy=randomUUID();await tasks.submit(legacy,{query:"legacy controlled",conversationId:randomUUID(),turnId:randomUUID()});await claim(legacy);await tasks.finish(legacy,"complete",{result});assert.deepEqual(await tasks.chat.agUiEvents(legacy),[]);
 // Foreground interruption takes the original Chat finish transaction too.
 const interruptedChat=await begin("held");await native.close();await interruptedChat.stream.done;assertBalanced(interruptedChat.stream.frames);assert.equal(interruptedChat.stream.frames.at(-1).type,"RUN_ERROR");assert.equal((await tasks.get(interruptedChat.id))?.status,"failed");
 console.log(JSON.stringify({fixedSixNames:true,concurrentRunIsolation:true,foregroundInterruptionClosed:true,onlineParkedDiscoverAndRead:true,phaseDedupeAndReentry:true,sameRunAndTurn:true,expiredCheckpointResuming:true,staleFenceNoProgress:true,earlyInterruptionClosedStream:true,lateRemoteStopNoPublicFrames:true,businessLatestPreserved:true,models:0,externalRequests:0}));
});
