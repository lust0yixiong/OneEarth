import assert from "node:assert/strict";
import test from "node:test";
import {emptyFilters} from "../src/domain/spatial";
import type {AnswerReference,DiscoveryContext,DiscoveryResponse,ReadEvidence} from "../src/domain/types";
import {parentResearchEvidence} from "./parent-research-evidence";
import {modelReply} from "./research-answer";
import type {researchExecutor} from "./research-executor";
import type {TurnPlan} from "./turn-planning";

const title="River Basin Surface Water";
const first="https://example.org/surface-water/v1";
const second="https://example.org/surface-water/v2";
const readings:ReadEvidence[]=[
  {title,url:first,stage:"page-excerpt",excerpt:"Version 1 covers the western basin from 1988 to 2010.",readAt:"2026-11-16T00:00:00Z"},
  {title,url:second,stage:"page-excerpt",excerpt:"Version 2 covers the eastern basin from 2000 to 2020.",readAt:"2026-11-16T00:00:00Z"},
];
const references:AnswerReference[]=readings.map(({url,title})=>({kind:"web",url,title,sourceChannel:"web"}));
const parent:DiscoveryResponse={message:"两份资料的标题相同，发布版本和区域不同。",conversationEvidence:readings,
  answerNotes:{references,sources:[],webSources:[],limitation:"",followUp:"",reviewed:0,elapsedMs:0,executor:"Codex"}};
const question="River Basin Surface Water 的东部流域版本覆盖哪几年？按已有的版本说明回答。";
const plan:TurnPlan={action:"respond",evidenceNeed:"existing",goal:question,reason:"已有版本说明",targets:[],clarification:null,
  conversationContext:question,researchIntent:{purpose:question,task:question,region:null,time:null,months:[]}};
const context:DiscoveryContext={caseId:null,citation:null,filters:emptyFilters(),gridSystem:"h3",layer:"all",
  selection:null,camera:{center:[0,0],zoom:1,reason:"test"}};

test("two same-title versions keep separate identities and never elevate an unread search hit",()=>{
  const evidence=parentResearchEvidence(parent,plan,question);
  assert.deepEqual(evidence?.readings.map(r=>r.url),[first,second]);
  const explicit={...plan,targets:[{key:"web:"+first,url:first,kind:"web" as const,title,basis:"numbered" as const}]};
  assert.deepEqual(parentResearchEvidence(parent,explicit,question)?.readings.map(r=>r.url),[first]);
  const snippets={...parent,conversationEvidence:[{...readings[1],stage:"search-snippet" as const}]};
  assert.equal(parentResearchEvidence(snippets,plan,question),undefined);
  assert.equal(parentResearchEvidence(parent,{...plan,action:"clarify",evidenceNeed:"unclear"},question),undefined);
});

test("a source-based answer without a persisted-source citation is repaired with the evidence actually used",async()=>{
  const priorEvidence=parentResearchEvidence(parent,plan,question);
  assert.ok(priorEvidence);
  let modelCalls=0;
  let sourceToken="";
  const executor:ReturnType<typeof researchExecutor>={
    name:"codex",
    async model(prompt){
      modelCalls++;
      const template={sections:[],limitation:"",followUp:"",researchNotes:[],calculationRequests:[]};
      if(modelCalls===1){
        const input=JSON.parse(prompt.slice(prompt.lastIndexOf("\n{")+1));
        const retrieved=input.webResults as Array<{url:string;ref:string;pageExcerpt:string;previousRead:boolean}>;
        assert.deepEqual(new Set(retrieved.map(row=>row.url)),new Set([first,second]));
        const version=retrieved.find(row=>row.url===second);
        assert.ok(version?.previousRead && version.pageExcerpt.includes("eastern basin"));
        sourceToken=version.ref;
        return JSON.stringify({...template,message:"东部流域版本是 2000–2020 年。"});
      }
      assert.match(prompt,/实际采用的证据/);
      return JSON.stringify({...template,message:"此前保留的东部流域版本说明列出 2000–2020 年。["+sourceToken+"]"});
    },
    async discover(){throw Error("no discovery in a reply based on stored evidence");},
    async read(){throw Error("no unread source access in a reply based on stored evidence");},
  };
  const result=await modelReply(question,context,{message:"依据既有材料"},[],executor,new AbortController().signal,undefined,
    [],"",undefined,undefined,undefined,{plan,searches:[],priorEvidence});
  assert.equal(modelCalls,2);
  assert.deepEqual(result.answerNotes?.references?.map(ref=>ref.kind==="web"&&ref.url),[second]);
  assert.match(result.message,/2000–2020 年。〔1〕/);
});
