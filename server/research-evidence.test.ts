import assert from "node:assert/strict";
import test from "node:test";
import {DiscoveryA2AError} from "./discovery-a2a-client";
import {continueResearch,researchEvidenceAuthority} from "./research-evidence";
import type {DataSearchResult} from "./data-search";
import type {TurnPlan} from "./turn-planning";
import type {SearchRun,ToolCall} from "../src/domain/types";

const question="Which monthly precipitation data can be compared?";
const plan:TurnPlan={action:"search",evidenceNeed:"discover",goal:question,targets:[],reason:"find sources",
  clarification:null,researchIntent:{purpose:question,task:question,region:null,time:null,months:[]},
  conversationContext:question};
const address="https://example.org/research-data";
const start:DataSearchResult={
  plan:{questionMode:"preserve",dataQuestion:question,dataNeed:null,hainaQueries:[],paper:{name:"",facets:[],region:[]},web:[]},
  issues:[],sourceStatus:[],papers:[],haina:[],searches:[],
};
const lastDecision=(trace:ToolCall[])=>[...trace].reverse().find(call=>call.id.startsWith("research-decision-"));
const answer=JSON.stringify({action:"answer",reason:"materials sufficient",gap:null,targets:[],clarification:null});

test("sufficient evidence completes without calling either acquisition tool",async()=>{
  const trace:ToolCall[]=[];
  const result=await continueResearch(question,plan,{retrieval:start,reads:[]},new AbortController().signal,{
    model:async()=>answer,read:async()=>assert.fail(),discover:async()=>assert.fail(),stage:()=>{},report:call=>trace.push(call),
  });
  assert.equal(result.retrieval,start);
  assert.equal(JSON.parse(lastDecision(trace)!.output!).action,"answer");
});

test("a completed confirmation cannot be requested again by the evidence reviewer",async()=>{
  const trace:ToolCall[]=[];
  const confirmedPlan={...plan,goal:"Ask the user whether to convert the earlier question"};
  const result=await continueResearch(question,confirmedPlan,{retrieval:start,reads:[]},new AbortController().signal,{
    model:async prompt=>{
      const input=JSON.parse(prompt.slice(prompt.lastIndexOf("\n{")+1));
      assert.equal(input.goal,question);
      assert.equal(input.confirmation.choice,"proposed");
      assert.equal(input.confirmation.question,question);
      assert.equal(input.actions.includes("clarify"),false);
      return JSON.stringify({action:"clarify",reason:"Repeat confirmation",gap:null,targets:[],clarification:"Please confirm."});
    },
    read:async()=>assert.fail(),discover:async()=>assert.fail(),stage:()=>{},report:call=>trace.push(call),
  },{choice:"proposed",originalQuestion:confirmedPlan.goal,dataQuestion:question,checkMessageId:"ca419cd3-a9a1-4947-9a6b-1ac3dbd984c6"});
  assert.equal(result.retrieval?.plan,start.plan);
  assert.equal(result.assessment,"unresolved");assert.equal(result.clarification,undefined);
  assert.equal(JSON.parse(lastDecision(trace)!.output!).assessment,"unresolved");
});

test("the next decision sees materials actually returned by the selected source",async()=>{
  const clue:SearchRun={engine:"DeepSeek Search",query:"monthly precipitation",status:"done",
    hits:[{url:address,title:"Product documentation",snippet:"Official product"}]};
  const acquired:SearchRun={engine:"原站读取",query:address,status:"done",
    hits:[{url:address,title:"Product documentation",snippet:"Rate per day",pageExcerpt:"Averages of daily rates",stage:"page-excerpt"}]};
  let calls=0;
  const result=await continueResearch(question,plan,{retrieval:{...start,searches:[clue]},reads:[]},new AbortController().signal,{
    model:async prompt=>{
      if(++calls===1)return JSON.stringify({action:"read",reason:"need units",gap:"what units",targets:["W1"],clarification:null});
      assert.match(prompt,/Averages of daily rates/);
      assert.match(prompt,/"exactReadTargets":\[\]/);
      return answer;
    },
    read:async(targets,focus)=>{
      assert.equal(targets[0].url,address);
      assert.equal(focus,"what units");
      return [acquired];
    },discover:async()=>assert.fail(),stage:()=>{},report:()=>{},
  });
  assert.equal(calls,2);
  assert.deepEqual(result.reads,[acquired]);
});

test("a failed supplemental discovery preserves material and disables repeated discovery",async()=>{
  let calls=0;
  const result=await continueResearch(question,plan,{retrieval:start,reads:[]},new AbortController().signal,{
    model:async prompt=>{
      if(++calls===1)return JSON.stringify({action:"discover",reason:"need additional sources",gap:"units in version 2",targets:[],clarification:null});
      assert.match(prompt,/"actions":\["answer","clarify"\]/);
      return answer;
    },
    read:async()=>assert.fail(),discover:async focus=>{assert.equal(focus,"units in version 2");throw Error("upstream");},
    stage:()=>{},report:()=>{},
  });
  assert.equal(calls,2);
  assert.equal(result.retrieval?.plan,start.plan);
  assert.match(result.retrieval!.issues[0],/保留前面取得的材料/);
});

test("a confirmed goal still surfaces an actual provider clarification without silently re-confirming a new goal",async()=>{
  const result=await continueResearch(question,plan,{retrieval:start,reads:[]},new AbortController().signal,{
    model:async()=>JSON.stringify({action:"discover",reason:"need an exact station",gap:"station identity",targets:[],clarification:null}),
    discover:async()=>({...start,clarification:"Which station within the confirmed region?"}),read:async()=>assert.fail(),stage:()=>{},report:()=>{},
  },{choice:"proposed",originalQuestion:"original task",dataQuestion:question,checkMessageId:"confirmed-parent"});
  assert.equal(result.clarification,"Which station within the confirmed region?");
  assert.equal(result.retrieval,start);
});

test("a model cannot invent a read target or convert a pinned source into discovery",async()=>{
  const trace:ToolCall[]=[];
  const exact={...plan,action:"read" as const,targets:[{key:"web:"+address,kind:"web" as const,title:"Known",basis:"citation" as const,url:address}]};
  await continueResearch(question,exact,{reads:[]},new AbortController().signal,{
    model:async()=>JSON.stringify({action:"read",reason:"guess",gap:"units",targets:["W2"],clarification:null}),
    read:async()=>assert.fail(),discover:async()=>assert.fail(),stage:()=>{},report:call=>trace.push(call),
  });
  assert.equal(lastDecision(trace)?.status,"failed");
});

for(const fallback of [false,true])test("a Haina search cannot read a prior web citation before web is authorized, fallback="+fallback,async()=>{
  const sourcePolicy:NonNullable<DataSearchResult["plan"]["sourcePolicy"]>=fallback
    ? {mode:"restricted",sources:["haina","web"],fallback:"no_match"}
    : {mode:"restricted",sources:["haina"]};
  const retrieval:DataSearchResult={...start,plan:{...start.plan,sourcePolicy},
    sourceStatus:[{source:"海纳专区检索",status:"done",count:1,detail:""},
      {source:"网络检索",status:"not_requested",count:0,detail:"未启动"}]};
  const withPriorWeb={...plan,targets:[{key:"web:"+address,kind:"web" as const,title:"Prior citation",
    basis:"history" as const,url:address}]};
  const trace:ToolCall[]=[];
  const result=await continueResearch(question,withPriorWeb,{retrieval,reads:[]},new AbortController().signal,{
    model:async prompt=>{
      const input=JSON.parse(prompt.slice(prompt.lastIndexOf("\n{")+1));
      assert.deepEqual(input.materials.sourcePolicy,sourcePolicy);
      assert.deepEqual(input.materials.exactReadTargets,[]);
      assert.ok(!input.actions.includes("read"));
      return JSON.stringify({action:"read",reason:"mistakenly read the prior citation",gap:"metadata",targets:["W1"],clarification:null});
    },
    read:async()=>assert.fail("no out-of-scope read"),discover:async()=>assert.fail("no implicit search"),
    stage:()=>{},report:call=>trace.push(call),
  });
  assert.deepEqual(result.reads,[]);
  assert.equal(result.retrieval?.plan,retrieval.plan);assert.equal(result.assessment,"unresolved");
  assert.equal(lastDecision(trace)?.status,"failed");
  assert.equal(JSON.parse(lastDecision(trace)!.output!).assessment,"unresolved");
});

for(const marker of ["W1","[w1]"," w1 "])test("only an existing W marker can normalize to an exact read: "+marker,async()=>{
 let modelCalls=0,reads=0;
 await continueResearch(question,plan,{retrieval:{...start,searches:[{engine:"DeepSeek Search",query:question,status:"done",hits:[{url:address,title:"Known",snippet:"units"}]}]},reads:[]},new AbortController().signal,{
  model:async prompt=>{assert.match(prompt,/"action":"read"/);assert.match(prompt,/例子不代表W1实际存在/);return ++modelCalls===1?JSON.stringify({action:"read",reason:"units",gap:"units",targets:[marker],clarification:null}):answer;},
  read:async targets=>{reads++;assert.equal(targets[0].url,address);return [];},discover:async()=>assert.fail(),stage:()=>{},report:()=>{},
 });assert.equal(reads,1);assert.equal(modelCalls,2);
});
for(const marker of ["1","S1",address,"W99"])test("invalid reference syntax does not grant reading: "+marker,async()=>{
 let modelCalls=0;const trace:ToolCall[]=[];
 await continueResearch(question,plan,{retrieval:{...start,searches:[{engine:"DeepSeek Search",query:question,status:"done",hits:[{url:address,title:"Known",snippet:"units"}]}]},reads:[]},new AbortController().signal,{
  model:async()=>{modelCalls++;return JSON.stringify({action:"read",reason:"units",gap:"units",targets:[marker],clarification:null});},
  read:async()=>assert.fail(),discover:async()=>assert.fail(),stage:()=>{},report:call=>trace.push(call),
 });assert.equal(modelCalls,8);assert.equal(lastDecision(trace)?.status,"failed");
});

test("a conflicting extra action field is rejected without guessing the original failed output",async()=>{
 const trace:ToolCall[]=[];
 await continueResearch(question,plan,{retrieval:start,reads:[]},new AbortController().signal,{
  model:async()=>JSON.stringify({action:"answer",reason:"enough",gap:null,targets:[],clarification:null,read:"W1"}),
  read:async()=>assert.fail(),discover:async()=>assert.fail(),stage:()=>{},report:call=>trace.push(call),
 });assert.equal(lastDecision(trace)?.status,"failed");
});

const choice=(action:string,targets:string[]=[],gap:string|null=null)=>JSON.stringify({action,reason:"bounded next step",targets,gap,clarification:null});
const readPlan={...plan,action:"read" as const,evidenceNeed:"read" as const,targets:[{key:"web:"+address,kind:"web" as const,title:"Selected original",basis:"citation" as const,url:address}]};
const acquired:SearchRun={engine:"原站读取",query:address,status:"done",hits:[{url:address,title:"Selected original",snippet:"",pageExcerpt:"A partial literal method paragraph.",stage:"page-excerpt"}]};

test("an invalid W label gets one real-error reassessment and no read before correction",async()=>{
 let calls=0,reads=0;const trace:ToolCall[]=[];
 const result=await continueResearch(question,plan,{retrieval:{...start,searches:[{engine:"DeepSeek Search",query:question,status:"done",hits:[{url:address,title:"Actual allowed source",snippet:"unit clue"}]}]},reads:[]},new AbortController().signal,{
  model:async prompt=>{
   const input=JSON.parse(prompt.slice(prompt.lastIndexOf("\n{")+1));
   if(++calls===1)return choice("read",["W99"],"unit field");
   assert.equal(reads,0);assert.equal(input.previousFailure.kind,"decision");assert.equal(input.previousFailure.toolAttempted,false);
   assert.equal(input.previousFailure.diagnostic.code,"target-not-allowed");assert.deepEqual(input.previousFailure.diagnostic.invalidTargets,["W99"]);assert.equal(input.resources.remainingModelCalls,6);return answer;
  },read:async()=>{reads++;return [];},discover:async()=>assert.fail(),stage:()=>{},report:row=>trace.push(row),
 });assert.equal(calls,2);assert.equal(reads,0);assert.equal(result.assessment,"answer");assert.equal(trace[0].status,"running");assert.ok(trace.some(r=>r.status==="failed"));
});

test("a failed model receives a fixed diagnostic, not its raw invalid JSON or an implicit answer",async()=>{
 let calls=0;const trace:ToolCall[]=[];
 const result=await continueResearch(question,plan,{retrieval:start,reads:[]},new AbortController().signal,{
  model:async prompt=>{if(++calls===2)assert.match(prompt,/证据决策不是有效JSON/);return "PRIVATE_INVALID_PAYLOAD";},read:async()=>assert.fail(),discover:async()=>assert.fail(),stage:()=>{},report:row=>trace.push(row),
 });assert.equal(calls,8);assert.equal(result.assessment,"unresolved");assert.ok(result.issues?.length);assert.ok(!JSON.stringify(trace).includes("PRIVATE_INVALID_PAYLOAD"));assert.ok(!JSON.stringify(trace).includes("answer-with-available"));
});

test("authorized read-first research creates its first discovery without a fictitious previous result",async()=>{
 let calls=0,finds=0;
 const result=await continueResearch(question,readPlan,{reads:[acquired]},new AbortController().signal,{
  model:async prompt=>{if(++calls===1){assert.match(prompt,/partial literal method/);return choice("discover",[],"independent validation");}assert.match(prompt,/new independently returned source/);return answer;},
  read:async()=>assert.fail(),discover:async focus=>{finds++;assert.equal(focus,"independent validation");return {...start,searches:[{engine:"DeepSeek Search",query:focus,status:"done",hits:[{url:"https://example.org/independent",title:"new independently returned source",snippet:"actual clue"}]}]};},stage:()=>{},report:()=>{},
 },undefined,{allowDiscovery:true});
 assert.equal(finds,1);assert.equal(calls,2);assert.equal(result.reads[0],acquired);assert.equal(result.retrieval?.searches[0].hits[0].title,"new independently returned source");
});

test("same-source-only can ask about expansion but cannot execute discovery",async()=>{
 let calls=0;
 const result=await continueResearch("只根据这份资料解释原文。",readPlan,{reads:[acquired]},new AbortController().signal,{
  model:async prompt=>{const input=JSON.parse(prompt.slice(prompt.lastIndexOf("\n{")+1));assert.ok(!input.actions.includes("discover"));return ++calls===1?choice("discover",[],"more sources"):JSON.stringify({action:"clarify",reason:"scope choice",gap:null,targets:[],clarification:"原来源不足，是否允许增加独立来源？"});},
  read:async()=>assert.fail(),discover:async()=>assert.fail("not authorized"),stage:()=>{},report:()=>{},
 },undefined,researchEvidenceAuthority("只根据这份资料解释原文。",readPlan));assert.equal(result.assessment,"clarify");assert.equal(calls,2);assert.equal(result.reads[0],acquired);
});

test("only an actual successful partial read permits one different-gap reread of the same authorized URL",async()=>{
 let calls=0,reads=0;
 const result=await continueResearch(question,readPlan,{reads:[acquired],attemptedReadTargets:[address]},new AbortController().signal,{
  model:async prompt=>{const input=JSON.parse(prompt.slice(prompt.lastIndexOf("\n{")+1));if(++calls===1){assert.equal(input.materials.exactReadTargets[0].purpose,"bounded-reread");return choice("read",["W1"],"the uncertainty definition not present in the first window");}assert.deepEqual(input.materials.exactReadTargets,[]);return answer;},
  read:async targets=>{reads++;assert.equal(targets[0].url,address);return [{...acquired,hits:[{...acquired.hits[0],pageExcerpt:"The second actual window defines uncertainty."}]}];},discover:async()=>assert.fail(),stage:()=>{},report:()=>{},
 },undefined,{allowDiscovery:false,allowReread:true});assert.equal(reads,1);assert.equal(calls,2);assert.equal(result.reads.length,2);
});

test("the original question is not a new reread gap, and unknown/failed reads never authorize a resend",async()=>{
 let reads=0,calls=0;
 const result=await continueResearch(question,readPlan,{reads:[acquired],attemptedReadTargets:[address]},new AbortController().signal,{
  model:async()=>++calls===1?choice("read",["W1"],question):answer,read:async()=>{reads++;return [];},discover:async()=>assert.fail(),stage:()=>{},report:()=>{},
 },undefined,{allowDiscovery:false,allowReread:true});assert.equal(reads,0);assert.equal(result.assessment,"answer");
 await continueResearch(question,readPlan,{reads:[acquired],issues:["accepted Task connection ended before final receipt"],attemptedReadTargets:[address]},new AbortController().signal,{
  model:async prompt=>{const input=JSON.parse(prompt.slice(prompt.lastIndexOf("\n{")+1));assert.deepEqual(input.materials.exactReadTargets,[]);assert.match(input.previousFailure.message,/connection ended/);return answer;},read:async()=>assert.fail(),discover:async()=>assert.fail(),stage:()=>{},report:()=>{},
 },undefined,{allowDiscovery:false,allowReread:true});
});

test("a tool error is reassessed with original materials and attempted identities within the shared budget",async()=>{
 let calls=0,reads=0;const retrieval={...start,searches:[{engine:"DeepSeek Search" as const,query:question,status:"done" as const,hits:[{url:address,title:"Known source",snippet:"clue"}]}]};
 const result=await continueResearch(question,plan,{retrieval,reads:[]},new AbortController().signal,{
  model:async prompt=>{if(++calls===1)return choice("read",["W1"],"units");const input=JSON.parse(prompt.slice(prompt.lastIndexOf("\n{")+1));assert.equal(input.previousFailure.kind,"read");assert.match(input.previousFailure.message,/controlled upstream failure/);assert.ok(input.materials.web.some((r:any)=>r.title==="Known source"));assert.deepEqual(input.materials.exactReadTargets,[]);return answer;},
  read:async()=>{reads++;throw Error("controlled upstream failure");},discover:async()=>assert.fail(),stage:()=>{},report:()=>{},
 });assert.equal(calls,2);assert.equal(reads,1);assert.equal(result.retrieval?.searches[0],retrieval.searches[0]);assert.equal(result.assessment,"answer");assert.match(result.issues!.join(" "),/controlled upstream failure/);
});

test("original channel restrictions and referenced prior server policy never become attachment-based discovery permission",()=>{
 const noSearch=researchEvidenceAuthority("只读取这份附件，不要搜索。",readPlan);assert.equal(noSearch.allowDiscovery,false);
 const haina=researchEvidenceAuthority("只在海纳查找独立数据资料，并读取这条。",readPlan);assert.equal(haina.allowDiscovery,true);assert.deepEqual(haina.sourcePolicy,{mode:"restricted",sources:["haina"]});
 const prior={message:"old result",answerNotes:{references:[{kind:"web" as const,title:"old",url:address}],sources:[],searches:[],webSources:[],limitation:"",followUp:"",reviewed:0,elapsedMs:0,executor:"Codex"},runTrace:{started:1,stages:[],calls:[{id:"data-question",kind:"tool" as const,name:"stored discovery",input:"",status:"done" as const,output:JSON.stringify({sourcePolicy:{mode:"restricted",sources:["haina"]}})}]}};
 const inherited=researchEvidenceAuthority("查找独立数据并核对旧引用。",readPlan,prior);assert.equal(inherited.allowDiscovery,false);assert.deepEqual(inherited.sourcePolicy,{mode:"restricted",sources:["haina"]});
 const other={...readPlan,targets:[{...readPlan.targets[0],url:"https://example.org/another",key:"web:https://example.org/another"}]};assert.equal(researchEvidenceAuthority("查找独立数据并核对新的引用。",other,prior).allowDiscovery,true);
});

test("cancellation and material persistence errors are not converted into another decision",async()=>{
 const controller=new AbortController();let calls=0;
 await assert.rejects(continueResearch(question,plan,{retrieval:{...start,searches:[{engine:"DeepSeek Search",query:question,status:"done",hits:[{url:address,title:"Known",snippet:"clue"}]}]},reads:[]},controller.signal,{
  model:async()=>{calls++;return choice("read",["W1"],"units");},read:async()=>{controller.abort(Error("explicit cancel"));throw Error("stopped");},discover:async()=>assert.fail(),stage:()=>{},report:()=>{},
 }),/explicit cancel/);assert.equal(calls,1);
});

test("the real supplied excerpt length and layer prevent treating a 420-character window as full text",async()=>{
 const full="Opening bounded text. ".repeat(30)+"Figure A contains a displacement comparison.";
 await continueResearch(question,readPlan,{reads:[{...acquired,hits:[{...acquired.hits[0],pageExcerpt:full,readAt:"2026-01-02T00:00:00Z"}]}]},new AbortController().signal,{
  model:async prompt=>{const input=JSON.parse(prompt.slice(prompt.lastIndexOf("\n{")+1)),entry=input.materials.web[0];assert.equal(entry.excerpt.length,420);assert.equal(entry.excerptChars,full.length);assert.equal(entry.excerptTruncated,true);assert.equal(entry.stage,"page-excerpt");assert.equal(entry.readAt,"2026-01-02T00:00:00Z");assert.match(entry.notice,/窗口未见不等于/);assert.ok(!entry.excerpt.includes("Figure A"));return answer;},
  read:async()=>assert.fail(),discover:async()=>assert.fail(),stage:()=>{},report:()=>{},
 });
});

test("material persistence failures abort the loop without another model or tool",async()=>{
 let calls=0;
 await assert.rejects(continueResearch(question,plan,{retrieval:{...start,searches:[{engine:"DeepSeek Search",query:question,status:"done",hits:[{url:address,title:"Known",snippet:"clue"}]}]},reads:[]},new AbortController().signal,{
  model:async()=>{calls++;return choice("read",["W1"],"unit");},read:async()=>{throw new DiscoveryA2AError("material save failed",false,undefined,"RUNTIME_PERSISTENCE_FAILED");},discover:async()=>assert.fail(),stage:()=>{},report:()=>{},
 }),/material save failed/);assert.equal(calls,1);
});

test("trusted preferred history keeps research capability while unbound historical restriction stays explicit",()=>{
 const parent=(mode:string)=>({message:"server record",answerNotes:{references:[{kind:"web" as const,url:address,title:"prior"}],sources:[],webSources:[],limitation:"",followUp:"",reviewed:0,elapsedMs:0,executor:"Codex"},runTrace:{started:1,stages:[],calls:[{id:"data-question",kind:"tool" as const,name:"saved",input:"",status:"done" as const,output:JSON.stringify({sourcePolicy:{mode,sources:["haina"]}})}]}});
 const preferred=researchEvidenceAuthority("这张图缺少的误差依据会影响结论吗？",readPlan,parent("preferred"));assert.equal(preferred.allowDiscovery,true);assert.equal(preferred.sourcePolicy?.mode,"preferred");
 const restricted=researchEvidenceAuthority("这张图缺少的误差依据会影响结论吗？",readPlan,parent("restricted"));assert.equal(restricted.allowDiscovery,false);assert.match(restricted.discoveryLimit!,/无法.*重验/);
 const rebound=researchEvidenceAuthority("这张图缺少的误差依据会影响结论吗？只在海纳补充。",readPlan,parent("restricted"));assert.equal(rebound.allowDiscovery,true);assert.deepEqual(rebound.sourcePolicy,{mode:"restricted",sources:["haina"]});
});
