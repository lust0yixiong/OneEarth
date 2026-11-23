import assert from "node:assert/strict";
import test,{type TestContext} from "node:test";
import {randomUUID} from "node:crypto";
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {emptyFilters} from "../src/domain/spatial";
import {validContext} from "../src/domain/context-validation";
import {workspaceViewActionAllowed,type WorkspaceViewContext} from "../src/domain/workspace-view-context";
import type {DiscoveryContext} from "../src/domain/types";
import {executeTurn,type RuntimeServices} from "./runtime-turn";
import {openTaskStore} from "./task-store";
import {parseTurnPlan,prepareTurn,turnPlanningSchema,turnPlanSchema,type TurnInput} from "./turn-planning";
import {navigationTarget} from "./place-lookup";

const view=(layer="c40",current="beijing"):WorkspaceViewContext=>({version:1,surface:"earth",activeLayer:{id:layer,title:layer==="c40"?"C40 城市":"森林月度图层",status:"ready",controls:[{
  id:layer==="c40"?"city":"time",label:layer==="c40"?"城市":"观测期",ordered:true,
  current:{id:current,label:current},options:(layer==="c40"?["shanghai","beijing","guangzhou"]:["2023-01-15","2023-07-15","2023-08-15"]).map(id=>({id,label:id}))}]}});
const context=(workspaceView?:WorkspaceViewContext):DiscoveryContext=>({caseId:null,filters:emptyFilters(),selection:null,citation:null,gridSystem:"h3",layer:"all",camera:{center:[116,40],zoom:50,reason:"旧相机说明并非选项"},...(workspaceView?{workspaceView}:{})});
const plan=(question:string,action="respond",workspaceAction:unknown=null)=>({action,goal:question,evidenceNeed:action==="search"?"discover":action==="clarify"?"unclear":"none",targets:[],
  reason:"受控模型回执，验证正式传输和动作校验",clarification:action==="clarify"?"你指的是哪个可操作对象？":null,
  evidenceGap:action==="search"?"需要用户明确要求的新资料":null,researchIntent:{purpose:question,task:question,region:null,time:null,months:[]},conversationContext:question,workspaceAction});
const control=(layerId="c40",controlId="city",valueId="shanghai")=>({kind:"set-control",layerId,controlId,valueId});

function fixture(t:TestContext){
  const dir=mkdtempSync(path.join(tmpdir(),"oe-workspace-prompt-")),oldPath=process.env.PATH,originalFetch=globalThis.fetch;
  const configFile=path.join(dir,"replies.json"),logFile=path.join(dir,"calls.jsonl");
  // This is an executor stub, not a language classifier: each case supplies its
  // model output. It captures the production prompt/schema and rejects network.
  writeFileSync(path.join(dir,"codex"),`#!${process.execPath}\nimport fs from 'node:fs';let prompt='';for await(const chunk of process.stdin)prompt+=chunk;const at=process.argv.indexOf('--output-schema');const schema=at<0?null:JSON.parse(fs.readFileSync(process.argv[at+1],'utf8'));fs.appendFileSync(${JSON.stringify(logFile)},JSON.stringify({prompt,schema})+'\\n');const replies=JSON.parse(fs.readFileSync(${JSON.stringify(configFile)},'utf8'));process.stdout.write(JSON.stringify(prompt.includes('先决定本轮要做什么')?replies.plan:replies.answer));\n`,{mode:0o700});
  process.env.PATH=dir+path.delimiter+oldPath;globalThis.fetch=async()=>assert.fail("view operation must not use remote data or geocoding");
  const tasks=openTaskStore(":memory:");
  const services={tasks,push:{latest(){return {records:[]};}},coverage:async()=>assert.fail("view snapshot is not a coverage handle"),researchRegionService:{locate:async()=>assert.fail("view snapshot is not a research region")},adminBoundaryDir:dir,canonicalCache:new Map()} as unknown as RuntimeServices;
  t.after(()=>{tasks.close();globalThis.fetch=originalFetch;if(oldPath===undefined)delete process.env.PATH;else process.env.PATH=oldPath;rmSync(dir,{recursive:true,force:true});});
  return {tasks,async run(query:string,ctx:DiscoveryContext,output:unknown,answer="当前显示状态"){
    writeFileSync(configFile,JSON.stringify({plan:output,answer:{message:answer,sections:[],limitation:"仅描述界面显示。",followUp:"",researchNotes:[],calculationRequests:[]}}));
    const before=readCalls().length,body={query,context:ctx,history:[],conversationId:randomUUID(),turnId:randomUUID(),config:{executor:"codex" as const,model:""}},id=randomUUID();
    tasks.submit(id,body);tasks.claim();const outcome=await executeTurn(services,id,body,new AbortController().signal,event=>tasks.append(id,event));
    tasks.finish(id,outcome.error?"failed":"complete",outcome);
    return {id,outcome,result:outcome.result as any,calls:readCalls().slice(before)};
  }};
  function readCalls():Array<{prompt:string;schema:any}>{try{return readFileSync(logFile,"utf8").trim().split("\n").filter(Boolean).map(line=>JSON.parse(line));}catch{return [];}}
}

test("optional browser snapshot is validated independently of authorized research context",()=>{
  const ctx=context(view());assert.ok(validContext(ctx));assert.ok(validContext(context()));
  assert.equal(validContext({...ctx,workspaceView:null}),false);
  assert.equal(validContext({...ctx,workspaceView:{...view(),sourceText:"not a permitted snapshot field"}}),false);
  const malformed=view();malformed.activeLayer!.controls[0].options.push({id:"beijing",label:"duplicate"});
  assert.equal(validContext(context(malformed)),false);
  const descriptive=view();descriptive.display=[{label:"图例",value:"显示值不是QC结果"}];assert.ok(validContext(context(descriptive)));
  // No equality requirement: an attached research scope may differ from browsing.
  assert.ok(validContext({...ctx,filters:{...ctx.filters,place:"已确认研究范围"}}));
});

test("derived strict schema adds nullable typed action only for new clients",()=>{
  assert.equal(turnPlanningSchema({}),turnPlanSchema);
  const schema=turnPlanningSchema({workspaceView:view()});assert.ok(schema.required.includes("workspaceAction"));
  assert.ok(Object.keys(schema.properties).every(key=>schema.required.includes(key)));
  assert.ok("workspaceAction" in schema.properties);
  assert.equal(schema.properties.workspaceAction.anyOf[1].additionalProperties,false);
  assert.deepEqual(schema.properties.workspaceAction.anyOf[1].required,["kind","layerId","controlId","valueId"]);
});

test("plain model output can omit the neutral field without granting a workspace action",()=>{
  const question="为什么会有季节？";
  const input:TurnInput={question,context:context(view()),history:[]};
  const ordinary={...plan(question),workspaceAction:undefined};
  assert.equal(parseTurnPlan(JSON.stringify(ordinary),input).workspaceAction,null);
  const command={...plan("切换到上海看看","workspace"),workspaceAction:undefined};
  assert.throws(()=>parseTurnPlan(JSON.stringify(command),{...input,question:"切换到上海看看"}),/视图动作/);
});

test("same utterance reaches the actual executor with distinct view states and yields validated absolute actions",async t=>{
  const f=fixture(t),query="切换到下一个。";
  for(const [snapshot,action] of [[view(),control("c40","city","guangzhou")],[view("forest","2023-07-15"),control("forest","time","2023-08-15")]] as const){
    const ctx=context(snapshot);ctx.candidateIds=["paper:unrelated-version"];
    const r=await f.run(query,ctx,plan(query,"workspace",action));
    assert.equal(r.outcome.error,undefined);assert.deepEqual(r.result.workspaceAction,action);assert.equal(r.result.camera,undefined);
    assert.equal(r.calls.length,1);assert.match(r.calls[0].prompt,/workspaceView/);assert.match(r.calls[0].prompt,new RegExp(snapshot.activeLayer!.controls[0].current.id));
    assert.ok(r.calls[0].schema.required.includes("workspaceAction"));assert.ok(!r.result.runTrace.calls.some((c:any)=>c.id.startsWith("paper-details")));
    assert.deepEqual((f.tasks.terminal(r.id) as any).result.workspaceAction,action);
  }
});

test("explicit place command still consults the planner in the new path instead of forcing navigation",async t=>{
  const f=fixture(t),query="飞到上海";
  const r=await f.run(query,context(view()),plan(query));
  assert.equal(r.outcome.error,undefined);assert.equal(r.calls.length,2);assert.equal(r.result.workspaceAction,undefined);assert.equal(r.result.camera,undefined);
});

test("an unresolved next selection never degrades to a geographic lookup",async t=>{
  const f=fixture(t),query="切换到下一个。";
  const r=await f.run(query,context({version:1,surface:"earth"}),plan(query,"workspace"));
  assert.equal(r.outcome.error,undefined);assert.equal(r.calls.length,1);assert.equal(r.result.camera,undefined);assert.equal(r.result.workspaceAction,undefined);
  assert.match(r.result.message,/没有执行界面切换/);
});

test("same forest question supplies January/August current choice to the existing synthesis, with no discovery",async t=>{
  const f=fixture(t),query="我现在看的这期是哪年哪月？";
  for(const date of ["2023-01-15","2023-08-15"]){
    const ctx=context(view("forest",date));ctx.filters.place="独立的研究范围";
    const r=await f.run(query,ctx,plan(query),"当前显示 "+date.slice(0,7)+" 的观测期。");
    assert.equal(r.outcome.error,undefined);assert.equal(r.calls.length,2);assert.match(r.result.message,new RegExp(date.slice(0,7)));
    const payload=JSON.parse(r.calls[1].prompt.slice(r.calls[1].prompt.lastIndexOf('\n{"question":')+1));
    assert.equal(payload.workspace.workspaceView.activeLayer.controls[0].current.id,date);assert.equal(payload.workspace.filters.place,"独立的研究范围");
    assert.equal(payload.workspace.visualization,undefined);assert.deepEqual(payload.catalogue,[]);assert.equal(r.result.workspaceAction,undefined);
    assert.ok(r.result.runTrace.calls.every((c:any)=>!c.id.includes("discovery")&&!c.id.startsWith("paper-details")));
  }
});

test("unavailable/foreign/invented controls and non-workspace actions cannot carry a UI mutation",()=>{
  const input:TurnInput={question:"切换到上海看看",context:context(view()),history:[]};
  for(const action of [control("forest"),control("c40","time"),control("c40","city","invented"),{...control(),patch:{zoom:9}}])
    assert.throws(()=>parseTurnPlan(JSON.stringify(plan(input.question,"workspace",action)),input),/视图动作/);
  assert.throws(()=>parseTurnPlan(JSON.stringify(plan(input.question,"respond",control())),input),/视图动作/);
  const unavailable=view();unavailable.activeLayer!.status="loading";unavailable.activeLayer!.controls=[];
  assert.equal(workspaceViewActionAllowed(unavailable,control()),false);
  assert.throws(()=>parseTurnPlan(JSON.stringify(plan(input.question,"workspace",control())),{...input,context:context(unavailable)}),/视图动作/);
  assert.throws(()=>parseTurnPlan(JSON.stringify(plan("为什么切换到上海？","workspace",control())),{...input,question:"为什么切换到上海？"}),/没有明确授权/);
  assert.throws(()=>parseTurnPlan(JSON.stringify(plan("把城市改成上海会怎样？","workspace",control())),{...input,question:"把城市改成上海会怎样？"}),/没有明确授权/);
  for(const question of ["切到下一个。","下一项。","把城市改成上海"])
    assert.deepEqual(parseTurnPlan(JSON.stringify(plan(question,"workspace",control())),{...input,question}).workspaceAction,control());
  assert.throws(()=>parseTurnPlan(JSON.stringify(plan("请查找上海新的数据资料","workspace",control())),{...input,question:"请查找上海新的数据资料"}),/必要检索/);
});

test("view identity does not become a readable target or discovery permission; planner chooses ambiguity",async()=>{
  const snapshot=view();snapshot.focus={kind:"evidence",id:"private-file",title:"可见来源标题"};
  const input:TurnInput={question:"切换到下一个。",context:context({...snapshot,activeLayer:undefined}),history:[]};
  let calls=0,searches=0;
  const prepared=await prepareTurn(input,new AbortController().signal,{run:async prompt=>{calls++;assert.match(prompt,/可见来源标题/);return JSON.stringify(plan(input.question,"clarify"));},stage:()=>{},report:()=>{},search:async()=>{searches++;assert.fail();}});
  assert.equal(prepared.plan.action,"clarify");assert.deepEqual(prepared.plan.targets,[]);assert.equal(calls,1);assert.equal(searches,0);
  assert.throws(()=>parseTurnPlan(JSON.stringify({...plan(input.question,"read"),evidenceNeed:"read",targets:["asset:private-file"]}),input),/对象无效/);
});

test("new view plans are not rewritten by the old navigation override; legacy plans keep it",async()=>{
  for(const fresh of [true,false]){
    const input:TurnInput={question:"飞到上海",context:context(fresh?view():undefined),history:[]};
    const output:any=plan(input.question);if(!fresh)delete output.workspaceAction;
    const prepared=await prepareTurn(input,new AbortController().signal,{run:async()=>JSON.stringify(output),stage:()=>{},report:()=>{},search:async()=>assert.fail()});
    assert.equal(prepared.plan.action,fresh?"respond":"workspace");
  }
});

test("post-planner geographic parsing removes generic courtesy suffixes without weakening legacy navigation",()=>{
  assert.equal(navigationTarget("切换到上海看看"),null);
  assert.equal(navigationTarget("切换到上海看看",true)?.place,"上海");
  assert.equal(navigationTarget("切换到杭州看一下",true)?.place,"杭州");
  assert.equal(navigationTarget("切换到上海的数据看看",true),null);
  assert.equal(navigationTarget("切换到那边看看",true),null);
  assert.equal(navigationTarget("切换到下一个看看",true),null);
  assert.equal(navigationTarget("切换到下一期",true),null);
  assert.equal(navigationTarget("为什么切换到上海？",true),null);
});
