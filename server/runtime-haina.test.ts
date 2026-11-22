import assert from "node:assert/strict";
import test,{type TestContext} from "node:test";
import express from "express";
import {once} from "node:events";
import {randomUUID} from "node:crypto";
import {mkdtempSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {queryHainaCatalog,DiscoveryA2AError} from "./discovery-a2a-client";
import {runtimeTurnHaina} from "./runtime-turn-haina";
import {runtimeMaterialHistory} from "./runtime-material-history";
import {executeTurn,type RuntimeServices} from "./runtime-turn";
import {openTaskStore} from "./task-store";
import {assetById,assets} from "../src/domain/datasets";
import {emptyFilters} from "../src/domain/spatial";
import type {HainaRecord} from "../src/domain/haina-record";
import type {HainaCatalogPage} from "./discovery-materials-contract";

const haina=(id=987654321,version="archived-v1"):HainaRecord=>({id,name:"Controlled Haina "+version,description:"Authorized snapshot "+version,provider:"fixture",source:"fixture Haina",version,license:"fixture license",access:"Public",labels:[],card:{tags:[]}});
const catalog={total:17,synced:"2026-11-20T00:00:00Z",endpoint:"https://example.org/fixture-haina",warning:"original published snapshot warning"};
async function provider(t:TestContext,mode:"normal"|"unavailable"|"wrong-message"="normal"){
  const app=express(),requests:any[]=[];app.use(express.json({type:"application/a2a+json"}));
  app.post("/message:send",(req,res)=>{
    requests.push(req.body);
    if(mode==="unavailable"){res.status(503).type("application/a2a+json").json({error:{code:503,message:"current catalogue unavailable"}});return;}
    const value:HainaCatalogPage={...catalog,areaId:"fixture-area",records:[haina()],nextCursor:null,complete:true,refreshing:false};
    res.type("application/a2a+json").json(mode==="wrong-message"?{task:{id:randomUUID()}}:{message:{messageId:randomUUID(),role:"ROLE_AGENT",parts:[{data:{kind:"oneearth.haina.catalog.result.v1",value}}]}});
  });
  const server=app.listen(0,"127.0.0.1");await once(server,"listening");const address=server.address();assert.ok(address&&typeof address!=="string");
  const old=process.env.ONEEARTH_DISCOVERY_URL;process.env.ONEEARTH_DISCOVERY_URL="http://127.0.0.1:"+address.port;
  t.after(async()=>{if(old===undefined)delete process.env.ONEEARTH_DISCOVERY_URL;else process.env.ONEEARTH_DISCOVERY_URL=old;server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));});
  return {requests};
}

test("explicit Haina catalogue uses a model-free direct Message and preserves published snapshot metadata",async t=>{
  const p=await provider(t),page=await queryHainaCatalog(0,250,new AbortController().signal);
  assert.deepEqual(page.records,[haina()]);assert.equal(page.total,17);assert.equal(page.warning,catalog.warning);assert.equal(page.synced,catalog.synced);
  const sent=p.requests[0];assert.deepEqual(sent.message.parts,[{data:{kind:"oneearth.haina.catalog.query.v1",input:{cursor:0,limit:250}}}]);
  assert.equal(sent.message.role,"ROLE_USER");assert.equal(sent.message.taskId,undefined);assert.equal(sent.configuration,undefined);
  await assert.rejects(queryHainaCatalog(0,251,new AbortController().signal),DiscoveryA2AError);assert.equal(p.requests.length,1);
});
for(const mode of ["unavailable","wrong-message"] as const)test("Haina direct catalogue rejects "+mode+" without fabricating an empty snapshot",async t=>{
  const p=await provider(t,mode);await assert.rejects(queryHainaCatalog(0,20,new AbortController().signal),DiscoveryA2AError);
  assert.equal(p.requests.length,mode==="unavailable"?3:1);
});

test("runtime Haina view consumes only bound archives or actual results, without bundled catalogue fallback",async()=>{
  const scope=runtimeTurnHaina();assert.equal(scope.records().length,0);assert.equal(scope.status(),undefined);
  assert.equal(assets.some(asset=>asset.origins.includes("haina")),false);
  scope.remember({hainaRecords:[haina()],hainaCatalog:catalog});assert.equal(assetById.get("haina:"+haina().id)?.title,haina().name);
  const before=JSON.stringify(scope.records());scope.remember({});assert.equal(JSON.stringify(scope.records()),before,"old v1/missing fields do not refresh or discard already-bound records");
  scope.close();assert.equal(assetById.has("haina:"+haina().id),false);
});

test("same-conversation Haina archives retain their original record and status after an interrupted turn",async()=>{
  const tasks=openTaskStore(":memory:"),id=randomUUID(),conversationId=randomUUID();
  try{
    tasks.submit(id,{conversationId});tasks.claim();tasks.append(id,{researchMaterials:{papers:[],searches:[],issues:[],hainaRecords:[haina()],hainaCatalog:catalog}});
    tasks.finish(id,"failed",{error:"interrupted"});const saved=await runtimeMaterialHistory(tasks,conversationId,[id]);
    assert.deepEqual(saved.hainaRecords,[haina()]);assert.deepEqual(saved.hainaCatalog,catalog);
    assert.equal((await runtimeMaterialHistory(tasks,"foreign",[id])).hainaRecords,undefined);
  }finally{tasks.close();}
});

for(const archived of [true,false])test("workspace opens an explicitly displayed Haina object without loading the current catalogue; archive="+archived,async t=>{
  const p=await provider(t,"unavailable"),dir=mkdtempSync(path.join(tmpdir(),"oe-runtime-haina-")),oldPath=process.env.PATH;
  const record=haina(),assetId="haina:"+record.id;
  const plan={action:"workspace",goal:"打开已显示对象",evidenceNeed:"existing",targets:["asset:"+assetId],reason:"用户明确打开已显示对象",clarification:null,evidenceGap:null,
    researchIntent:{purpose:"打开已显示对象",task:"打开已显示对象",region:null,time:null,months:[]},conversationContext:"打开已显示对象"};
  writeFileSync(path.join(dir,"codex"),`#!/usr/bin/env node\nfor await(const _ of process.stdin){}process.stdout.write(${JSON.stringify(JSON.stringify(plan))});\n`,{mode:0o700});process.env.PATH=dir+path.delimiter+oldPath;
  const tasks=openTaskStore(":memory:"),conversationId=randomUUID(),parentId=randomUUID();
  if(archived){tasks.submit(parentId,{conversationId});tasks.claim();tasks.finish(parentId,"complete",{result:{message:"saved object",hainaRecords:[record],hainaCatalog:catalog}});}
  const body={query:"打开这条海纳记录",conversationId,turnId:randomUUID(),previousTaskId:archived?parentId:undefined,history:[],config:{executor:"codex" as const,model:""},
    context:{filters:emptyFilters(),caseId:null,citation:null,selection:null,gridSystem:"h3" as const,layer:"all" as const,camera:{center:[0,0] as [number,number],zoom:1,reason:"fixture"},
      attachedScope:[{kind:"dataset" as const,id:assetId,title:record.name,version:record.version,source:record.source}],candidateIds:[assetId]}};
  t.after(()=>{tasks.close();rmSync(dir,{recursive:true,force:true});if(oldPath===undefined)delete process.env.PATH;else process.env.PATH=oldPath;});
  const id=randomUUID();tasks.submit(id,body);tasks.claim();const services={tasks,push:{latest(){return{records:[]};}},coverage:async()=>assert.fail(),researchRegionService:{locate:async()=>null},adminBoundaryDir:dir,canonicalCache:new Map()} as unknown as RuntimeServices;
  const outcome=await executeTurn(services,id,body,new AbortController().signal,event=>tasks.append(id,event));
  assert.equal(outcome.error,undefined);assert.equal((outcome.result as any).inspectId,assetId);assert.equal(p.requests.length,0);
  assert.deepEqual((outcome.result as any).hainaRecords,archived?[record]:undefined);assert.deepEqual((outcome.result as any).hainaCatalog,archived?catalog:undefined);
  assert.equal(assetById.has(assetId),false,"turn-local hydration does not become another conversation's authority");
});
