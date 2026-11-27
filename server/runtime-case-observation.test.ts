import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {once} from "node:events";
import {setTimeout as delay} from "node:timers/promises";
import {mkdtemp,rm} from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import {tmpdir} from "node:os";
import path from "node:path";
import test from "node:test";
import {EventSchema} from "@ag-ui/core/schemas";
import express from "express";
import {caseObservationUrl,type CaseObservationRef} from "../src/domain/case-observations";
import {emptyFilters} from "../src/domain/spatial";
import type {DiscoveryContext} from "../src/domain/types";
import {publishEarthquakeSnapshot,publishMetarSnapshot,resolveCaseObservation} from "./case-observations";
import {postgresTaskStore} from "./postgres-task-store";
import {createRuntimeApi} from "./runtime-api-service";
import {bindCaseObservation} from "./runtime-case-observation";
import {readChatResearchHandoff} from "./runtime-chat-turn";
import {validateTurnStructure} from "./runtime-input";

const fixture=process.env.ONEEARTH_CASE_OBSERVATION_TEST_DATABASE_URL;
const context=(kind?:CaseObservationRef["kind"],caseObservationRef?:CaseObservationRef):DiscoveryContext=>({
  caseId:null,filters:emptyFilters(),selection:null,citation:null,gridSystem:"h3",layer:"all",
  camera:{center:[103,36],zoom:1,reason:"测试"},
  workspaceView:kind?{version:1,surface:"cases",case:kind==="usgs-earthquake"?
    {id:"earthquakes",title:"全球地震"}:{id:"live-lightning",title:"全球气象站与美洲闪电"}}:{version:1,surface:"earth"},
  ...(caseObservationRef?{caseObservationRef}:{}),
});
const config={executor:"codex",provider:"deepseek",model:"deepseek-flash"};

function observations() {
  const now=Date.now(),observedAt=now-60_000;
  const earthquakeId=publishEarthquakeSnapshot({generated:now,events:[{
    id:"qa-earthquake-4",point:[103.5,36.1],place:"QA 原地震地点",time:observedAt,
    depth:14.75,mag:4.28,url:"https://irrelevant.invalid/ignored",
  }]},now);
  const metarId=publishMetarSnapshot({latest:observedAt,stations:[{
    id:"QAMT",name:"QA 原气象站",point:[101.5,36.8],observed:observedAt,weather:"TSRA",
    temperature:null,wind:16.25,storm:true,
  }]},now);
  assert.ok(earthquakeId&&metarId);
  return {
    quake:{kind:"usgs-earthquake",snapshotId:earthquakeId,id:"qa-earthquake-4",observedAt} as const,
    metar:{kind:"awc-metar",snapshotId:metarId,id:"QAMT",observedAt} as const,
  };
}

test("same case and immutable observation identity are checked before trusting a published value",()=>{
  const {quake,metar}=observations();
  assert.equal(bindCaseObservation(context(),resolveCaseObservation),undefined);
  assert.deepEqual(bindCaseObservation(context(quake.kind),resolveCaseObservation),{kind:quake.kind,status:"not-selected"});
  assert.deepEqual(bindCaseObservation(context(quake.kind,{...quake,observedAt:quake.observedAt+1}),resolveCaseObservation),
    {kind:quake.kind,status:"unavailable"});
  assert.throws(()=>bindCaseObservation(context(metar.kind,quake),()=>assert.fail("cross-case resolver invoked")));
  assert.throws(()=>bindCaseObservation(context(quake.kind,{...quake,magnitude:999} as any),()=>assert.fail("invalid resolver invoked")));
  const genuine=resolveCaseObservation(quake);
  assert.ok(genuine);
  assert.deepEqual(bindCaseObservation(context(quake.kind,quake),()=>({...genuine,snapshotId:randomUUID()})),
    {kind:quake.kind,status:"unavailable"});
  assert.deepEqual(bindCaseObservation(context(quake.kind,quake),resolveCaseObservation),
    {kind:quake.kind,status:"ready",observation:genuine});
});

test("native HTTP with real PostgreSQL freezes published USGS/METAR and emits only deterministic original values",
  {skip:!fixture,timeout:25000},async t=>{
  const database=new URL(fixture!);
  assert.match(database.hostname,/^(127\.0\.0\.1|localhost)$/u);
  assert.match(database.pathname,/^\/native_agui_[a-z0-9_]+caseobservation[a-z0-9_]*$/u);
  const {quake,metar}=observations();
  const oldRuntime=process.env.ONEEARTH_RUNTIME_DATABASE_URL,oldKey=process.env.DEEPSEEK_API_KEY,originalRequest=https.request;
  process.env.ONEEARTH_RUNTIME_DATABASE_URL=fixture;
  process.env.DEEPSEEK_API_KEY="ISOLATED_CASE_OBSERVATION_FIXTURE";
  const dir=await mkdtemp(path.join(tmpdir(),"oneearth-case-observation-"));
  t.after(async()=>{
    https.request=originalRequest;
    for(const [key,old] of [["ONEEARTH_RUNTIME_DATABASE_URL",oldRuntime],["DEEPSEEK_API_KEY",oldKey]] as const)
      if(old===undefined)delete process.env[key];else process.env[key]=old;
    await rm(dir,{recursive:true,force:true});
  });
  const inputs:{question:string;prompt:string;planning:boolean}[]=[];
  const upstream=http.createServer(async(req,res)=>{
    let raw="";for await(const chunk of req)raw+=chunk;
    const wire=JSON.parse(raw),prompt=wire.input.find((item:any)=>item.role==="user").content[0].text as string;
    const planning=prompt.startsWith("仅做本轮一次意图决定");
    const question=planning?JSON.parse(prompt.slice(prompt.lastIndexOf("\n")+1)).question as string:"";
    inputs.push({question,prompt,planning});
    assert.deepEqual(wire.tools,[]);
    const decision=question.includes("请独立检索")?
      {kind:"search",goal:question,targets:[]}:{kind:"respond",reply:null,targets:[]};
    const output=planning?JSON.stringify({decide:decision,...(prompt.includes("caseObservationUse")?
      {caseObservationUse:question.includes("一般原理")?"unrelated":"selected"}:{})}):"原有一般答复。";
    const frame=(type:string,sequence_number:number,extra:Record<string,unknown>)=>
      "data: "+JSON.stringify({type,sequence_number,item_id:"answer",output_index:0,content_index:0,...extra})+"\n\n";
    res.writeHead(200,{"Content-Type":"text/event-stream"});
    res.end(frame("response.output_text.delta",0,{delta:output})+frame("response.output_text.done",1,{text:output})+
      frame("response.completed",2,{response:{status:"completed"}}));
  });
  upstream.listen(0,"127.0.0.1");await once(upstream,"listening");
  const address=upstream.address();assert.ok(address&&typeof address!=="string");
  https.request=((options:any,callback:any)=>{
    assert.equal(options.hostname,"api.deepseek.com");
    assert.equal(options.path,"/responses");
    return http.request({...options,protocol:"http:",hostname:"127.0.0.1",port:address.port},callback);
  }) as typeof https.request;
  const native=await createRuntimeApi(dir),tasks=await postgresTaskStore("runtime");
  const app=express().use(native.business);
  const listener=app.listen(0,"127.0.0.1");
  await once(listener,"listening");
  t.after(async()=>{
    for(const server of [listener,upstream])server.closeAllConnections();
    await Promise.all([listener,upstream].map(server=>new Promise<void>(resolve=>server.close(()=>resolve()))));
    await native.close();await tasks.close();
  });
  const local=listener.address();assert.ok(local&&typeof local!=="string");
  const origin="http://127.0.0.1:"+local.port;
  const threadId=randomUUID();
  const input=(question:string,view:DiscoveryContext,previousTaskId?:string)=>({
    runId:randomUUID(),threadId,protocolVersion:"1.0",messages:[{id:randomUUID(),role:"user",content:question}],
    context:[],state:{},tools:[],forwardedProps:{oneearth:{version:1,submission:{config,context:view,previousTaskId}}},
  });
  const post=(data:unknown)=>fetch(origin+"/api/ag-ui",{method:"POST",headers:{"Content-Type":"application/json",Accept:"text/event-stream"},body:JSON.stringify(data)});
  const record=async(runId:string)=>{
    const result=await fetch(origin+"/api/tasks/"+runId+"/record");
    assert.equal(result.status,200);return result.json();
  };
  const events=async(run:ReturnType<typeof input>,ending="RUN_FINISHED")=>{
    const result=await post(run);assert.equal(result.status,200,await result.clone().text());
    const parsed=(await result.text()).split("\n\n").filter(line=>line.startsWith("data: ")).map(line=>EventSchema.parse(JSON.parse(line.slice(6))));
    const terminal=parsed.filter(event=>event.type==="RUN_ERROR"||event.type==="RUN_FINISHED");
    assert.equal(terminal.length,1);assert.equal(terminal[0].type,ending);
    return parsed;
  };
  const original=input("这次地震有多深？",context(quake.kind,quake));
  const seismic=await events(original);
  const initialArchive=await record(original.runId),persisted=JSON.parse((await tasks.get(original.runId))!.body);
  assert.equal(initialArchive.conversationId,threadId);
  assert.equal(initialArchive.turnId,original.messages[0].id);
  assert.deepEqual(initialArchive.result.caseObservation,resolveCaseObservation(quake));
  assert.deepEqual(persisted.serverCaseObservation.observation,initialArchive.result.caseObservation);
  assert.deepEqual(persisted.context.caseObservationRef,quake);
  assert.match(initialArchive.result.message,/深度 14\.75 km/u);
  assert.ok(initialArchive.result.message.includes(new Date(quake.observedAt).toISOString()));
  assert.equal(initialArchive.result.answerNotes.references[0].url,caseObservationUrl(quake.kind,quake.id));
  assert.equal(seismic.filter(event=>event.type==="TEXT_MESSAGE_CONTENT").map(event=>event.delta).join(""),initialArchive.result.message);
  assert.equal(inputs.length,1);assert.doesNotMatch(inputs[0].prompt,/14\.75|4\.28|qa-earthquake-4|QA 原地震地点|earthquakes\/eventpage/u);

  const station=input("这个站的风速是多少？",context(metar.kind,metar),original.runId);
  await events(station);
  const stationArchive=await record(station.runId);
  assert.match(stationArchive.result.message,/风速 16\.25 kt/u);assert.match(stationArchive.result.message,/气温 未提供/u);
  assert.doesNotMatch(stationArchive.result.message,/14\.75|qa-earthquake-4/u);
  assert.equal(stationArchive.result.answerNotes.references[0].url,caseObservationUrl(metar.kind,metar.id));
  assert.equal(inputs.length,2);assert.doesNotMatch(inputs[1].prompt,/14\.75|16\.25|qa-earthquake-4|QAMT/u);

  for(const [wire,pattern] of [
    [input("这个站风速多少？",context(metar.kind),station.runId),/请先.*选择/u],
    [input("这个站风速多少？",context(metar.kind,{...metar,snapshotId:randomUUID()}),station.runId),/已失效或无法核对/u],
    [input("这个站风速多少？",context(metar.kind,{...metar,observedAt:metar.observedAt+1}),station.runId),/已失效或无法核对/u],
  ] as const){
    await events(wire);
    const result=(await record(wire.runId)).result;assert.match(result.message,pattern);
    assert.doesNotMatch(result.message,/16\.25/u);assert.equal(result.caseObservation,undefined);assert.equal(result.answerNotes,undefined);
  }
  const before=inputs.length;
  const wrongCase=input("这个站风速多少？",context(quake.kind,metar));
  const forgedRef=input("这个站风速多少？",context(metar.kind,{...metar,windKnots:999} as any));
  const forgedContext=input("这个站风速多少？",{...context(metar.kind,metar),caseObservation:{windKnots:999}} as any);
  const forgedBody=input("这个站风速多少？",context(metar.kind,metar));
  Object.assign(forgedBody.forwardedProps.oneearth.submission,{serverCaseObservation:{status:"ready",observation:{windKnots:999}}});
  for(const wire of [wrongCase,forgedRef,forgedBody,forgedContext]){
    assert.equal((await post(wire)).status,400);assert.equal(await tasks.get(wire.runId),undefined);
  }
  assert.equal(inputs.length,before);
  assert.match(await validateTurnStructure(tasks,{query:"x",conversationId:threadId,turnId:randomUUID(),history:[],config,
    context:context(metar.kind,metar),serverCaseObservation:{status:"ready",observation:{windKnots:999}}})||"",/由服务端确定/u);

  const conflicted=input("请独立检索这次事件。",context(quake.kind,quake));
  await events(conflicted,"RUN_ERROR");assert.equal((await tasks.get(conflicted.runId))?.status,"failed");
  const ordinary=input("请讲讲一般原理。",context(metar.kind,metar),station.runId);
  await events(ordinary);
  assert.equal((await record(ordinary.runId)).result.message,"原有一般答复。");
  assert.equal((await record(ordinary.runId)).result.caseObservation,undefined);
  assert.deepEqual(await record(original.runId),initialArchive);
  assert.equal((await post(original)).status,409);
  assert.equal(inputs.filter(item=>!item.planning).length,1);
  assert.doesNotMatch(inputs.at(-1)!.prompt,/16\.25|14\.75|QAMT|qa-earthquake-4/u);

  const research=input("请独立检索气象站观测的一般原理。",context(metar.kind,metar),station.runId);
  const researchStream=await post(research);
  assert.equal(researchStream.status,200);
  const reader=researchStream.body!.getReader();
  await reader.read();
  await reader.cancel();
  for(let attempt=0;attempt<40&&(await tasks.get(research.runId))?.status!=="queued";attempt++)await delay(20);
  assert.equal((await tasks.get(research.runId))?.status,"queued");
  const handoff=readChatResearchHandoff((await tasks.chat.handoff(research.runId))!);
  assert.equal(handoff.plan.plan.action,"search");
  assert.equal(handoff.plan.plan.caseObservationUse,undefined);
  assert.equal(handoff.body.context.caseObservationRef,undefined);
  assert.equal(Object.hasOwn(handoff.body,"serverCaseObservation"),false);
  const cancel=await fetch(origin+"/api/tasks/"+research.runId,{method:"DELETE"});
  assert.equal(cancel.status,204);
});
