import assert from "node:assert/strict";
import test from "node:test";
import {randomBytes,randomUUID} from "node:crypto";
import {once} from "node:events";
import express from "express";
import {researchExecutor} from "./research-executor";
import type {RuntimeWebToolAuthority,WebGrantInput} from "./runtime-web-tool-store";
import {emptyFilters} from "../src/domain/spatial";
const result={plan:{dataQuestion:"controlled"},papers:[],haina:[],searches:[],sourceStatus:[],issues:[]};
const input=(query="查找NOAA风场资料")=>({query,history:[],references:[],currentDatasets:[],scope:{filters:emptyFilters(),selection:null,caseId:null,citation:null}});

test("actual outbound acceptance persists ownership before grant binding and cleanup failure preserves a completed result",async t=>{
  const old=process.env.ONEEARTH_DISCOVERY_URL,received:any[]=[],order:string[]=[],grants:WebGrantInput[]=[];const token=randomBytes(32).toString("base64url"),id=randomUUID();
  const app=express();app.use(express.json({type:["application/json","application/a2a+json"]}));app.post("/message:send",(req,res)=>{
    received.push(req.body);res.json({task:{id,contextId:randomUUID(),status:{state:"TASK_STATE_COMPLETED"},artifacts:[{artifactId:"result",parts:[{data:{kind:"oneearth.discovery.event.v1",event:{seq:1,result}}}]}]}});
  });
  const server=app.listen(0,"127.0.0.1");await once(server,"listening");const address=server.address();assert.ok(address&&typeof address!=="string");process.env.ONEEARTH_DISCOVERY_URL="http://127.0.0.1:"+address.port;
  t.after(async()=>{if(old===undefined)delete process.env.ONEEARTH_DISCOVERY_URL;else process.env.ONEEARTH_DISCOVERY_URL=old;server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));});
  const authority:RuntimeWebToolAuthority={reserve:async grant=>{grants.push(grant);return token;},bind:async(_token,taskId)=>{assert.equal(taskId,id);order.push("bind");},revoke:async()=>{order.push("revoke");throw Error("controlled transient database failure");}};
  const executor=researchExecutor({executor:"codex",model:"runtime-model"},{search:false,fetch:false},new AbortController().signal,{researchTaskId:randomUUID(),authority});
  const obtained=await executor.discover(randomUUID(),input(),()=>{},{onAccepted:async()=>{order.push("archive");}});assert.deepEqual(obtained,result);assert.deepEqual(order,["archive","bind","revoke"]);
  assert.equal(received[0].message.parts[0].data.input.runtimeWebToolGrant,token);assert.equal(received[0].message.parts[0].data.input.config,undefined);assert.equal(received[0].message.parts[0].data.input.nativeModel,undefined);assert.equal(grants[0].nativeModel?.model,"runtime-model");await executor.close();
});

test("initial, continuation, confirmation and trusted clarification get independent message-scoped grants; explicit Haina gets none",async t=>{
  const old=process.env.ONEEARTH_DISCOVERY_URL,received:any[]=[],grants:WebGrantInput[]=[],tokens:string[]=[],bound:string[]=[],revoked:string[]=[];
  const app=express();app.use(express.json({type:["application/json","application/a2a+json"]}));app.post("/message:send",(req,res)=>{
    received.push(req.body);res.json({task:{id:req.body.message.taskId??randomUUID(),contextId:req.body.message.contextId??randomUUID(),status:{state:"TASK_STATE_COMPLETED"},artifacts:[{artifactId:"result",parts:[{data:{kind:"oneearth.discovery.event.v1",event:{seq:1,result}}}]}]}});
  });
  const server=app.listen(0,"127.0.0.1");await once(server,"listening");const address=server.address();assert.ok(address&&typeof address!=="string");process.env.ONEEARTH_DISCOVERY_URL="http://127.0.0.1:"+address.port;
  t.after(async()=>{if(old===undefined)delete process.env.ONEEARTH_DISCOVERY_URL;else process.env.ONEEARTH_DISCOVERY_URL=old;server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));});
  const authority:RuntimeWebToolAuthority={reserve:async grant=>{grants.push(grant);const token=randomBytes(32).toString("base64url");tokens.push(token);return token;},bind:async token=>{bound.push(token);},revoke:async token=>{revoked.push(token);}};
  const executor=researchExecutor({executor:"codex",model:"runtime-model"},{search:false,fetch:false},new AbortController().signal,{researchTaskId:randomUUID(),authority}),messageIds=Array.from({length:5},()=>randomUUID()),taskId=randomUUID(),contextId=randomUUID();
  try{
    await executor.discover(messageIds[0],input(),()=>{});
    await executor.discover(messageIds[1],{...input(),continuation:{previousId:taskId,focus:"再核官方出处"}},()=>{});
    await executor.discover(messageIds[2],input("已确认的新目标"),()=>{},{target:{discoveryId:taskId,contextId},afterSeq:0});
    await executor.discover(messageIds[3],{continuedFrom:taskId,clarificationReply:{text:"补充原条件",afterSeq:0}},()=>{},{target:{discoveryId:taskId,contextId},afterSeq:0,webToolQuestion:"查找NOAA风场资料"});
    await executor.discover(messageIds[4],{...input("只在海纳查找风场资料"),decision:{checkMessageId:randomUUID(),choice:"proposed",originalQuestion:"只在海纳查找风场资料",dataQuestion:"查找风场资料"}},()=>{});
    assert.deepEqual(grants.map(g=>g.messageId),messageIds.slice(0,4));assert.equal(new Set(tokens).size,4);assert.deepEqual(bound,tokens);assert.deepEqual(revoked,tokens);assert.equal(received[4].message.parts[0].data.input.runtimeWebToolGrant,undefined);
  }finally{await executor.close();}
});
