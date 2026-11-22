import assert from "node:assert/strict";
import test,{type TestContext} from "node:test";
import {randomUUID,createHash} from "node:crypto";
import {once} from "node:events";
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import express from "express";
import {gridQueryLimits,gridCatalogueAnswer,gridCatalogueLimit} from "./grid-catalogue-answer";
import * as planning from "./turn-planning";
const {turnPlanSchema,gridTurnPlanSchema}=planning;
import {executeTurn,type RuntimeServices} from "./runtime-turn";
import {openTaskStore,taskRoutes} from "./task-store";
import {emptyFilters,gridSpec} from "../src/domain/spatial";
import type {PaperRecord} from "../src/domain/paper-record";
import type {GridCoverageEvidence} from "../src/domain/grid-coverage";
import type {HainaRecord} from "../src/domain/haina-record";
import type {HainaCatalogStatus} from "../src/domain/haina-catalog-client";
import type {DiscoveryContext} from "../src/domain/types";

// The exact natural question from e52cb271, with no product rule tied to its
// year, grid, record identity or fixture type.
const original="请根据我已附加的地图范围，核对这个 H3 网格在 2003 年、当前论文筛选下命中的论文覆盖条目，并且只引用这个范围返回的资料。只读取当前覆盖结果，不要扩大范围或另行搜索。";
const paper=(version:string,key="doi:10.9999/grid-catalogue"):PaperRecord=>({id:"earthnano:"+createHash("sha256").update(key+version).digest("hex"),dsKey:key,papers:1,
  paperTitle:"Actual catalogue source "+version,studyContext:"",points:[],need:{name:"Data",product:"Actual dataset "+version,source:"文献资料",type:"Dataset",status:"published",
    detail:"Stored exact record "+version,profile:{role:"data",spatial:"nonspatial",coverage:"unknown",access:"fixture",limitation:"not an observation"},
    tabs:[{kind:"table",label:"论文用法（本页）",rows:[["Paper","input","field","","paper-id",key]]},
      {kind:"text",label:"原文 · archived excerpt",quote:"Existing excerpt must not be described as newly read."}]}});
const a=paper("A"),b=paper("B"),selection={id:"871f8aa03ffffff",grid:gridSpec("h3",7),point:[10.7,46.8] as [number,number]};
const ready=():GridCoverageEvidence=>({status:"ready",scopeId:randomUUID(),revision:"a".repeat(64),cellId:selection.id,gridKey:selection.grid.key,count:1,members:[a.dsKey],sourceIds:[a.id],
  summary:{selection,filters:{...emptyFilters(),source:"paper",period:[2003,2003]},caseId:null,layer:"all",metric:"products",candidateCount:1,candidateIdentity:"a".repeat(64)}});

async function fixture(t:TestContext,action:"read"|"respond"|"search"|"clarify"="read",options:{coverage?:GridCoverageEvidence;archived?:boolean;foreign?:boolean;missing?:boolean;wrongId?:boolean;unavailable?:boolean;explicitPaper?:boolean;intent?:string;noGrid?:boolean;haina?:{record:HainaRecord;catalog?:HainaCatalogStatus}}={}){
  const directory=mkdtempSync(path.join(tmpdir(),"oe-grid-catalogue-")),prompts=path.join(directory,"prompts.jsonl"),tasks=openTaskStore(":memory:");
  const old={path:process.env.PATH,url:process.env.ONEEARTH_DISCOVERY_URL,protocol:process.env.ONEEARTH_DISCOVERY_PROTOCOL};
  const plan={action,...(options.coverage?.status!=="unknown"?{gridIntent:options.intent??"catalogue"}:{}),goal:"核对本轮所指对象",evidenceNeed:action==="search"?"discover":action==="read"?"read":action==="clarify"?"unclear":"existing",targets:action==="read"?[options.explicitPaper?"asset:"+a.id:"grid:h7/"+selection.id]:[],
    reason:"controlled planner",clarification:action==="clarify"?"是否需要论文的方法判断？":null,evidenceGap:action==="search"?"controlled gap":null,
    researchIntent:{purpose:"核对所指对象",task:"核对所指对象",region:null,time:null,months:[]},conversationContext:"所附范围"};
  const noCitations={message:"模型故意遗漏所有引用。",sections:[],limitation:"未打开原文。",followUp:"",researchNotes:[],calculationRequests:[]};
  writeFileSync(path.join(directory,"codex"),`#!/usr/bin/env node\nimport fs from 'node:fs';let text='';for await(const c of process.stdin)text+=c;const index=process.argv.indexOf('--output-schema');const schema=index<0?null:JSON.parse(fs.readFileSync(process.argv[index+1],'utf8'));fs.appendFileSync(${JSON.stringify(prompts)},JSON.stringify({prompt:text,schema})+'\\n');const answer=text.includes('先决定本轮要做什么')?${JSON.stringify(plan)}:${JSON.stringify(noCitations)};if(!schema?.properties?.gridIntent)delete answer.gridIntent;process.stdout.write(JSON.stringify(answer));\n`,{mode:0o700});
  process.env.PATH=directory+path.delimiter+old.path;delete process.env.ONEEARTH_DISCOVERY_PROTOCOL;
  const requests:any[]=[],app=express();app.use(express.json({type:"application/a2a+json"}));
  app.post("/message:send",(req,res)=>{
    const data=req.body.message.parts[0].data;requests.push(structuredClone(data));
    if(data.kind==="oneearth.paper.query.v1"){
      assert.equal(data.input.operation,"records");assert.ok(data.input.ids.length<=20);
      if(options.unavailable){res.status(503).json({error:{code:503,message:"controlled unavailable"}});return;}
      const value=options.missing?[]:options.wrongId?[b]:data.input.ids.flatMap((id:string)=>id===a.id?[a]:[]);
      res.type("application/a2a+json").json({message:{role:"ROLE_AGENT",messageId:randomUUID(),contextId:randomUUID(),parts:[{data:{kind:"oneearth.paper.result.v1",operation:"records",value}}]}});return;
    }
    const event=data.kind==="oneearth.source.read.v1"?{sourceReadResult:{papers:[a],searches:[],issues:["No new full text acquired"]}}:
      {result:{plan:{questionMode:"preserve",dataQuestion:"new research",paper:{name:"",facets:[],region:[]},web:[],hainaQueries:[],dataNeed:null},
        clarification:"新的研究目标需要补充哪个条件？",papers:[],haina:[],searches:[],sourceStatus:[],issues:[]}};
    res.type("application/a2a+json").json({task:{id:randomUUID(),contextId:randomUUID(),status:{state:data.kind==="oneearth.source.read.v1"?"TASK_STATE_COMPLETED":"TASK_STATE_INPUT_REQUIRED"},
      artifacts:[{artifactId:randomUUID(),parts:[{data:{kind:"oneearth.discovery.event.v1",event:{seq:1,...event}}}]}]}});
  });
  taskRoutes(app,"/api/tasks",tasks,()=>undefined,{researchRecords:true});
  const server=app.listen(0,"127.0.0.1");await once(server,"listening");const address=server.address();assert.ok(address&&typeof address!=="string");
  const origin="http://127.0.0.1:"+address.port;process.env.ONEEARTH_DISCOVERY_URL=origin;
  t.after(async()=>{server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));tasks.close();rmSync(directory,{recursive:true,force:true});
    for(const [key,value] of [["PATH",old.path],["ONEEARTH_DISCOVERY_URL",old.url],["ONEEARTH_DISCOVERY_PROTOCOL",old.protocol]])if(value===undefined)delete process.env[key!];else process.env[key!]=value;});
  const conversationId=randomUUID(),parentId=randomUUID(),coverage=options.coverage??ready();
  tasks.submit(parentId,{conversationId:options.foreign?randomUUID():conversationId});tasks.claim();tasks.finish(parentId,"complete",{result:{message:"Old exact A",paperRecords:options.archived?[a]:[],gridCoverage:coverage,
    ...(options.haina?{hainaRecords:[options.haina.record],...(options.haina.catalog?{hainaCatalog:options.haina.catalog}:{})}:{})}});
  const parentBefore=JSON.stringify(tasks.terminal(parentId));
  const context:DiscoveryContext={filters:{...emptyFilters(),source:"public",period:[2020,2020]},selection,gridSystem:"h3",caseId:null,citation:null,layer:"all",camera:{center:[0,0],zoom:1,reason:"client mirror"},
    candidateIds:[b.id],attachedScope:[{kind:"grid",place:"client mirror",selection,coverageScope:{id:coverage.status==="ready"?coverage.scopeId:randomUUID(),revision:coverage.revision||"b".repeat(64)}},
      ...(options.explicitPaper?[{kind:"dataset" as const,id:a.id,title:a.need.product,source:a.need.source,version:null}]:[])]};
  if(options.noGrid){delete context.attachedScope;context.selection=null;context.candidateIds=[];}
  let coverageReads=0;
  const services={tasks,push:{latest:()=>({records:[]})},coverage:async()=>{coverageReads++;return coverage;},researchRegionService:{locate:async()=>null},adminBoundaryDir:directory,canonicalCache:new Map()} as unknown as RuntimeServices;
  async function run(query=original){
    const body={query,context,conversationId,turnId:randomUUID(),previousTaskId:parentId,history:[],config:{executor:"codex" as const,model:""},deepseekTools:{search:false,fetch:false}};
    const id=randomUUID();tasks.submit(id,body);tasks.claim();const outcome=await executeTurn(services,id,body,new AbortController().signal,event=>tasks.append(id,event));
    tasks.finish(id,outcome.error?"failed":"complete",outcome);assert.equal(JSON.stringify(tasks.terminal(parentId)),parentBefore);
    const modelCalls=readFileSync(prompts,"utf8").trim().split("\n").map(line=>JSON.parse(line));
    return {id,outcome,reply:outcome.result as any,promptCount:modelCalls.length,modelCalls};
  }
  return {run,requests,tasks,origin,coverageReads:()=>coverageReads};
}

for(const action of ["read","respond","search"] as const)test("original scoped catalogue question retains clickable exact A when planner chooses "+action,async t=>{
  const f=await fixture(t,action),{id,outcome,reply,promptCount,modelCalls}=await f.run();assert.equal(outcome.error,undefined);
  if(process.env.ONEEARTH_GRID_REPLAY_DIR)writeFileSync(path.join(process.env.ONEEARTH_GRID_REPLAY_DIR,action+".json"),JSON.stringify({question:original,plannedAction:action,
    promptCount,requests:f.requests.map(r=>({kind:r.kind,input:r.input})),message:reply.message,references:reply.answerNotes.references,
    paperIds:reply.paperRecords?.map((p:PaperRecord)=>p.id)||[],gridCoverage:reply.gridCoverage,limitation:reply.answerNotes.limitation},null,2));
  assert.deepEqual(reply.answerNotes.references.map((r:any)=>r.id),[a.id]);
  assert.deepEqual(modelCalls[0].schema,gridTurnPlanSchema);assert.match(modelCalls[0].prompt,/gridIntent/);
  assert.equal(promptCount,1,"only existing action planner; no extra synthesis/review/classification model call");
  assert.deepEqual(f.requests.map(r=>[r.kind,r.input.operation,r.input.ids]),[["oneearth.paper.query.v1","records",[a.id]]]);
  assert.deepEqual(reply.paperRecords,[a]);assert.equal(reply.answerNotes.references[0].id,a.id);assert.equal(reply.answerNotes.references[0].title,a.paperTitle);
  assert.equal(reply.answerNotes.references[0].evidenceLevel,"catalogue-record");assert.match(reply.message,/〔1〕/);assert.deepEqual(reply.modelIds,[a.id]);
  assert.match(reply.answerNotes.limitation,/未读取论文原文/);assert.equal(reply.gridCoverage.sourceIds[0],a.id);
  assert.ok(!JSON.stringify(reply).includes(b.id));assert.equal(f.coverageReads(),1);
  const record=await (await fetch(f.origin+"/api/tasks/"+id+"/record")).json();assert.deepEqual(record.result.paperRecords,[a]);assert.deepEqual(record.result.answerNotes.references,reply.answerNotes.references);
  const events=f.tasks.events(id,0);assert.ok(events.some(row=>(row.researchMaterials as any)?.papers?.[0]?.id===a.id));
});

test("same-conversation full archived A is retained while current B is not queried or substituted",async t=>{
  const f=await fixture(t,"respond",{archived:true,unavailable:true}),{reply}=await f.run("请列出这个格子里匹配的论文目录条目。");
  assert.deepEqual(reply.paperRecords,[a]);assert.equal(reply.answerNotes.references[0].id,a.id);assert.equal(f.requests.length,0);
  assert.match(reply.answerNotes.limitation,/同会话已归档材料/);
});
test("foreign archive does not authorize reuse of a withdrawn A",async t=>{
  const f=await fixture(t,"read",{archived:true,foreign:true,missing:true}),{reply}=await f.run();assert.equal(f.requests.length,1);assert.deepEqual(reply.answerNotes.references,[]);
  assert.match(reply.answerNotes.limitation,/暂未取得/);assert.match(reply.message,/匹配 1/);assert.equal(reply.paperRecords,undefined);
});
for(const failure of ["missing","wrongId","unavailable"] as const)test("exact catalogue lookup failure remains a gap, not current B or zero: "+failure,async t=>{
  const f=await fixture(t,"read",{[failure]:true}),{outcome,reply}=await f.run();assert.equal(outcome.error,undefined);assert.deepEqual(reply.answerNotes.references,[]);
  assert.equal(reply.paperRecords,undefined);assert.match(reply.message,/匹配 1/);assert.match(reply.answerNotes.limitation,/未按同名或当前版本替换/);
  assert.ok(f.requests.every(r=>r.kind==="oneearth.paper.query.v1"&&r.input.operation==="records"&&r.input.ids[0]===a.id));
});
for(const reason of ["expired","pending","unavailable"] as const)test("unverified scope blocks mistaken search/read without inventing catalogue references: "+reason,async t=>{
  const f=await fixture(t,"search",{coverage:{status:"unknown",reason,cellId:selection.id,gridKey:selection.grid.key}}),{reply}=await f.run();
  assert.match(reply.message,/覆盖未知/);assert.equal(reply.clarification,true);assert.equal(f.requests.length,0);assert.equal(reply.answerNotes,undefined);
});
test("count-only grid answer and authoritative zero need no paper query",async t=>{
  const f=await fixture(t,"read",{intent:"count"}),{reply}=await f.run("这个格子有多少种目录数据？");assert.match(reply.message,/匹配 1/);assert.deepEqual(reply.answerNotes.references,[]);assert.equal(f.requests.length,0);
  const zero=ready();if(zero.status==="ready"){zero.count=0;zero.sourceIds=[];zero.members=[];}
  assert.match(gridCatalogueAnswer(zero,"catalogue",[]).message,/匹配 0/);
});
test("bounded catalogue list never treats a partial list or identity-only record as all members",()=>{
  const records=Array.from({length:gridCatalogueLimit+3},(_,i)=>paper(String(i),"doi:10.9999/"+i)),coverage=ready();assert.equal(coverage.status,"ready");
  coverage.count=records.length;coverage.sourceIds=records.map(p=>p.id);coverage.members=records.map(p=>p.dsKey);
  const reply=gridCatalogueAnswer(coverage,"catalogue",records);assert.equal(reply.paperRecords?.length,gridCatalogueLimit);assert.match(reply.answerNotes!.limitation,/不是完整条目清单/);
  const thin=gridCatalogueAnswer(ready(),"catalogue",[{...a,catalogSummary:true}]);assert.deepEqual(thin.answerNotes?.references,[]);assert.equal(thin.paperRecords,undefined);
});
for(const query of ["把附图命中的论文名称和出处给我。","把刚选的那一格里命中的那篇给我看看。","对比一下两条目录记录。"])
test("the same planner semantic intent handles natural catalogue wording: "+query,async t=>{
  const f=await fixture(t,"search",{intent:"catalogue"}),{reply,promptCount}=await f.run(query);
  assert.equal(promptCount,1);assert.match(reply.message,new RegExp(a.paperTitle));assert.match(reply.message,new RegExp(a.need.product));
  assert.equal(f.requests[0].kind,"oneearth.paper.query.v1");
});
test("explicit paper text request retains exact source-read Task rather than a catalogue answer",async t=>{
  const f=await fixture(t,"read",{archived:true,explicitPaper:true,intent:"deeper"}),{outcome,reply,promptCount}=await f.run("读取所附网格中这篇论文的原文，只核对原文内容。");
  assert.equal(outcome.error,undefined);assert.equal(f.requests[0].kind,"oneearth.source.read.v1");assert.deepEqual(f.requests[0].input.targets,[{kind:"paper",id:a.id}]);
  assert.equal(promptCount,2);assert.ok(!reply.answerNotes.references.some((r:any)=>r.evidenceLevel==="catalogue-record"));
});
test("an explicit new research purpose still delegates discovery under the verified scope",async t=>{
  const f=await fixture(t,"search",{intent:"none"}),{outcome,reply}=await f.run("为这个网格查找更多独立论文和新数据，研究山洪风险。");assert.equal(outcome.error,undefined);
  assert.equal(f.requests[0].kind,"oneearth.discovery.request.v1");assert.equal(reply.clarification,true);
  assert.deepEqual(f.requests[0].input.scope.filters.period,[2003,2003]);assert.equal(f.requests[0].input.scope.filters.source,"paper");
});

test("public data research is not relabeled as paper catalogue membership",async t=>{
  const f=await fixture(t,"search",{intent:"none"}),{reply}=await f.run("这个网格有哪些公开数据？");
  assert.equal(f.requests[0].kind,"oneearth.discovery.request.v1");assert.equal(reply.clarification,true);
});
test("ordinary question keeps the actual original planner schema and no catalogue lookup",async t=>{
  const f=await fixture(t,"respond",{noGrid:true}),{modelCalls}=await f.run("你好，解释遥感的基本概念。");
  assert.deepEqual(modelCalls[0].schema,turnPlanSchema);assert.equal(f.requests.length,0);assert.equal(f.coverageReads(),0);
});
test("a scientific rebuttal question remains deeper, even with a paper in the grid",async t=>{
  const f=await fixture(t,"respond",{intent:"deeper",archived:true}),{reply,promptCount}=await f.run("这格里哪篇论文反驳了上一轮结论？");
  assert.equal(promptCount,2);assert.equal(reply.message,"模型故意遗漏所有引用。");assert.equal(f.requests.length,0);
});
for(const action of ["read","search","clarify"] as const)test("explicit current-coverage-only permission survives a mistaken deeper intent and "+action,async t=>{
  const f=await fixture(t,action,{intent:"deeper",explicitPaper:true}),{reply}=await f.run();
  assert.equal(f.requests[0].kind,"oneearth.paper.query.v1");assert.equal(f.requests.length,1);assert.equal(reply.answerNotes.references[0].id,a.id);
  assert.equal(reply.clarification,true);assert.match(reply.message,/不足以判断论文原文、方法或科学结论/);
});
test("no-search permission stops a mistaken semantic search without making up a scientific answer",async t=>{
  const f=await fixture(t,"search",{intent:"deeper"}),{reply}=await f.run("判断这个网格中论文能否反驳旧结论，不要另行搜索。");
  assert.equal(f.requests.length,0);assert.equal(reply.clarification,true);assert.match(reply.message,/尚未执行新发现/);
});
test("scoped schema is strict, validates semantic intent and leaves ordinary schema unchanged",async t=>{
  assert.equal(turnPlanSchema.required.includes("gridIntent"),false);assert.equal(Object.hasOwn(turnPlanSchema.properties,"gridIntent"),false);
  assert.equal(gridTurnPlanSchema.required.includes("gridIntent"),true);assert.deepEqual(gridTurnPlanSchema.properties.gridIntent.enum,["none","count","catalogue","deeper"]);
  assert.ok(gridTurnPlanSchema.required.every(k=>Object.hasOwn(gridTurnPlanSchema.properties,k)));
  const f=await fixture(t,"search",{intent:"invented"}),{outcome}=await f.run("列出所附网格的目录条目。");assert.equal(outcome.code,"TURN_PLAN_INVALID");assert.equal(f.requests.length,0);
  assert.equal(gridQueryLimits("不要另行搜索，只读取当前覆盖结果。").currentCoverageOnly,true);
});
test("a catalogue semantic label cannot bypass an explicit new-source request",async t=>{
  const f=await fixture(t,"search",{intent:"catalogue"}),{outcome}=await f.run("为这个网格查找新的独立论文和公开数据。");
  assert.equal(outcome.code,"TURN_PLAN_INVALID");assert.equal(f.requests.length,0);
});
for(const withStatus of [true,false])test("mixed catalogue membership retains actual local Haina type and archived status: "+withStatus,async t=>{
  const record:HainaRecord={id:987654321,name:"Actual archived Haina data",description:"original",provider:"fixture",source:"Haina",version:"A",license:"fixture",access:"Public",labels:[],card:{tags:[]}};
  const catalog={total:1,synced:"2026-11-22T00:00:00Z",endpoint:"https://example.org/archived-haina",warning:""};
  const coverage=ready();assert.equal(coverage.status,"ready");coverage.count=2;coverage.members.push("haina:"+record.id);coverage.sourceIds.push("haina:"+record.id);coverage.summary!.filters.source="";
  const f=await fixture(t,"respond",{coverage,archived:true,haina:{record,...(withStatus?{catalog}:{})}}),{reply}=await f.run("列出所附范围的目录条目。");
  assert.equal(f.requests.length,0);assert.equal(reply.answerNotes.references[1].id,"haina:"+record.id);assert.equal(reply.answerNotes.references[1].sourceChannel,"local");
  assert.match(reply.message,/目录对象：Actual archived Haina data/);assert.ok(!reply.message.includes("论文：Actual archived Haina data"));
  assert.deepEqual(reply.hainaRecords,[record]);assert.deepEqual(reply.hainaCatalog,withStatus?catalog:undefined);
  if(!withStatus)assert.match(reply.answerNotes.limitation,/未取得对应目录状态/);
});
