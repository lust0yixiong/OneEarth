import {researchExecutor} from "../../server/research-executor";
import test from "node:test";
import assert from "node:assert/strict";
import {requiredDataSearch,parseDataSearch,fallbackDataSearch,type DataSearchPlan} from "../../server/data-search";
import {makeQuestionDecision,validQuestionDecision} from "./question-confirmation";
import type {ToolCall} from "./types";
import {modelReply} from "../../server/chat-executor";

const plan:DataSearchPlan={questionMode:"preserve",dataQuestion:"为什么城市里更热",dataNeed:null,
  hainaQueries:["城市热岛"],paper:{name:"",facets:[{need:"温度观测关系",queries:["urban heat island"]}],region:[]},
  web:[{web:"urban heat island observations",dataset:"urban heat island"}]};
const haina={assets:[],total:0,synced:"",endpoint:"",warning:""};
const check={originalQuestion:plan.dataQuestion,proposedQuestion:"城市与周边温度差异的观测关系，能否支持对其成因的判断？"};

test("data understanding, comparisons, values and evidence questions retain the user's wording",()=>{
  for(const query of ["IMERG Late 和 Final 有什么区别？","这些值是实测还是推算的？",
    "海表温度与叶绿素的关系怎么验证？","这个格点2022年7月降水是多少？",
    "Retrieve atmospheric variables from satellite radiometer and sounder data products"]){
    const parsed=parseDataSearch(JSON.stringify({...plan,dataQuestion:"查找某地区所需的数据集"}),query);
    assert.equal(parsed.dataQuestion,query);
    assert.equal(parsed.dataNeed,null);
    assert.equal(fallbackDataSearch(query).dataQuestion,query);
  }
});

test("every unconfirmed conversion stops before any source retrieval, including on retry",async()=>{
  for(let retry=0;retry<2;retry++){
    const executed:string[]=[],calls:ToolCall[]=[];
    const result=await requiredDataSearch(check.originalQuestion,new AbortController().signal,{
      plan:async()=>JSON.stringify({...plan,questionMode:"reframe",dataQuestion:check.proposedQuestion}),
      paper:async()=>{executed.push("paper");return {records:[],tools:[],incomplete:[]};},
      haina:()=>{executed.push("haina");return haina;},
      web:async()=>{executed.push("web");return [];},report:c=>calls.push(c),stage:()=>{},
    });
    assert.deepEqual(executed,[]);
    assert.deepEqual(result.questionCheck,check);
    assert.deepEqual(result.sourceStatus,[]);
    assert.ok(calls.every(call=>["data-question","data-question-initial","data-question-repair"].includes(call.id)));
    await assert.rejects(()=>modelReply(check.originalQuestion,{} as never,{message:""},[],researchExecutor({executor:"codex",model:""},undefined,new AbortController().signal),
      new AbortController().signal,undefined,[],"",undefined,result),/尚未得到用户确认/);
  }
});

test("the chosen or edited question is fixed even when planning tries to convert it again",async()=>{
  for(const choice of ["proposed","original","edited"] as const){
    const decision=makeQuestionDecision(check,"check-1",choice,"城市温度差异在观测中是否稳定？");
    const executed:string[]=[];
    const result=await requiredDataSearch(check.originalQuestion,new AbortController().signal,{
      plan:async()=>JSON.stringify({...plan,questionMode:"reframe",dataQuestion:"查找2000年北京的城市热岛数据"}),
      paper:async p=>{assert.deepEqual(p.region,[]);executed.push("paper");return {records:[],tools:[],incomplete:[]};},
      haina:terms=>{assert.ok(terms.length);assert.ok(terms.every(t=>!t.includes("北京") && !t.includes("2000")));executed.push("haina");return haina;},
      web:async()=>{executed.push("web");return [];},report:()=>{},stage:()=>{},
    },decision);
    assert.deepEqual(executed,["haina","web"]);
    assert.equal(result.sourceStatus.find(s=>s.source==="文献资料检索")?.status,"not_requested");
    assert.match(result.sourceStatus.find(s=>s.source==="文献资料检索")?.detail||"",/未请求/);
    assert.equal(result.questionCheck,undefined);
    assert.equal(result.plan.dataQuestion,decision.dataQuestion);
    assert.equal(result.plan.dataNeed,null);
    assert.ok(!result.plan.dataQuestion.includes("北京"));
  }
});

test("approval is bound to its original request and empty edits cannot count as confirmation",async()=>{
  const decision=makeQuestionDecision(check,"check-1","proposed");
  assert.equal(validQuestionDecision(decision,"下一轮问题"),false);
  assert.equal(validQuestionDecision({confirmed:true},check.originalQuestion),false);
  assert.equal(validQuestionDecision({...decision,choice:"original"},check.originalQuestion),false);
  assert.throws(()=>makeQuestionDecision(check,"check-1","edited","  "));
  await assert.rejects(()=>requiredDataSearch("下一轮问题",new AbortController().signal,{} as never,decision),/不一致/);
});

test('a proposed conversion still requires approval when planning also asks for clarification',async()=>{
  const result=await requiredDataSearch(check.originalQuestion,new AbortController().signal,{
    plan:async()=>JSON.stringify({...plan,questionMode:'reframe',dataQuestion:check.proposedQuestion,clarification:'具体是哪座城市？'}),
    paper:async()=>{throw Error('unapproved query');},haina:()=>{throw Error('unapproved query');},web:async()=>{throw Error('unapproved query');},
    report:()=>{},stage:()=>{},
  });
  assert.deepEqual(result.questionCheck,check);assert.equal(result.clarification,undefined);
});

test("a proposed question with no retrieval parameters still waits for the user",async()=>{
  const fail=async()=>{throw Error("source retrieval attempted before confirmation")};
  const result=await requiredDataSearch(check.originalQuestion,new AbortController().signal,{
    plan:async()=>JSON.stringify({questionMode:"reframe",dataQuestion:check.proposedQuestion}),
    paper:fail,haina:fail,web:fail,report:()=>{},stage:()=>{},
  });
  assert.deepEqual(result.questionCheck,check);
  assert.deepEqual(result.sourceStatus,[]);
});
