import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {synthesizeAnswer,needsVerifiedCalculation,retainedSourceAnswer} from "../../server/scientific-answer";
import {modelReply} from "../../server/chat-executor";
import {parseTurnPlan,turnMetadata,type TurnInput} from "../../server/turn-planning";
import {emptyFilters} from "./spatial";
import type {AnswerReference,ToolCall} from "./types";

const ref:AnswerReference={kind:"asset",id:"source-a",title:"产品 A 的来源资料",source:"测试来源"};
const references=[ref],signal=()=>new AbortController().signal;
const sourceDraft={message:"来源列出产品 A 和产品 B，可继续核对各自的覆盖范围。[S1]\n\n例如，作者报告产品 A 的 RMSE 为 4.2 m、MAE 为 3.1 m，产品 B 为 5.0 m 和 3.6 m；这些不确定度是来源报告值，不是本轮演算。[S1]",calculationRequests:[]};
const arithmeticDraft={message:"产品 A 的来源记录仍可用于后续核对。[S1]\n\n4000 × 0.0068948 = 27.597 MPa。",calculationRequests:[]};
const internal={message:"这份草稿没有可供核验的数值输入，因此 calculationRequests 为空。",calculationRequests:[]};

test("source-reported accuracy values and versions do not trigger a calculation plan or replace the answer",async()=>{
 let calls=0;
 const answer=await synthesizeAnswer("列出全球建筑高度数据及来源",references,[],async()=>{calls++;return JSON.stringify(sourceDraft)},signal(),undefined,undefined,{enforceCalculations:true});
 assert.equal(needsVerifiedCalculation(sourceDraft),false);assert.equal(calls,1);
 assert.match(answer.message,/产品 A 和产品 B/);assert.match(answer.message,/4\.2 m/);assert.equal(answer.references.length,1);assert.doesNotMatch(answer.message,/calculationRequests/);
 assert.equal(needsVerifiedCalculation({message:"研究2020-2023年建筑高度，RMSE=4.2 m、MAE=3.1 m。"}),false);
 assert.equal(needsVerifiedCalculation({message:"例如产品A有2018、2020、2023版本，标准差分别为3.1、4.2、2.8。"}),false);
 assert.equal(needsVerifiedCalculation({message:"4000 × 0.0068948 = 27.5792 MPa。"}),true);
 assert.equal(needsVerifiedCalculation({message:"合成示例：A(80,10)、B(60,20)，min-max归一化后比较得分。"}),true);
});

test("an empty calculation plan is never a final answer; final synthesis receives the original draft",async()=>{
 const prompts:string[]=[],plans:string[]=[],replies=[arithmeticDraft,internal,{...sourceDraft,message:"产品 A 仍是候选；来源报告的 RMSE 为 4.2 m，尚未进行新演算。[S1]"}];
 const answer=await synthesizeAnswer("回答产品问题",references,[],async p=>{prompts.push(p);return JSON.stringify(replies.shift())},signal(),undefined,undefined,{enforceCalculations:true,onCalculationPlan:s=>plans.push(s)});
 assert.equal(prompts.length,3);assert.deepEqual(plans,["running","partial"]);assert.match(prompts[2],/产品 A 的来源记录/);
 assert.match(answer.message,/产品 A/);assert.match(answer.message,/4\.2 m/);assert.equal(answer.references.length,1);assert.doesNotMatch(answer.message,/calculationRequests/);
});

test("calculation preparation timeout or malformed output retains valid source content, never unchecked arithmetic",async()=>{
 for(const failure of ["timeout","malformed"]){
  let calls=0;const nodes:any[]=[],plans:string[]=[];
  const answer=await synthesizeAnswer("材料",references,[],async()=>{if(++calls===1)return JSON.stringify(arithmeticDraft);if(failure==="timeout")throw Error("Injected timeout");return "not JSON"},signal(),undefined,undefined,{enforceCalculations:true,onCalculationPlan:s=>plans.push(s),onNodeFailure:n=>nodes.push(n)});
  assert.equal(calls,2);assert.match(answer.message,/产品 A/);assert.doesNotMatch(answer.message,/27\.597|4000/);assert.equal(answer.references[0],ref);
  assert.deepEqual(plans,["running","failed"]);assert.equal(nodes[0].node,"calculation-plan");assert.equal(nodes[0].retained,true);
  assert.deepEqual(answer.recovery?.failedNodes,["calculation-plan"]);assert.match(answer.limitation,/未完成/);
 }
});

test("a failed final synthesis preserves the validated draft and actual calculation report",async()=>{
 let calls=0;const reports:any[]=[],nodes:any[]=[];
 const answer=await synthesizeAnswer("材料",references,[],async()=>{
  calls++;if(calls===1)return JSON.stringify(arithmeticDraft);
  if(calls===2)return JSON.stringify({...internal,calculationRequests:[{operation:"arithmetic",arguments:JSON.stringify({expression:"4000*0.0068948"}),scope:"source",sourceRefs:["S1"]}]});
  throw Error("Injected final synthesis timeout");
 },signal(),undefined,r=>reports.push(r),{enforceCalculations:true,onNodeFailure:n=>nodes.push(n)});
 assert.equal(calls,3);assert.equal(reports.length,1);assert.equal(reports[0].status,"completed");assert.equal(reports[0].result.value,27.5792);
 assert.match(answer.message,/产品 A/);assert.doesNotMatch(answer.message,/27\.597|calculationRequests/);assert.equal(nodes[0].node,"final-answer");assert.equal(answer.references.length,1);
 assert.match(answer.limitation,/已取得受控核算结果/);assert.doesNotMatch(answer.limitation,/数值演算尚未完成|未取得成功的受控核算/);
});

test("a completed calculation is not labelled incomplete when there was no narrative checkpoint",async()=>{
 let calls=0;const reports:any[]=[];
 const answer=await synthesizeAnswer("核算示例",[],[],async()=>{if(++calls===1)return JSON.stringify({message:"1 + 2 = 4。",calculationRequests:[{operation:"arithmetic",arguments:'{"expression":"1+2"}',scope:"example",sourceRefs:[]}]});throw Error("Injected formatting failure")},signal(),undefined,r=>reports.push(r));
 assert.equal(calls,2);assert.equal(reports[0].result.value,3);assert.match(answer.limitation,/已取得受控核算结果/);assert.doesNotMatch(answer.message+answer.limitation,/演算尚未完成|未取得成功的受控核算/);
});

test("internal control replies or invalid final citations cannot erase the earlier valid answer",async()=>{
 for(const broken of [internal,{message:"错误引用[S99]",calculationRequests:[]}]){
  let calls=0,repairs=0;const nodes:any[]=[];
  const answer=await synthesizeAnswer("材料",references,[],async()=>JSON.stringify(++calls===1?arithmeticDraft:calls===2?internal:broken),signal(),()=>repairs++,undefined,{enforceCalculations:true,onNodeFailure:n=>nodes.push(n)});
  assert.equal(calls,4);assert.equal(repairs,1);assert.equal(nodes[0].node,"answer-repair");assert.match(answer.message,/产品 A/);
  assert.doesNotMatch(answer.message,/calculationRequests|S99|27\.597/);assert.equal(answer.references.length,1);assert.deepEqual(answer.recovery?.failedNodes,["answer-repair"]);
 }
});

test("an invalid original source draft is never promoted to a checkpoint after repair failure",async()=>{
 let calls=0;
 await assert.rejects(synthesizeAnswer("材料",references,[],async()=>{calls++;return JSON.stringify({message:"无效来源[S99]",calculationRequests:[]})},signal()),/引用/);
 assert.equal(calls,2);
});

test("cancellation during an auxiliary node never publishes a retained answer or retries",async()=>{
 let calls=0;const controller=new AbortController();
 await assert.rejects(synthesizeAnswer("材料",references,[],async()=>{if(++calls===1)return JSON.stringify(arithmeticDraft);controller.abort();throw Error("stop")},controller.signal,undefined,undefined,{enforceCalculations:true}),{name:"AbortError"});
 assert.equal(calls,2);
});

test("source-only recovery lists real identities and keeps channel metadata without scientific or calculation claims",()=>{
 const web={kind:"web" as const,title:"实际读到的网页",url:"https://example.org/source",sourceChannel:"web" as const};
 const answer=retainedSourceAnswer([{...ref,sourceChannel:"assertion"},web],[{title:web.title,url:web.url,snippet:"已返回的摘要"}])!;
 assert.equal(answer.references.length,2);assert.equal(answer.references[0].sourceChannel,"assertion");assert.equal(answer.references[1].sourceChannel,"web");
 assert.match(answer.message,/来源条目/);assert.match(answer.message,/产品 A/);assert.match(answer.limitation,/未能|未形成/);assert.equal(answer.webSources.length,1);
 assert.equal(retainedSourceAnswer([],[]),undefined);
});

test("the live reply builder preserves selected source identities when the model executable fails",async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),"oneearth-compose-failure-")),oldPath=process.env.PATH;
 try{
  await writeFile(path.join(dir,"codex"),"#!/bin/sh\nexit 1\n",{mode:0o755});process.env.PATH=dir+path.delimiter+(oldPath||"");
  const input:TurnInput={question:"解释这份已引用资料",history:[],context:{caseId:null,filters:emptyFilters(),selection:null,gridSystem:"h3",layer:"all",camera:{center:[105,25],zoom:1,reason:"test"},citation:null,attachedScope:[{kind:"dataset",id:"wind-0",title:"GFS 风场",version:null,source:"已接入资料"}]}};
  const plan=parseTurnPlan(JSON.stringify({action:"respond",goal:input.question,evidenceNeed:"existing",targets:["asset:wind-0"],reason:"依据指定对象",clarification:null,...turnMetadata(input.question,input),searchPlan:null}),input);
  const calls:ToolCall[]=[];
  const reply=await modelReply(input.question,input.context,{message:"仅解释已提供材料"},[],{executor:"codex",model:""},signal(),()=>{},false,[],"",undefined,undefined,c=>calls.push(c),{plan,searches:[]});
  assert.match(reply.message,/来源条目/);assert.deepEqual(reply.modelIds,["wind-0"]);assert.equal(reply.answerNotes?.references?.length,1);
  assert.ok(calls.some(c=>c.id==="answer-generation"&&c.status==="failed"));assert.ok(!calls.some(c=>c.id==="synthesis-repair"&&c.status==="done"));
 }finally{if(oldPath===undefined)delete process.env.PATH;else process.env.PATH=oldPath;await rm(dir,{recursive:true,force:true});}
});
