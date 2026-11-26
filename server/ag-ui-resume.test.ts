import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {once} from "node:events";
import {randomUUID} from "node:crypto";
import {mkdtemp,writeFile,readFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {spawn} from "node:child_process";
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
const fixture=process.env.ONEEARTH_AGUI_TEST_DATABASE_URL;
const baseContext=()=>({filters:emptyFilters(),caseId:null,selection:null,citation:null,gridSystem:"h3",layer:"all",camera:{center:[0,0],zoom:1,reason:"controlled"}});
const config={executor:"codex",model:"gpt-6-luna"};
const view=()=>({version:1,surface:"earth",activeLayer:{id:"forest",title:"Controlled dates",status:"ready",controls:[{id:"time",label:"日期",current:{id:"2020-01-01",label:"首日"},options:[{id:"2020-01-01",label:"首日"},{id:"2020-02-01",label:"次日"}],ordered:true}]}});
const action={kind:"set-control",layerId:"forest",controlId:"time",valueId:"2020-02-01"};
const clarify={decide:{kind:"clarify",subject:"question",question:"采用哪个时段，还需补充什么？",choices:["首个时段","第二时段"]}};
const respond={decide:{kind:"respond",reply:"已按实际补充保留条件。",targets:[]}};

test("persisted native interrupt resumes with one same-thread original claim and verified legacy confirmation guards",{skip:!fixture,timeout:25000},async t=>{
 assert.ok(fixture);assert.match(new URL(fixture).pathname,/native_agui.*(?:module_runtime|m2)/);
 const old={runtime:process.env.ONEEARTH_RUNTIME_DATABASE_URL,path:process.env.PATH};process.env.ONEEARTH_RUNTIME_DATABASE_URL=fixture;
 const dir=await mkdtemp(path.join(tmpdir(),"oe-native-resume-")),mode=path.join(dir,"plan.json"),log=path.join(dir,"calls");
 await writeFile(mode,JSON.stringify(clarify));await writeFile(path.join(dir,"codex"),`#!${process.execPath}\nimport fs from 'node:fs';let p='';for await(const b of process.stdin)p+=b;while(fs.existsSync(${JSON.stringify(path.join(dir,"hold"))}))await new Promise(r=>setTimeout(r,10));fs.appendFileSync(${JSON.stringify(log)},'call\\n');process.stdout.write(fs.readFileSync(${JSON.stringify(mode)},'utf8'));`,{mode:0o700});process.env.PATH=dir+path.delimiter+(old.path||"");
 const tasks=await postgresTaskStore("runtime"),audit=productDatabase("RUNTIME"),services={tasks,push:{latest:()=>({records:[]})},coverage:async()=>undefined,researchRegionService:{locate:async()=>null},adminBoundaryDir:dir,canonicalCache:new Map()} as unknown as RuntimeServices;
 const app=express();app.use(express.json());const native=await agUiWorkbench(app,tasks,(id,body)=>prepareRuntimeChat(services,id,body,id=>tasks.chat.latestCompleted(id),{publicAnswer:true}));taskStatusRoutes(app,"/api/tasks",tasks,{researchRecords:true,chatIdentity:true,readInterrupt:id=>tasks.chat.agUiInterrupt(id),onCancelled:id=>native.cancel(id)});
 const server=app.listen(0,"127.0.0.1");await once(server,"listening");const address=server.address();assert.ok(address&&typeof address!=="string");const origin="http://127.0.0.1:"+address.port;
 t.after(async()=>{await native.close();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await tasks.close();await audit.end();await closeRuntimeModelCapacity();for(const [key,value] of [["ONEEARTH_RUNTIME_DATABASE_URL",old.runtime],["PATH",old.path]])if(value===undefined)delete process.env[key!];else process.env[key!]=value;await rm(dir,{recursive:true,force:true});});
 const input=(question:string,threadId=randomUUID(),submission:Record<string,unknown>={})=>({protocolVersion:"1.0",runId:randomUUID(),threadId,messages:[{id:randomUUID(),role:"user",content:question}],tools:[],context:[],state:{},forwardedProps:{oneearth:{version:1,submission:{context:baseContext(),config,...structuredClone(submission)}}}});
 const post=(body:unknown)=>fetch(origin+"/api/ag-ui",{method:"POST",headers:{"Content-Type":"application/json",Accept:"text/event-stream"},body:JSON.stringify(body)});
 async function collect(body:unknown){const response=await post(body);assert.equal(response.status,200,await (response.status===200?Promise.resolve(""):response.text()));const records=(await response.text()).split("\n\n").filter(value=>value.startsWith("data: ")).map(value=>EventSchema.parse(JSON.parse(value.slice(6))));return records as any[];}
 const calls=async()=>{try{return (await readFile(log,"utf8")).trim().split("\n").filter(Boolean).length;}catch{return 0;}};
 async function parent(question="保留原问题并补充条件",scope?:any){await writeFile(mode,JSON.stringify(clarify));const body=input(question,randomUUID(),scope?{context:{...baseContext(),workspaceView:scope}}:{});const records=await collect(body),end=records.at(-1);assert.equal(end.type,"RUN_FINISHED");assert.equal(end.outcome.type,"interrupt");assert.equal(end.outcome.interrupts[0].id,body.runId);assert.equal(end.outcome.interrupts[0].reason,"oneearth.clarification");return {body,records};}
 const resume=(parent:any,payload:unknown,query:string)=>({...input(query,parent.threadId,{...structuredClone(parent.forwardedProps.oneearth.submission),previousTaskId:parent.runId}),resume:[{interruptId:parent.runId,status:"resolved",payload}]});
 const first=await parent(),persisted=await tasks.chat.agUiInterrupt(first.body.runId);assert.equal(persisted?.status,"pending");assert.ok(persisted&&persisted.kind!=="question-check");assert.equal(persisted.prompt.options?.[0].id,"option-1");assert.deepEqual((await(await fetch(origin+"/api/tasks/"+first.body.runId+"/record")).json()).interrupt,persisted);
 const reopened=await postgresTaskStore("runtime");assert.deepEqual(await reopened.chat.agUiInterrupt(first.body.runId),persisted);await reopened.close();
 const before=await calls();assert.equal((await post(input("普通话不能绕过原追问",first.body.threadId))).status,409);assert.equal((await post({...resume(first.body,{text:"答复"},"答复"),threadId:randomUUID()})).status,409);
 assert.equal((await post(resume({...first.body,runId:randomUUID()},{text:"答复"},"答复"))).status,404);
 assert.equal((await post(resume(first.body,{optionId:"foreign"},"foreign"))).status,409);assert.equal((await post(resume(first.body,{text:"实际补充"},"不同内容"))).status,409);assert.equal(await calls(),before);
 await writeFile(mode,JSON.stringify(respond));const combined=resume(first.body,{optionId:"option-1",text:"同时保留既定范围。"},"首个时段\n同时保留既定范围。"),reply=await collect(combined);assert.equal(reply.at(-1).type,"RUN_FINISHED");assert.equal(reply.at(-1).outcome,undefined);
 const accepted=await tasks.get(combined.runId);assert.equal(JSON.parse(accepted!.body).query,"首个时段\n同时保留既定范围。");assert.deepEqual(JSON.parse(accepted!.body).clarificationAnswer,{optionId:"option-1",text:"同时保留既定范围。",parentTaskId:first.body.runId});
 assert.deepEqual(await tasks.chat.agUiInterrupt(first.body.runId),{...persisted,status:"resolved",resumedBy:combined.runId});const replay=await post(combined);assert.equal(replay.status,409);assert.equal((await replay.json()).code,"RUN_ALREADY_ACCEPTED");const conflict=await post({...combined,messages:[{...combined.messages[0],content:"changed content"}]});assert.equal(conflict.status,409);assert.equal((await conflict.json()).code,"RUN_ID_CONFLICT");assert.equal((await(await fetch(origin+"/api/tasks/"+first.body.runId+"/record")).json()).interrupt.resumedBy,combined.runId);const consumed=await calls();assert.equal((await post(resume(first.body,{text:"新ID也不能二答"},"新ID也不能二答"))).status,409);assert.equal(await calls(),consumed);
 // Different child IDs race for one exact parent; one acceptance/model call only.
 const raced=await parent();await writeFile(mode,JSON.stringify(respond));const a=resume(raced.body,{text:"同一补充"},"同一补充"),b=resume(raced.body,{text:"同一补充"},"同一补充"),count=await calls(),responses=await Promise.all([post(a),post(b)]);assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);for(const response of responses)await response.text();assert.equal(await calls(),count+1);
 const winner=responses[0].status===200?a:b;assert.equal((await tasks.chat.agUiInterrupt(raced.body.runId))?.resumedBy,winner.runId);
 // Concrete confirmation is generated only from a verified original proposal.
 async function confirmation(){await writeFile(mode,JSON.stringify({decide:{kind:"propose-workspace",question:"确定选择次日吗？",action}}));const body=input("先确认再选择该控件",randomUUID(),{context:{...baseContext(),workspaceView:view()}}),records=await collect(body);assert.equal(records.at(-1).result.oneearth.response.clarificationPrompt.kind,"confirmation");assert.ok(!records.at(-1).result.oneearth.response.workspaceAction);return body;}
 const approvedParent=await confirmation(),approve=resume(approvedParent,{optionId:"approve"},"确认执行"),approvalCount=await calls();const approved=await collect(approve);assert.deepEqual(approved.at(-1).result.oneearth.response.workspaceAction,action);assert.equal(await calls(),approvalCount,"explicit original approval reuses the trusted proposal without a new model");
 const declineParent=await confirmation(),declineCount=await calls(),declined=await collect(resume(declineParent,{optionId:"decline"},"不执行"));assert.equal(declined.at(-1).result.oneearth.response.workspaceAction,undefined);assert.equal(await calls(),declineCount);
 const invalidParent=await confirmation(),invalidCount=await calls();assert.equal((await post(resume(invalidParent,{optionId:"approve",text:"另换目标"},"确认执行\n另换目标"))).status,409);
 const changed=resume(invalidParent,{optionId:"approve"},"确认执行");(changed.forwardedProps.oneearth.submission.context as any).workspaceView.activeLayer.controls[0].current={id:"2020-02-01",label:"次日"};assert.equal((await post(changed)).status,409);assert.equal(await calls(),invalidCount);
 // A free condition is not approval, even if a model attempts the original action.
 await writeFile(mode,JSON.stringify({decide:{kind:"workspace",action}}));const condition=await collect(resume(invalidParent,{text:"先说明条件"},"先说明条件"));assert.equal(condition.at(-1).outcome.type,"interrupt");assert.equal(condition.at(-1).result.oneearth.response.workspaceAction,undefined);
 // Explicit abandoned status is separate from merely closing the UI.
 const abandoned=await parent(),abandon=input("明确放弃这个问题",abandoned.body.threadId,{previousTaskId:abandoned.body.runId}),noModel=await calls();const abandonEvents=await collect({...abandon,resume:[{interruptId:abandoned.body.runId,status:"cancelled"}]});assert.deepEqual(abandonEvents.at(-1).outcome,{type:"cancelled"});assert.equal((await tasks.chat.agUiInterrupt(abandoned.body.runId))?.status,"cancelled");assert.equal(await calls(),noModel);
 // A later accepted legacy completion expires a concrete approval, with no new model.
 const expired=await confirmation(),later=randomUUID();await tasks.submit(later,{query:"independent legacy task",conversationId:expired.threadId,turnId:randomUUID(),history:[],context:baseContext(),config});await tasks.finish(later,"complete",{result:{message:"independent completion"}});
 assert.equal((await tasks.chat.agUiInterrupt(expired.runId))?.status,"unavailable");const expiredCount=await calls();assert.equal((await post(resume(expired,{optionId:"approve"},"确认执行"))).status,409);assert.equal(await calls(),expiredCount);
 // Two already-admitted runs may ask concurrently. Only the actual latest native
 // ending can be resolved; old IDs are retained as unavailable for inspection.
 await writeFile(mode,JSON.stringify(clarify));const held=path.join(dir,"hold");await writeFile(held,"hold");const shared=randomUUID(),firstConcurrent=input("first accepted question",shared),secondConcurrent=input("second accepted question",shared);
 const pendingResponses=await Promise.all([post(firstConcurrent),post(secondConcurrent)]);assert.deepEqual(pendingResponses.map(response=>response.status),[200,200]);await rm(held);for(const response of pendingResponses)await response.text();
 const current=await tasks.chat.agUiPending(shared);assert.ok(current);const superseded=current.id===firstConcurrent.runId?secondConcurrent:firstConcurrent;assert.equal((await tasks.chat.agUiInterrupt(superseded.runId))?.status,"unavailable");const previousCalls=await calls();assert.equal((await post(resume(superseded,{text:"old answer"},"old answer"))).status,409);assert.equal(await calls(),previousCalls);
 // Stored superseded identity is unavailable; never resolve an older native question.
 const stale=await parent();const nativeBody={query:"later accepted original",conversationId:stale.body.threadId,turnId:randomUUID(),history:[],context:baseContext(),config};const lateId=randomUUID();
 // Existing non-AGUI compatibility can archive a later question; it cannot grant a resume.
 await tasks.submit(lateId,nativeBody);await tasks.finish(lateId,"complete",{result:{message:"later"}});
 // This is not a concrete proposal, so its explicit chat answer remains eligible under old business rules.
 assert.equal((await tasks.chat.agUiInterrupt(stale.body.runId))?.status,"pending");
 console.log(JSON.stringify({nativeInterruptPersisted:true,combinedOptionAndText:true,foreignAndUnknownZeroModel:true,oneOriginalClaim:true,confirmationExactAction:true,freeTextNotApproval:true,viewChangeRefused:true,explicitCancelledZeroAction:true}));
});
