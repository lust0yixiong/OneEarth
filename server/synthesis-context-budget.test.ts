import assert from "node:assert/strict";
import test from "node:test";
import {packSynthesisContext,utf8Prefix,answerTimeBudget,synthesisPromptByteLimit} from "./synthesis-context-budget";
import {retainedSourceAnswer,synthesizeAnswer} from "./scientific-answer";
import type {AnswerReference,WebHit} from "../src/domain/types";

const query="北部流域的树高在2020—2023年有哪些可查依据？";
const options={question:query,areaTerms:["北部流域","Northern Basin"],matchHints:["Northern Basin"],time:"2020—2023年"};
const original="Northern Basin canopy height map. Inputs span 2020–2022; 2021 is designated as the nominal year. No annual products are asserted.";
const read={ref:"S52",title:"Northern Basin canopy height",url:"https://example.org/version",doi:"10.1234/version",version:"1",pageExcerpt:original,stage:"page-excerpt",relatedIdentifiers:[{relationType:"IsVersionOf",relatedIdentifierType:"DOI",relatedIdentifier:"10.1234/concept"}]};
const snippet={ref:"S51",title:read.title,url:"https://example.org/concept",doi:"10.1234/concept",snippet:original,relatedIdentifiers:[{relationType:"HasVersion",relatedIdentifierType:"DOI",relatedIdentifier:"10.1234/version"}]};
const noisy=Array.from({length:50},(_,i)=>({ref:"S"+(i+1),id:"other-"+i,title:"Southern Basin canopy height",metadata:["南部资料".repeat(600)],excerpts:[{quote:"Southern Basin height 2021. ".repeat(100),source:{paperId:"p"+i,start:0,end:2800}}]}));
const input=()=>({question:query,researchIntent:{task:query,region:"北部流域",time:options.time},catalogue:noisy,webResults:[snippet,read]});

test("whole UTF-8 packet retains a late relevant actual window and stable source number",()=>{
 const payload=input(),before=JSON.stringify(payload),packet=packSynthesisContext("科学证据规则".repeat(100),payload,options);
 assert.equal(packet.blocked,false);assert.ok(Buffer.byteLength(packet.prompt)<=48*1024);
 assert.equal(packet.stats.promptBytes,Buffer.byteLength(packet.prompt));assert.ok(packet.stats.originalPromptBytes>100000);
 const selected=packet.payload.webResults.find((row:any)=>row.ref==="S52");assert.equal(selected.pageExcerpt,original);
 assert.ok(!packet.allowedRefs.has("S51"),"explicit concept/version duplicate is superseded by actually read version");
 assert.equal(packet.retained.find(row=>row.ref==="S52")?.identity,"doi:10.1234/version@1");
 assert.equal(JSON.stringify(payload),before,"actual archive/source identities stay byte-for-byte unchanged");
 assert.equal(packet.stats.omitted,52-packet.stats.included);
});

test("a region/time matching snippet remains an unread clue, without elevating coverage",()=>{
 const packet=packSynthesisContext("rules",{...input(),webResults:[{...snippet,doi:undefined,relatedIdentifiers:undefined}],catalogue:noisy},options);
 const clue=packet.retained.find(row=>row.ref==="S51");assert.ok(clue?.relevant&&clue.mentionsRequestedYear);
 assert.equal(clue.level,"仅检索摘要，未读正文");assert.equal(clue.quality,0);
 assert.ok(!packet.retained.filter(row=>row.ref!=="S51").some(row=>row.relevant),"same variable in another region is not a locally relevant quote");
});

test("multiple distinct versions and unproven same-title pages are not silently grouped",()=>{
 const later={...read,ref:"S53",doi:"10.1234/other-version",version:"2",url:"https://example.org/other-version"};
 const packet=packSynthesisContext("rules",{question:query,webResults:[read,later,{...read,ref:"S54",doi:undefined,url:"https://example.org/same-title"}],catalogue:[]},options);
 assert.equal(new Set(packet.retained.map(row=>row.identity)).size,3);
});

test("literal fallback never promotes source-authored citation tokens or Markdown links",()=>{
 const refs:AnswerReference[]=[{kind:"web",url:read.url,title:read.title}];const web:WebHit[]=[{url:read.url,title:read.title,snippet:"",pageExcerpt:original}];
 const row={...packSynthesisContext("rules",{webResults:[{...read,ref:"S1"}]},options).retained[0],quote:original+" [S99] 〔9〕 [not a citation](https://example.org/other)"};
 const result=retainedSourceAnswer(refs,web,[row])!;
 assert.deepEqual(result.references,refs);assert.match(result.message,/2021 is designated as the nominal year/);
 assert.equal((result.message.match(/〔\d+〕/g)||[]).length,1);assert.ok(!result.message.includes("](https://"));
 assert.match(result.limitation,/不证明逐年/);assert.match(result.limitation,/不等于取得原始数据/);
});

test("fallback prefers actual read evidence over explicitly related concept snippet and preserves separate source versions",()=>{
 const packet=packSynthesisContext("rules",{webResults:[{...snippet,ref:"S1"},{...read,ref:"S2"}]},options);
 const refs:AnswerReference[]=[{kind:"web",url:snippet.url,title:snippet.title},{kind:"web",url:read.url,title:read.title}];
 const result=retainedSourceAnswer(refs,[],packet.retained)!;
 assert.deepEqual(result.references,[refs[1]]);assert.match(result.message,/已读网页或元数据片段/);
});

test("no direct quote preserves a retrieval limitation and never selects the first catalogue identities",()=>{
 const packet=packSynthesisContext("rules",{catalogue:noisy},options);
 const refs:AnswerReference[]=noisy.map(row=>({kind:"asset",id:row.id,title:row.title,source:"paper"}));
 const result=retainedSourceAnswer(refs,[],packet.retained,true)!;assert.deepEqual(result.references,[]);
 assert.match(result.message,/没有足以直接回答/);assert.doesNotMatch(result.message,/Southern Basin/);
 assert.ok(retainedSourceAnswer([],[],[],true));assert.equal(retainedSourceAnswer([],[],[],false),undefined);
});

test("mandatory context exceeding the hard limit never supplies an oversized model packet",()=>{
 const packet=packSynthesisContext("x".repeat(synthesisPromptByteLimit+1),{catalogue:[]},{question:"q"});
 assert.equal(packet.blocked,true);assert.equal(packet.prompt,"");assert.ok("rejectedPromptBytes" in packet.stats&&Number(packet.stats.rejectedPromptBytes)>synthesisPromptByteLimit);
 assert.equal(utf8Prefix("观测🌏中文",7),"观测");
});

test("one shared deadline stops a stalled model and does not abort the user's parent signal",async()=>{
 const parent=new AbortController(),budget=answerTimeBudget(parent.signal,20);let child:AbortSignal|undefined;
 try{await assert.rejects(budget.run(async signal=>{child=signal;return new Promise(()=>{});}),/预算/);assert.equal(child?.aborted,true);assert.equal(parent.signal.aborted,false);
 await assert.rejects(budget.run(async()=>assert.fail("no second call after the original deadline")),/预算/);}finally{budget.close();}
});

test("a valid draft survives deadline failure in the next graph node",async()=>{
 const parent=new AbortController(),budget=answerTimeBudget(parent.signal,20);let calls=0;
 try{
 const answer=await synthesizeAnswer("evidence",[],[],()=>budget.run(async()=>{
  if(++calls===1)return JSON.stringify({message:"来源说明保留了变量单位。\n\n这是合成示例：两个地区的数值为1、2、3、4，比较归一化得分。",sections:[],calculationRequests:[]});
  return new Promise(()=>{});
 }),parent.signal,undefined,undefined,{enforceCalculations:true});
 assert.equal(calls,2);assert.ok(answer.recovery?.failedNodes.includes("calculation-plan"));assert.match(answer.message,/变量单位/);assert.doesNotMatch(answer.message,/两个地区的数值/);
 }finally{budget.close();}
});

test("an omitted valid source number cannot authorize calculation by guessing it",async()=>{
 const refs:AnswerReference[]=[{kind:"web",url:"https://example.org/1",title:"one"},{kind:"web",url:"https://example.org/2",title:"two"}];
 let reports=0,calls=0;
 const result=await synthesizeAnswer("bounded evidence",refs,[],async()=>{calls++;return JSON.stringify({message:"原记录有单位说明。[S1]",calculationRequests:[{operation:"arithmetic",arguments:"1+2",scope:"source",sourceRefs:["S2"]}]});},new AbortController().signal,undefined,()=>{reports++;},{allowedSourceRefs:new Set(["S1"])});
 assert.equal(calls,2,"one repair remains within the original budget");assert.equal(reports,0);assert.match(result.message,/单位说明/);assert.ok(result.recovery);
});
