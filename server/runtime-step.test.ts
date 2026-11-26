import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {openTaskStore,TaskParked} from "./task-store";
import {createRuntimeStep,semanticModelInput} from "./runtime-step";
import type {RuntimeTurnInput} from "./runtime-turn-handoff";
import {emptyFilters} from "../src/domain/spatial";
const body=():RuntimeTurnInput=>({query:"An authorized research task",conversationId:randomUUID(),turnId:randomUUID(),history:[],config:{executor:"codex",model:"gpt-6-luna"},context:{filters:emptyFilters(),caseId:null,selection:null,citation:null,gridSystem:"h3",layer:"all",camera:{center:[0,0],zoom:1,reason:"fixture"}}});

test("completed model output reuses only the same semantic input; countdown cannot increase or hide changed materials",async()=>{
 const tasks=openTaskStore(":memory:"),id=randomUUID(),input=body();tasks.submit(id,input);tasks.claim();let calls=0;
 try{
  const prompt=(remainingMs:number,title="Source A")=>'Same instructions\n'+JSON.stringify({question:"same",resources:{remainingMs,remainingAcquisitions:1,remainingModelCalls:2},materials:[{title,readAt:"2026-01-01"}]});
  let step=await createRuntimeStep(tasks,id,input,undefined,new AbortController().signal,()=>{});
  assert.equal(await step.model(prompt(1000),{type:"object"},async()=>{calls++;return '{"action":"answer"}';}),'{"action":"answer"}');
  step=await createRuntimeStep(tasks,id,input,tasks.step(id),new AbortController().signal,()=>{});assert.equal(await step.model(prompt(900),{type:"object"},async()=>{calls++;return "BAD";}),'{"action":"answer"}');
  step=await createRuntimeStep(tasks,id,input,tasks.step(id),new AbortController().signal,()=>{});await assert.rejects(step.model(prompt(800,"Source B"),{type:"object"},async()=>{calls++;return "BAD";}),/语义输入/);
  step=await createRuntimeStep(tasks,id,input,tasks.step(id),new AbortController().signal,()=>{});await assert.rejects(step.model(prompt(1100),{type:"object"},async()=>{calls++;return "BAD";}),/语义输入/);assert.equal(calls,1);
  assert.notEqual(semanticModelInput('Instruction\n'+JSON.stringify({materials:{remainingMs:1}})).semanticHash,semanticModelInput('Instruction\n'+JSON.stringify({materials:{remainingMs:2}})).semanticHash);
 }finally{tasks.close();}
});

test("unknown model results are not repeated, and step identity and budget do not reset",async()=>{
 const tasks=openTaskStore(":memory:"),id=randomUUID(),input=body();tasks.submit(id,input);tasks.claim();let calls=0;
 try{
  const first=await createRuntimeStep(tasks,id,input,undefined,new AbortController().signal,()=>{}),identity=first.stableId("delegate"),deadline=first.budget(10000);
  await assert.rejects(first.model("Same prompt",{},async()=>{calls++;throw Error("unknown provider state");}));
  const next=await createRuntimeStep(tasks,id,input,tasks.step(id),new AbortController().signal,()=>{});assert.equal(next.stableId("delegate"),identity);assert.equal(next.budget(10000),deadline);
  await assert.rejects(next.model("Same prompt",{},async()=>{calls++;return "duplicate";}),/尚未确认/);assert.equal(calls,1);
  await assert.rejects(createRuntimeStep(tasks,id,{...input,query:"changed"},tasks.step(id),new AbortController().signal,()=>{}),/原步骤不一致/);
 }finally{tasks.close();}
});
