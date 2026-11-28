import assert from "node:assert/strict";
import {randomBytes,randomUUID} from "node:crypto";
import {once} from "node:events";
import test from "node:test";
import express from "express";
import {Pool} from "pg";
import {agUiWorkbench} from "./ag-ui-workbench";
import {postgresTaskStore} from "./postgres-task-store";
import {prepareRuntimeChat} from "./runtime-chat-turn";
import type {RuntimeServices} from "./runtime-turn";
import {spatialCoverageClient} from "./spatial-coverage-client";
import {workTasks,taskStatusRoutes} from "./task-store";
import {runtimeWorkerRunner} from "./runtime-worker-runner";
import {workspaceEffectRoutes} from "./workspace-effect-routes";
import {cellAt,emptyFilters,gridSpec} from "../src/domain/spatial";
import type {DiscoveryResponse} from "../src/domain/types";
import {readWorkspaceActionEffect,workspacePageHeader,workspaceEffectReceiptPath,type WorkspaceActionEffect} from "../src/domain/workspace-action-effect";

const dbUrl=process.env.ONEEARTH_WORKSPACE_RESEARCH_TEST_DATABASE_URL;
const revision="b".repeat(64);
test("one native run waits for the original page, then consumes one durable receipt", {skip:!dbUrl,timeout:20000},async t=>{
  assert.ok(dbUrl);assert.match(new URL(dbUrl).pathname,/test/u);
  const old=process.env.ONEEARTH_RUNTIME_DATABASE_URL;
  process.env.ONEEARTH_RUNTIME_DATABASE_URL=dbUrl;
  const tasks=await postgresTaskStore("runtime"),audit=new Pool({connectionString:dbUrl});
  const app=express();app.use(express.json());
  app.use((req,res,next)=>{
    if(req.method==="PUT"&&req.get("X-Drop-Test-Response")==="yes")res.json=()=>{res.destroy();return res;};
    next();
  });
  const scopes=new Map<string,Record<string,any>>();
  const reads:{path:string;body:any}[]=[];
  app.post("/api/coverage/scopes",(req,res)=>{
    reads.push({path:req.path,body:req.body});const id=randomUUID();
    const summary={selection:req.body.selection,filters:req.body.filters,caseId:null,layer:"all",metric:"products",candidateCount:null,candidateIdentity:null};
    scopes.set(id,summary);res.json({id,revision,scope:summary});
  });
  app.post("/api/coverage/cells",(req,res)=>{
    reads.push({path:req.path,body:req.body});const summary=scopes.get(req.body.id);
    assert.ok(summary);assert.deepEqual(req.body.cells,[summary.selection.id]);
    res.json({revision,ready:req.body.cells,scope:summary,cells:[],members:[[summary.selection.id,[]]]});
  });
  const server=app.listen(0,"127.0.0.1");await once(server,"listening");
  const addr=server.address();assert.ok(addr&&typeof addr!=="string");
  const origin="http://127.0.0.1:"+addr.port;
  const services={tasks,coverage:spatialCoverageClient(origin),push:{latest:()=>({records:[]})},
    researchRegionService:{locate:async()=>null},adminBoundaryDir:"",canonicalCache:new Map()} as unknown as RuntimeServices;
  const deck=new Map<string,DiscoveryResponse>();
  const frontend=await agUiWorkbench(app,tasks,(id,input)=>{
    const fixture=deck.get(id);
    return fixture?Promise.resolve({kind:"foreground",run:async()=>({kind:"reply",payload:{result:fixture}})}):
      prepareRuntimeChat(services,id,input,tasks.chat.latestCompleted);
  },undefined,undefined,undefined,true);
  workspaceEffectRoutes(app,tasks.workspaceEffects);
  taskStatusRoutes(app,"/api/tasks",tasks,{researchRecords:true,chatIdentity:true,readWorkspaceEffect:tasks.workspaceEffects.read,onCancelled:frontend.cancel});
  const runner=runtimeWorkerRunner(services,undefined,{workspaceEffects:tasks.workspaceEffects});
  const stop=await workTasks(tasks,runner.run);
  t.after(async()=>{
    await stop();await frontend.close();server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));
    await Promise.all([audit.end(),tasks.close()]);
    if(old===undefined)delete process.env.ONEEARTH_RUNTIME_DATABASE_URL;else process.env.ONEEARTH_RUNTIME_DATABASE_URL=old;
  });
  const point:[number,number]=[120.2,30.3],grid=gridSpec("h3",6),ground={id:cellAt(point,grid),level:6,point};
  const arrival=()=>({kind:"flight",flight:{state:"arrived",observedAt:Date.now(),ground}});
  const context={caseId:null,filters:{...emptyFilters(),source:"NASA",period:[2020,2024]},selection:null,citation:null,gridSystem:"h3",layer:"all",
    camera:{center:[110,29],zoom:2,reason:"发问时的视图"},workspaceView:{version:1,surface:"earth",operations:[]}};
  const wire=(token?:string)=>({
    runId:randomUUID(),threadId:randomUUID(),messages:[{id:randomUUID(),role:"user",content:"请飞到120.2E 30.3N，再查这里。"}],
    tools:[],context:[],state:{},forwardedProps:{oneearth:{version:1,submission:{context,config:{executor:"codex",model:"gpt-6-luna"},...(token?{workspacePage:{token}}:{})}}},
  });
  const post=(input:ReturnType<typeof wire>)=>fetch(origin+"/api/ag-ui",{method:"POST",headers:{"Content-Type":"application/json",Accept:"text/event-stream"},body:JSON.stringify(input)});
  async function begin(token:string,input=wire(token)){
    const response=await post(input);assert.equal(response.status,200);
    const reader=response.body!.getReader(),decoder=new TextDecoder(),events:any[]=[];
    let buffer="";
    const next=async()=>{
      for(;;){
        const end=buffer.indexOf("\n\n");
        if(end!==-1){
          const raw=buffer.slice(0,end);buffer=buffer.slice(end+2);
          if(raw.startsWith("data: ")){const event=JSON.parse(raw.slice(6));events.push(event);return event;}
        }else{
          const read=await reader.read();if(read.done)return;
          buffer+=decoder.decode(read.value,{stream:true});
        }
      }
    };
    for(let event;event=await next();){
      const effect=readWorkspaceActionEffect(event.snapshot?.oneearth?.workspaceEffect,input.runId);
      if(effect?.command)return {input,effect,events,async finish(){while(await next()){}return events.at(-1);}};
    }
    assert.fail(JSON.stringify(events));
  }
  const status=(id:string,token?:string)=>fetch(origin+"/api/tasks/"+id,{headers:token?{[workspacePageHeader]:token}:undefined}).then(r=>r.json());
  const record=(id:string,token?:string)=>fetch(origin+"/api/tasks/"+id+"/record",{headers:token?{[workspacePageHeader]:token}:undefined}).then(r=>r.json());
  const receipt=(effect:WorkspaceActionEffect,token:string,fact:unknown,drop=false)=>fetch(origin+workspaceEffectReceiptPath(effect.conversationId,effect.actionId,effect.effectId),
    {method:"PUT",headers:{"Content-Type":"application/json",[workspacePageHeader]:token,...(drop?{"X-Drop-Test-Response":"yes"}:{})},body:JSON.stringify(fact)});
  const token=randomBytes(32).toString("hex"),wrong=randomBytes(32).toString("hex");
  const first=await begin(token);
  assert.equal(first.effect.kind,"flight");
  assert.equal((await status(first.input.runId)).workspaceEffect.command,undefined);
  assert.equal((await status(first.input.runId,wrong)).workspaceEffect.command,undefined);
  assert.deepEqual((await status(first.input.runId,token)).workspaceEffect.command,first.effect.command);
  assert.equal((await status(first.input.runId,token)).runtimePhase.phase,"waiting-workspace");
  assert.equal(await tasks.claim(),undefined);
  assert.equal(reads.length,0);
  const fact=arrival();
  assert.equal((await receipt(first.effect,wrong,fact)).status,404);
  assert.equal((await receipt({...first.effect,conversationId:randomUUID()},token,fact)).status,404);
  await assert.rejects(receipt(first.effect,token,fact,true));
  assert.equal((await(await receipt(first.effect,token,fact)).json()).status,"received");
  const done=await first.finish();
  assert.equal(done.type,"RUN_FINISHED");assert.equal(done.outcome?.type??"success","success");
  assert.equal(done.result.oneearth.response.resultBatch.taskId,first.input.runId);
  assert.equal(done.result.oneearth.response.gridCoverage.cellId,ground.id);
  assert.equal(done.result.oneearth.response.fly,undefined);
  assert.equal((await record(first.input.runId,token)).workspaceEffect.command,undefined);
  assert.deepEqual((await record(first.input.runId)).workspaceEffect.receipt,fact);
  assert.deepEqual(reads.map(x=>x.path),["/api/coverage/scopes","/api/coverage/cells"]);
  assert.deepEqual(reads[0].body.filters,context.filters);
  const duplicates=await audit.query("SELECT (SELECT COUNT(*) FROM runtime_chat_messages WHERE id=$1)::int AS chat,(SELECT COUNT(*) FROM runtime_tasks WHERE id=$1)::int AS task",[first.input.runId]);
  assert.deepEqual(duplicates.rows[0],{chat:1,task:1});
  assert.doesNotMatch(JSON.stringify(await tasks.get(first.input.runId)),new RegExp(token));

  const cancelled=await begin(token);
  assert.equal((await fetch(origin+"/api/tasks/"+cancelled.input.runId,{method:"DELETE"})).status,204);
  assert.deepEqual((await cancelled.finish()).outcome,{type:"cancelled"});
  const late=arrival();
  assert.equal((await(await receipt(cancelled.effect,token,late)).json()).status,"cancelled");
  assert.deepEqual((await record(cancelled.input.runId)).workspaceEffect.receipt,late);
  assert.equal((await status(cancelled.input.runId,token)).workspaceEffect.command,undefined);
  assert.equal(reads.length,2);

  const expired=await begin(token);
  const previous=Date.now()-20;
  const conn=await audit.connect();
  try{
    await conn.query("BEGIN");
    await conn.query("UPDATE runtime_tasks SET updated=$2 WHERE id=$1",[expired.input.runId,previous]);
    await conn.query("UPDATE runtime_workspace_action_effects SET effect=jsonb_set(effect,'{expiresAt}',to_jsonb($2::bigint)) WHERE run_id=$1",[expired.input.runId,previous]);
    await conn.query("UPDATE runtime_steps SET wake_at=$2 WHERE id=$1",[expired.input.runId,previous]);
    await conn.query("COMMIT");
  }finally{conn.release();}
  assert.match((await expired.finish()).result.oneearth.response.message,/回执已超时/u);
  assert.equal((await(await receipt(expired.effect,token,arrival())).json()).status,"expired");
  assert.equal(reads.length,2);

  const catalogue=wire(token),turnId=catalogue.messages[0].id,batchId=randomUUID(),datasetId="haina:1825232";
  deck.set(catalogue.runId,{message:"原目录结果。",hainaRecords:[{id:1825232,version:"1"}],
    gridCoverage:{status:"ready",cellId:ground.id,gridKey:grid.key,scopeId:randomUUID(),revision,count:1,members:["private-marker"],sourceIds:[datasetId],
      summary:{selection:{id:ground.id,point,grid},filters:emptyFilters(),caseId:null,layer:"all",metric:"products",candidateCount:null,candidateIdentity:null}},
    workspaceOperation:{kind:"present-catalogue",batchId},
    resultBatch:{batchId,taskId:catalogue.runId,conversationId:catalogue.threadId,turnId,kind:"catalogue",status:"complete",query:"查目录并上球",
      conditions:["权威覆盖修订："+revision],channels:[{source:"authoritative-grid-catalogue",status:"done",count:1}],itemIds:[datasetId]}} as DiscoveryResponse);
  const map=await begin(token,catalogue);
  assert.equal(map.effect.command?.kind,"catalogue-presentation");
  assert.doesNotMatch(JSON.stringify(map.effect.command),/private-marker/);
  const rendering={kind:"catalogue-presentation",presentation:{conversationId:catalogue.threadId,turnId,batchId,coverageRevision:revision,
    items:[{datasetId,version:"1",state:"rendered",observedAt:Date.now()}]}};
  assert.equal((await receipt(map.effect,token,{...rendering,presentation:{...rendering.presentation,coverageRevision:"0".repeat(64)}})).status,409);
  assert.equal((await receipt(map.effect,token,rendering)).status,200);
  const mapDone=await map.finish(),reply=mapDone.result.oneearth.response;
  assert.equal(mapDone.type,"RUN_FINISHED");assert.equal(reply.workspaceOperation,undefined);assert.equal(reply.resultBatch.batchId,batchId);
  assert.equal(mapDone.outcome?.pendingToolCallIds,undefined);
  assert.match(reply.message,/1 项已绘制/u);
  assert.equal((await record(catalogue.runId)).cataloguePresentation.items[0].datasetId,datasetId);
});
