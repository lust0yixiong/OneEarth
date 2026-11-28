import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {once} from "node:events";
import {randomBytes,randomUUID} from "node:crypto";
import {EventSchema} from "@ag-ui/core/schemas";
import {agUiWorkbench} from "./ag-ui-workbench";
import {projectWorkspaceDiscoveryRun} from "./ag-ui-persistence";
import {postgresTaskStore} from "./postgres-task-store";
import {workspaceResearchStateStore} from "./workspace-research-state";
import {workspaceDiscoveryOperations} from "./workspace-discovery-operations";
import {runtimeTaskLease} from "./runtime-task-lease";
import {taskStatusRoutes} from "./task-store";
import {emptyFilters} from "../src/domain/spatial";
import type {WorkspaceDiscoveryResult} from "../src/domain/workspace-discovery";

const fixture=process.env.ONEEARTH_AGUI_TEST_DATABASE_URL;
test("native workspace discovery links one protected operation and cites the same completed batch without another execution",
 {skip:!fixture,timeout:15000},async t=>{
 assert.ok(fixture);
 assert.match(new URL(fixture).pathname,/native_agui.*module_runtime/u);
 const previous=process.env.ONEEARTH_RUNTIME_DATABASE_URL;
 process.env.ONEEARTH_RUNTIME_DATABASE_URL=fixture;
 const tasks=await postgresTaskStore("runtime");
 const state=await workspaceResearchStateStore();
 t.after(async()=>{
  await state.close();
  await tasks.close();
  if(previous===undefined)delete process.env.ONEEARTH_RUNTIME_DATABASE_URL;
  else process.env.ONEEARTH_RUNTIME_DATABASE_URL=previous;
 });
 const discovery=workspaceDiscoveryOperations(tasks.operations,projectWorkspaceDiscoveryRun);
 const app=express();
 app.use(express.json());
 let ordinaryCalls=0;
 const workbench=await agUiWorkbench(app,tasks,async()=>{
  ordinaryCalls++;
  return {error:"This fixture does not permit an ordinary dispatcher."};
 },undefined,undefined,state,false,undefined,discovery);
 taskStatusRoutes(app,"/api/tasks",tasks,{chatIdentity:true,researchRecords:true});
 const listener=app.listen(0,"127.0.0.1");
 await once(listener,"listening");
 t.after(async()=>{
  await workbench.close();
  listener.closeAllConnections();
  await new Promise<void>(resolve=>listener.close(()=>resolve()));
 });
 const address=listener.address();
 assert.ok(address&&typeof address!=="string");
 const base="http://127.0.0.1:"+address.port;
 const threadId=randomUUID(),actionId=randomUUID(),accessKey=randomBytes(32).toString("hex");
 const context={filters:emptyFilters(),caseId:null,selection:null,citation:null,gridSystem:"h3",layer:"all",
  camera:{center:[0,0],zoom:1,reason:"controlled"}};
 const config={executor:"codex",model:"gpt-6-luna"};
 const input=(query:string,extra:Record<string,unknown>,thread=threadId)=>({
  protocolVersion:"1.0",threadId:thread,runId:randomUUID(),messages:[{role:"user",id:randomUUID(),content:query}],
  tools:[],context:[],state:{},forwardedProps:{oneearth:{version:1,submission:{context,config,...extra}}},
 });
 const post=(body:unknown)=>fetch(base+"/api/ag-ui",{method:"POST",body:JSON.stringify(body),signal:AbortSignal.timeout(6000),
  headers:{"Content-Type":"application/json",Accept:"text/event-stream"}});
 const decode=async(response:Response)=>{
  assert.equal(response.status,200);
  return (await response.text()).split("\n\n").filter(frame=>frame.startsWith("data: "))
   .map(frame=>EventSchema.parse(JSON.parse(frame.slice(6))));
 };
 const status=(runId:string)=>fetch(base+"/api/tasks/"+runId);
 const record=(runId:string)=>fetch(base+"/api/tasks/"+runId+"/record");

 const original=input("发现资料：  monthly  snow  ",{discoveryAction:{actionId,expectedRevision:0,accessKey}});
 const response=await post(original);
 assert.equal(response.status,200);
 const pending=await (await status(original.runId)).json();
 assert.equal(pending.status,"queued");
 assert.equal(pending.turnId,original.messages[0].id);
 assert.equal(pending.conversationId,threadId);
 const originalTask=await tasks.get(original.runId);
 assert.ok(originalTask);
 const storedInput=JSON.parse(originalTask.body);
 assert.equal(storedInput.query,original.messages[0].content);
 assert.equal(storedInput.discoveryAction,undefined);
 assert.ok(!originalTask.body.includes(accessKey));
 const accepted=await discovery.readAction(threadId,actionId,accessKey);
 assert.ok(accepted);
 assert.notEqual(accepted.operationId,original.runId);
 const duplicate=await post(original);
 assert.equal(duplicate.status,409);
 assert.equal((await duplicate.json()).code,"RUN_ALREADY_ACCEPTED");
 const counterfeit=input(original.messages[0].content,{discoveryAction:{actionId,expectedRevision:0,accessKey}});
 const sameActionNewRun=await post(counterfeit);
 assert.equal(sameActionNewRun.status,409);
 assert.equal((await sameActionNewRun.json()).code,"DISCOVERY_USE_ORIGINAL_OPERATION");
 assert.equal(await tasks.get(counterfeit.runId),undefined);
 const operation=await tasks.operations.readForRun(original.runId);
 assert.deepEqual([operation?.operationId,operation?.activeTurnId,operation?.input.query,operation?.input.researchRevision],
  [accepted.operationId,original.messages[0].id,"monthly snow",0]);
 assert.ok(!JSON.stringify(operation).includes(accessKey));

 const assigned=await tasks.claim();
 assert.ok(assigned?.lease&&operation?.currentStepId);
 assert.equal(assigned.id,accepted.operationId);
 const batch:WorkspaceDiscoveryResult={batchId:randomUUID(),query:"monthly snow",complete:true,items:[{
  kind:"paper",id:"paper-fixture",title:"Archived snow measurements",source:"Published catalogue",
  url:"https://example.org/archived-snow",excerpt:"January measurements are described by the catalogue."
 }]};
 await runtimeTaskLease.run(assigned.lease,async()=>{
  await tasks.operations.transaction(async db=>{
   const dispatch=await tasks.operations.prepareDispatchInTransaction(db,assigned.id,operation.currentStepId!);
   assert.ok(dispatch);
   const receipt=await tasks.operations.receiptInTransaction(db,{operationId:assigned.id,stepId:operation.currentStepId!,
    kind:"service",requestId:dispatch.requestId,receiptId:randomUUID(),payload:{batchId:batch.batchId}},{requireLease:true});
   assert.equal(receipt.status,"accepted");
   assert.equal(await tasks.operations.completeInTransaction(db,assigned.id,{result:batch},async(tx,persisted)=>{
    assert.equal(persisted.activeRunId,original.runId);
    assert.equal(await projectWorkspaceDiscoveryRun(tx,original.runId,"complete",batch),true);
    assert.equal(await projectWorkspaceDiscoveryRun(tx,original.runId,"complete",batch),false);
   }),true);
  });
 });
 const initialEvents=await decode(response);
 assert.equal(initialEvents.filter(event=>event.type==="RUN_FINISHED").length,1);
 assert.equal(initialEvents.at(-1)?.type,"RUN_FINISHED");
 const originalRecord=await (await record(original.runId)).json();
 assert.deepEqual(originalRecord.result.workspaceDiscovery,{operationId:accepted.operationId,...batch});
 assert.equal(originalRecord.result.answerNotes.references[0].url,batch.items[0].url);
 assert.equal(originalRecord.result.answerNotes.webSources[0].stage,"search-snippet");
 assert.equal(originalRecord.result.answerNotes.webSources[0].snippet,batch.items[0].excerpt);

 const reference={operationId:accepted.operationId,batchId:batch.batchId,accessKey};
 const reply=(selection:typeof reference,conversationId=threadId)=>input("引用选定的已保存资料。",{discoveryReference:selection},conversationId);
 for(const rejected of [
  reply({...reference,accessKey:randomBytes(32).toString("hex")}),
  reply({...reference,batchId:randomUUID()}),
  reply({...reference,operationId:randomUUID()}),
  reply(reference,randomUUID()),
 ]){
  const denied=await post(rejected);
  assert.equal(denied.status,404);
  assert.equal((await denied.json()).code,"DISCOVERY_OPERATION_NOT_FOUND");
  assert.equal(await tasks.get(rejected.runId),undefined);
 }
 const followup=reply(reference);
 const readEvents=await decode(await post(followup)),end=readEvents.at(-1);
 assert.ok(end?.type==="RUN_FINISHED");
 assert.match(JSON.stringify(end.result),/Archived snow measurements.*archived-snow/u);
 assert.ok(JSON.stringify(end.result).includes(batch.items[0].excerpt!));
 const saved=await (await record(followup.runId)).json();
 assert.equal(saved.conversationId,threadId);
 assert.deepEqual(saved.result.workspaceDiscovery,originalRecord.result.workspaceDiscovery);
 assert.equal(await tasks.operations.readForRun(followup.runId),undefined);
 assert.ok(!(await tasks.get(followup.runId))?.body.includes(accessKey));
 assert.equal(await tasks.claim(),undefined);
 assert.equal(ordinaryCalls,0);
});
