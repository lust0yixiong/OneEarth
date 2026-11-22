import assert from "node:assert/strict";
import test from "node:test";
import {compareSourceReadings,validateSourceChanges,readSourceIdentity,type SourceChangeAssessment} from "./source-read-comparison";
import {modelReply} from "./research-answer";
import {synthesisResponseSchema,parseSynthesis} from "./scientific-answer";
import {buildAnswerEvidenceInput} from "./review-answer-evidence";
import {emptyFilters} from "../src/domain/spatial";
import type {DiscoveryContext,DiscoveryResponse,ReadEvidence,SearchRun,WebHit} from "../src/domain/types";
import type {researchExecutor} from "./research-executor";
import type {TurnPlan} from "./turn-planning";

const url="https://files.scec.org/s3fs-public/15108report.pdf";
const grouping="Comparison between the relative displacement time-series of GPS and InSAR at sites COTD and sites PSAP. c) Similar comparison as b) at sites CACT and sites TMAP.";
const oldText="[PDF 第 2 页；文本字符 1–700；局部片段 1]\n"+"Prior archived context. ".repeat(44)+grouping+"\n"+"Other saved report text. ".repeat(135);
const currentText="[PDF 第 3 页；文本字符 106–805；局部片段 1]\n"+"Current sampled page context. ".repeat(91)+grouping.replace("time-series","time - series")+"\n[读取范围] 仅摘录上述页面的有界文本；不代表全文已核实。";
const oldTime="2026-11-21T12:00:00Z",newTime="2026-11-22T08:36:58.568Z";
const memory:ReadEvidence={url,title:"SCEC report",excerpt:oldText.slice(0,1600),stage:"pdf-excerpt",readAt:oldTime,excerptTruncated:true,sourceExcerptLength:oldText.length,readBy:"platform"};
const previous:WebHit={url,title:"SCEC report",snippet:"Previously acquired report excerpt",pageExcerpt:oldText,stage:"page-excerpt"};
const parent:DiscoveryResponse={message:"Saved comparison",conversationEvidence:[memory],answerNotes:{sources:[],references:[{kind:"web",url,title:"SCEC report",sourceChannel:"web"}],webSources:[previous],limitation:"",followUp:"",reviewed:0,elapsedMs:0,executor:"Codex"}};
const current=(extra=""):WebHit=>({url,title:"SCEC report",snippet:"Current acquired excerpt",pageExcerpt:currentText+extra,stage:"pdf-excerpt",readAt:newTime,discoveredBy:"assistant",readBy:"platform"});
const runs=(hit=current()):SearchRun[]=>[{engine:"PDF 原文",query:url,status:"done",requestUrl:url,startedAt:newTime,hits:[hit]}];
const context:DiscoveryContext={filters:emptyFilters(),caseId:null,citation:null,selection:null,gridSystem:"h3",layer:"all",camera:{center:[0,0],zoom:1,reason:"fixture"}};
const query="重读图注，说明四站分组此前已有还是本轮才补齐，以及实际可见的差别。";
const plan:TurnPlan={action:"read",goal:query,evidenceNeed:"read",reason:"明确原PDF精确重读",targets:[{key:"web:"+url,kind:"web",url,title:"SCEC report",basis:"numbered",discoveredBy:"assistant"}],clarification:null,researchIntent:{purpose:query,task:query,region:null,time:null,months:[]},conversationContext:query};
const template={sections:[],limitation:"",followUp:"",researchNotes:[],calculationRequests:[]};
const badStatement="本轮新增的图注文字补全了四个站点的分组";
const correctStatement="四站分组在此前保存的图注中已齐全，本轮只是按原PDF重新核实";
function assessment(statement:string,status:SourceChangeAssessment["status"],quote=grouping):SourceChangeAssessment{
  return {ref:"S1",statement,status,historyWindow:status==="reverified"?"H1":null,historyQuote:status==="reverified"?grouping:null,currentWindow:"C1",currentQuote:quote};
}
const decoded=(prompt:string)=>JSON.parse(prompt.slice(prompt.lastIndexOf("\n{")+1));
async function assemble(run:ReturnType<typeof researchExecutor>["model"],hit=current(),record:DiscoveryResponse|null=parent){
  const executor:ReturnType<typeof researchExecutor>={name:"codex",model:run,discover:async()=>{throw Error("No discovery request");},read:async()=>{throw Error("No source request");},close:async()=>{}};
  return modelReply(query,context,{message:"精确重读已实际取得原PDF节选"},[{role:"assistant",text:"此前归档",conversationEvidence:record?.conversationEvidence}],executor,new AbortController().signal,
    undefined,[],"",undefined,undefined,undefined,{plan,searches:runs(hit)},[],{record:record||undefined});
}

test("same source compares the longer original archive and actual reread with original layer, time and page anchors",()=>{
  const before=JSON.stringify(parent),comparison=compareSourceReadings([current()],{record:parent},[memory])[0];
  assert.equal(comparison.history[0].excerpt,oldText);assert.equal(comparison.history[0].origin,"parent.answerNotes.webSources");
  assert.equal(comparison.history[0].stage,"page-excerpt");assert.equal(comparison.history[0].readAt,null,"unknown original read time is not fabricated");
  assert.equal(comparison.history[1].readAt,oldTime);assert.equal(comparison.history[1].truncated,true);
  assert.equal(comparison.current[0].readAt,newTime);assert.equal(comparison.current[0].stage,"pdf-excerpt");
  assert.ok(comparison.history[0].pageMarkers[0].includes("第 2 页"));assert.ok(comparison.current[0].pageMarkers[0].includes("第 3 页"));
  assert.equal(comparison.difference.currentTextSeenBefore,false,"different sampled windows do not establish new facts");
  assert.equal(JSON.stringify(parent),before);
  assert.throws(()=>validateSourceChanges({message:badStatement,limitation:"",followUp:"",references:[{kind:"web",url,title:"report"}],sourceChanges:[assessment(badStatement,"added_in_supplied_material")]},[comparison]),/历史窗口/);
});

test("old four-station grouping mislabeled as new is corrected in the existing synthesis repair, without a classifier call",async()=>{
  const saved=JSON.stringify(parent);let calls=0;
  const result=await assemble(async(prompt,options)=>{
    calls++;const schema=options!.outputSchema as typeof synthesisResponseSchema&{properties:{sourceChanges:unknown}};
    assert.ok(schema.required.includes("sourceChanges"));assert.ok(schema.properties.sourceChanges);assert.equal(schema.additionalProperties,false);
    if(calls===1){
      const supplied=decoded(prompt).sourceReadComparisons[0];assert.equal(supplied.history[0].excerpt,oldText);assert.equal(supplied.current[0].excerpt,currentText);
      return JSON.stringify({...template,message:badStatement+"。[S1]",sourceChanges:[assessment(badStatement,"added_in_supplied_material")]});
    }
    assert.equal(calls,2);assert.match(prompt,/本轮引文已存在于提供的历史窗口/);
    return JSON.stringify({...template,message:correctStatement+"。[S1]",sourceChanges:[assessment(correctStatement,"reverified")]});
  });
  assert.equal(calls,2);assert.ok(result.message.includes(correctStatement));assert.ok(!result.message.includes(badStatement));
  assert.equal(result.answerNotes?.references?.[0].kind,"web");assert.equal(result.answerNotes?.webSources?.[0].pageExcerpt,currentText);
  assert.equal(JSON.stringify(parent),saved);assert.equal(result.conversationEvidence?.[0].readAt,newTime,"current receipt remains current, while old source windows remain archived");
});

test("a new fact relative to the supplied complete archive can be explicitly described in the original one synthesis call",async()=>{
  const newMaterial="CONTROLLED NEW MATERIAL: the processing log names a 17-day calibration window.";
  const statement="相对本次可见旧归档，本轮补读新增了 processing log 的17-day校准窗口说明";let calls=0;
  const result=await assemble(async(prompt,options)=>{
    calls++;const supplied=decoded(prompt).sourceReadComparisons[0];assert.ok(!supplied.history[0].excerpt.includes(newMaterial));assert.ok(supplied.current[0].excerpt.includes(newMaterial));
    assert.ok((options!.outputSchema as any).required.includes("sourceChanges"));
    return JSON.stringify({...template,message:statement+"。[S1]",sourceChanges:[assessment(statement,"added_in_supplied_material",newMaterial)]});
  },current("\n[PDF 第 4 页；文本字符 1–90]\n"+newMaterial));
  assert.equal(calls,1);assert.ok(result.message.includes(statement));
});

test("truncated history cannot be used to force a novelty classification; unknown is valid",async()=>{
  const clipped={...parent,answerNotes:undefined,conversationEvidence:[{...memory,excerpt:"Only a short partial caption was retained.",excerptTruncated:true}]};
  const comparison=compareSourceReadings([current()],{record:clipped})[0];
  assert.throws(()=>validateSourceChanges({message:badStatement,limitation:"",followUp:"",references:[{kind:"web",url,title:"report"}],sourceChanges:[assessment(badStatement,"added_in_supplied_material")]},[comparison]),/裁短/);
  const statement="旧档节选不完整，无法判断这段分组说明是否属于首次补齐";let calls=0;
  const result=await assemble(async()=>{calls++;return JSON.stringify({...template,message:statement+"。[S1]",sourceChanges:[assessment(statement,"unknown")]});},current(),clipped);
  assert.equal(calls,1);assert.ok(result.message.includes(statement));
});

test("ordinary replies retain the original strict schema; PDF page fragments share identity but versions and web hash routes do not",async()=>{
  assert.equal(readSourceIdentity(url+"#page=3"),url);assert.notEqual(readSourceIdentity(url+"?edition=2#page=3"),url);
  assert.notEqual(readSourceIdentity("https://example.org/app#page=2"),"https://example.org/app#page=1");
  assert.equal(compareSourceReadings([{...current(),url:url+"?edition=2"}],{record:parent}).length,0);
  let calls=0,schema:unknown;const result=await assemble(async(_prompt,options)=>{calls++;schema=options!.outputSchema;return JSON.stringify({...template,message:"本轮读取保留原PDF引用，不判断资料是否新增。[S1]"});},current(),null);
  assert.equal(calls,1);assert.equal(schema,synthesisResponseSchema);assert.ok(!Object.hasOwn((schema as any).properties,"sourceChanges"));assert.match(result.message,/本轮读取保留原PDF引用/);
});

test("the existing sampled evidence review receives archived original text and reading provenance too",()=>{
  const web=current(),comparisons=compareSourceReadings([web],{record:parent},[memory]);
  const parsedAnswer=parseSynthesis(JSON.stringify({...template,message:correctStatement+"。[S1]",sourceChanges:[assessment(correctStatement,"reverified")]}),[{kind:"web",url,title:"report"}],[web]);
  const input=buildAnswerEvidenceInput({parsedAnswer,catalogue:[],references:[{kind:"web",url,title:"report"}],webHits:[web],sourceReadComparisons:comparisons});
  const archived=input.sources[0].windows.find(window=>window.id==="prior-literal-archive-H1");assert.equal(archived?.text,oldText);
  assert.ok(archived?.location.includes("page-excerpt"));assert.ok(input.sources[0].windows.find(window=>window.id==="page")?.text?.includes("time - series"));
});

test("limited PDF typography matching preserves numeric ranges and negative-sign spacing",()=>{
  for(const [before,after] of [["Range is 3 - 7.","Range is 3-7."],["Contrast is - 5.","Contrast is -5."]]){
    const record:DiscoveryResponse={message:"saved",answerNotes:{sources:[],webSources:[{...previous,pageExcerpt:before}],limitation:"",followUp:"",reviewed:0,elapsedMs:0,executor:"Codex"}};
    const comparison=compareSourceReadings([{...current(),pageExcerpt:after}],{record})[0];
    assert.equal(comparison.difference.currentTextSeenBefore,false);
    assert.equal(comparison.history[0].excerpt,before);assert.equal(comparison.current[0].excerpt,after);
  }
});
