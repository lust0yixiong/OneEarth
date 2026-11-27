import assert from "node:assert/strict";
import test from "node:test";
import {modelReply} from "./research-answer";
import {emptyFilters} from "../src/domain/spatial";
import type {DiscoveryContext,SearchRun,ToolCall,WebHit} from "../src/domain/types";
import type {DataSearchResult} from "./data-search";
import type {researchExecutor} from "./research-executor";
import {synthesisPromptByteLimit} from "./synthesis-context-budget";
import {publicAgUiResponse} from "./ag-ui-persistence";
import {publicAnswerContext} from "./public-answer-stream";
import {ExecutorFailure} from "./executor-failure";
import {verifiedDeliveryMaterials} from "./answer-delivery-materials";
import type {PaperRecord} from "../src/domain/paper-record";
const question="Northern Basin height 2020–2023 sources";
const context:DiscoveryContext={caseId:null,citation:null,selection:null,filters:emptyFilters(),gridSystem:"h3",layer:"all",camera:{center:[0,0],zoom:1,reason:"test"}};
const hit:WebHit={url:"https://example.org/data",title:"Northern Basin height",snippet:"Published metadata",pageExcerpt:"Inputs span 2020–2022. The nominal year is 2021. Files were not read.",stage:"page-excerpt"};
const retrieval=(hits:WebHit[]=[hit]):DataSearchResult=>({plan:{questionMode:"preserve",dataQuestion:question,dataNeed:null,paper:{name:"",facets:[],region:["Northern Basin"]},web:[],hainaQueries:[],researchIntent:{purpose:question,task:question,region:"Northern Basin",time:"2020–2023",months:[]}},papers:[],haina:[],issues:[],sourceStatus:[],searches:[{engine:"原站读取",status:"done",query:hit.url,requestUrl:hit.url,hits}]});
const timeout=()=>new ExecutorFailure({kind:"timeout",exitCode:null,signal:null,elapsedMs:110000,outputChars:0,diagnosticTailChars:0});
const paper:PaperRecord={id:"earthnano:"+"a".repeat(64),dsKey:"doi:10.9999/example-dataset",papers:1,
 paperTitle:"Methods for fictional current radiometry",studyContext:"",points:[],
 need:{name:"Fixture",product:"Fictional Radiometer Catalogue",type:"Data",source:"文献资料",status:"Published",detail:"Published assertion usage identity.",
  profile:{role:"data",spatial:"coverage",coverage:"Unspecified",access:"Public",limitation:"Fixture dataset"},
  tabs:[{kind:"table",label:"论文用法（本页）",rows:[["Methods for fictional current radiometry","Calibration input","Radiance","","paper-A","dataset-A"]]}]}};
const paperRef={kind:"asset",id:paper.id,title:paper.need.product,source:"文献资料",sourceChannel:"assertion"} as const;
const output=(message:string)=>JSON.stringify({message,sections:[],limitation:"",followUp:"",researchNotes:[],calculationRequests:[]});
const fake=(model:ReturnType<typeof researchExecutor>["model"]):ReturnType<typeof researchExecutor>=>({name:"codex",model,discover:async()=>assert.fail("no discovery"),read:async()=>assert.fail("no reading"),close:async()=>{}});
const call=(executor:ReturnType<typeof researchExecutor>,trace:ToolCall[],data:DataSearchResult|undefined=retrieval(),signal=new AbortController().signal,ms=1000,promptBytes?:number)=>modelReply(question,context,{message:""},[],executor,signal,undefined,[],"",undefined,data,item=>trace.push(item),undefined,[],{},undefined,undefined,{answerMs:ms,promptBytes});

test("a timed-out generation sends one bounded prompt, retains real source identities and records failure separately",async()=>{
 const trace:ToolCall[]=[];let count=0;
 const result=await call(fake(async prompt=>{count++;assert.ok(Buffer.byteLength(prompt)<=synthesisPromptByteLimit);assert.doesNotMatch(prompt,/controlled-fixture/);throw timeout();}),trace);
 assert.equal(count,1);assert.equal(result.answerNotes?.references?.length,1);assert.match(result.message,/nominal year is 2021/);
 assert.equal(result.answerNotes?.searches?.[0].query,hit.url);assert.equal(result.answerNotes?.webSources?.[0].url,hit.url,"do not sanitize actual read/source identity");
 const failure=trace.find(row=>row.id==="answer-generation"&&row.status==="failed")!;assert.equal(failure.error,"模型请求超时，可按原条件重试。");
 assert.equal(result.answerDelivery?.status,"partial");assert.equal(result.answerDelivery.reason,"timeout");
 assert.equal(result.answerDelivery.materials[0]?.kind,"web");
 assert.equal(JSON.parse(failure.output!).mode,"evidence-retained");assert.ok(!trace.some(row=>row.id==="answer-generation"&&row.status==="done"));
 assert.equal(JSON.parse(trace.find(row=>row.id==="answer-delivery")!.output!).mode,"evidence-retained");
});

test("empty actual retrieval survives model failure as zero-reference limitations",async()=>{
 const trace:ToolCall[]=[];const result=await call(fake(async()=>{throw timeout();}),trace,retrieval([]));
 assert.deepEqual(result.answerDelivery,{status:"unavailable",reason:"timeout",materials:[]});
 assert.doesNotMatch(result.answerNotes!.limitation,/完整年份/);
 assert.deepEqual(result.answerNotes?.references,[]);assert.equal(JSON.parse(trace.find(row=>row.id==="answer-delivery")!.output!).mode,"no-direct-evidence");
 const plan={action:"respond" as const,evidenceNeed:"none" as const,goal:question,targets:[],reason:"ordinary",clarification:null,researchIntent:{purpose:question,task:question,region:null,time:null,months:[]},conversationContext:question};
 await assert.rejects(modelReply(question,context,{message:""},[],fake(async()=>{throw Error("old ordinary failure");}),new AbortController().signal,undefined,[],"",undefined,undefined,undefined,{plan,searches:[]}),/old ordinary failure/);
});

test("only a validated model answer produces answer-generation done",async()=>{
 const trace:ToolCall[]=[];let calls=0;
 const result=await call(fake(async prompt=>{calls++;const p=JSON.parse(prompt.slice(prompt.lastIndexOf("\n{")+1));return output("该元数据的名义年为2021。["+p.webResults[0].ref+"]");}),trace);
 assert.equal(calls,1);assert.equal(result.answerNotes?.references?.length,1);assert.equal(result.answerDelivery,undefined);assert.equal(JSON.parse(trace.find(row=>row.id==="answer-generation"&&row.status==="done")!.output!).mode,"model-validated");
});

test("a failed first model preserves only actual current materials as clickable identities outside the prose",async()=>{
 const current={...hit,url:"https://example.org/current-read",title:"Saved original",pageExcerpt:"The fictional supplier records a sample."};
 const searchOnly={...current,url:"https://example.org/other",title:"Plausible search-only result",stage:"search-snippet" as const};
 const historyOnly={...current,url:"https://example.org/past",title:"Previous read",previousRead:true};
 const failed={...current,url:"https://example.org/failed",title:"Failed source"};
 const signed={...current,url:"https://example.org/export?sig=controlled-fixture",title:"Signed source"};
 const searches:SearchRun[]=[{engine:"原站读取",query:current.url,status:"done",hits:[current,current,searchOnly,historyOnly,signed]},
  {engine:"原站读取",query:failed.url,status:"failed",hits:[failed]}];
 const unverified={...paper,id:"earthnano:"+"b".repeat(64),need:{...paper.need,product:"Unverified paper candidate",
  tabs:[{kind:"table" as const,label:"论文用法（本页）",rows:[["Metadata-adjacent title","","","","","dataset-B"]]}]}};
 const data={...retrieval([]),papers:[paper,unverified,paper],searches};
 const trace:ToolCall[]=[];
 const result=await call(fake(async()=>{throw timeout();}),trace,data);
 assert.deepEqual(result.answerDelivery,{status:"partial",reason:"timeout",materials:[paperRef,
  {kind:"web",url:current.url,title:current.title,sourceChannel:"web",referenceType:"web"}]});
 assert.match(result.message,/打开本轮已保存的资料/);
 assert.doesNotMatch(result.message,/〔|Fictional Radiometer/,"independent cards are not numbered claims in the text");
 assert.deepEqual(result.answerNotes?.references,[]);
 assert.deepEqual(result.answerNotes?.webSources,[current],"the exact original record can open the saved text");
 assert.deepEqual(publicAgUiResponse(result).answerDelivery,result.answerDelivery);
 assert.equal(publicAgUiResponse(result).answerNotes?.webSources,undefined);
 assert.equal(JSON.parse(trace.find(row=>row.id==="answer-delivery")!.output!).mode,"evidence-retained");
});

test("an exact assertion receipt must identify the acquired record, paper, and dataset and include an actual quote",()=>{
 const past={...paper,id:"earthnano:"+"c".repeat(64)};
 const date="2026-11-27T01:02:00Z";
 const quote={blockId:"B001",section:"Methods",quote:"Exact fictional author text.",claims:[]};
 const found={paperId:"paper-A",datasetId:"dataset-A",title:paper.paperTitle,abstract:null,usage:null,variables:null,context:null,quotes:[quote]};
 const receipt={id:paper.id,readAt:date,evidence:{dataset:null,papers:[found]}};
 const verify=(candidate:typeof receipt)=>verifiedDeliveryMaterials([],[paper,past],[candidate],[],[]);
 assert.deepEqual(verify(receipt).select([]).map(item=>item.reference),[paperRef]);
 assert.equal(verify(receipt).hasQuote(paperRef,quote.quote),true);
 for(const candidate of [{...receipt,id:"earthnano:"+"d".repeat(64)}, {...receipt,evidence:{dataset:null,papers:[{...found,datasetId:"wrong"}]}},
  {...receipt,evidence:{dataset:null,papers:[{...found,quotes:[]}]}}]){
  assert.deepEqual(verify(candidate).select([]),[]);
 }
});

test("a late timeout can preserve an already validated exact public prefix and its current receipt",async()=>{
 const visible:string[]=[];
 const result=await publicAnswerContext.run({onText:delta=>visible.push(delta)},()=>call(fake(async(prompt,options)=>{
  const ref=JSON.parse(prompt.slice(prompt.lastIndexOf("\n{")+1)).webResults[0].ref;
  options?.publicText?.onDelta(JSON.stringify({message:"已提供北部流域元数据。["+ref+"]"}).slice(0,-2)+"\\n");
  throw timeout();
 }),[]));
 assert.equal(visible.join(""),"已提供北部流域元数据。〔1〕");
 assert.equal(result.message,visible.join(""));
 assert.deepEqual(result.answerDelivery,{status:"partial",reason:"timeout",materials:[
  {kind:"web",url:hit.url,title:hit.title,sourceChannel:"web",referenceType:"web"}]});
 assert.equal(result.answerNotes?.references?.length,1);
});

test("user cancellation still aborts instead of publishing a fallback",async()=>{
 const parent=new AbortController();const task=call(fake(async()=>{parent.abort(Error("user cancelled"));throw Error("child stopped");}),[],retrieval(),parent.signal);
 await assert.rejects(task,/user cancelled/);
});

test("the server deadline does not discard already acquired material or start another model",async()=>{
 let calls=0;const result=await call(fake(async()=>{calls++;return new Promise(()=>{});}),[],retrieval(),new AbortController().signal,20);
 assert.equal(calls,1);assert.equal(result.answerDelivery?.reason,"timeout");assert.match(result.message,/nominal year is 2021/);
});

test("a repair whose instructions cannot fit the remaining budget never reaches the executor",async()=>{
 let initialBytes=0;
 await call(fake(async prompt=>{initialBytes=Buffer.byteLength(prompt);return output("该元数据的名义年为2021。[S1]");}),[]);
 let calls=0;const trace:ToolCall[]=[];
 const result=await call(fake(async prompt=>{
  calls++;assert.equal(Buffer.byteLength(prompt),initialBytes);
  return output("待核字".repeat(7000)+" [S999]");
 }),trace,retrieval(),new AbortController().signal,1000,initialBytes+8);
 assert.equal(calls,1,"repair rejected even after removing its previous draft");
 assert.match(result.message,/回答整理未能完成/);
 const failure=trace.find(row=>row.id==="answer-generation"&&row.status==="failed")!;
 assert.match(failure.error!,/字节预算/);
 assert.equal(result.answerDelivery?.reason,"incomplete");
 assert.equal(JSON.parse(failure.output!).modelCalls,1);
});
