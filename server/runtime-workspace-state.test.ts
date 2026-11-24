import assert from "node:assert/strict";
import test from "node:test";
import {randomUUID} from "node:crypto";
import {openTaskStore} from "./task-store";
import {runtimeTurnContext} from "./runtime-turn-context";
import {refreshWorkspaceObservations} from "./runtime-workspace-state";
import {emptyFilters} from "../src/domain/spatial";
import type {RuntimeTurnInput} from "./runtime-turn-handoff";
import type {DiscoveryResponse} from "../src/domain/types";
import type {WorkspaceReceipt} from "../src/domain/turn-context";

const revision="a".repeat(64),datasetId="haina:1846639";
const input=(conversationId:string=randomUUID()):RuntimeTurnInput=>({query:"原目标",conversationId,turnId:randomUUID(),context:{caseId:null,citation:null,filters:emptyFilters(),gridSystem:"h3",selection:null,layer:"all",camera:{center:[121,31],zoom:165,reason:"原上海目标"},workspaceView:{version:1,surface:"earth"}},history:[],config:{executor:"codex",model:""}});
function setup(){
  const tasks=openTaskStore(":memory:"),original=input(),id=randomUUID();
  const result:DiscoveryResponse={message:"将加载原上海目标",workspaceEffect:{effectId:"workspace:"+id,state:"proposed",fields:["workspaceLayerOpen","camera","filters"]},
    workspaceLayerOpen:{kind:"open-published-layer",datasetId,valueId:"shanghai-chn",publicationRevision:revision},camera:{center:[121,31],zoom:165,reason:"原规划目标"},filters:{...emptyFilters(),source:"haina",period:[2010,2023]}};
  tasks.submit(id,original);tasks.claim();tasks.finish(id,"complete",{result});
  const current=input(original.conversationId);current.previousTaskId=id;current.query="刚才完成了吗？";
  current.context.browserTurnFrame={version:1,capturedAt:1000,related:[{taskId:id,turnId:original.turnId,relation:"workspace-action"}],globe:{focusId:datasetId,layers:[{id:datasetId,label:"当前北京",visible:true,presentation:{valueId:"beijing-chn",publicationRevision:revision,state:"rendered",observedAt:900}}]}};
  const receipt:WorkspaceReceipt={taskId:id,effectId:"workspace:"+id,conversationId:original.conversationId,turnId:original.turnId,state:"applied",reportedAt:200,
    observation:{datasetId,valueId:"shanghai-chn",publicationRevision:revision,state:"rendered",observedAt:300},observationReportedAt:310};
  return {tasks,id,original,current,receipt,result};
}

test("original server target, old Shanghai render receipt and current Beijing presentation retain separate origins",async()=>{
  const f=setup();try{
    const context=await runtimeTurnContext({...f.tasks,workspaceReceipt:async()=>f.receipt},randomUUID(),f.current),state=context.history[0].execution.workspace;
    assert.equal(state.operation?.target?.valueId,"shanghai-chn");assert.deepEqual(state.operation?.values.camera?.center,[121,31]);assert.equal(state.operation?.values.filters?.source,"haina");
    assert.equal(state.receipt?.observation?.state,"rendered");assert.equal(state.receipt?.observation?.valueId,"shanghai-chn");
    assert.equal(state.atSubmission?.presentation?.valueId,"beijing-chn");assert.equal(state.atSubmission?.sameTarget,false);assert.equal(state.atSubmission?.capturedAt,1000);
    assert.match(context.rule,/旧rendered不代表当前/);assert.deepEqual(context.browserObservations,f.current.context.browserTurnFrame);
  }finally{f.tasks.close();}
});

test("loading is not rendered, old applied has no render proof, and mismatched receipt identities are ignored",async()=>{
  const f=setup();try{
    for(const state of ["loading","load-failed","superseded"] as const){
      const receipt={...f.receipt,observation:{...f.receipt.observation!,state}};
      const context=await runtimeTurnContext({...f.tasks,workspaceReceipt:async()=>receipt},randomUUID(),f.current);
      assert.equal(context.history[0].execution.workspace.receipt?.observation?.state,state);
    }
    const legacy={...f.receipt};delete legacy.observation;
    const old=await runtimeTurnContext({...f.tasks,workspaceReceipt:async()=>legacy},randomUUID(),f.current);assert.equal(old.history[0].execution.workspace.state,"applied");assert.equal(old.history[0].execution.workspace.receipt?.observation,undefined);
    for(const receipt of [{...f.receipt,conversationId:randomUUID()},{...f.receipt,turnId:randomUUID()},{...f.receipt,effectId:"workspace:"+randomUUID()}]){
      const context=await runtimeTurnContext({...f.tasks,workspaceReceipt:async()=>receipt},randomUUID(),f.current);assert.equal(context.history[0].execution.workspace.state,"proposed");
    }
    const wrong={...f.receipt,observation:{...f.receipt.observation!,valueId:"beijing-chn"}};
    const context=await runtimeTurnContext({...f.tasks,workspaceReceipt:async()=>wrong},randomUUID(),f.current);assert.equal(context.history[0].execution.workspace.receipt?.observation,undefined);
  }finally{f.tasks.close();}
});

test("late receipt refresh changes only related execution facts, preserving the frozen frame, intent and old batch",async()=>{
  const f=setup();try{
    let receipt:WorkspaceReceipt={...f.receipt,observation:{...f.receipt.observation!,state:"loading"}};
    const context=await runtimeTurnContext({...f.tasks,workspaceReceipt:async()=>receipt},randomUUID(),f.current),before=JSON.stringify(context);
    receipt={...receipt,observation:{...receipt.observation!,state:"rendered",observedAt:1100},observationReportedAt:1200};
    const latest=await refreshWorkspaceObservations({workspaceReceipt:async()=>receipt},context);
    assert.equal(latest.history[0].execution.workspace.receipt?.observation?.state,"rendered");assert.equal(JSON.stringify(context),before);
    assert.deepEqual(latest.current,context.current);assert.deepEqual(latest.frozenView,context.frozenView);assert.deepEqual(latest.browserObservations,context.browserObservations);
    assert.deepEqual(latest.visibleBatch,context.visibleBatch);assert.deepEqual(latest.history[0].conditions,context.history[0].conditions);
    const regressed=await refreshWorkspaceObservations({workspaceReceipt:async()=>({...receipt,observation:{...receipt.observation!,state:"loading",observedAt:200}})},latest);
    assert.equal(regressed.history[0].execution.workspace.receipt?.observation?.state,"rendered");
    const unavailable=await refreshWorkspaceObservations({workspaceReceipt:async()=>{throw Error("controlled unavailable");}},latest);
    assert.equal(unavailable.history[0].execution.workspace.receiptRefresh,"unavailable");assert.equal(unavailable.history[0].execution.workspace.receipt?.observation?.state,"rendered");
  }finally{f.tasks.close();}
});

test("refusal reasons, same-operation explanation and actual runtime failure are available without creating execution",async()=>{
  const f=setup();try{
    const receipt:WorkspaceReceipt={...f.receipt,state:"failed",reason:"publication-unverified",observation:undefined,
      recovery:{state:"complete",observedAt:400,message:"原目标未应用，需要你确认下一步。",nextStep:"ask-confirmation"}};
    const context=await runtimeTurnContext({...f.tasks,workspaceReceipt:async()=>receipt},randomUUID(),f.current);
    const state=context.history[0].execution.workspace;assert.equal(state.state,"failed");assert.equal(state.receipt?.reason,"publication-unverified");assert.equal(state.receipt?.recovery?.nextStep,"ask-confirmation");assert.equal(state.receipt?.observation,undefined);
    const failed=randomUUID(),body=input(f.original.conversationId);f.tasks.submit(failed,body);f.tasks.claim();f.tasks.finish(failed,"failed",{code:"TURN_PLAN_INVALID",error:"旧动作未通过；Authorization Bearer synthetic-private"});
    f.current.context.browserTurnFrame!.related=[{taskId:failed,turnId:body.turnId,relation:"recent-outcome"}];
    const actual=await runtimeTurnContext(f.tasks,randomUUID(),f.current),row=actual.history.find(row=>row.taskId===failed)!;
    assert.equal(actual.recentOutcome?.taskId,failed);
    assert.equal(actual.recentOutcome?.taskState,"failed");
    assert.equal(actual.recentOutcome?.hasResultBatch,false);
    assert.equal(actual.recentOutcome?.submittedAt,row.submittedAt);
    assert.equal(row.failure?.code,"TURN_PLAN_INVALID");assert.ok(!JSON.stringify(actual).includes("synthetic-private"));assert.equal(row.execution.workspace.state,"unknown");assert.equal(row.execution.workspace.operation,undefined);
  }finally{f.tasks.close();}
});
