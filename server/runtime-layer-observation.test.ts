import assert from "node:assert/strict";
import {createHash,randomUUID} from "node:crypto";
import {once} from "node:events";
import {readFileSync} from "node:fs";
import {mkdtemp,rm} from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import {tmpdir} from "node:os";
import path from "node:path";
import {setTimeout as delay} from "node:timers/promises";
import test from "node:test";
import {gunzipSync,gzipSync} from "node:zlib";
import {EventSchema} from "@ag-ui/core/schemas";
import express from "express";
import {localLayerObservationRevisions,layerObservationLayer,layerObservationSources,type LayerObservationRef} from "../src/domain/layer-observations";
import {emptyFilters} from "../src/domain/spatial";
import type {DiscoveryContext} from "../src/domain/types";
import {ctdStations} from "../src/domain/visualization";
import {postgresTaskStore} from "./postgres-task-store";
import {createRuntimeApi} from "./runtime-api-service";
import {answerLayerObservation,bindLayerObservation,readLayerObservationRequest} from "./runtime-layer-observation";
import {readChatResearchHandoff} from "./runtime-chat-turn";
import {validateTurnStructure} from "./runtime-input";

const fixture=process.env.ONEEARTH_LAYER_OBSERVATION_TEST_DATABASE_URL;
const hash=(data:Uint8Array)=>createHash("sha256").update(data).digest("hex");
const sourceRoot=new URL("../public/visualizations/precip/imerg-v07b-2024/",import.meta.url);
const packagedTile=readFileSync(new URL("03/2/10-4.bin.gz",sourceRoot));
const sourceEntry=JSON.parse(readFileSync(new URL("manifest.json",sourceRoot),"utf8")).sources[2];
const rain:Extract<LayerObservationRef,{kind:"imerg-cell"}>={kind:"imerg-cell",datasetId:"nasa:imerg-monthly",month:"2024-03",
  revision:sourceEntry.sha256,tileRevision:hash(packagedTile),row:723,column:1805};
const ctd:Extract<LayerObservationRef,{kind:"ctd"}>={kind:"ctd",datasetId:"pangaea:891386",revision:localLayerObservationRevisions.ctd,
  stationId:"NE-Greenland-1997-1998_Sea01-1",sampledAt:"1997-07-22T17:45",depthM:2,variable:"temperature"};
const front:Extract<LayerObservationRef,{kind:"glacier-front"}>={kind:"glacier-front",datasetId:"zenodo:15241675:fronts",
  revision:localLayerObservationRevisions.front,objectId:"front-0",observedOn:"1984-04-11"};
const stationName=ctdStations.find(item=>item.id===ctd.stationId)!.name;

const context=(kind:LayerObservationRef["kind"],ref?:LayerObservationRef):DiscoveryContext=>({
  caseId:kind==="ctd"?"Q19":kind==="glacier-front"?"Q20":null,
  filters:emptyFilters(),selection:null,citation:null,gridSystem:"h3",layer:"all",
  camera:{center:[0,0],zoom:1,reason:"固定工作台"},
  workspaceView:{version:1,surface:"earth",activeLayer:{
    id:layerObservationLayer(kind),status:"ready",title:"当前测试图层",controls:kind==="imerg-cell"?
      [{id:"time",label:"所选月份",current:{id:rain.month,label:rain.month},options:[],ordered:true}]:[],
  }},
  ...(kind==="ctd"?{dataView:{kind:"ctd",stationId:stationName,variable:ctd.variable,depth:ctd.depthM}}:
    kind==="glacier-front"?{dataView:{kind:"front",glacier:"Mendenhall",epoch:"first"}}:{}),
  ...(ref?{layerObservationRef:ref}:{}),
});
const config={executor:"codex",provider:"deepseek",model:"deepseek-flash"};

test("layer admission rejects otherwise valid references from a different visible month, station, depth or epoch",async()=>{
  assert.deepEqual(readLayerObservationRequest(context(rain.kind,rain)),rain);
  assert.deepEqual(readLayerObservationRequest(context(ctd.kind,ctd)),ctd);
  assert.deepEqual(readLayerObservationRequest(context(front.kind,front)),front);
  for(const invalid of [context(ctd.kind,rain),context(rain.kind,{...rain,month:"2024-04"}),
    context(ctd.kind,{...ctd,depthM:3}),context(ctd.kind,{...ctd,stationId:"another-station"}),
    {...context(front.kind,front),dataView:{kind:"front",glacier:"Mendenhall",epoch:"last"}} as DiscoveryContext,
    {...context(rain.kind,rain),caseObservationRef:{}} as DiscoveryContext]){
    await assert.rejects(bindLayerObservation(invalid,async()=>assert.fail("invalid target reached source resolver")));
  }
  const mismatch=await bindLayerObservation(context(rain.kind,rain),async ref=>({...ref as typeof rain,
    row:rain.row+1,sourceUrl:sourceEntry.url,point:[0,0],value:1,unit:"mm/day",
    productVersion:"V07B",run:"Final",complete:true,through:"2024-03-31"}));
  assert.deepEqual(mismatch,{kind:rain.kind,status:"unavailable"});
});

test("the deterministic answer identifies a NASA POWER derivative and preserves an original measurement of zero",()=>{
  const sourceUrl="https://nasa-power.s3.us-west-2.amazonaws.com/imerg/spatial/power_imerg_monthly_spatial_utc.zarr/IMERG_PRECTOT/314.0.0";
  const result=answerLayerObservation({kind:rain.kind,status:"ready",observation:{
    ...rain,point:[.55,17.65],sourceUrl,value:0,unit:"mm/day",productVersion:"POWER v10",run:"Derived",complete:true,
  }},{started:Date.now(),stages:[],calls:[]});
  assert.match(result.message,/NASA POWER IMERG 派生格点/);
  assert.match(result.message,/降水量 0 mm\/day/);
  assert.doesNotMatch(result.message,/原始格点|undefined|缺测/);
  assert.equal(result.answerNotes?.references?.[0]?.kind,"web");
  assert.equal(result.layerObservation?.sourceUrl,sourceUrl);
});

test("native HTTP and PostgreSQL freeze exact rainfall, CTD and glacier values with no reread after archive recovery",
  {skip:!fixture,timeout:25_000},async t=>{
  const database=new URL(fixture!);
  assert.match(database.hostname,/^(127\.0\.0\.1|localhost)$/u);
  assert.match(database.pathname,/^\/native_agui_[a-z0-9_]+layerobservation[a-z0-9_]*$/u);
  const old={runtime:process.env.ONEEARTH_RUNTIME_DATABASE_URL,key:process.env.DEEPSEEK_API_KEY,
    spatial:process.env.ONEEARTH_SPATIAL_URL,request:https.request};
  process.env.ONEEARTH_RUNTIME_DATABASE_URL=fixture;
  process.env.DEEPSEEK_API_KEY="FIXED_LAYER_OBSERVATION_TEST";
  const dir=await mkdtemp(path.join(tmpdir(),"oneearth-layer-observation-"));
  const seen:{prompt:string;planning:boolean}[]=[],reads:string[]=[];
  const nativeLayer="2024/03-final-"+rain.revision.slice(0,12);
  const manifestPath="/precip-data/2024/manifest.json",tilePath="/precip-data/"+nativeLayer+"/2/10-4.bin.gz";
  const manifest=Buffer.from(JSON.stringify({id:"imerg-2024-2f325d9bc14d",product:"GPM IMERG",source:layerObservationSources[rain.kind],
    year:2024,step:.1,rows:1800,columns:3600,tileSize:180,factors:[10,2,1],missing:65535,unit:"mm/day",scale:.01,
    months:Array.from({length:12},(_,i)=>i===2?{month:3,path:nativeLayer,complete:true,through:"2024-03-31",
      source:{sha256:rain.revision,run:"Final",version:"V07B",url:sourceEntry.url}}:null)}));
  let tile=packagedTile;
  const upstream=http.createServer(async(req,res)=>{
    if(req.method==="GET"){
      const url=req.url||"";reads.push(url);
      const bytes=url===manifestPath?manifest:url===tilePath?tile:undefined;
      if(!bytes){res.writeHead(404).end();return;}
      res.writeHead(200,{"x-oneearth-service":"spatial",etag:'"'+hash(bytes)+'"',
        "Content-Type":url===manifestPath?"application/json":"application/octet-stream"});
      res.end(bytes);return;
    }
    assert.equal(req.url,"/responses");
    let raw="";for await(const chunk of req)raw+=chunk;
    const wire=JSON.parse(raw),prompt=wire.input.find((item:any)=>item.role==="user").content[0].text as string;
    assert.deepEqual(wire.tools,[]);
    const planning=prompt.startsWith("仅做本轮一次意图决定");
    seen.push({prompt,planning});
    const question=planning?JSON.parse(prompt.slice(prompt.lastIndexOf("\n")+1)).question as string:"";
    const decide=question.includes("独立查找")?
      {kind:"search",goal:question,targets:[]}:{kind:"respond",reply:null,targets:[]};
    const output=planning?JSON.stringify({decide,layerObservationUse:question.includes("一般知识")?"unrelated":"selected"}):"一般说明保持原样。";
    function frame(type:string,sequence_number:number,data:Record<string,unknown>){
      return "data: "+JSON.stringify({type,sequence_number,item_id:"answer",output_index:0,content_index:0,...data})+"\n\n";
    }
    res.writeHead(200,{"Content-Type":"text/event-stream"});
    res.end(frame("response.output_text.delta",0,{delta:output})+frame("response.output_text.done",1,{text:output})+
      frame("response.completed",2,{response:{status:"completed"}}));
  });
  await new Promise<void>(ok=>upstream.listen(0,"127.0.0.1",ok));const address=upstream.address();assert.ok(address&&typeof address!=="string");
  process.env.ONEEARTH_SPATIAL_URL="http://127.0.0.1:"+address.port;
  https.request=((options:any,callback:any)=>{
    assert.equal(options.hostname,"api.deepseek.com");
    return http.request({...options,protocol:"http:",hostname:"127.0.0.1",port:address.port},callback);
  }) as typeof https.request;
  t.after(async()=>{
    https.request=old.request;
    for(const [key,value] of [["ONEEARTH_RUNTIME_DATABASE_URL",old.runtime],["DEEPSEEK_API_KEY",old.key],["ONEEARTH_SPATIAL_URL",old.spatial]] as const)
      if(value===undefined)delete process.env[key];else process.env[key]=value;
    upstream.closeAllConnections();await new Promise<void>(ok=>upstream.close(()=>ok()));
    await rm(dir,{recursive:true,force:true});
  });
  const native=await createRuntimeApi(dir),tasks=await postgresTaskStore("runtime");
  const listener=express().use(native.business).listen(0,"127.0.0.1");
  await once(listener,"listening");
  t.after(async()=>{
    listener.closeAllConnections();await new Promise<void>(ok=>listener.close(()=>ok()));
    await native.close();await tasks.close();
  });
  const local=listener.address();assert.ok(local&&typeof local!=="string");
  const origin="http://127.0.0.1:"+local.port;
  const threadId=randomUUID();
  const input=(question:string,context:DiscoveryContext,previousTaskId?:string)=>({
    runId:randomUUID(),threadId,protocolVersion:"1.0",messages:[{id:randomUUID(),role:"user",content:question}],
    context:[],state:{},tools:[],forwardedProps:{oneearth:{version:1,submission:{config,context,previousTaskId}}},
  });
  const post=(body:unknown)=>fetch(origin+"/api/ag-ui",{method:"POST",headers:{"Content-Type":"application/json",Accept:"text/event-stream"},body:JSON.stringify(body)});
  const record=async(id:string)=>{
    const reply=await fetch(origin+"/api/tasks/"+id+"/record");assert.equal(reply.status,200);return reply.json();
  };
  const events=async(wire:ReturnType<typeof input>,ending="RUN_FINISHED")=>{
    const result=await post(wire);assert.equal(result.status,200,await result.clone().text());
    const parsed=(await result.text()).split("\n\n").filter(line=>line.startsWith("data: ")).map(line=>EventSchema.parse(JSON.parse(line.slice(6))));
    const terminal=parsed.filter(event=>event.type==="RUN_FINISHED"||event.type==="RUN_ERROR");
    assert.equal(terminal.length,1);assert.equal(terminal[0].type,ending);
    return parsed;
  };
  const originalRain=input("这里的原始格点降水量？",context(rain.kind,rain));
  const rainEvents=await events(originalRain),rainArchived=await record(originalRain.runId);
  const offset=((rain.row%180)*180+rain.column%180)*2,encoded=gunzipSync(packagedTile).readUInt16LE(offset);
  assert.notEqual(encoded,65535);assert.equal(rainArchived.result.layerObservation.value,encoded/100);
  assert.equal(rainArchived.result.layerObservation.month,rain.month);
  assert.equal(rainArchived.result.answerNotes.references[0].url,sourceEntry.url);
  assert.deepEqual(JSON.parse((await tasks.get(originalRain.runId))!.body).serverLayerObservation.observation,rainArchived.result.layerObservation);
  assert.equal(rainEvents.filter(event=>event.type==="TEXT_MESSAGE_CONTENT").map(event=>event.delta).join(""),rainArchived.result.message);
  assert.deepEqual(reads,[manifestPath,tilePath]);assert.equal(seen.length,1);

  const station=input("这个样点的原始 CTD 值？",context(ctd.kind,ctd),originalRain.runId);
  await events(station);
  const stationArchived=await record(station.runId);
  assert.equal(stationArchived.result.layerObservation.value,-.0972);
  assert.equal(stationArchived.result.layerObservation.sampledAt,ctd.sampledAt);
  assert.match(stationArchived.result.message,/实际采样深度 2 m/);
  assert.equal(stationArchived.result.answerNotes.references[0].url,layerObservationSources.ctd);

  const glacier=input("这条前缘对应哪天的原记录？",context(front.kind,front),station.runId);
  await events(glacier);
  const glacierArchived=await record(glacier.runId);
  assert.equal(glacierArchived.result.layerObservation.objectId,"front-0");
  assert.deepEqual(glacierArchived.result.layerObservation.point,[-134.5425814,58.4240927]);
  assert.match(glacierArchived.result.message,/索引中心/);
  assert.equal(glacierArchived.result.answerNotes.references[0].url,layerObservationSources[front.kind]);
  assert.deepEqual(reads,[manifestPath,tilePath]);assert.equal(seen.length,3);
  assert.doesNotMatch(seen.map(item=>item.prompt).join(" "),/tileRevision|-.0972|front-0|1984-04-11/);

  const beforeForgery=seen.length,beforeSource=reads.length;
  const forged=input("当前值？",{...context(rain.kind,rain),layerObservation:{value:9}} as any);
  const forgedTop=input("当前值？",context(rain.kind,rain));
  Object.assign(forgedTop.forwardedProps.oneearth.submission,{serverLayerObservation:{status:"ready",observation:{value:9}}});
  for(const wire of [forged,forgedTop,
    input("当前值？",context(rain.kind,{...rain,month:"2024-04"})),
    input("当前值？",context(ctd.kind,rain)),
    input("当前值？",context(rain.kind,{...rain,value:9} as any))]){
    assert.equal((await post(wire)).status,400);assert.equal(await tasks.get(wire.runId),undefined);
  }
  assert.match(await validateTurnStructure(tasks,{query:"x",conversationId:threadId,turnId:randomUUID(),history:[],config,
    context:context(rain.kind,rain),serverLayerObservation:{status:"ready"}})||"",/由服务端确定/);
  assert.equal(seen.length,beforeForgery);assert.equal(reads.length,beforeSource);

  const missing=input("这个格点的值？",context(rain.kind));
  await events(missing);
  assert.equal((await record(missing.runId)).result.layerObservationStatus,"not-selected");assert.equal(reads.length,beforeSource);
  const stale=input("这个格点的值？",context(rain.kind,{...rain,revision:"a".repeat(64)}));
  await events(stale);const staleRecord=await record(stale.runId);
  assert.equal(staleRecord.result.layerObservationStatus,"unavailable");
  assert.equal(staleRecord.result.layerObservation,undefined);
  assert.deepEqual(reads.slice(beforeSource),[manifestPath]);

  const rawTile=gunzipSync(packagedTile);rawTile.writeUInt16LE(65535,offset);tile=gzipSync(rawTile);
  const noData=input("这个格点的值？",context(rain.kind,{...rain,tileRevision:hash(tile)}));
  await events(noData);const noDataRecord=await record(noData.runId);
  assert.equal(noDataRecord.result.layerObservation.value,null);assert.match(noDataRecord.result.message,/原记录缺测/);
  const beforeReadback=reads.length;
  assert.equal((await post(originalRain)).status,409);
  assert.deepEqual(await record(originalRain.runId),rainArchived);
  assert.equal(reads.length,beforeReadback);

  const contradictory=input("独立查找这个 CTD 样点",context(ctd.kind,ctd),station.runId);
  await events(contradictory,"RUN_ERROR");assert.equal((await tasks.get(contradictory.runId))?.status,"failed");
  const general=input("请解释海冰的一般知识",context(ctd.kind,ctd),station.runId);
  await events(general);assert.equal((await record(general.runId)).result.message,"一般说明保持原样。");
  assert.equal((await record(general.runId)).result.layerObservation,undefined);

  const research=input("独立查找 CTD 的一般知识",context(ctd.kind,ctd),station.runId);
  const stream=await post(research);assert.equal(stream.status,200);
  const reader=stream.body!.getReader();await reader.read();await reader.cancel();
  for(let attempt=0;attempt<40&&(await tasks.get(research.runId))?.status!=="queued";attempt++)await delay(20);
  assert.equal((await tasks.get(research.runId))?.status,"queued");
  const handoff=readChatResearchHandoff((await tasks.chat.handoff(research.runId))!);
  assert.equal(handoff.body.context.layerObservationRef,undefined);assert.equal(handoff.plan.plan.layerObservationUse,undefined);
  assert.equal(Object.hasOwn(handoff.body,"serverLayerObservation"),false);
  assert.equal((await fetch(origin+"/api/tasks/"+research.runId,{method:"DELETE"})).status,204);
  assert.equal(seen.filter(item=>!item.planning).length,1);
});
