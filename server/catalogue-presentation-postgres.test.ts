import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {once} from "node:events";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";
import express from "express";
import type {CataloguePresentation,CataloguePresentationItem,CataloguePresentationWrite} from "../src/domain/catalogue-presentation";
import type {HainaRecord} from "../src/domain/haina-record";
import {cellAt,emptyFilters,gridSpec} from "../src/domain/spatial";
import type {DiscoveryResponse} from "../src/domain/types";
import {postgresTaskStore} from "./postgres-task-store";
import {createRuntimeApi} from "./runtime-api-service";
import {gridCatalogueBatch} from "./runtime-result-batch";
import {workspaceReply} from "./runtime-chat-channel";

const fixture=process.env.ONEEARTH_AGUI_TEST_DATABASE_URL;
const coverageRevision="a".repeat(64);
const datasetId=(id:number)=>"haina:"+id;
const observedAt=Date.now();
const metadata=(id:number,version:string):HainaRecord=>({
  id,name:"受控目录条目 "+id,description:"隔离的可重放记录",provider:"目录测试",source:"目录测试",
  version,license:"Public",access:"Public",labels:[],card:{tags:[]},
});
const item=(id:number,state:CataloguePresentationItem["state"]="rendered"):CataloguePresentationItem=>
  ({datasetId:datasetId(id),version:"1",state,observedAt});

test("catalogue presentation original identity and immutable item states through runtime HTTP and PostgreSQL",
  {skip:!fixture,timeout:20_000},async t=>{
  assert.ok(fixture);
  const database=new URL(fixture);
  assert.match(database.hostname,/^(127\.0\.0\.1|localhost)$/);
  assert.match(database.pathname,/^\/native_agui_[a-z0-9_]+catalogue[a-z0-9_]*$/);
  const old=process.env.ONEEARTH_RUNTIME_DATABASE_URL;
  process.env.ONEEARTH_RUNTIME_DATABASE_URL=fixture;
  const dir=await mkdtemp(join(tmpdir(),"oneearth-catalogue-presentation-test."));
  t.after(async()=>{
    if(old===undefined)delete process.env.ONEEARTH_RUNTIME_DATABASE_URL;
    else process.env.ONEEARTH_RUNTIME_DATABASE_URL=old;
    await rm(dir,{recursive:true,force:true});
  });
  const api=await createRuntimeApi(dir);
  const tasks=await postgresTaskStore("runtime");
  const app=express().use(api.business);
  const listener=app.listen(0,"127.0.0.1");
  await once(listener,"listening");
  t.after(async()=>{
    listener.closeAllConnections();
    await new Promise<void>(resolve=>listener.close(()=>resolve()));
    await api.close();
    await tasks.close();
  });
  const address=listener.address();
  assert.ok(address&&typeof address!=="string");
  const origin="http://127.0.0.1:"+address.port;
  const record=async(id:string)=>{
    const response=await fetch(origin+"/api/tasks/"+id+"/record");
    assert.equal(response.status,200);
    assert.equal(response.headers.get("cache-control"),"no-store");
    return response.json();
  };
  const put=(runId:string,body:unknown,contentType="application/json")=>fetch(origin+"/api/tasks/"+runId+"/catalogue-presentation",{
    method:"PUT",headers:{"Content-Type":contentType},body:JSON.stringify(body),
  });
  const checkStatus=async(response:Promise<Response>,status:number)=>{
    const result=await response;
    assert.equal(result.status,status,await result.clone().text());
    return result;
  };

  async function original(mode:"foreground"|"background"|"legacy"|"pending"|"failed"|"cancelled",
    batchStatus:"complete"|"partial"|"failed"="complete",
    authorization:"native-call"|"ordinary"|"proposal-only"|"bad-tool-batch"="native-call"){
    const runId=randomUUID(),conversationId=randomUUID(),turnId=randomUUID(),batchId=randomUUID();
    const point:[number,number]=[105,25],grid=gridSpec("h3",2);
    const cellId=cellAt(point,grid);
    const ids=[1,2,3,4].map(datasetId);
    const owner={taskId:runId,conversationId,turnId,batchId};
    const gridCoverage:DiscoveryResponse["gridCoverage"]={status:"ready",cellId,gridKey:grid.key,
      scopeId:randomUUID(),revision:coverageRevision,count:4,members:ids,sourceIds:[...ids.slice(0,3),datasetId(5)],
      summary:{selection:{id:cellId,grid,point},filters:{...emptyFilters(),source:"haina"},caseId:null,layer:"all",
        metric:"products",candidateCount:null,candidateIdentity:null}};
    const result:DiscoveryResponse={message:"原目录批次。",gridCoverage,
      resultBatch:{...gridCatalogueBatch(owner,"读取所选网格",ids,coverageRevision,batchStatus==="complete"),status:batchStatus},
      ...(authorization==="ordinary"?{}:{workspaceOperation:{kind:"present-catalogue" as const,
        batchId:authorization==="bad-tool-batch"?randomUUID():batchId}}),
      hainaRecords:[metadata(1,"1"),metadata(2,"1"),metadata(3,""),metadata(4,"1"),metadata(5,"1")]};
    const body={conversationId,turnId,query:"读取所选网格"};
    const admission=mode==="legacy"?undefined:{threadId:conversationId,turnId,fingerprint:"isolated",workspaceTool:authorization!=="proposal-only"};
    const payload=workspaceReply(runId,{result});
    assert.ok((await tasks.chat.admit(runId,body,4,admission))?.started);
    if(mode==="background"){
      assert.equal(await tasks.chat.promote(runId),true);
      assert.equal(await tasks.finish(runId,"complete",payload),true);
    }else if(mode==="pending"){
      // Leave the actual native run open until the negative HTTP check is done.
    }else if(mode==="cancelled"){
      assert.equal(await tasks.finish(runId,"cancelled",payload),true);
    }else assert.equal(await tasks.chat.finish(runId,mode==="failed"?"failed":"complete",payload),true);
    const write:CataloguePresentationWrite={conversationId,turnId,batchId,coverageRevision,items:[item(1)]};
    return {runId,write};
  }

  const {runId,write}=await original("foreground");
  const before=await record(runId);
  const events=await tasks.chat.agUiEvents(runId);
  assert.equal(Object.hasOwn(before,"cataloguePresentation"),false);
  assert.equal(Object.hasOwn(before,"workspaceReceipt"),false);
  assert.equal(before.workspaceTool.call.id,"workspace:"+runId);
  await checkStatus(put(runId,{...write,renderer:"guessed"}),400);
  await checkStatus(put(runId,write,"text/plain"),400);
  await checkStatus(put(runId,{...write,items:[item(1),item(1)]}),400);
  await checkStatus(put(randomUUID(),write),409);
  for(const patch of [
    {conversationId:randomUUID()}, {turnId:randomUUID()}, {batchId:randomUUID()}, {coverageRevision:"b".repeat(64)},
    {items:[{...item(1),version:"2"}]}, {items:[item(3)]}, {items:[item(4)]}, {items:[item(5)]},
    {items:[item(1),{...item(2),version:"2"}]},
    {items:[{...item(1),observedAt:Date.now()+60000}]},
  ])await checkStatus(put(runId,{...write,...patch}),409);
  assert.deepEqual(await record(runId),before);

  const stored:CataloguePresentation=await (await checkStatus(put(runId,write),200)).json();
  assert.deepEqual(stored,{runId,...write});
  const unchanged=await (await checkStatus(put(runId,{...write,items:[{...item(1),observedAt:observedAt+1}]}),200)).json();
  assert.deepEqual(unchanged,stored);
  await checkStatus(put(runId,{...write,items:[item(2),item(1,"failed")]}),409);
  assert.deepEqual((await record(runId)).cataloguePresentation,stored);
  const competitors=[item(2),item(2,"superseded")];
  const raced=await Promise.all(competitors.map(entry=>put(runId,{...write,items:[entry]})));
  assert.deepEqual(raced.map(result=>result.status).sort(),[200,409]);
  const accepted=competitors[raced.findIndex(result=>result.status===200)];
  const final={...stored,items:[item(1),accepted]};
  const {cataloguePresentation,...rest}=await record(runId);
  assert.deepEqual(cataloguePresentation,final);
  assert.deepEqual(rest,before);
  assert.deepEqual(await tasks.chat.agUiEvents(runId),events);
  assert.deepEqual(await tasks.chat.agUiPendingWorkspaceCalls(write.conversationId),[{runId,toolCallId:"workspace:"+runId}]);

  for(const mode of ["pending","legacy","failed","cancelled"] as const){
    const disallowed=await original(mode);
    await checkStatus(put(disallowed.runId,disallowed.write),409);
    assert.equal(await tasks.cataloguePresentation.read(disallowed.runId),undefined);
  }
  const failedBatch=await original("foreground","failed");
  await checkStatus(put(failedBatch.runId,failedBatch.write),409);
  for(const authorization of ["ordinary","proposal-only","bad-tool-batch"] as const){
    const disallowed=await original("foreground","complete",authorization);
    await checkStatus(put(disallowed.runId,disallowed.write),409);
    assert.equal((await record(disallowed.runId)).cataloguePresentation,undefined);
  }
  const background=await original("background","partial");
  assert.equal((await record(background.runId)).cataloguePresentation,undefined);
  await checkStatus(put(background.runId,{...background.write,items:[item(1,"failed")]}),200);
  assert.equal((await record(background.runId)).cataloguePresentation.items[0].state,"failed");
  const reopened=await postgresTaskStore("runtime");
  try{assert.deepEqual(await reopened.cataloguePresentation.read(runId),final);}
  finally{await reopened.close();}
});
