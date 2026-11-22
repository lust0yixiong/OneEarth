import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import {once} from "node:events";
import {randomUUID} from "node:crypto";
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {openTaskStore,taskRoutes} from "./task-store";
import {executeTurn,type RuntimeServices} from "./runtime-turn";
import {withCurrentAssertionReadings,rememberCurrentAssertionReadings,currentAssertionView} from "./runtime-assertion-evidence";
import {emptyFilters} from "../src/domain/spatial";
import type {PaperRecord,PaperDatasetEvidence} from "../src/domain/paper-record";

const record:PaperRecord={id:"earthnano:"+"9".repeat(64),dsKey:"doi:10.9999/assertion-loop",papers:1,paperTitle:"Original stable paper record",studyContext:"No unique method retained",points:[],
  need:{name:"Original stable record",product:"Controlled product",type:"论文抽取线索",detail:"Previously retained metadata only",source:"文献资料",status:"used",datasetId:"doi:10.9999/assertion-loop",url:"https://example.org/metadata-only",
    profile:{role:"data",spatial:"nonspatial",coverage:"not located",access:"fixture",limitation:"saved record lacks method paragraph"},
    tabs:[{kind:"table",label:"论文用法（本页）",rows:[["Original stable record","input","flux","","PAPER-CONSERVATION","DATASET-1"]]}]}};
const fact="The conservation constraint is enforced with the unique flux-balancing method ZEPHYR-731.",readAt="2026-11-22T04:00:00Z";
const evidence:PaperDatasetEvidence={dataset:null,papers:[{paperId:"PAPER-CONSERVATION",datasetId:"DATASET-1",title:"Fresh method source",abstract:null,usage:null,variables:null,context:null,
  quotes:[{blockId:"B009871",section:"Methods",quote:fact,claims:[]},{blockId:"B009872",section:"Appendix",quote:"Unrelated appendix prose ".repeat(3000)+"UNADOPTED-RAW-END",claims:[]}]}]};
const reading={id:record.id,readAt,evidence};

test("current assertion receipts remain separate, are bounded to actual supplied windows and remember only cited identities",()=>{
  const row={id:record.id,title:record.need.product,source:"文献资料",dsKey:record.dsKey,excerpts:[],sourceTextChars:0,includedChars:0,omittedBlocks:0,omittedPages:[],notice:"saved metadata"};
  const before=JSON.stringify(record),rows=withCurrentAssertionReadings([row],[reading],"conservation method");
  assert.equal(rows[0].excerpts.length,1);assert.equal(rows[0].excerpts[0].quote,fact);
  assert.deepEqual(rememberCurrentAssertionReadings([],rows,[],"conservation method"),[]);
  const adopted=rememberCurrentAssertionReadings([],rows,[record.id],"conservation method");
  assert.equal(adopted.length,1);assert.equal(adopted[0].recordedAt,readAt);assert.equal(adopted[0].paperId,"PAPER-CONSERVATION");
  assert.equal(adopted[0].datasetId,"DATASET-1");assert.equal(adopted[0].block,"B009871");assert.equal(adopted[0].quote,fact);
  assert.equal(JSON.stringify(record),before);assert.ok(!JSON.stringify(rows).includes("UNADOPTED-RAW-END"));
  assert.equal(currentAssertionView([reading],"conservation method")[0].omittedBlocks,1);
});

test("a new exact assertion paragraph enters Task decisions, answer and reopenable cited memory without replacing the old PaperRecord",async t=>{
  const dir=mkdtempSync(path.join(tmpdir(),"oe-new-assertion-")),promptFile=path.join(dir,"prompts.jsonl"),oldPath=process.env.PATH,oldUrl=process.env.ONEEARTH_DISCOVERY_URL;
  const planner={action:"read",goal:"核对 conservation 方法",evidenceNeed:"read",targets:["asset:"+record.id],reason:"原记录缺少所问方法",clarification:null,evidenceGap:null,
    researchIntent:{purpose:"核对 conservation 方法",task:"核对 conservation 方法",region:null,time:null,months:[]},conversationContext:"conservation 方法"};
  const followupPlan={...planner,action:"respond",evidenceNeed:"existing",reason:"仅解释已有节选"};
  const decision={action:"answer",reason:"已取得所问的明确方法段落",gap:null,targets:[],clarification:null};
  const answer={message:"conservation 约束采用 ZEPHYR-731 方法。[S1]",sections:[],limitation:"依据所提供的断言原文窗口，未打开完整论文或网页。",followUp:"",researchNotes:[{ref:"S1",note:"conservation method"}],calculationRequests:[]};
  writeFileSync(path.join(dir,"codex"),`#!/usr/bin/env node\nimport fs from 'node:fs';let input='';for await(const c of process.stdin)input+=c;const planning=input.includes('先决定本轮要做什么'),review=input.includes('你负责决定同一轮研究任务的下一步');fs.appendFileSync(${JSON.stringify(promptFile)},JSON.stringify({phase:planning?'planning':review?'decision':'answer',prompt:input})+'\\n');if(!planning&&!input.includes(${JSON.stringify(fact)}))process.exit(2);process.stdout.write(JSON.stringify(planning?(input.includes('解释刚才')?${JSON.stringify(followupPlan)}:${JSON.stringify(planner)}):review?${JSON.stringify(decision)}:${JSON.stringify(answer)}));\n`,{mode:0o700});
  process.env.PATH=dir+path.delimiter+oldPath;
  const tasks=openTaskStore(":memory:"),conversationId=randomUUID(),parentId=randomUUID();
  tasks.submit(parentId,{conversationId});tasks.claim();tasks.finish(parentId,"complete",{result:{message:"Saved metadata",paperRecords:[record],answerNotes:{references:[{kind:"asset",id:record.id,title:record.need.product,source:"文献资料",sourceChannel:"assertion"}]}}});
  const archivedBefore=JSON.stringify(tasks.terminal(parentId)),recordBefore=JSON.stringify(record),requests:any[]=[];
  const app=express();app.use(express.json({type:["application/a2a+json","application/json"]}));
  app.post("/message:send",(req,res)=>{
    requests.push(req.body);assert.equal(req.body.message.parts[0].data.kind,"oneearth.source.read.v1");
    assert.deepEqual(req.body.message.parts[0].data.input.targets,[{kind:"paper",id:record.id}]);
    res.type("application/a2a+json").json({task:{id:randomUUID(),contextId:randomUUID(),status:{state:"TASK_STATE_COMPLETED"},artifacts:[{artifactId:"actual-assertion-receipt",parts:[{data:{kind:"oneearth.discovery.event.v1",event:{seq:1,sourceReadResult:{searches:[],papers:[record],issues:[],paperEvidence:[reading]}}}}]}]}});
  });
  taskRoutes(app,"/api/tasks",tasks,()=>undefined,{researchRecords:true});
  const server=app.listen(0,"127.0.0.1");await once(server,"listening");const address=server.address();assert.ok(address&&typeof address!=="string");const origin="http://127.0.0.1:"+address.port;process.env.ONEEARTH_DISCOVERY_URL=origin;
  t.after(async()=>{server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));tasks.close();rmSync(dir,{recursive:true,force:true});if(oldPath===undefined)delete process.env.PATH;else process.env.PATH=oldPath;if(oldUrl===undefined)delete process.env.ONEEARTH_DISCOVERY_URL;else process.env.ONEEARTH_DISCOVERY_URL=oldUrl;});
  const body={query:"补读这篇论文，核对 conservation 方法。",conversationId,turnId:randomUUID(),previousTaskId:parentId,history:[],config:{executor:"codex" as const,model:""},
    context:{filters:emptyFilters(),caseId:null,citation:null,selection:null,gridSystem:"h3" as const,layer:"all" as const,camera:{center:[0,0] as [number,number],zoom:1,reason:"fixture"},attachedScope:[{kind:"dataset" as const,id:record.id,title:record.need.product,source:"文献资料",version:null}]}};
  const services={tasks,push:{latest(){return{records:[]};}},coverage:async()=>assert.fail(),researchRegionService:{locate:async()=>null},adminBoundaryDir:dir,canonicalCache:new Map()} as unknown as RuntimeServices;
  const run=async(value:typeof body)=>{const id=randomUUID();tasks.submit(id,value);tasks.claim();const outcome=await executeTurn(services,id,value,new AbortController().signal,event=>tasks.append(id,event));tasks.finish(id,outcome.error?"failed":"complete",outcome);return{id,outcome};};
  const first=await run(body);assert.equal(first.outcome.error,undefined);assert.equal(requests.length,1);
  const reply=first.outcome.result as any;assert.deepEqual(reply.paperRecords,[record]);assert.equal(reply.answerNotes.references[0].id,record.id);
  const memory=reply.conversationAssertionEvidence;assert.equal(memory.length,1);assert.equal(memory[0].quote,fact);assert.equal(memory[0].recordedAt,readAt);
  assert.equal(memory[0].block,"B009871");assert.equal(memory[0].paperId,"PAPER-CONSERVATION");assert.equal(memory[0].datasetId,"DATASET-1");
  assert.equal(JSON.stringify(record),recordBefore);assert.equal(JSON.stringify(tasks.terminal(parentId)),archivedBefore);
  const prompts=readFileSync(promptFile,"utf8").trim().split("\n").map(line=>JSON.parse(line));
  assert.ok(!prompts.find(p=>p.phase==="planning").prompt.includes(fact));
  assert.ok(prompts.find(p=>p.phase==="decision").prompt.includes(fact));
  const actualPrompt=prompts.find(p=>p.phase==="answer").prompt;assert.ok(actualPrompt.includes(fact));assert.ok(actualPrompt.includes(readAt));assert.ok(!actualPrompt.includes("UNADOPTED-RAW-END"));
  const actual=JSON.parse(actualPrompt.slice(actualPrompt.lastIndexOf("\n{")+1));assert.deepEqual(actual.executionScope.currentSourceReads,[]);assert.equal(actual.executionScope.currentAssertionReads.length,1);
  assert.ok(!JSON.stringify(reply.runTrace.calls).includes(fact),"call logs keep receipt identities, not source full text");
  const reopened=await (await fetch(origin+"/api/tasks/"+first.id+"/record")).json();assert.deepEqual(reopened.result.conversationAssertionEvidence,memory);
  const second=await run({...body,query:"解释刚才存下的 conservation 节选。",previousTaskId:first.id,turnId:randomUUID()});
  assert.equal(second.outcome.error,undefined);assert.equal(requests.length,1,"archived follow-up does not re-read the provider");
  assert.ok((second.outcome.result as any).conversationAssertionEvidence.some((entry:any)=>entry.quote===fact&&entry.recordedAt===readAt));
  t.diagnostic(JSON.stringify({runtimeTask:first.id,citedAsset:record.id,readAt,paperId:memory[0].paperId,datasetId:memory[0].datasetId,block:memory[0].block,providerTasks:requests.length,recordUnchanged:true,archivedFollowup:true}));
});
