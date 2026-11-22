import assert from "node:assert/strict";
import test from "node:test";
import {continueResearch} from "./research-evidence";
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
const answer=JSON.stringify({action:"answer",reason:"materials sufficient",gap:null,targets:[],clarification:null});

test("sufficient evidence completes without calling either acquisition tool",async()=>{
  const trace:ToolCall[]=[];
  const result=await continueResearch(question,plan,{retrieval:start,reads:[]},new AbortController().signal,{
    model:async()=>answer,read:async()=>assert.fail(),discover:async()=>assert.fail(),stage:()=>{},report:call=>trace.push(call),
  });
  assert.equal(result.retrieval,start);
  assert.equal(JSON.parse(trace.at(-1)!.output!).action,"answer");
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
  assert.equal(result.retrieval,start);
  assert.equal(result.clarification,undefined);
  assert.equal(JSON.parse(trace.at(-1)!.output!).fallback,"answer-with-available-materials");
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

test("a model cannot invent a read target or convert a pinned source into discovery",async()=>{
  const trace:ToolCall[]=[];
  const exact={...plan,action:"read" as const,targets:[{key:"web:"+address,kind:"web" as const,title:"Known",basis:"citation" as const,url:address}]};
  await continueResearch(question,exact,{reads:[]},new AbortController().signal,{
    model:async()=>JSON.stringify({action:"read",reason:"guess",gap:"units",targets:["W2"],clarification:null}),
    read:async()=>assert.fail(),discover:async()=>assert.fail(),stage:()=>{},report:call=>trace.push(call),
  });
  assert.equal(trace.at(-1)?.status,"failed");
});
