import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {once} from "node:events";
import {randomUUID,createHash} from "node:crypto";
import {mkdtemp,writeFile,readFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {EventSchema} from "@ag-ui/core/schemas";
import {agUiWorkbench} from "./ag-ui-workbench";
import {postgresTaskStore} from "./postgres-task-store";
import {productDatabase} from "./product-database";
import {taskStatusRoutes,type Payload} from "./task-store";
import {ProviderReasoningObserver,providerReasoningArchive,providerReasoningLimits} from "./provider-reasoning";
import {prepareRuntimeChat} from "./runtime-chat-turn";
import {runtimeTurnContext} from "./runtime-turn-context";
import {runtimeTaskLease} from "./runtime-task-lease";
import {closeRuntimeModelCapacity} from "./runtime-model-capacity";
import {isNativeAgUiSummaryId,nativeAgUiSummaryPrefix} from "../src/domain/native-agui-summary";
import {emptyFilters} from "../src/domain/spatial";
import type {RuntimeServices} from "./runtime-turn";
import type {RuntimeTurnInput} from "./runtime-turn-handoff";

const fixture=process.env.ONEEARTH_AGUI_TEST_DATABASE_URL;
const latch=()=>{let resolve!:()=>void;const promise=new Promise<void>(r=>resolve=r);return {promise,resolve};};
const visible="PUBLIC_SUMMARY_ONLY 本轮仅整理已给条件，保留资料边界。";
const snapshot=(taskId:string,key:string,text=visible)=>({id:taskId+":"+key,revision:1,kind:"summary",text,complete:true});
const frame=(type:string,sequence_number:number,extra:Record<string,unknown>={},name=type)=>Buffer.from("event: "+name+"\ndata: "+JSON.stringify({type,sequence_number,item_id:"fixture",output_index:0,summary_index:0,content_index:0,...extra})+"\n\n");
type Mode="complete"|"failed"|"cancelled"|"research"|"production"|"raw-only"|"terminal-only";
type Control={mode:Mode;ready:ReturnType<typeof latch>;release:ReturnType<typeof latch>};

function paired(frames:any[],taskId:string){
 const summaries=frames.filter(frame=>frame.type.startsWith("REASONING_"));assert.equal(summaries.length%5,0);
 for(let i=0;i<summaries.length;i+=5){const group=summaries.slice(i,i+5),id=group[0].messageId;assert.ok(isNativeAgUiSummaryId(taskId,id));assert.deepEqual(group.map(event=>event.type),["REASONING_START","REASONING_MESSAGE_START","REASONING_MESSAGE_CONTENT","REASONING_MESSAGE_END","REASONING_END"]);assert.ok(group.every(event=>event.messageId===id));assert.equal(group[1].role,"reasoning");assert.ok(group.every(event=>event.rawEvent===undefined));}
 assert.doesNotMatch(JSON.stringify(summaries),/RAW_THINKING|PRIVATE_|OPAQUE_|WRONG_MARKER|CONTROLLED_|stale-not-public|new-value-must-not-replace/);
}
async function live(response:Response){
 assert.equal(response.status,200);const reader=response.body!.getReader(),decoder=new TextDecoder(),frames:any[]=[];let pending="";
 const done=(async()=>{for(;;){const {value,done}=await reader.read();if(done)break;pending+=decoder.decode(value,{stream:true});for(;;){const end=pending.indexOf("\n\n");if(end<0)break;const line=pending.slice(0,end);pending=pending.slice(end+2);if(line.startsWith("data: "))frames.push(EventSchema.parse(JSON.parse(line.slice(6))));}}})();return {frames,done};
}

test("persisted explicit summaries alone produce paired native reasoning, dedupe and caps without entering model history",{skip:!fixture,timeout:25000},async t=>{
 assert.ok(fixture);assert.match(new URL(fixture).pathname,/native_agui.*progress/);
 const old={runtime:process.env.ONEEARTH_RUNTIME_DATABASE_URL,path:process.env.PATH};process.env.ONEEARTH_RUNTIME_DATABASE_URL=fixture;
 const dir=await mkdtemp(path.join(tmpdir(),"oe-native-summary-")),stdin=path.join(dir,"stdin"),calls=path.join(dir,"calls");
 await writeFile(path.join(dir,"codex"),`#!${process.execPath}\nimport fs from 'node:fs';let p='';for await(const b of process.stdin)p+=b;fs.appendFileSync(${JSON.stringify(stdin)},JSON.stringify(p)+'\\n');fs.appendFileSync(${JSON.stringify(calls)},'call\\n');process.stdout.write(JSON.stringify({decide:{kind:'respond',reply:'仅依据本轮用户问题说明。',targets:[]}}));`,{mode:0o700});process.env.PATH=dir+path.delimiter+(old.path||"");
 const tasks=await postgresTaskStore("runtime"),other=await postgresTaskStore("runtime"),db=productDatabase("RUNTIME"),controls=new Map<string,Control>();
 const services={tasks,push:{latest:()=>({records:[]})},coverage:async()=>undefined,researchRegionService:{locate:async()=>null},adminBoundaryDir:dir,canonicalCache:new Map()} as unknown as RuntimeServices;
 const app=express();app.use(express.json());const native=await agUiWorkbench(app,tasks,async(id,body)=>{
  const control=controls.get(id)!;
  if(control.mode==="production")return prepareRuntimeChat(services,id,body,id=>tasks.chat.latestCompleted(id),{publicAnswer:true});
  return {kind:"foreground",async run(_id,signal,emit){
   const archive=providerReasoningArchive(id,[],value=>emit({providerReasoning:value})),observer=new ProviderReasoningObserver(id+":attempt",value=>archive.accept(value));
   if(control.mode!=="research"&&control.mode!=="terminal-only"){
    observer.feed(frame("response.output_item.added",0,{item:{type:"reasoning",encrypted_content:"OPAQUE_NOT_PUBLIC",content:[{text:"PRIVATE_ITEM_NOT_PUBLIC"}]}}));
    observer.feed(frame("response.reasoning_summary_text.done",1,{text:"WRONG_MARKER_NOT_PUBLIC"},"response.reasoning_text.done"));
    observer.feed(frame("response.reasoning_summary_part.done",2,{part:{type:"opaque",text:"PRIVATE_OPAQUE_PART"},text:"PRIVATE_FALLBACK_NOT_PUBLIC"}));
    observer.feed(frame("response.reasoning_summary_part.done",3,{text:"PRIVATE_MISSING_PART"}));
    observer.feed(frame("response.reasoning_text.done",4,{text:"RAW_THINKING_NOT_PUBLIC"}));
    if(control.mode!=="raw-only"){observer.feed(frame("response.reasoning_summary_text.delta",5,{delta:visible}));observer.feed(frame("response.reasoning_summary_text.done",6,{text:visible}));}
   }
   observer.close();control.ready.resolve();await Promise.race([control.release.promise,new Promise<never>((_r,reject)=>signal.addEventListener("abort",()=>reject(signal.reason),{once:true}))]);signal.throwIfAborted();
   if(control.mode==="failed")throw Error("PRIVATE_RUN_FAILURE");
   if(control.mode==="research")return {kind:"research",handoff:{kind:"controlled-no-model"},checkpoint:{kind:"controlled-checkpoint"}};
   return {kind:"reply",payload:{result:{message:"本轮公开答复。",runTrace:{started:Date.now(),stages:[],calls:[],providerReasoning:control.mode==="terminal-only"?[snapshot(id,"terminal-only")]:archive.values}}}};
  }};
 });taskStatusRoutes(app,"/api/tasks",tasks,{researchRecords:true,chatIdentity:true,onCancelled:id=>native.cancel(id)});
 const server=app.listen(0,"127.0.0.1");await once(server,"listening");const address=server.address();assert.ok(address&&typeof address!=="string");const origin="http://127.0.0.1:"+address.port;
 t.after(async()=>{for(const c of controls.values())c.release.resolve();await native.close();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await other.close();await tasks.close();await db.end();await closeRuntimeModelCapacity();if(old.runtime===undefined)delete process.env.ONEEARTH_RUNTIME_DATABASE_URL;else process.env.ONEEARTH_RUNTIME_DATABASE_URL=old.runtime;if(old.path===undefined)delete process.env.PATH;else process.env.PATH=old.path;await rm(dir,{recursive:true,force:true});});
 const context={filters:emptyFilters(),caseId:null,selection:null,citation:null,gridSystem:"h3",layer:"all",camera:{center:[0,0],zoom:1,reason:"controlled"}},config={executor:"codex",model:"gpt-6-luna"};
 async function until(check:()=>boolean|Promise<boolean>){for(let i=0;i<300;i++){if(await check())return;await new Promise(r=>setTimeout(r,5));}assert.fail("original summary did not become durable");}
 async function begin(mode:Mode="complete",threadId=randomUUID(),previousTaskId?:string,messages:any[]=[]){const id=randomUUID(),control={mode,ready:latch(),release:latch()};controls.set(id,control);const wire={protocolVersion:"1.0",runId:id,threadId,messages:[...messages,{id:randomUUID(),role:"user",content:"说明本轮任务。"}],tools:[],context:[],state:{},forwardedProps:{oneearth:{version:1,submission:{context,config,...(previousTaskId?{previousTaskId}:{})}}}};
  const stream=await live(await fetch(origin+"/api/ag-ui",{method:"POST",headers:{"Content-Type":"application/json",Accept:"text/event-stream"},body:JSON.stringify(wire)}));if(mode!=="production")await control.ready.promise;return {id,threadId,control,stream};}
 const first=await begin();await until(()=>first.stream.frames.some(event=>event.type==="REASONING_END"));paired(first.stream.frames,first.id);assert.equal(first.stream.frames.some(event=>event.type==="RUN_FINISHED"),false);assert.equal((await tasks.get(first.id))?.status,"running");
 const publicId=first.stream.frames.find(event=>event.type==="REASONING_START").messageId;assert.equal(publicId,nativeAgUiSummaryPrefix(first.id)+createHash("sha256").update(first.id+":attempt:1:0").digest("hex").slice(0,24));assert.equal(first.stream.frames.find(event=>event.type==="REASONING_MESSAGE_CONTENT").delta,visible);
 let count=(await tasks.chat.agUiEvents(first.id)).length;
 const sameId=first.id+":attempt:1:0";
 for(const providerReasoning of [{...snapshot(first.id,"unused"),id:sameId,revision:2},{...snapshot(first.id,"unused","new-value-must-not-replace"),id:sameId,revision:3},snapshot(randomUUID(),"foreign"),{...snapshot(first.id,"private"),private:true},{...snapshot(first.id,"opaque"),encryptedValue:"OPAQUE_NOT_PUBLIC"},{...snapshot(first.id,"raw"),kind:"deepseek-thinking"},{...snapshot(first.id,"partial"),complete:false},{...snapshot(first.id,"truncated"),truncated:true},{...snapshot(first.id,"large"),text:"x".repeat(providerReasoningLimits.textBytes+1)}])await tasks.chat.append(first.id,{providerReasoning});
 assert.equal((await tasks.chat.agUiEvents(first.id)).length,count);
 // Same ID partial and stale revisions cannot be independently promoted.
 const prior=snapshot(first.id,"revision-guard");await tasks.chat.append(first.id,{providerReasoning:{...prior,revision:2,complete:false}});for(const revision of [1,2])await tasks.chat.append(first.id,{providerReasoning:{...prior,revision,text:"stale-not-public"}});assert.equal((await tasks.chat.agUiEvents(first.id)).length,count);await tasks.chat.append(first.id,{providerReasoning:{...prior,revision:3}});count+=5;assert.equal((await tasks.chat.agUiEvents(first.id)).length,count);
 // Two PG clients race different completed revisions. One first stable value.
 const concurrent=snapshot(first.id,"concurrent"),before=count;await Promise.all([tasks.chat.append(first.id,{providerReasoning:concurrent}),other.chat.append(first.id,{providerReasoning:{...concurrent,revision:2}})]);count+=5;assert.equal((await tasks.chat.agUiEvents(first.id)).length,before+5);
 // Reuse the original filter for a signed/private locator; raw row is retained,
 // while only its cleaned high-level public summary becomes a native message.
 await tasks.chat.append(first.id,{providerReasoning:snapshot(first.id,"safe-boundary","PUBLIC_SUMMARY_ONLY 链接 https://example.org/a?id=2&amp;amp;sig=CONTROLLED_SIGNATURE，Authorization: Bearer CONTROLLED_BEARER /private/var/fixture/a.pdf")});count+=5;assert.equal((await tasks.chat.agUiEvents(first.id)).length,count);
 for(let i=0;i<15;i++)await tasks.chat.append(first.id,{providerReasoning:snapshot(first.id,"cap:"+i,("PUBLIC_SUMMARY_ONLY cap"+i+" ").padEnd(providerReasoningLimits.textBytes,"a"))});
 const summaries=(await tasks.chat.agUiEvents(first.id)).map(row=>row.event).filter(event=>event.type==="REASONING_MESSAGE_CONTENT");assert.equal(summaries.length,providerReasoningLimits.snapshots);assert.ok(summaries.reduce((sum,event)=>sum+Buffer.byteLength(String(event.delta)),0)<=providerReasoningLimits.totalBytes);
 const second=await begin();await until(()=>second.stream.frames.some(event=>event.type==="REASONING_END"));const firstCount=(await tasks.chat.agUiEvents(first.id)).length;await tasks.chat.append(first.id,{providerReasoning:snapshot(second.id,"foreign-other-run")});assert.equal((await tasks.chat.agUiEvents(first.id)).length,firstCount);second.control.release.resolve();await second.stream.done;paired(second.stream.frames,second.id);
 first.control.release.resolve();await first.stream.done;paired(first.stream.frames,first.id);assert.equal(first.stream.frames.at(-1).type,"RUN_FINISHED");assert.equal(first.stream.frames.filter(event=>event.type==="REASONING_START").length,12);
 const archived=await(await fetch(origin+"/api/tasks/"+first.id+"/record")).json();assert.ok(archived.result.runTrace.providerReasoning.some((value:any)=>value.kind==="deepseek-thinking"));assert.ok(archived.result.runTrace.providerReasoning.some((value:any)=>value.kind==="summary"&&value.complete));assert.equal(first.stream.frames.at(-1).result.oneearth.response.runTrace,undefined);
 const closed=(await tasks.chat.agUiEvents(first.id)).length;await tasks.chat.append(first.id,{providerReasoning:snapshot(first.id,"late")});assert.equal((await tasks.chat.agUiEvents(first.id)).length,closed);
 for(const mode of ["failed","cancelled"] as const){const run=await begin(mode);await until(()=>run.stream.frames.some(event=>event.type==="REASONING_END"));if(mode==="cancelled")assert.equal((await fetch(origin+"/api/tasks/"+run.id,{method:"DELETE"})).status,204);else run.control.release.resolve();await run.stream.done;paired(run.stream.frames,run.id);assert.equal(run.stream.frames.filter(event=>["RUN_ERROR","RUN_FINISHED"].includes(event.type)).length,1);assert.equal(run.stream.frames.at(-1).type,mode==="failed"?"RUN_ERROR":"RUN_FINISHED");}
 // Raw-only producers have no native summary; a summary first appearing
 // only in a final archive is never replayed as a live notification.
 for(const mode of ["raw-only","terminal-only"] as const){const run=await begin(mode);run.control.release.resolve();await run.stream.done;assert.equal(run.stream.frames.some(event=>event.type.startsWith("REASONING_")),false);const original=(await tasks.terminal(run.id))?.result as any;assert.ok(original.runTrace.providerReasoning.length);}
 // The same projection also runs from original background task event writes.
 const background=await begin("research");background.control.release.resolve();await until(async()=>(await tasks.get(background.id))?.status==="queued");const claimed=await tasks.claim();assert.equal(claimed?.id,background.id);assert.ok(claimed.lease);const backgroundSummary=snapshot(background.id,"worker");await runtimeTaskLease.run(claimed.lease,()=>tasks.append(background.id,{providerReasoning:backgroundSummary}));await until(()=>background.stream.frames.some(event=>event.type==="REASONING_END"));await tasks.finish(background.id,"cancelled",{error:"任务已取消。",code:"cancelled"});await background.stream.done;paired(background.stream.frames,background.id);const ending=await tasks.terminal(background.id),nativeCount=(await tasks.chat.agUiEvents(background.id)).length,rawCount=(await tasks.events(background.id,0)).length;assert.equal(await tasks.cancelStep!(background.id,{reconciled:true},{providerReasoning:snapshot(background.id,"late-worker")}),true);assert.ok((await tasks.events(background.id,0)).length>rawCount);assert.equal((await tasks.chat.agUiEvents(background.id)).length,nativeCount);assert.deepEqual(await tasks.terminal(background.id),ending);
 // Actual next-turn planner stdin comes from server history, never summary or
 // raw thinking — even when the official client restates a reasoning message.
 const follow=await begin("production",first.threadId,first.id,[{id:publicId,role:"reasoning",content:visible}]);await follow.stream.done;const inputs=(await readFile(stdin,"utf8")).trim().split("\n").map(line=>JSON.parse(line));assert.equal((await readFile(calls,"utf8")).trim().split("\n").length,1);assert.equal(inputs.length,1);assert.doesNotMatch(inputs[0],/PUBLIC_SUMMARY_ONLY|RAW_THINKING|providerReasoning|oneearth:summary/);
 const history=await tasks.conversationHistory!(first.threadId,follow.id);assert.doesNotMatch(JSON.stringify(history),/PUBLIC_SUMMARY_ONLY|RAW_THINKING|providerReasoning|oneearth:summary/);const stored=JSON.parse((await tasks.get(follow.id))!.body) as RuntimeTurnInput;assert.doesNotMatch(JSON.stringify(stored.history),/PUBLIC_SUMMARY_ONLY|RAW_THINKING/);assert.doesNotMatch(JSON.stringify(await runtimeTurnContext(tasks,follow.id,stored)),/PUBLIC_SUMMARY_ONLY|RAW_THINKING|providerReasoning|oneearth:summary/);
 console.log(JSON.stringify({explicitTypedSummary:true,rawOnlyAndTerminalOnlyNoReplay:true,pairedFiveFrames:true,firstStableValue:true,staleAndPartialNoOutput:true,rawOpaquePrivateNoOutput:true,bounded12And96KiB:true,sameRunIsolation:true,successFailureCancelClosed:true,lateAuditNoPublicOutput:true,archivePreserved:true,actualNextPlannerExcludesSummary:true,controlledPlannerCalls:1,realModelCalls:0,externalRequests:0}));
});
