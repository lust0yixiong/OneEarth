import assert from "node:assert/strict";
import test,{type TestContext} from "node:test";
import express from "express";
import {once} from "node:events";
import {createHash,randomUUID} from "node:crypto";
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {queryPapers} from "./discovery-a2a-client";
import {paperCatalogueProjection} from "./runtime-workbench-queries";
import {runtimePaperRoutes} from "./runtime-paper-routes";
import {runtimeMaterialHistory} from "./runtime-material-history";
import {openTaskStore,taskRoutes} from "./task-store";
import {executeTurn,type RuntimeServices} from "./runtime-turn";
import {spatialCoverageClient} from "./spatial-coverage-client";
import {questionGridEvidence,verifiedGridContext,gridCoverageSummary} from "./question-grid";
import {assetById,assets,replacePublishedPapers} from "../src/domain/datasets";
import {paperCatalogSummary,type PaperRecord} from "../src/domain/paper-record";
import {emptyFilters,gridSpec} from "../src/domain/spatial";
import type {DiscoveryContext} from "../src/domain/types";

const paper=(key:string,version:string):PaperRecord=>({id:"earthnano:"+createHash("sha256").update(key+":"+version).digest("hex"),dsKey:key,papers:1,paperTitle:"Controlled "+version,studyContext:"controlled",points:[],
  need:{name:"Dataset",product:"Controlled dataset "+version,type:"Dataset",status:"published",source:"文献资料",detail:"Immutable original material "+version,
    profile:{role:"data",spatial:"nonspatial",coverage:"unknown",access:"fixture",limitation:"controlled"},
    tabs:[{kind:"table",label:"论文用法（本页）",rows:[["paper","input","field","","paper-identity",key]]}]}});
const a=paper("doi:10.9999/runtime-alpha","A"),b=paper(a.dsKey,"B"),tail=paper("doi:10.9999/runtime-zeta","Z");
async function listen(t:TestContext,app:express.Express){
  const server=app.listen(0,"127.0.0.1");await once(server,"listening");const address=server.address();assert.ok(address&&typeof address!=="string");
  t.after(async()=>{server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));});return "http://127.0.0.1:"+address.port;
}
async function discovery(t:TestContext){
  const app=express(),requests:any[]=[];app.use(express.json({type:"application/a2a+json"}));
  const state={revision:"pg-publication:41",records:[a,tail],history:new Map([a,b,tail].map(row=>[row.id,row])),wrongId:false,unavailable:false,afterFirstPage:undefined as (()=>void)|undefined};
  app.post("/message:send",(req,res)=>{
    const message=req.body.message,data=message?.parts?.[0]?.data,input=data?.input;requests.push(structuredClone(input));
    assert.equal(data?.kind,"oneearth.paper.query.v1");assert.equal(message.role,"ROLE_USER");assert.equal(input.config,undefined);
    if(state.unavailable){res.status(503).type("application/a2a+json").json({error:{code:503,message:"controlled unavailable"}});return;}
    let value:unknown;
    if(input.operation==="records")value=state.wrongId?[b]:input.ids.flatMap((id:string)=>state.history.get(id)||[]);
    else{
      assert.equal(input.operation,"list");
      const remaining=state.records.filter(row=>row.dsKey>input.cursor),selected=remaining.slice(0,Math.min(input.limit,1));
      value={records:selected.map(paperCatalogSummary),total:state.records.length,nextCursor:remaining.length>selected.length?selected.at(-1)!.dsKey:null,cached:true,
        catalog:{revision:state.revision,complete:true,source:"controlled PG publication",sourceTotal:state.records.length,filteredOut:0,updatedAt:null}};
    }
    res.type("application/a2a+json").json({message:{messageId:randomUUID(),contextId:randomUUID(),role:"ROLE_AGENT",parts:[{data:{kind:"oneearth.paper.result.v1",operation:input.operation,value}}]}});
    if(input.operation==="list"&&input.limit===500&&!input.cursor&&state.afterFirstPage){const change=state.afterFirstPage;state.afterFirstPage=undefined;change();}
  });
  const origin=await listen(t,app),previous=process.env.ONEEARTH_DISCOVERY_URL;process.env.ONEEARTH_DISCOVERY_URL=origin;
  t.after(()=>{if(previous===undefined)delete process.env.ONEEARTH_DISCOVERY_URL;else process.env.ONEEARTH_DISCOVERY_URL=previous;});
  return {state,requests,origin};
}

test("actual direct Message pagination never publishes mixed generations and leaves exact history independent",async t=>{
  const provider=await discovery(t),publications:string[][]=[];let now=100_000;
  const pull=paperCatalogueProjection((input,signal)=>queryPapers(input,signal),rows=>{replacePublishedPapers(rows);publications.push(rows.map(row=>row.id));},()=>now);
  t.after(()=>replacePublishedPapers([]));
  await pull();assert.deepEqual(publications,[[a.id,tail.id]]);
  provider.state.revision="pg-publication:42";provider.state.records=[b,tail];now+=2_000;
  provider.state.afterFirstPage=()=>{provider.state.revision="pg-publication:43";provider.state.records=[paper(a.dsKey,"C"),tail];};
  await assert.rejects(pull,/分页期间更新/);assert.deepEqual(publications,[[a.id,tail.id]]);
  assert.deepEqual(assets.filter(row=>row.id===a.id||row.id===b.id).map(row=>row.id),[a.id]);
  const retryStart=provider.requests.length;await pull();
  assert.deepEqual(provider.requests.slice(retryStart).map(row=>[row.cursor,row.limit]),[["",1],["",500],[a.dsKey,500]]);
  const current=provider.state.records[0];assert.deepEqual(publications.at(-1),[current.id,tail.id]);
  const before=publications.length;now+=2_000;await pull();assert.equal(publications.length,before);assert.equal(provider.requests.at(-1).limit,1);
  assert.deepEqual(await queryPapers({operation:"records",ids:[a.id]},new AbortController().signal),[a]);
  assert.equal(assetById.get(a.id)?.description,a.need.detail);assert.equal(publications.length,before);
  assert.ok(provider.requests.every(row=>["list","records"].includes(row.operation)),"known IDs do not trigger search or a delegated model Task");
});

test("public exact A never becomes current B, while same-conversation archived A opens with the provider unavailable",async t=>{
  const provider=await discovery(t);provider.state.records=[b];provider.state.revision="pg-publication:51";
  const tasks=openTaskStore(":memory:"),conversationId=randomUUID(),parentId=randomUUID();
  const originalCoverage={cellId:"874cc5cceffffff",gridKey:"h7",status:"ready",scopeId:randomUUID(),revision:"a".repeat(64),count:1,members:[a.dsKey],sourceIds:[a.id]};
  tasks.submit(parentId,{conversationId,query:"saved A",turnId:randomUUID()});tasks.claim();tasks.finish(parentId,"complete",{result:{message:"saved A",paperRecords:[a],gridCoverage:originalCoverage,answerNotes:{sources:[{id:a.id,reason:"original"}],references:[{kind:"asset",id:a.id,title:a.need.product,source:"文献资料",sourceChannel:"assertion"}]}}});
  const saved=JSON.stringify(tasks.terminal(parentId)),app=express();app.use("/api/paper-records",runtimePaperRoutes());taskRoutes(app,"/api/tasks",tasks,()=>undefined,{researchRecords:true});
  const origin=await listen(t,app);t.after(()=>tasks.close());
  let response=await fetch(origin+"/api/paper-records?ids="+a.id);assert.equal(response.status,200);assert.deepEqual(await response.json(),[a]);
  provider.state.history.delete(a.id);
  response=await fetch(origin+"/api/paper-records?ids="+a.id);assert.equal(response.status,200);assert.deepEqual(await response.json(),[],"public IDs never scan the runtime's private archived A");
  provider.state.history.set(a.id,a);
  const probeDirectory=mkdtempSync(path.join(tmpdir(),"oe-runtime-consumer-probe-"));t.after(()=>rmSync(probeDirectory,{recursive:true,force:true}));
  const probeConfig=path.join(probeDirectory,"config.json"),probeReport=path.join(probeDirectory,"report.json");
  const probeSpatial=express();probeSpatial.use(express.json());probeSpatial.post("/api/coverage/cells",(_req,res)=>res.sendStatus(410));
  const probeSpatialOrigin=await listen(t,probeSpatial);
  writeFileSync(probeConfig,JSON.stringify({runtimeUrl:origin,discoveryUrl:provider.origin,spatialUrl:probeSpatialOrigin,taskId:parentId,exact:[{id:a.id,dsKey:a.dsKey},{id:b.id,dsKey:b.dsKey}],
    scopes:[{id:randomUUID(),revision:"a".repeat(64),cell:{id:"874cc5cceffffff",grid:gridSpec("h3",7)},expectedStatus:"unknown",expectedReason:"expired"}]}));
  const probe=await promisify(execFile)(process.execPath,["--import","tsx",fileURLToPath(new URL("../scripts/check-runtime-paper-consumer.mts",import.meta.url)),probeConfig,probeReport],{timeout:20000});
  const checked=JSON.parse(readFileSync(probeReport,"utf8"));assert.equal(checked.archive.unchanged,true);assert.deepEqual(checked.provider.ids,[b.id]);assert.equal(checked.modelOrSearchRequests,0);assert.equal(checked.scopes[0].reason,"expired");assert.match(probe.stdout,/"ok":true/);
  provider.state.wrongId=true;const beforeBad=provider.requests.length;
  response=await fetch(origin+"/api/paper-records?ids="+a.id);assert.equal(response.status,503);assert.equal(provider.requests.length,beforeBad+1);
  assert.equal(provider.requests.at(-1).ids[0],a.id);assert.ok(!provider.requests.some(row=>row.operation==="search"));provider.state.wrongId=false;
  provider.state.unavailable=true;const offlineStart=provider.requests.length;
  response=await fetch(origin+"/api/tasks/"+parentId+"/record");assert.equal(response.status,200);const reopened=await response.json();assert.deepEqual(reopened.result.paperRecords,[a]);assert.deepEqual(reopened.result.gridCoverage,originalCoverage);
  assert.deepEqual((await runtimeMaterialHistory(tasks,conversationId,[parentId],{paperIds:[a.id],includeSources:false})).papers,[a]);
  assert.deepEqual((await runtimeMaterialHistory(tasks,"foreign-conversation",[parentId])).papers,[]);
  const directory=mkdtempSync(path.join(tmpdir(),"oe-runtime-old-paper-")),previousPath=process.env.PATH;
  const plan={action:"workspace",goal:"打开保存版本A",evidenceNeed:"existing",targets:["asset:"+a.id],reason:"打开明确引用的原资料",clarification:null,evidenceGap:null,
    researchIntent:{purpose:"打开A",task:"打开A",region:null,time:null,months:[]},conversationContext:"打开保存版本A"};
  writeFileSync(path.join(directory,"codex"),`#!/usr/bin/env node\nfor await(const _ of process.stdin){}process.stdout.write(${JSON.stringify(JSON.stringify(plan))});\n`,{mode:0o700});process.env.PATH=directory+path.delimiter+previousPath;
  t.after(()=>{rmSync(directory,{recursive:true,force:true});if(previousPath===undefined)delete process.env.PATH;else process.env.PATH=previousPath;});
  const body={query:"打开保存版本A",conversationId,turnId:randomUUID(),previousTaskId:parentId,history:[],config:{executor:"codex" as const,model:""},
    context:{filters:emptyFilters(),caseId:null,citation:null,selection:null,gridSystem:"h3" as const,layer:"all" as const,camera:{center:[0,0] as [number,number],zoom:1,reason:"fixture"},
      attachedScope:[{kind:"dataset" as const,id:a.id,title:a.need.product,version:"A",source:"文献资料"}]}};
  const id=randomUUID();tasks.submit(id,body);tasks.claim();const services={tasks,push:{latest(){return{records:[]};}},coverage:async()=>assert.fail(),researchRegionService:{locate:async()=>null},adminBoundaryDir:directory,canonicalCache:new Map()} as unknown as RuntimeServices;
  const outcome=await executeTurn(services,id,body,new AbortController().signal,event=>tasks.append(id,event));
  assert.equal(outcome.error,undefined);assert.equal((outcome.result as any).inspectId,a.id);assert.equal(provider.requests.length,offlineStart);
  assert.equal(JSON.stringify(tasks.terminal(parentId)),saved);
});

test("grid questions use authoritative scope revisions and never substitute current B for expired A",async t=>{
  const cell={id:"874cc5cceffffff",grid:gridSpec("h3",7)},selection={...cell,point:[-66.9,18.4] as [number,number]};
  const revisionA=createHash("sha256").update("authoritative-A").digest("hex"),revisionB=createHash("sha256").update("authoritative-B").digest("hex"),scopeA=randomUUID(),scopeB=randomUUID();
  const summary={selection,filters:{...emptyFilters(),source:"paper",period:[2003,2003] as [number,number]},candidateCount:1,candidateIdentity:"a".repeat(64),caseId:null,layer:"all" as const,metric:"products" as const};
  let publishedB=false;const requests:any[]=[],app=express();app.use(express.json());
  app.post("/api/coverage/cells",(req,res)=>{
    requests.push(structuredClone(req.body));assert.equal(req.body.requireSelection,true);assert.equal(req.body.includeReferences,true);
    if(req.body.id===scopeA&&publishedB){res.sendStatus(410);return;}
    const latest=req.body.id===scopeB,expected=latest?revisionB:revisionA;
    if(req.body.revision!==expected){res.sendStatus(409);return;}
    res.json({revision:expected,scope:summary,ready:[cell.id],cells:[[cell.id,1]],members:[[cell.id,[a.dsKey]]],sourceIds:[[cell.id,[latest?b.id:a.id]]]});
  });
  const origin=await listen(t,app),read=spatialCoverageClient(origin);
  const context:DiscoveryContext={filters:{...emptyFilters(),source:"public",period:[2020,2020]},selection,caseId:null,layer:"all",gridSystem:"h3",camera:{center:[-60,15],zoom:1,reason:"forged mirror"},citation:null,
    candidateIds:[b.id],candidateVersions:{[b.id]:"B"},attachedScope:[{kind:"dataset",id:a.id,title:a.need.product,version:"A",source:"文献资料"},
      {kind:"grid",place:"browser mirror",selection,coverageScope:{id:scopeA,revision:revisionA,summary:{...summary,filters:emptyFilters()}}}]};
  const initial=await questionGridEvidence(context,read,new AbortController().signal);assert.equal(initial?.status,"ready");
  const effective=verifiedGridContext(context,initial!);assert.deepEqual(effective.filters,summary.filters);assert.deepEqual(effective.candidateIds,[a.id]);
  assert.deepEqual(effective.candidateVersions,{[a.id]:"A"});assert.match(gridCoverageSummary(initial!),new RegExp(revisionA));
  publishedB=true;const expired=await questionGridEvidence(context,read,new AbortController().signal);
  assert.deepEqual(expired,{cellId:cell.id,gridKey:cell.grid.key,status:"unknown",reason:"expired",revision:revisionA});
  assert.match(gridCoverageSummary(expired!),/覆盖未知/);assert.ok(!gridCoverageSummary(expired!).includes(b.id));
  const latest=await read({cell,scope:{id:scopeB,revision:revisionB}},new AbortController().signal);assert.equal(latest.status,"ready");
  if(latest.status==="ready")assert.deepEqual(latest.sourceIds,[b.id]);
  assert.deepEqual(requests.map(row=>[row.id,row.revision]),[[scopeA,revisionA],[scopeA,revisionA],[scopeB,revisionB]]);
});
