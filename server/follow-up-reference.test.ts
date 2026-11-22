import {test} from "node:test";
import assert from "node:assert/strict";
import { numberedReference } from "./follow-up-reference";
import {parseTurnPlan,prepareTurn,TurnPlanningFailure,turnMetadata,turnTargets,type TurnInput} from "./turn-planning";
import {emptyFilters} from "../src/domain/spatial";
import type { DiscoveryResponse } from "../src/domain/types";

const local={kind:"asset",title:"本地资料",id:"local",source:"local",sourceChannel:"local"} as const;
const first={kind:"asset",title:"第一篇",id:"p1",source:"paper",sourceChannel:"assertion"} as const;
const second={...first,id:"p2",title:"第二篇"} as const;
const website={kind:"web",title:"公开网页",url:"https://example.org/",sourceChannel:"web"} as const;
const prior={answerNotes:{references:[local,first,website,second]}} as DiscoveryResponse;

test("natural literature ordinals use order within the literature channel",()=>{
  for(const text of ["第二篇论文用了什么数据？","上次回答里，作者在第 ２ 篇文献用了什么？","第2篇文献里用的什么测量方法？"])
    assert.deepEqual(numberedReference(text,prior),{ordinal:2,scope:"literature",reference:second});
});
test("citation markers follow the displayed, mixed-source ordering",()=>{
  assert.equal(numberedReference("能讲讲依据〔3〕里的时间范围吗？",prior)?.reference,website);
  assert.equal(numberedReference("〔3〕里怎么描述时间范围？",prior)?.reference,website);
  assert.equal(numberedReference("上一条回复的来源编号 2，哪里可以查到方法？",prior)?.reference,first);
  assert.equal(numberedReference("What is the scale in reference #3?",prior)?.reference,website);
});
test("source identity is independent of the requested research action",()=>{
  assert.equal(numberedReference("对比第二篇文献和第三篇文献的结果。",prior),undefined);
  assert.equal(numberedReference("按第二篇论文的方法另找一些新资料。",prior)?.reference,second);
  assert.equal(numberedReference("打开第二篇论文的来源，核对上次没读到的段落。",prior)?.reference,second);
  assert.deepEqual(numberedReference("第九篇论文用了什么数据？",prior),{ordinal:9,scope:"literature",reference:undefined});
  assert.equal(numberedReference("第二篇论文用了什么数据？"),undefined);
});

test("the same numbered source reaches model planning with its real read coverage",async()=>{
  const ref=numberedReference("解释第三个来源",prior)!;
  const i:TurnInput={question:"第三个来源的资料怎么用？",history:[],numbered:ref,
    numberedRead:{url:website.url,title:website.title,excerpt:"已有截断的节选",stage:"page-excerpt",
      excerptTruncated:true,sourceExcerptLength:100,readAt:"2026-11-22T00:00:00Z"},
    context:{caseId:null,filters:emptyFilters(),selection:null,camera:{center:[105,25],zoom:1,reason:"test"},
      gridSystem:"h3",layer:"all",citation:null}};
  const same=turnTargets(i)[0];
  assert.equal(same.basis,"numbered");
  assert.equal(same.url,website.url);
  assert.equal(same.excerptTruncated,true);
  for(const [action,evidenceNeed] of [["respond","existing"],["read","read"],["search","discover"]] as const){
    let delegated=0;
    const output=await prepareTurn(i,new AbortController().signal,{
      run:async prompt=>{
        assert.match(prompt,/已有截断的节选/);
        assert.match(prompt,/"excerptTruncated":true/);
        return JSON.stringify({action,evidenceNeed,targets:[same.key],goal:i.question,...turnMetadata(i.question,i),
          reason:"依据本轮目标决定动作",clarification:null,evidenceGap:action==="search"?"需要额外来源印证资料用法":null});
      },
      search:async()=>{delegated++;return {} as never;},stage:()=>{},report:()=>{},
    });
    assert.equal(output.plan.action,action);
    assert.equal(output.plan.targets[0].url,website.url);
    assert.equal(delegated,action==="search"?1:0);
  }
});

test("mere presence of a numbered asset does not count as a reading",()=>{
  const i:TurnInput={question:"第二篇论文为何使用这个数据？",history:[],numbered:numberedReference("第二篇论文",prior),
    context:{caseId:null,filters:emptyFilters(),selection:null,camera:{center:[105,25],zoom:1,reason:"test"},
      gridSystem:"h3",layer:"all",citation:null}};
  assert.equal(turnTargets(i)[0].basis,"numbered");
  assert.equal(turnTargets(i)[0].alreadyRead,undefined);
});

test("a valid model action can omit a single server-bound reference without replanning or changing the action",async()=>{
  for(const [action,evidenceNeed] of [["respond","existing"],["read","read"],["search","discover"]] as const){
    const question=action==="search"?"以第三个来源为线索，请找一篇新的论文。":"请处理第三个来源。";
    const i:TurnInput={question,history:[],numbered:numberedReference(question,prior),
      context:{caseId:null,filters:emptyFilters(),selection:null,camera:{center:[105,25],zoom:1,reason:"test"},
        gridSystem:"h3",layer:"all",citation:null}};
    let plans=0,delegated=0;
    const output=await prepareTurn(i,new AbortController().signal,{
      run:async()=>{
        plans++;
        return JSON.stringify({action,evidenceNeed,targets:[],goal:question,...turnMetadata(question,i),
          reason:"依据本轮研究目标",clarification:null,evidenceGap:action==="search"?"需要一篇独立研究":null});
      },
      search:async plan=>{delegated++;assert.equal(plan.targets[0].url,website.url);return {} as never;},stage:()=>{},report:()=>{},
    });
    assert.equal(plans,1);
    assert.equal(output.plan.action,action);
    assert.equal(output.plan.restoredNumberedTarget,true);
    assert.equal(output.plan.targets[0].url,website.url);
    assert.equal(delegated,action==="search"?1:0);
  }
});

test("unknown targets, conflicting reads and forbidden discovery remain blocked",()=>{
  const attached={kind:"web",title:"另一页",url:"https://example.org/other"} as const;
  const question="只解释第三个来源的已提供内容，不需要查找新资料。";
  const i:TurnInput={question,history:[{role:"assistant",text:"已提出材料",conversationReferences:[attached]}],numbered:numberedReference(question,prior),
    context:{caseId:null,filters:emptyFilters(),selection:null,camera:{center:[105,25],zoom:1,reason:"test"},
      gridSystem:"h3",layer:"all",citation:null}};
  const draft={action:"read",evidenceNeed:"read",goal:question,reason:"处理指定来源",
    ...turnMetadata(question,i),clarification:null,evidenceGap:null};
  assert.throws(()=>parseTurnPlan(JSON.stringify({...draft,targets:["web:https://example.org/invented"]}),i),/引用对象无效/);
  assert.throws(()=>parseTurnPlan(JSON.stringify({...draft,targets:["web:"+attached.url]}),i),/定向读取只能/);
  assert.throws(()=>parseTurnPlan(JSON.stringify({...draft,action:"search",evidenceNeed:"discover",targets:[]}),i),/不做新检索/);
});

test("a final invalid plan exposes a user action, with validation details only in the trace",async()=>{
  const question="按第三个来源找新的资料。";
  const i:TurnInput={question,history:[],numbered:numberedReference(question,prior),
    context:{caseId:null,filters:emptyFilters(),selection:null,camera:{center:[105,25],zoom:1,reason:"test"},
      gridSystem:"h3",layer:"all",citation:null}};
  const attempts:string[]=[];
  await assert.rejects(()=>prepareTurn(i,new AbortController().signal,{
    run:async()=>JSON.stringify({action:"search",evidenceNeed:"discover",goal:question,reason:"需要新资料",
      ...turnMetadata(question,i),clarification:null,evidenceGap:null,targets:["unknown-extra-target"]}),
    search:async()=>assert.fail("invalid scope cannot call discovery"),stage:()=>{},report:call=>{
      if(call.status==="failed")attempts.push(call.output!);
    },
  }), (error:unknown)=>{
    assert.ok(error instanceof TurnPlanningFailure);
    assert.match(error.message,/可以点选具体来源/);
    assert.equal(error.code,"TURN_PLAN_INVALID");
    return true;
  });
  assert.deepEqual(JSON.parse(attempts[0]),{diagnostic:"本轮动作或引用对象无效，不能猜测目标。",attempts:2});
});
