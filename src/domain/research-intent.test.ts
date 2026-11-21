import test from "node:test";
import assert from "node:assert/strict";
import {parseDataSearch,requiredDataSearch} from "../../server/data-search";
import {validHistory} from "../../server/chat-executor";
import {parseSynthesis} from "../../server/scientific-answer";
import {createResearchList,parseResearchList,researchProducts,researchNote,updateResearchNote,listMarkdown} from "./research-list";
import {mergeScope,scopedQuestionContext} from "./question-scope";
import {validContext} from "./context-validation";
import {emptyFilters} from "./spatial";
import type {CandidateSet} from "./types";
import {snapshotResult,validResultSnapshot} from "./result-snapshot";
const emptySearch={query:"",type:"",source:"",savedOnly:false,kind:"all" as const,capability:"" as const,compare:[],result:null};

const intent={purpose:"研究西北太平洋海温、叶绿素与海色变化",task:"找资料并核对变量、版本和入口",region:"西北太平洋",time:"2020—2023 年",months:[] as number[]};
const seasonal={...intent,time:"2020—2023 年各年6—8月",months:[6,7,8]};
const plan={questionMode:"preserve",dataQuestion:"只看夏季呢？",dataNeed:null,researchIntent:seasonal,
  conversationPeriod:[2020,2023],conversationWindow:null,conversationContext:"西北太平洋2020—2023年夏季海色资料",
  hainaQueries:["西北太平洋 夏季 海色"],paper:{name:"",facets:[{need:"海色",queries:["ocean color"]}],region:["Northwest Pacific"],scenario:["summer"]},
  web:[{web:"Northwest Pacific summer ocean color 2020 2023",dataset:"ocean color"}]};
test("seasonal follow-up keeps the user's aim and years, carries months to source queries, and never fabricates a continuous summer window",async()=>{
  const p=parseDataSearch(JSON.stringify(plan),"只看夏季呢？");
  assert.deepEqual(p.researchIntent,seasonal);assert.deepEqual(p.conversationPeriod,[2020,2023]);assert.equal(p.conversationWindow,null);
  assert(validHistory([{role:"assistant",text:"资料",researchIntent:intent}]));
  assert(!validHistory([{role:"assistant",text:"资料",researchIntent:{...intent,months:[13]}}]));
  const calls:string[]=[];
  await requiredDataSearch("只看夏季呢？",new AbortController().signal,{
    plan:async()=>JSON.stringify(plan),report:()=>{},stage:()=>{},
    paper:async p=>{calls.push(p.scenario?.join(" ") || "");return {records:[],tools:[],incomplete:[]};},
    haina:async q=>{calls.push(q.join(" "));return {assets:[],total:0,synced:"",endpoint:"",warning:""};},
    web:async q=>{calls.push(q[0].web);return [];},
  });
  assert(calls.every(s=>/summer|夏季/.test(s)));
  const fresh=parseDataSearch(JSON.stringify({...plan,researchIntent:{purpose:"理解地震波",task:"解释概念",region:null,time:null,months:[]},conversationPeriod:null}),"什么是地震波？");
  assert.equal(fresh.researchIntent?.region,null);
});
test("product saves preserve separate question and research-intent snapshots, survive import, and retain other edits",()=>{
  const batch:CandidateSet={title:"首页原始问句",ids:["Q05-3"],caseId:"Q05",filters:emptyFilters(),selection:null,gridSystem:"h3",layer:"all",camera:{center:[130,30],zoom:1,reason:"test"}};
  batch.researchRecord={question:"研究西北太平洋2020—2023年的海色，可以找到哪些资料？",intent,sessionId:"s",messageId:"m1",notes:[{id:"Q05-3",note:"对照 chlor_a 与 Rrs"}]};
  const first=createResearchList(batch);
  batch.researchRecord={...batch.researchRecord,question:"只看夏季呢？",intent:seasonal,messageId:"m2",notes:[{id:"Q05-3",note:"比较多年夏季海色"}]};
  const second=createResearchList(batch);
  assert(validResultSnapshot(snapshotResult("discover",batch,{
    caseId:batch.caseId,filters:batch.filters,selection:batch.selection,
    camera:batch.camera,gridSystem:batch.gridSystem,layer:batch.layer,
  },emptySearch,[])));
  const products=researchProducts([second,first]);assert.equal(products.length,1);assert.equal(products[0].entries.length,2);
  const otherVersion=structuredClone(second);
  otherVersion.items[0].version="另一版次";
  otherVersion.items[0].identity=JSON.stringify([JSON.parse(first.items[0].identity)[0],"另一版次"]);
  const editions=researchProducts([otherVersion,first]);
  assert.equal(editions.length,1);assert.equal(editions[0].versions.length,2);
  assert.equal(editions[0].entries[0].item.version,"另一版次");
  assert.equal(first.researchRecord?.intent?.time,"2020—2023 年");
  assert.equal(second.question,"只看夏季呢？");
  assert.deepEqual(parseResearchList(JSON.stringify(second)),JSON.parse(JSON.stringify(second)));
  const storage=new Map<string,string>();const local={getItem:(k:string)=>storage.get(k)||null,setItem:(k:string,v:string)=>storage.set(k,v)} as unknown as Storage;
  updateResearchNote(first,"Q05-3","用户修改后的意图",local);
  assert.equal(researchNote(parseResearchList([...storage.values()][0]),"Q05-3"),"用户修改后的意图");
  assert.equal(parseResearchList([...storage.values()][0]).batch.researchRecord?.notes[0].note,"用户修改后的意图");
  assert.equal(researchNote(second,"Q05-3"),"比较多年夏季海色");
  assert.match(listMarkdown(second),/各年6—8月/);
  const legacy=createResearchList({...batch,researchRecord:undefined});
  assert.doesNotThrow(()=>parseResearchList(JSON.stringify(legacy)));
});
test("research notes use actual dataset identities; quoted web sources keep identity without turning into dataset evidence",()=>{
  const refs=[{kind:"asset" as const,id:"Q05-3",title:"MODIS",source:"NASA"}];
  const reply=parseSynthesis(JSON.stringify({message:"可关注该产品[S1]",researchNotes:[{ref:"S1",note:"核对叶绿素与反射率"}]}),refs,[]);
  assert.deepEqual(reply.researchNotes,[{id:"Q05-3",note:"核对叶绿素与反射率"}]);
  assert.deepEqual(parseSynthesis(JSON.stringify({message:"[S1]",researchNotes:[{ref:"S2",note:"无关"}]}),refs,[]).researchNotes,[]);
  const mixed=parseSynthesis(JSON.stringify({message:"产品[S1]和目录说明[S2]",researchNotes:[
    {ref:"S2",note:"网页资料"},{ref:"[S1]",note:"保留产品相关研究意图"},
  ]}),[...refs,{kind:"web",title:"目录说明",url:"https://example.org/catalogue"}],[]);
  assert.deepEqual(mixed.researchNotes,[{id:"Q05-3",note:"保留产品相关研究意图"}]);
  const item={kind:"reference" as const,reference:{kind:"web" as const,title:"论文",url:"https://example.org/paper"},number:2,messageId:"m"};
  const context=scopedQuestionContext(mergeScope([item],[item]),null);
  assert.equal(context.attachedScope?.length,1);assert.deepEqual(context.candidateIds,[]);assert(validContext(context));
});
