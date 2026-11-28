import {randomUUID} from "node:crypto";
import {once} from "node:events";
import {mkdtemp,rm,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import {Pool} from "pg";
import {agUiWorkbench} from "./ag-ui-workbench";
import {postgresTaskStore} from "./postgres-task-store";
import {prepareRuntimeChat} from "./runtime-chat-turn";
import {closeRuntimeModelCapacity} from "./runtime-model-capacity";
import type {RuntimeServices} from "./runtime-turn";
import {spatialCoverageClient} from "./spatial-coverage-client";
import {taskStatusRoutes} from "./task-store";
import {workspaceResearchStateRoutes,workspaceResearchStateStore} from "./workspace-research-state";
import {cellAt,emptyFilters,gridSpec} from "../src/domain/spatial";
import type {CoverageAttachment} from "../src/domain/coverage-attachment";
import type {DiscoveryContext} from "../src/domain/types";
import type {WorkspaceResearchAction} from "../src/domain/workspace-research-state";

const database=process.env.ONEEARTH_WORKSPACE_RESEARCH_TEST_DATABASE_URL;
const publication="a".repeat(64);
const nextPublication="b".repeat(64);

test("workspace actions and native runs bind the submitted range despite concurrency or expired handles",
  {skip:!database,timeout:30000},async t=>{
  assert.ok(database);
  assert.match(new URL(database).pathname,/test/u);
  const originalUrl=process.env.ONEEARTH_RUNTIME_DATABASE_URL,originalPath=process.env.PATH;
  const dir=await mkdtemp(path.join(tmpdir(),"oe-research-range-test-"));
  process.env.ONEEARTH_RUNTIME_DATABASE_URL=database;
  process.env.PATH=dir+path.delimiter+(originalPath??"");
  await writeFile(path.join(dir,"codex"),`#!${process.execPath}
    let prompt=''; for await (const chunk of process.stdin) prompt+=chunk;
    const input=JSON.parse(prompt.trimEnd().split('\\n').at(-1));
    const question=input.question;
    const ret=question.includes('清除当前会话')||question.includes('刚选的这一格')||question.includes('只查这里一次')
      ?{decide:{kind:'workspace',action:{kind:'workspace-operation',operation:question.includes('清除当前会话')?'clear-research-range':'adopt-research-range'}}}
      :{decide:{kind:'respond',reply:'这里只作一般说明。',targets:[]},gridIntent:question.includes('多少资料')?'count':'none'};
    process.stdout.write(JSON.stringify(ret));
  `,{mode:0o700});
  const tasks=await postgresTaskStore("runtime");
  const audit=new Pool({connectionString:database});
  const app=express();
  app.use(express.json());
  const scopes=new Map<string,CoverageAttachment>();
  const requestedHandles:string[]=[];
  let revision=publication,rebinds=0,poisonRegistration=false;
  app.post("/api/coverage/scopes",(req,res)=>{
    rebinds++;
    assert.equal(req.body.batch,null);
    if(req.body.revision!==revision){res.sendStatus(409);return;}
    const attachment=scopeFor(req.body.selection.point,{
      ...req.body.filters,...(poisonRegistration?{source:"tampered"}:{}),
    });
    res.json({id:attachment.id,revision:attachment.revision,scope:attachment.summary});
  });
  app.post("/api/coverage/cells",(req,res)=>{
    const {id,cells}=req.body;
    requestedHandles.push(id);
    const attachment=scopes.get(id);
    if(!attachment||req.body.revision!==revision){res.sendStatus(410);return;}
    const {summary}=attachment;
    assert.deepEqual(cells,[summary.selection.id]);
    res.json({revision,ready:cells,scope:summary,cells:[[cells[0],0]],members:[[cells[0],[]]]});
  });
  const server=app.listen(0,"127.0.0.1");
  await once(server,"listening");
  const address=server.address();
  assert.ok(address&&typeof address!=="string");
  const origin="http://127.0.0.1:"+address.port;
  const coverage=spatialCoverageClient(origin);
  const workspace=await workspaceResearchStateStore(new Pool({connectionString:database}),coverage);
  const services={tasks,coverage,workspaceResearch:workspace,push:{latest:()=>({records:[]})},
    researchRegionService:{locate:async()=>null},adminBoundaryDir:dir,canonicalCache:new Map()} as unknown as RuntimeServices;
  workspaceResearchStateRoutes(app,workspace);
  let preAdmission:Promise<void>|undefined,afterAdmission:Promise<void>|undefined,prepareStarted:(()=>void)|undefined;
  let release:()=>void=()=>{},admit:()=>void=()=>{};
  const chat=await agUiWorkbench(app,tasks,async (id,body)=>{
    const prepared=await prepareRuntimeChat(services,id,body,tasks.chat.latestCompleted);
    prepareStarted?.();
    if(preAdmission)await preAdmission;
    const activeGate=afterAdmission;
    if(activeGate&&"kind" in prepared&&prepared.kind==="foreground"){
      return {...prepared,run:async(...args:Parameters<typeof prepared.run>)=>{await activeGate;return prepared.run(...args);}};
    }
    return prepared;
  },undefined,undefined,workspace);
  taskStatusRoutes(app,"/api/tasks",tasks,{researchRecords:true,chatIdentity:true,onCancelled:chat.cancel});
  t.after(async()=>{
    release();admit();
    await chat.close();
    server.closeAllConnections();
    await new Promise<void>(done=>server.close(()=>done()));
    await Promise.all([tasks.close(),workspace.close(),audit.end(),closeRuntimeModelCapacity()]);
    if(originalPath===undefined)delete process.env.PATH;else process.env.PATH=originalPath;
    if(originalUrl===undefined)delete process.env.ONEEARTH_RUNTIME_DATABASE_URL;else process.env.ONEEARTH_RUNTIME_DATABASE_URL=originalUrl;
    await rm(dir,{recursive:true,force:true});
  });

  function scopeFor(point:[number,number],filters=emptyFilters()):CoverageAttachment{
    const grid=gridSpec("h3",2),selection={id:cellAt(point,grid),point,grid};
    const attachment={id:randomUUID(),revision,summary:{selection,filters,caseId:null,layer:"all" as const,
      metric:"products" as const,candidateCount:null,candidateIdentity:null}};
    scopes.set(attachment.id,attachment);
    return attachment;
  }
  const a=scopeFor([105,25]),b=scopeFor([120,30]),thread=randomUUID();
  const root=origin+"/api/workspaces/"+thread;
  const read=async()=>await (await fetch(root+"/research-state")).json();
  const post=(url:string,body:unknown)=>fetch(url,{method:"POST",headers:{"Content-Type":"application/json",Accept:"text/event-stream"},body:JSON.stringify(body)});
  const adopt=(scope:CoverageAttachment,expectedRevision:number,actionId:string=randomUUID()):WorkspaceResearchAction=>({
    kind:"adopt-research-range",actionId,expectedRevision,range:{scope:{kind:"grid",place:"发问时的网格",selection:scope.summary.selection,coverageScope:scope}},
  });
  const context:DiscoveryContext={caseId:null,filters:emptyFilters(),gridSystem:"h3",layer:"all",selection:b.summary.selection,
    camera:{center:b.summary.selection.point,zoom:1,reason:"view"},citation:null,workspaceView:{version:1,surface:"earth",operations:[]}};
  const wire=(query:string,extra:Record<string,unknown>={},view=context)=>({
    runId:randomUUID(),threadId:thread,messages:[{id:randomUUID(),role:"user",content:query}],tools:[],context:[],state:{},
    forwardedProps:{oneearth:{version:1,submission:{context:view,config:{executor:"codex",model:"gpt-6-luna"},...extra}}},
  });
  const receive=async(response:Response)=>{
    assert.equal(response.status,200,await (response.status!==200?response.text():Promise.resolve("")));
    const frames=(await response.text()).split("\n").filter(line=>line.startsWith("data: ")).map(line=>JSON.parse(line.slice(6)));
    return frames.at(-1);
  };
  const getRecord=async(id:string)=>await (await fetch(origin+"/api/tasks/"+id+"/record")).json();
  const runUrl=origin+"/api/ag-ui";
  assert.deepEqual(await read(),{conversationId:thread,revision:0,actionId:null,range:null});
  const first=adopt(a,0),concurrent=adopt(b,0);
  const initial=await post(root+"/actions",first);
  assert.equal(initial.status,200);
  const stateA=await initial.json(),binding={revision:stateA.revision,actionId:stateA.actionId};
  assert.equal((await post(root+"/actions",concurrent)).status,409);
  assert.deepEqual(await(await post(root+"/actions",first)).json(),stateA);
  assert.equal((await(await post(root+"/actions",adopt(b,0,first.actionId))).json()).code,"WORKSPACE_ACTION_ID_CONFLICT");
  const forged=wire("当前可定位多少资料？",{}, {...context,selection:a.summary.selection,attachedScope:[stateA.range.scope]});
  assert.equal((await post(runUrl,forged)).status,400);
  assert.equal(await tasks.get(forged.runId),undefined);

  afterAdmission=new Promise<void>(done=>{release=done;});
  const frozen=wire("已采用的研究范围能定位多少资料？",{workspaceResearch:binding});
  const pending=await post(runUrl,frozen);
  assert.equal(pending.status,200);
  afterAdmission=undefined;
  const newSelection=adopt(b,1);
  const stateB=await(await post(root+"/actions",newSelection)).json();
  assert.equal(stateB.revision,2);
  release();
  assert.equal((await receive(pending)).type,"RUN_FINISHED");
  const archive=await getRecord(frozen.runId);
  assert.deepEqual(archive.workspaceResearch,binding);
  assert.equal(archive.researchRange.selection.id,a.summary.selection.id);
  assert.deepEqual(await read(),stateB);
  assert.deepEqual(await(await post(root+"/actions",first)).json(),stateA);

  let entered!:()=>void;
  const prepared=new Promise<void>(done=>{entered=done;});
  prepareStarted=entered;
  preAdmission=new Promise<void>(done=>{admit=done;});
  const conflicted=wire("当前工作台是什么？",{workspaceResearch:{revision:2,actionId:stateB.actionId}});
  const awaiting=post(runUrl,conflicted);
  await prepared;
  const stateC=await(await post(root+"/actions",adopt(a,2))).json();
  assert.equal(stateC.revision,3);
  preAdmission=undefined;prepareStarted=undefined;admit();
  const conflict=await awaiting;
  assert.equal(conflict.status,409);
  assert.equal((await conflict.json()).code,"WORKSPACE_REVISION_CONFLICT");
  assert.equal(await tasks.get(conflicted.runId),undefined);

  scopes.delete(a.id);
  const refC={revision:3,actionId:stateC.actionId};
  const renewed=wire("已采用的研究范围能定位多少资料？",{workspaceResearch:refC});
  assert.equal((await receive(await post(runUrl,renewed))).type,"RUN_FINISHED");
  const rebound=await getRecord(renewed.runId);
  assert.deepEqual(rebound.workspaceResearch,refC);
  assert.equal(rebound.researchRange.selection.id,a.summary.selection.id);
  assert.notEqual(rebound.researchRange.coverageScope.id,a.id);
  assert.equal(rebound.researchRange.coverageScope.revision,publication);
  assert.equal(rebinds,1);
  assert.deepEqual(await read(),stateC);
  poisonRegistration=true;
  const altered=wire("已采用的研究范围能定位多少资料？",{workspaceResearch:refC});
  assert.match((await receive(await post(runUrl,altered))).result.oneearth.response.message,/已失效/u);
  assert.equal(await getRecord(altered.runId).then(value=>value.researchRange),undefined);
  poisonRegistration=false;
  revision=nextPublication;
  const ordinary=wire("当前展示的是哪种工作台？",{workspaceResearch:refC});
  assert.equal((await receive(await post(runUrl,ordinary))).result.oneearth.response.message,"这里只作一般说明。");
  const stale=wire("已采用的研究范围能定位多少资料？",{workspaceResearch:refC});
  assert.match((await receive(await post(runUrl,stale))).result.oneearth.response.message,/已失效/u);
  assert.deepEqual(await read(),stateC);

  const activeB=scopeFor([120,30]);
  const natural=adopt(activeB,3);
  assert.ok(natural.kind==="adopt-research-range");
  const observed={actionId:natural.actionId,expectedRevision:natural.expectedRevision,range:natural.range};
  const onceOnly=wire("只查这里一次",{workspaceResearchAction:observed});
  assert.equal((await receive(await post(runUrl,onceOnly))).type,"RUN_ERROR");
  const accepted=wire("请把地图上刚选的这一格作为接下来研究的范围。",{workspaceResearchAction:observed});
  const applied=(await receive(await post(runUrl,accepted))).result.oneearth.response.workspaceResearchState;
  assert.equal(applied.range.scope.selection.id,activeB.summary.selection.id);
  assert.equal(applied.revision,4);
  const beforeClear=requestedHandles.length;
  const clear=wire("请清除当前会话的研究范围。",{workspaceResearchAction:{actionId:randomUUID(),expectedRevision:4},
    workspaceResearch:{revision:4,actionId:applied.actionId}});
  assert.equal((await receive(await post(runUrl,clear))).result.oneearth.response.workspaceResearchState.range,null);
  assert.equal(requestedHandles.length,beforeClear);
  assert.equal((await read()).revision,5);
  const batch=scopeFor([120,30]);
  batch.summary.candidateCount=1;
  batch.summary.candidateIdentity="f".repeat(64);
  const stateBatch=await(await post(root+"/actions",adopt(batch,5))).json();
  assert.equal(stateBatch.range.scope.coverageScope.summary.candidateCount,1);
  scopes.delete(batch.id);
  const beforeBatchRebind=rebinds;
  const staleBatch=wire("已采用的研究范围能定位多少资料？",{workspaceResearch:{revision:6,actionId:stateBatch.actionId}});
  assert.match((await receive(await post(runUrl,staleBatch))).result.oneearth.response.message,/已失效/u);
  assert.equal(rebinds,beforeBatchRebind);
  const {rows}=await audit.query("SELECT origin FROM runtime_workspace_research_actions WHERE conversation_id=$1 AND action_id=$2",[thread,observed.actionId]);
  assert.deepEqual(rows[0].origin,{source:"chat",runId:accepted.runId,turnId:accepted.messages[0].id});
  assert.equal((await getRecord(frozen.runId)).researchRange.selection.id,a.summary.selection.id);
});
