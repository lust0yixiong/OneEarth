import test from "node:test";
import assert from "node:assert/strict";
import {continueResearch} from "./research-evidence";
import {evidenceDecisionLimits,decisionDeadline} from "./runtime-decision-budget";
import {parseTurnPlan,type TurnPlan} from "./turn-planning";
import {emptyFilters} from "../src/domain/spatial";
import type {SearchRun,ToolCall} from "../src/domain/types";
import type {SourceReadLocator} from "../src/domain/source-read-locator";
const url="https://example.org/controlled-source",other="https://example.org/new-source",question="比较原图表的依据，并说明缺项。";
const plan:TurnPlan={action:"read",goal:question,evidenceNeed:"read",targets:[{key:"web:"+url,kind:"web",title:"Controlled source",basis:"attachment",url}],reason:"original selected source",clarification:null,researchIntent:{purpose:question,task:question,region:null,time:null,months:[]},conversationContext:question};
const source=(address=url):SearchRun=>({engine:"原站读取",query:address,status:"done",hits:[{url:address,title:"Controlled source",snippet:"Actual supplied source",pageExcerpt:"The supplied opening window establishes the original source.",stage:"page-excerpt",availableLocators:[{kind:"table",value:"rates",label:"Measured rates"},{kind:"equation",value:"normalization",label:"Normalization formula"}]}]});
const decision=(action:string,targets:string[]=[],locators:unknown=null,gap:string|null=action==="read"||action==="discover"?"specific missing field":null)=>JSON.stringify({action,targets,locators,gap,clarification:null});
const acquired={...source(),hits:[{...source().hits[0],locatorResults:[{kind:"table" as const,value:"rates",status:"found" as const,excerpt:"Site | rate\nA | 0.4"}]}]};

test("two field failures followed by a third valid locator really read, without requiring reason",async()=>{
 let models=0,reads=0;const inputs:any[]=[],trace:ToolCall[]=[];
 const result=await continueResearch(question,plan,{reads:[source()]},new AbortController().signal,{
  model:async prompt=>{inputs.push(JSON.parse(prompt.slice(prompt.lastIndexOf("\n{")+1)));models++;return models===1?decision("read",["W999"],[{kind:"table",value:"rates"}]):models===2?decision("read",["W1"],[{kind:"invalid",value:"rates"}]):models===3?decision("read",["W1"],[{kind:"table",value:"rates"}]):decision("answer");},
  read:async(targets,_focus,_step,signal)=>{reads++;assert.equal(signal?.aborted,false);assert.equal(targets[0].url,url);assert.deepEqual(targets[0].locators,[{kind:"table",value:"rates"}]);return [acquired];},discover:async()=>assert.fail(),report:call=>trace.push(call),stage:()=>{},
 },undefined,{allowDiscovery:false,allowReread:true});
 assert.equal(models,4);assert.equal(reads,1);assert.equal(result.assessment,"answer");assert.equal(inputs[1].previousFailure.diagnostic.field,"targets");assert.equal(inputs[2].previousFailure.diagnostic.field,"locators[0].kind");assert.equal(inputs[2].resources.remainingAcquisitions,2);assert.equal(inputs[2].resources.remainingLocatorReads,4);assert.ok(inputs[0].materials.web[0].availableLocators.some((item:any)=>item.value==="rates"));
 const budget=JSON.parse(trace.find(call=>call.id==="research-budget")!.output!);assert.equal(budget.modelCalls,4);assert.equal(budget.acquisitions,0);assert.equal(budget.locatorReads,1);
});

test("the same code and field can be corrected later rather than being an early no-progress veto",async()=>{
 let models=0,reads=0;
 const result=await continueResearch(question,plan,{reads:[source()]},new AbortController().signal,{
  model:async()=>++models<4?decision("read",["W"+(100+models)],[{kind:"table",value:"rates"}]):models===4?decision("read",["W1"],[{kind:"table",value:"rates"}]):decision("answer"),read:async()=>{reads++;return [acquired];},discover:async()=>assert.fail(),report:()=>{},stage:()=>{},
 },undefined,{allowDiscovery:false});assert.equal(models,5);assert.equal(reads,1);assert.equal(result.assessment,"answer");
});

test("a source-declared format is visible and can be acquired only within the existing authority",async()=>{
 const alternate="https://archive.example.org/source.xml";
 const landing:SearchRun={engine:"原站读取",query:url,status:"done",hits:[{
   url,title:"Controlled source",snippet:"Public landing page",sourceAlternates:[
     {url:alternate,mediaType:"application/xml",relation:"alternate"},
     {url:"https://archive.example.org/source.pdf?sig=temporary",mediaType:"application/pdf",relation:"citation_pdf_url"},
   ],
 }]};
 for(const allowDiscovery of [false,true]){
   const inputs:any[]=[],requests:TurnPlan["targets"][]=[],trace:ToolCall[]=[];
   const result=await continueResearch(question,plan,{reads:[landing],attemptedReadTargets:[url]},new AbortController().signal,{
     model:async prompt=>{
       const input=JSON.parse(prompt.slice(prompt.lastIndexOf("\n{")+1));inputs.push(input);
       if(inputs.length>1)return decision("answer");
       return decision("read",[input.materials.sourceAlternateHints[0].readTarget??"W2"]);
     },
     read:async targets=>{requests.push(targets);return [source(alternate)];},
     discover:async()=>assert.fail(),report:call=>trace.push(call),stage:()=>{},
   },undefined,{allowDiscovery,allowReread:true});
   const hints=inputs[0].materials.sourceAlternateHints;
   assert.deepEqual(hints,[{url:alternate,mediaType:"application/xml",relation:"alternate",declaredBy:url,...allowDiscovery?{readTarget:"W1"}:{}}]);
   assert.equal(inputs[0].sameSourceLocatorTargets.length,0);
   assert.equal(requests.length,allowDiscovery?1:0);
   if(allowDiscovery){
     assert.equal(requests[0][0].url,alternate);
     assert.equal(JSON.parse(trace.find(call=>call.id==="research-budget")!.output!).acquisitions,1);
   }else assert.equal(inputs[1].previousFailure.toolAttempted,false);
   assert.equal(result.assessment,"answer");
 }
});

test("the provider's bounded outline reaches the material model intact, including late entries",async()=>{
 const run=source(),locators=Array.from({length:20},(_,i)=>({kind:"section" as const,value:"section-"+(i+1),label:"Published section "+(i+1)}));run.hits[0].availableLocators=locators;
 let seen:any;await continueResearch(question,plan,{reads:[run]},new AbortController().signal,{model:async prompt=>{seen=JSON.parse(prompt.slice(prompt.lastIndexOf("\n{")+1));return decision("answer");},read:async()=>assert.fail(),discover:async()=>assert.fail(),report:()=>{},stage:()=>{}},undefined,{allowDiscovery:false});
 assert.deepEqual(seen.materials.web[0].availableLocators,locators);assert.deepEqual(seen.materials.sourceOutlines[0].availableLocators,locators);assert.equal(seen.materials.sourceOutlines[0].label,"W1");
});

test("missing or malformed noncritical reason alone cannot block a valid read or answer",async()=>{
 for(const reason of [undefined,"",7,{not:"a reason"},"x".repeat(600)]){
  let calls=0,reads=0;const result=await continueResearch(question,plan,{reads:[source()]},new AbortController().signal,{
   model:async()=>JSON.stringify({...JSON.parse(++calls===1?decision("read",["W1"],[{kind:"table",value:"rates"}]):decision("answer")),...(reason===undefined?{}:{reason})}),read:async()=>{reads++;return [acquired];},discover:async()=>assert.fail(),report:()=>{},stage:()=>{},
  },undefined,{allowDiscovery:false});assert.equal(reads,1);assert.equal(calls,2);assert.equal(result.assessment,"answer");
 }
});

test("legacy plan reason is also noncritical while its target and authority checks remain mandatory",()=>{
 const input={question,context:{caseId:null,filters:emptyFilters(),selection:null,citation:null,gridSystem:"h3" as const,layer:"all" as const,camera:{center:[0,0] as [number,number],zoom:1,reason:"fixture"}},history:[]};
 for(const reason of [undefined,"",7,{}]){
  const value={...plan,reason,targets:[plan.targets[0].key],evidenceGap:null};assert.equal(parseTurnPlan(JSON.stringify(value),input,plan.targets).action,"read");assert.throws(()=>parseTurnPlan(JSON.stringify({...value,targets:["unknown"]}),input,plan.targets));
 }
});

test("failed and successful positions are reused per URL and locator while a new position still executes",async()=>{
 let calls=0;const dispatched:SourceReadLocator[][]=[],inputs:any[]=[];
 const result=await continueResearch(question,plan,{reads:[source()]},new AbortController().signal,{
  model:async prompt=>{inputs.push(JSON.parse(prompt.slice(prompt.lastIndexOf("\n{")+1)));calls++;return calls===1?decision("read",["W1"],[{kind:"table",value:"missing"}]):calls===2?decision("read",["W1"],[{kind:"table",value:"missing"},{kind:"table",value:"rates"}]):calls===3?decision("read",["W1"],[{kind:"table",value:"rates"}]):decision("answer");},
  read:async targets=>{const positions=targets[0].locators!;dispatched.push(positions);return [{...source(),hits:[{...source().hits[0],locatorResults:positions.map(locator=>({...locator,status:locator.value==="missing"?"not_found" as const:"found" as const,...(locator.value==="missing"?{}:{excerpt:"Actual measured row A = 0.4"})}))}]}];},discover:async()=>assert.fail(),report:()=>{},stage:()=>{},
 },undefined,{allowDiscovery:false});
 assert.equal(calls,4);assert.deepEqual(dispatched,[[{kind:"table",value:"missing"}],[{kind:"table",value:"rates"}]]);assert.equal(inputs[3].previousFailure,undefined);assert.ok(inputs[3].receipts.some((row:any)=>row.locator?.value==="rates"&&row.status==="found"));assert.equal(result.assessment,"answer");assert.equal(result.reads.length,3);
});

test("two external acquisitions do not consume the independent locator allowance for an obtained source",async()=>{
 let calls=0,finds=0;const reads:any[]=[],inputs:any[]=[],trace:ToolCall[]=[];
 const result=await continueResearch(question,plan,{reads:[source()]},new AbortController().signal,{
  model:async prompt=>{const input=JSON.parse(prompt.slice(prompt.lastIndexOf("\n{")+1));inputs.push(input);calls++;return calls===1?decision("discover"):calls===2?decision("read",["W2"]):calls===3?decision("read",["W1"],[{kind:"table",value:"rates"}]):decision("answer");},
  discover:async()=>{finds++;return {plan:{questionMode:"preserve",dataQuestion:question,dataNeed:null,hainaQueries:[],paper:{name:"",facets:[],region:[]},web:[]},issues:[],sourceStatus:[],papers:[],haina:[],searches:[{engine:"DeepSeek Search",query:"actual independent clue",status:"done",hits:[{url:other,title:"New clue",snippet:"not read yet"}]}]};},
  read:async targets=>{reads.push(targets);return targets[0].url===other?[source(other)]:[acquired];},report:call=>trace.push(call),stage:()=>{},
 },undefined,{allowDiscovery:true});
 assert.equal(finds,1);assert.equal(reads.length,2);assert.equal(reads[1][0].url,url);assert.equal(inputs[2].resources.remainingAcquisitions,0);assert.equal(inputs[2].resources.remainingLocatorReads,4);assert.ok(inputs[2].actions.includes("read"));assert.ok(!inputs[2].actions.includes("discover"));assert.equal(result.assessment,"answer");
 const budget=JSON.parse(trace.find(call=>call.id==="research-budget")!.output!);assert.deepEqual({external:budget.acquisitions,locator:budget.locatorReads,tools:budget.toolAttempts},{external:2,locator:1,tools:3});
});

test("all invalid decisions exhaust only shared model resources, while actual location/tool calls remain zero",async()=>{
 let models=0;const result=await continueResearch(question,plan,{reads:[source()]},new AbortController().signal,{model:async()=>{models++;return decision("read",["W999"],[{kind:"page",value:"-1"}]);},read:async()=>assert.fail(),discover:async()=>assert.fail(),report:()=>{},stage:()=>{}},undefined,{allowDiscovery:false});assert.equal(models,evidenceDecisionLimits.modelCalls);assert.equal(result.assessment,"unresolved");assert.equal(result.reads.length,1);
});

test("a search snippet with location metadata does not become an obtained source after external slots are full",async()=>{
 let calls=0,reads=0;const inputs:any[]=[];
 const result=await continueResearch(question,plan,{reads:[source()]},new AbortController().signal,{
  model:async prompt=>{inputs.push(JSON.parse(prompt.slice(prompt.lastIndexOf("\n{")+1)));calls++;return calls===1?decision("discover"):calls===2?decision("read",["W2"]):calls===3?decision("read",["W2"],[{kind:"table",value:"rates"}]):decision("answer");},
  discover:async()=>({plan:{questionMode:"preserve",dataQuestion:question,dataNeed:null,hainaQueries:[],paper:{name:"",facets:[],region:[]},web:[]},issues:[],sourceStatus:[],papers:[],haina:[],searches:[{engine:"DeepSeek Search",query:"clue",status:"done",hits:[{url:other,title:"Unobtained source",snippet:"Only a snippet",stage:"search-snippet",availableLocators:[{kind:"table",value:"rates"}]}]}]}),
  read:async()=>{reads++;throw Error("source not obtained");},report:()=>{},stage:()=>{},
 },undefined,{allowDiscovery:true});
 assert.equal(reads,1);assert.equal(calls,4);assert.ok(!inputs[2].sameSourceLocatorTargets.includes("W2"));assert.equal(inputs[3].previousFailure.diagnostic.code,"acquisition-budget-exhausted");assert.equal(result.assessment,"answer");
});

test("failed source receipts remain reusable when external slots are exhausted and no source was obtained",async()=>{
 let calls=0,reads=0;const inputs:any[]=[];
 const both={...plan,targets:[plan.targets[0],{...plan.targets[0],key:"web:"+other,url:other,title:"Other provided source"}]};
 const result=await continueResearch(question,both,{reads:[]},new AbortController().signal,{
  model:async prompt=>{inputs.push(JSON.parse(prompt.slice(prompt.lastIndexOf("\n{")+1)));calls++;return calls===1?decision("read",["W1"]):calls===2?decision("read",["W2"]):calls===3?decision("read",["W1"]):decision("answer");},
  read:async()=>{reads++;throw Error("controlled unavailable source");},discover:async()=>assert.fail(),report:()=>{},stage:()=>{},
 },undefined,{allowDiscovery:false});
 assert.equal(reads,2);assert.equal(calls,4);assert.equal(inputs[2].resources.remainingAcquisitions,0);assert.ok(inputs[2].receipts.some((row:any)=>row.label==="W1"&&row.status==="unknown"&&!row.sourceAcquired));assert.equal(inputs[3].previousFailure.toolAttempted,false);assert.equal(result.assessment,"answer");assert.equal(result.reads.length,0);
});

test("a local deadline is distinct from cancellation and never fabricates a received material",async()=>{
 const parent=new AbortController(),deadline=decisionDeadline(parent.signal,10);try{await assert.rejects(deadline.run(()=>new Promise(()=>{})),/时间预算/);assert.equal(parent.signal.aborted,false);assert.equal(deadline.signal.aborted,true);}finally{deadline.close();}
 const cancel=new AbortController();let reads=0;await assert.rejects(continueResearch(question,plan,{reads:[source()]},cancel.signal,{model:async()=>decision("read",["W1"],[{kind:"table",value:"rates"}]),read:async()=>{reads++;cancel.abort(Error("actual user cancel"));throw Error("stopped");},discover:async()=>assert.fail(),report:()=>{},stage:()=>{}},undefined,{allowDiscovery:false}),/actual user cancel/);assert.equal(reads,1);
});
