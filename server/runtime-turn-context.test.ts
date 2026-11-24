import assert from "node:assert/strict";
import test from "node:test";
import {randomUUID} from "node:crypto";
import {openTaskStore} from "./task-store";
import {runtimeTurnContext,boundTurnContext,modelTurnContext} from "./runtime-turn-context";
import {emptyFilters} from "../src/domain/spatial";
import type {RuntimeTurnInput} from "./runtime-turn-handoff";
import type {DiscoveryResponse} from "../src/domain/types";
import type {ResultBatch,WorkspaceReceipt} from "../src/domain/turn-context";

const input=(query="本轮原问",conversationId:string=randomUUID()):RuntimeTurnInput=>({query,conversationId,turnId:randomUUID(),history:[],config:{executor:"codex",model:""},
  context:{caseId:null,citation:null,selection:null,gridSystem:"h3",layer:"all",filters:emptyFilters(),camera:{center:[0,0],zoom:1,reason:"test"},workspaceView:{version:1,surface:"earth"}}});
function archived(store:ReturnType<typeof openTaskStore>,body:RuntimeTurnInput,result:Partial<DiscoveryResponse>){const id=randomUUID();store.submit(id,body);store.claim();store.finish(id,"complete",{result});return id;}
const plan=(action:string)=>({id:"turn-action",kind:"tool" as const,name:"原规划",input:"原问",status:"done" as const,output:JSON.stringify({action,goal:"原归一研究目标"})});
const discovery={id:randomUUID()+":discovery",kind:"tool" as const,name:"发现委托",input:"原问",status:"done" as const};
function batch(taskId:string,body:RuntimeTurnInput):ResultBatch{return {batchId:randomUUID(),taskId,turnId:body.turnId,conversationId:body.conversationId,kind:"research",status:"complete",
  query:"仅在来源A查原地区2010—2023年",conditions:["来源策略：restricted A"],channels:[{source:"A",status:"done",count:2}],itemIds:["haina:1","haina:2"]};}

test("a context-free ordinary question makes no historical or remote query",async()=>{
  const tasks=openTaskStore(":memory:"),body=input();let reads=0;
  const store={...tasks,get(){reads++;assert.fail("no parent was referenced");}};
  const ctx=await runtimeTurnContext(store,randomUUID(),body);assert.equal(reads,0);assert.equal(ctx.history.length,0);assert.equal(ctx.visibleBatch.state,"unbound");tasks.close();
});

test("a verified old batch preserves its actual query and source conditions independently of the current view",async()=>{
  const tasks=openTaskStore(":memory:"),previous=input("查原地区数据"),id=randomUUID(),original=batch(id,previous);
  tasks.submit(id,previous);tasks.claim();tasks.finish(id,"complete",{result:{modelIds:original.itemIds,resultBatch:original,message:"旧答复",runTrace:{started:1,stages:[],calls:[plan("search"),discovery]}}});
  const body=input("新地区有没有数据",previous.conversationId);body.previousTaskId=id;body.context.filters.place="新地区";body.context.filters.period=null;
  body.context.browserTurnFrame={version:1,batch:{answerId:id,batchId:original.batchId,title:"浏览器新标题不作证据",origin:"research",visibleIds:["haina:2"],expanded:true}};
  const ctx=await runtimeTurnContext(tasks,randomUUID(),body);assert.equal(ctx.visibleBatch.state,"verified");assert.equal(ctx.visibleBatch.query,original.query);
  assert.deepEqual(ctx.visibleBatch.batch?.conditions,original.conditions);assert.equal(ctx.frozenView?.surface,"earth");
  assert.equal(ctx.history[0].execution.research,"complete");assert.equal(ctx.history[0].conditions[0].origin,"user-message");
  assert.equal(body.context.filters.place,"新地区");tasks.close();
});

test("forged members, a different batch and a foreign conversation cannot become actionable candidates",async()=>{
  const tasks=openTaskStore(":memory:"),previous=input(),id=randomUUID(),original=batch(id,previous);
  tasks.submit(id,previous);tasks.claim();tasks.finish(id,"complete",{result:{resultBatch:original,modelIds:original.itemIds,message:"PRIVATE_FOREIGN_FACT"}});
  for(const bad of ["member","batch","conversation","turn"]){
    const body=input("看看这批",bad==="conversation"?randomUUID():previous.conversationId);body.context.candidateIds=["haina:999"];
    body.context.workspaceView!.candidateItems=[{id:"haina:999",label:"伪造候选"}];body.context.browserTurnFrame={version:1,
      batch:{answerId:id,batchId:bad==="batch"?randomUUID():original.batchId,title:"claimed",origin:"research",visibleIds:bad==="member"?["haina:999"]:["haina:1"]},
      ...(bad==="turn"?{related:[{taskId:id,turnId:randomUUID(),relation:"visible-batch" as const}]}:{})};
    const ctx=await runtimeTurnContext(tasks,randomUUID(),body);assert.equal(ctx.visibleBatch.state,"invalid",bad);
    assert.deepEqual(boundTurnContext(body.context,ctx).workspaceView!.candidateItems,[]);assert.deepEqual(boundTurnContext(body.context,ctx).candidateIds,[]);
    if(bad==="conversation"||bad==="turn")assert.ok(!JSON.stringify(ctx).includes("PRIVATE_FOREIGN_FACT"));
  }
  tasks.close();
});

test("an assistant's claim and inherited records do not prove a new lookup; legacy actual receipts can be identified",async()=>{
  const tasks=openTaskStore(":memory:"),previous=input(),old=archived(tasks,previous,{modelIds:["haina:1"],message:"已经检索并找到一条",runTrace:{started:1,stages:[],calls:[plan("workspace")]}});
  const body=input("找到了么",previous.conversationId);body.context.browserTurnFrame={version:1,batch:{answerId:old,title:"旧批",origin:"unknown",visibleIds:["haina:1"]}};
  const ctx=await runtimeTurnContext(tasks,randomUUID(),body);assert.equal(ctx.visibleBatch.state,"unbound");assert.equal(ctx.history[0].execution.research,"not-requested");
  const actual=archived(tasks,{...previous,turnId:randomUUID()},{modelIds:["haina:1"],message:"真实旧结果",runTrace:{started:1,stages:[],calls:[plan("search"),discovery]}});
  body.context.browserTurnFrame.batch!.answerId=actual;
  const legacy=await runtimeTurnContext(tasks,randomUUID(),body);assert.equal(legacy.visibleBatch.state,"legacy-verified");assert.equal(legacy.visibleBatch.batch,undefined);tasks.close();
});

test("real worker bindings, frontend completion and actual browser action receipts remain distinct",async()=>{
  const tasks=openTaskStore(":memory:"),previous=input(),id=archived(tasks,previous,{message:"已建议修改",workspaceEffect:{effectId:"workspace:"+randomUUID(),state:"proposed",fields:["filters"]},
    runTrace:{started:1,stages:[],calls:[plan("workspace")]}});
  const effect=(tasks.terminal(id)!.result as DiscoveryResponse).workspaceEffect!,receipt:WorkspaceReceipt={effectId:effect.effectId,taskId:id,turnId:previous.turnId,conversationId:previous.conversationId,state:"stale",reportedAt:1};
  const body=input("刚才做完了吗",previous.conversationId);body.previousTaskId=id;
  const ctx=await runtimeTurnContext({...tasks,workspaceReceipt:async()=>receipt,researchExecution:async()=>undefined},randomUUID(),body);
  assert.equal(ctx.history[0].execution.workspace.state,"stale");assert.equal(ctx.history[0].execution.research,"not-requested");
  const mismatch=await runtimeTurnContext({...tasks,workspaceReceipt:async()=>({...receipt,turnId:randomUUID()})},randomUUID(),body);
  assert.equal(mismatch.history[0].execution.workspace.state,"proposed");
  const working=await runtimeTurnContext({...tasks,researchExecution:async()=>({status:"running" as const,bindings:[{taskId:randomUUID(),messageId:randomUUID(),operation:"discover" as const,state:"TASK_STATE_WORKING"}]})},randomUUID(),body);
  assert.equal(working.history[0].execution.research,"running");assert.equal(working.history[0].taskState,"complete");tasks.close();
});

test("local catalogue handles stay descriptive and a closed verified batch cannot expose ordinal actions",async()=>{
  const tasks=openTaskStore(":memory:"),body=input();body.context.browserTurnFrame={version:1,batch:{localBatchId:randomUUID(),title:"本机目录",origin:"catalogue",visibleIds:["haina:1"]}};
  const local=await runtimeTurnContext(tasks,randomUUID(),body);assert.equal(local.visibleBatch.state,"unbound");assert.equal(local.history.length,0);
  const previous=input("原目录",body.conversationId),id=randomUUID(),record=batch(id,previous);tasks.submit(id,previous);tasks.claim();tasks.finish(id,"complete",{result:{resultBatch:record}});
  body.context.browserTurnFrame.batch={answerId:id,batchId:record.batchId,title:"已关闭的原批",origin:"research",visibleIds:[],expanded:false};
  body.context.workspaceView!.candidateItems=[{id:"haina:1",label:"不可见条目"}];
  const closed=await runtimeTurnContext(tasks,randomUUID(),body);assert.equal(closed.visibleBatch.state,"verified");assert.deepEqual(boundTurnContext(body.context,closed).workspaceView!.candidateItems,[]);tasks.close();
});

test("a hard four-record budget and unknown history do not trigger broad event scanning",async()=>{
  const tasks=openTaskStore(":memory:"),conversationId=randomUUID(),body=input("看看过去",conversationId);let reads=0;
  const ids=Array.from({length:8},()=>archived(tasks,input("旧问题",conversationId),{message:"旧答复"}));
  body.context.browserTurnFrame={version:1,related:ids.map(taskId=>({taskId,relation:"reference"}))};
  const ctx=await runtimeTurnContext({...tasks,get(id){reads++;return tasks.get(id);},events(){assert.fail("no progress scan");}},randomUUID(),body);
  assert.equal(reads,4);assert.equal(ctx.history.length,4);assert.equal(ctx.unavailableRelations.filter(item=>item.reason==="limit").length,4);
  assert.ok(Buffer.byteLength(JSON.stringify(modelTurnContext(ctx)))<18000);tasks.close();
});

test("old observation facts are not a bypass around their dedicated current authorization",async()=>{
  const tasks=openTaskStore(":memory:"),previous=input("PRIVATE_OBSERVATION_FACT"),id=archived(tasks,previous,{message:"PRIVATE_OBSERVATION_FACT",answerNotes:{references:[{kind:"asset",id:"observation:test",title:"受权文件",source:"本地",evidenceLevel:"observation-file"}]} as any});
  const body=input("解释一下",previous.conversationId);body.previousTaskId=id;const ctx=await runtimeTurnContext(tasks,randomUUID(),body);
  assert.ok(!JSON.stringify(ctx).includes("PRIVATE_OBSERVATION_FACT"));assert.equal(ctx.history[0].observationFacts,"separate-authority");tasks.close();
});
