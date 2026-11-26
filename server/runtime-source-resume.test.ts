import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {once} from "node:events";
import {randomUUID} from "node:crypto";
import {openTaskStore,TaskParked} from "./task-store";
import {createRuntimeStep,runtimeStepContext} from "./runtime-step";
import {researchExecutor} from "./research-executor";
import {emptyFilters} from "../src/domain/spatial";
import type {RuntimeTurnInput} from "./runtime-turn-handoff";
import type {RuntimeWebToolAuthority} from "./runtime-web-tool-store";
const url="https://example.org/exact-source";
const body=():RuntimeTurnInput=>({query:"读取这个确切来源 "+url,conversationId:randomUUID(),turnId:randomUUID(),history:[],config:{executor:"codex",model:"gpt-6-luna"},deepseekTools:{search:false,fetch:false},context:{filters:emptyFilters(),caseId:null,selection:null,citation:null,gridSystem:"h3",layer:"all",camera:{center:[0,0],zoom:1,reason:"fixture"}}});

for(const mode of ["restore-progress","expired","revoked","no-replay-hook"] as const)test("exact source durable read keeps its material, original grant and wire: "+mode,{timeout:8000},async t=>{
 const tasks=openTaskStore(":memory:"),id=randomUUID(),input=body();tasks.submit(id,input);tasks.claim();
 const old=process.env.ONEEARTH_DISCOVERY_URL,oldToken=process.env.ONEEARTH_DISCOVERY_RECOVERY_TOKEN;process.env.ONEEARTH_DISCOVERY_RECOVERY_TOKEN="test-recovery-".repeat(4);
 let posts=0,ready=false,reserves=0,revokes=0,replayChecks=0;const submitted:any[]=[],taskId=randomUUID(),contextId=randomUUID();
 const run={engine:"Origin",query:url,requestUrl:url,status:"done",hits:[{engine:"Origin",url,title:"Exact source",snippet:"Exact source excerpt",stage:"page-excerpt",pageExcerpt:"Actual controlled excerpt preserved before cancellation."}]};
 const progress={artifactId:"progress",parts:[{data:{kind:"oneearth.discovery.event.v1",event:{seq:1,sourceReadProgress:{papers:[],searches:[run],issues:[]}}}}]};
 const result={artifactId:"result",parts:[{data:{kind:"oneearth.discovery.event.v1",event:{seq:2,sourceReadResult:{papers:[],searches:[run],issues:[]}}}}]};
 const snapshot=()=>({id:taskId,contextId,status:{state:ready?"TASK_STATE_COMPLETED":"TASK_STATE_WORKING"},artifacts:ready?[progress,result]:[progress]});
 const app=express();app.use(express.json({type:"application/a2a+json"}));
 app.post("/message:send",(req,res)=>{posts++;submitted.push(req.body);if(mode!=="restore-progress"){res.destroy();return;}res.type("application/a2a+json").json({task:snapshot()});});
 app.get("/tasks/:id",(_req,res)=>res.type("application/a2a+json").json(snapshot()));
 app.get("/internal/discovery-delegations/:messageId",(_req,res)=>res.status(404).json({code:"DELEGATION_NOT_FOUND",idempotentReplay:true}));
 const server=app.listen(0,"127.0.0.1");await once(server,"listening");const address=server.address();assert.ok(address&&typeof address!=="string");process.env.ONEEARTH_DISCOVERY_URL="http://127.0.0.1:"+address.port;
 t.after(()=>{server.closeAllConnections();server.close();tasks.close();if(old===undefined)delete process.env.ONEEARTH_DISCOVERY_URL;else process.env.ONEEARTH_DISCOVERY_URL=old;if(oldToken===undefined)delete process.env.ONEEARTH_DISCOVERY_RECOVERY_TOKEN;else process.env.ONEEARTH_DISCOVERY_RECOVERY_TOKEN=oldToken;});
 const grant="g".repeat(43),authority:RuntimeWebToolAuthority={reserve:async()=>{reserves++;return grant;},bind:async()=>{},revoke:async()=>{revokes++;},...(mode!=="no-replay-hook"?{canReplay:async(token:string,root:string,message:string)=>{assert.equal(token,grant);assert.equal(root,id);assert.equal(message,submitted[0].message.messageId);replayChecks++;return false;}}:{})};
 async function read(){const step=await createRuntimeStep(tasks,id,input,tasks.step(id),new AbortController().signal,()=>{});return runtimeStepContext.run(step,async()=>{
  const executor=researchExecutor(input.config,input.deepseekTools,new AbortController().signal,{researchTaskId:id,authority});
  try{return await executor.read({action:"read",goal:"read exact source",targets:[{key:"web:"+url,kind:"web",basis:"question",title:"Exact source",url}],evidenceNeed:"read",reason:"explicit",clarification:null,researchIntent:{purpose:"read",task:"read",region:null,time:null,months:[]},conversationContext:"read"},input.query,{stage:()=>{},report:()=>{},onResult:material=>step.captureMaterial(material)});}
  finally{await executor.close();}
 });}
 await assert.rejects(read(),error=>error instanceof TaskParked);assert.equal(posts,1);assert.equal(reserves,1);assert.equal(revokes,0);
 if(mode==="restore-progress"){
  const materialCount=tasks.materialEvents(id).length;assert.equal(materialCount,1);
  await assert.rejects(read(),error=>error instanceof TaskParked);assert.equal(tasks.materialEvents(id).length,materialCount,"restoring progress must not append the old material again");
  ready=true;const sources=await read();assert.equal(sources[0].hits[0].pageExcerpt,run.hits[0].pageExcerpt);assert.equal(posts,1);assert.equal(reserves,1);assert.equal(revokes,1);assert.equal(tasks.materialEvents(id).length,2);
  const saved=tasks.step(id) as any;assert.equal(saved.delegations[0].lastSeq,2);assert.equal(saved.delegations[0].envelope,JSON.stringify(submitted[0]));assert.equal(saved.cancelledResult.runTrace.searches.length,1);
 }else{
  const sources=await read();assert.deepEqual(sources,[]);assert.equal(posts,1,"expired/revoked/unknown grant must never authorize another POST");assert.equal(reserves,1);assert.equal(replayChecks,mode==="no-replay-hook"?0:1);
 }
});
