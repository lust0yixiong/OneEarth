import test from "node:test";
import assert from "node:assert/strict";
import {requiredDataSearch} from "./data-search";
import {runSourceRead} from "./discovery-material-operations";
import {sourceReadKind} from "./discovery-materials-contract";
import {delegatedResearchProgress,mergeResearchProgress,readResearchProgressFact,type ResearchProgressFact} from "./research-progress";
import {readResearchProgressState,type ResearchProgress} from "../src/domain/native-agui-research-progress";

test("research progress is ordered, bounded and monotonic across replay",()=>{
 const fact={id:"source-web",area:"web",status:"running"} as const;
 const allowed=new Set<ResearchProgressFact["area"]>(["web"]);
 const first=delegatedResearchProgress("first",fact,allowed)!;
 const repeated=delegatedResearchProgress("other",fact,allowed)!;
 assert.notEqual(first.id,repeated.id);assert.equal(first.id,delegatedResearchProgress("first",fact,allowed)?.id);
 assert.equal(delegatedResearchProgress("first",fact,new Set(["reading"])),undefined);
 let state=mergeResearchProgress(undefined,"run",first)!;
 assert.equal(mergeResearchProgress(state,"run",first),undefined);
 state=mergeResearchProgress(state,"run",repeated)!;
 state=mergeResearchProgress(state,"run",{...first,status:"partial",count:2})!;
 assert.equal(mergeResearchProgress(state,"run",first),undefined);
 assert.equal(mergeResearchProgress(state,"run",{...first,status:"done",count:7}),undefined);
 assert.equal(mergeResearchProgress(state,"wrong-run",first),undefined);
 assert.deepEqual(state.actions,[{...first,order:1,status:"partial",count:2},{...repeated,order:2}]);
 assert.deepEqual(readResearchProgressState({oneearth:{researchProgress:state}},"run"),state);
 assert.equal(readResearchProgressState({oneearth:{researchProgress:state}},"wrong-run"),undefined);
 for(let i=2;i<64;i++)state=mergeResearchProgress(state,"run",{...first,id:"op"+i})!;
 assert.equal(mergeResearchProgress(state,"run",{...first,id:"overflow"}),undefined);
 assert.equal(mergeResearchProgress(state,"run",{...repeated,status:"timeout"})?.actions[1].status,"timeout");
 assert.equal(readResearchProgressFact({...fact,count:2}),undefined);
 assert.equal(readResearchProgressFact({...fact,status:"done",count:NaN}),undefined);
 assert.deepEqual(readResearchProgressFact({...fact,diagnostic:"never project",output:"nor this"}),fact);
});

test("discovery producers report actual bounded channel outputs and typed timeouts",async()=>{
 const query="查覆盖范围",facts:ResearchProgressFact[]=[];
 const source="https://example.test/fixture";
 const plan={questionMode:"preserve",dataQuestion:query,dataNeed:null,hainaQueries:["ERA5"],
  paper:{name:"",facets:[{need:"资料覆盖",queries:["coverage data"]}],region:[],scenario:[]},
  web:[{web:"coverage data",dataset:"coverage data"}]};
 const result=await requiredDataSearch(query,new AbortController().signal,{
  plan:async()=>JSON.stringify(plan),report:()=>{},stage:()=>{},progress:fact=>facts.push(fact),
  paper:async()=>{throw new DOMException("Do not display this timeout detail","TimeoutError");},
  haina:async()=>({assets:[],total:0,synced:"",endpoint:source,warning:"simulated failure"}),
  web:async()=>[
   {engine:"DataCite",query:"coverage data",status:"done",hits:[{title:"first",url:source,snippet:"private excerpt"}]},
   {engine:"DataCite",query:"duplicate",status:"done",hits:[{title:"copy",url:source,snippet:"same URL"}]},
   {engine:"DataCite",query:"failure",status:"failed",hits:[],error:"raw failure"},
  ],
 });
 assert.ok(result.sourceStatus.some(source=>source.status==="partial"&&source.count===1));
 assert.deepEqual(facts.map(({area,status,count})=>[area,status,count]),[
  ["literature","running",undefined],["haina","running",undefined],["web","running",undefined],
  ["literature","timeout",undefined],["haina","failed",undefined],["web","partial",1],
 ]);
 assert.doesNotMatch(JSON.stringify(facts),/example|private|raw|timeout detail|failure/);
});

test("source reading counts returned excerpts, with an explicit failed and timed-out attempt",async()=>{
 const facts:unknown[]=[];
 const targets=["first","snippet","deadline"].map(value=>({kind:"web" as const,url:"https://example.test/"+value,title:value}));
 const result=await runSourceRead({kind:sourceReadKind,input:{question:"检查给定出处",targets}},new AbortController().signal,
  event=>{if(event.researchProgressFact)facts.push(event.researchProgressFact);},
  {detail:async()=>{throw Error("unexpected");},evidence:async()=>{throw Error("unexpected");}},false,async target=>{
   const url=target.url!;
   if(url.endsWith("deadline"))throw new DOMException("no public diagnostic","TimeoutError");
   return {engine:"原站读取",requestUrl:url,warning:"",hits:[{title:target.title,url,snippet:"not sufficient",...(url.endsWith("first")?{pageExcerpt:"actual text"}:{})}]};
  });
 assert.ok(result.sourceReadResult);
 assert.deepEqual(facts,[{id:"source-read",area:"reading",status:"running"},{id:"source-read",area:"reading",status:"partial",count:1}]);
 let final:ResearchProgress|undefined;
 await runSourceRead({kind:sourceReadKind,input:{question:"同一真实来源的本地替身",targets:[targets[2]]}},new AbortController().signal,
  event=>{const fact=readResearchProgressFact(event.researchProgressFact);if(fact)final=mergeResearchProgress(final,"read",fact);},
  {detail:async()=>{throw Error("unexpected");},evidence:async()=>{throw Error("unexpected");}},false,async()=>{
   throw new DOMException("no public diagnostic","TimeoutError");
  });
 assert.equal(final?.actions[0].status,"timeout");
});
