import assert from "node:assert/strict";
import test from "node:test";
import {modelReply} from "./research-answer";
import {emptyFilters} from "../src/domain/spatial";
import type {DiscoveryContext,ToolCall,WebHit} from "../src/domain/types";
import type {DataSearchResult} from "./data-search";
import type {researchExecutor} from "./research-executor";
import {synthesisPromptByteLimit} from "./synthesis-context-budget";
const question="Northern Basin height 2020–2023 sources";
const context:DiscoveryContext={caseId:null,citation:null,selection:null,filters:emptyFilters(),gridSystem:"h3",layer:"all",camera:{center:[0,0],zoom:1,reason:"test"}};
const hit:WebHit={url:"https://example.org/data?sig=controlled-fixture",title:"Northern Basin height",snippet:"Published metadata",pageExcerpt:"Inputs span 2020–2022. The nominal year is 2021. Files were not read.",stage:"page-excerpt"};
const retrieval=(hits:WebHit[]=[hit]):DataSearchResult=>({plan:{questionMode:"preserve",dataQuestion:question,dataNeed:null,paper:{name:"",facets:[],region:["Northern Basin"]},web:[],hainaQueries:[],researchIntent:{purpose:question,task:question,region:"Northern Basin",time:"2020–2023",months:[]}},papers:[],haina:[],issues:[],sourceStatus:[],searches:[{engine:"原站读取",status:"done",query:hit.url,requestUrl:hit.url,hits}]});
const output=(message:string)=>JSON.stringify({message,sections:[],limitation:"",followUp:"",researchNotes:[],calculationRequests:[]});
const fake=(model:ReturnType<typeof researchExecutor>["model"]):ReturnType<typeof researchExecutor>=>({name:"codex",model,discover:async()=>assert.fail("no discovery"),read:async()=>assert.fail("no reading"),close:async()=>{}});
const call=(executor:ReturnType<typeof researchExecutor>,trace:ToolCall[],data:DataSearchResult|undefined=retrieval(),signal=new AbortController().signal,ms=1000)=>modelReply(question,context,{message:""},[],executor,signal,undefined,[],"",undefined,data,item=>trace.push(item),undefined,[],{},undefined,undefined,{answerMs:ms});

test("a timed-out generation sends one bounded prompt, retains real source identities and records failure separately",async()=>{
 const trace:ToolCall[]=[];let count=0;
 const result=await call(fake(async prompt=>{count++;assert.ok(Buffer.byteLength(prompt)<=synthesisPromptByteLimit);assert.doesNotMatch(prompt,/controlled-fixture/);throw Error("simulated original timeout");}),trace);
 assert.equal(count,1);assert.equal(result.answerNotes?.references?.length,1);assert.match(result.message,/nominal year is 2021/);
 assert.equal(result.answerNotes?.searches?.[0].query,hit.url);assert.equal(result.answerNotes?.webSources?.[0].url,hit.url,"do not sanitize actual read/source identity");
 const failure=trace.find(row=>row.id==="answer-generation"&&row.status==="failed")!;assert.equal(failure.error,"simulated original timeout");
 assert.equal(JSON.parse(failure.output!).mode,"evidence-retained");assert.ok(!trace.some(row=>row.id==="answer-generation"&&row.status==="done"));
 assert.equal(JSON.parse(trace.find(row=>row.id==="answer-delivery")!.output!).mode,"evidence-retained");
});

test("empty actual retrieval survives model failure as zero-reference limitations",async()=>{
 const trace:ToolCall[]=[];const result=await call(fake(async()=>{throw Error("offline");}),trace,retrieval([]));
 assert.deepEqual(result.answerNotes?.references,[]);assert.equal(JSON.parse(trace.find(row=>row.id==="answer-delivery")!.output!).mode,"no-direct-evidence");
 const plan={action:"respond" as const,evidenceNeed:"none" as const,goal:question,targets:[],reason:"ordinary",clarification:null,researchIntent:{purpose:question,task:question,region:null,time:null,months:[]},conversationContext:question};
 await assert.rejects(modelReply(question,context,{message:""},[],fake(async()=>{throw Error("old ordinary failure");}),new AbortController().signal,undefined,[],"",undefined,undefined,undefined,{plan,searches:[]}),/old ordinary failure/);
});

test("only a validated model answer produces answer-generation done",async()=>{
 const trace:ToolCall[]=[];let calls=0;
 const result=await call(fake(async prompt=>{calls++;const p=JSON.parse(prompt.slice(prompt.lastIndexOf("\n{")+1));return output("该元数据的名义年为2021。["+p.webResults[0].ref+"]");}),trace);
 assert.equal(calls,1);assert.equal(result.answerNotes?.references?.length,1);assert.equal(JSON.parse(trace.find(row=>row.id==="answer-generation"&&row.status==="done")!.output!).mode,"model-validated");
});

test("user cancellation still aborts instead of publishing a fallback",async()=>{
 const parent=new AbortController();const task=call(fake(async()=>{parent.abort(Error("user cancelled"));throw Error("child stopped");}),[],retrieval(),parent.signal);
 await assert.rejects(task,/user cancelled/);
});

test("the server deadline does not discard already acquired material or start another model",async()=>{
 let calls=0;const result=await call(fake(async()=>{calls++;return new Promise(()=>{});}),[],retrieval(),new AbortController().signal,20);
 assert.equal(calls,1);assert.match(result.message,/nominal year is 2021/);
});

test("appending a large repair draft cannot bypass the whole-prompt byte cap",async()=>{
 let calls=0;const trace:ToolCall[]=[];
 const result=await call(fake(async()=>{calls++;return output("待核字".repeat(7000)+" [S999]");}),trace);
 assert.equal(calls,1,"oversized repair rejected before executor.model");assert.match(result.message,/回答整理未能完成/);
 assert.equal(JSON.parse(trace.find(row=>row.id==="answer-generation"&&row.status==="failed")!.output!).modelCalls,1);
});
