import assert from "node:assert/strict";
import test from "node:test";
import {prepareTurn,turnPlanningSchema,turnPlanSchema,type TurnInput} from "./turn-planning";
import {emptyFilters} from "../src/domain/spatial";
import {observationOrdinaryInput} from "./runtime-observation-authority";
const query="刚才那份资料的单位是什么？";
const context={filters:emptyFilters(),caseId:null,citation:null,selection:null,gridSystem:"h3" as const,layer:"all" as const,camera:{center:[0,0] as [number,number],zoom:1,reason:"controlled"}};
function plan(question:string,use:"unrelated"|"unavailable"){return {action:use==="unavailable"?"search":"respond",goal:question,evidenceNeed:use==="unavailable"?"discover":"none",targets:[],reason:"本轮目的的语义判断",clarification:null,evidenceGap:use==="unavailable"?"缺少旧文件事实":null,
  researchIntent:{purpose:question,task:question,region:null,time:null,months:[]},conversationContext:question,observationUse:use};}
for(const use of ["unavailable","unrelated"] as const)test("one ordinary planner call distinguishes unavailable file dependence from unrelated concepts: "+use,async()=>{
  const question=use==="unavailable"?query:"什么是单位换算？",raw={query:question,previousTaskId:"private",history:[{role:"assistant",text:"OLD_PRIVATE_FACT"}],context:{...context,citation:{body:"OLD_PRIVATE_EXCERPT"}}};
  const body=observationOrdinaryInput(raw,true),input:TurnInput={question,context:body.context,history:body.history,observationUnavailable:true};let calls=0,searches=0;
  const schema=turnPlanningSchema(input);assert.ok(schema.required.includes("observationUse"));assert.ok(Object.keys(schema.properties).every(key=>schema.required.includes(key)));
  const output=await prepareTurn(input,new AbortController().signal,{run:async prompt=>{calls++;assert.ok(!prompt.includes("OLD_PRIVATE"));assert.ok(!prompt.includes("private\""));assert.match(prompt,/此前观测资料现在不可用/);return JSON.stringify(plan(question,use));},stage:()=>{},report:()=>{},search:async()=>{searches++;assert.fail("no external lookup");}});
  assert.equal(calls,1);assert.equal(searches,0);if(use==="unavailable"){assert.equal(output.plan.action,"clarify");assert.match(output.plan.clarification!,/现在不可用/);}else assert.equal(output.plan.action,"respond");
});
test("ordinary planning schema is unchanged without a trusted unavailable-material marker",()=>{
  assert.equal(turnPlanningSchema({}),turnPlanSchema);assert.ok(!Object.hasOwn(turnPlanningSchema({}).properties,"observationUse"));
});
test("general with an ordinary parent preserves independent history, citation and confirmation",async()=>{
  const reference={kind:"web",url:"https://example.invalid/independent",title:"独立来源"};
  const body={query:"解释刚才独立论文中的方法。",previousTaskId:"ordinary-parent",questionDecision:{choice:"proposed",dataQuestion:"已确认的独立问题"},history:[{role:"assistant",text:"INDEPENDENT_HISTORY",conversationReferences:[reference]}],
    context:{...context,citation:{title:"独立摘录",scope:"web",url:reference.url,body:"INDEPENDENT_CITATION"},attachedScope:[{kind:"observation",artifactId:"irrelevant",version:"A",title:"无关附着"},{kind:"reference",reference,number:1,messageId:"independent"}]}};
  const safe=observationOrdinaryInput(body,false,false);assert.equal(safe.previousTaskId,body.previousTaskId);assert.deepEqual(safe.history,body.history);assert.deepEqual(safe.context.citation,body.context.citation);assert.deepEqual(safe.questionDecision,body.questionDecision);assert.equal(safe.context.attachedScope.length,1);
  const input:TurnInput={question:safe.query,context:safe.context as any,history:safe.history as any};let calls=0;
  await prepareTurn(input,new AbortController().signal,{run:async prompt=>{calls++;assert.match(prompt,/INDEPENDENT_HISTORY/);assert.match(prompt,/INDEPENDENT_CITATION/);const value:any=plan(input.question,"unrelated");delete value.observationUse;return JSON.stringify(value);},stage:()=>{},report:()=>{},search:async()=>assert.fail()});assert.equal(calls,1);assert.equal(turnPlanningSchema(input),turnPlanSchema);
});
