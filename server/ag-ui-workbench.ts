import {authorizedFlashApi} from "./flash-api";
import type {Router,Response} from "express";
import {setTimeout as delay} from "node:timers/promises";
import type {TaskStore,Payload} from "./task-store";
import {TaskConflict} from "./task-store";
import type {PostgresChatMessages} from "./postgres-chat-messages";
import {submissionFingerprint} from "./postgres-chat-messages";
import type {ChatPreparation} from "./runtime-chat-channel";
import {TaskCancelled} from "./task-cancellation";
import {modelExecutionContext} from "./model-execution-context";
import {requestPerformance,type ExecutorTiming} from "./request-performance";
import {publicAnswerContext} from "./public-answer-stream";
import {AgUiInputError,readAgUiInput} from "./ag-ui-input";
import {nativeAgUiPath} from "../src/domain/native-ag-ui";
import {workspaceReply} from "./runtime-chat-channel";

/** Native producer: standard frames are persisted directly by the original
 * acceptance/finish transactions, never reconstructed from NDJSON events. */
export async function agUiWorkbench(app:Router,tasks:TaskStore&{chat:PostgresChatMessages},prepare:(id:string,input:unknown)=>Promise<ChatPreparation>){
 const {chat}=tasks;await chat.acquire();let stopping=false;
 const active=new Map<string,{controller:AbortController;done:Promise<void>}>();
 function start(id:string,prepared:Exclude<ChatPreparation,{error:string}>,allowPublic:boolean){
  const controller=new AbortController(),signal=AbortSignal.any([controller.signal,AbortSignal.timeout(125000)]),timings:ExecutorTiming[]=[];
  let pending=Promise.resolve(),persistFailed=false,retained:Payload|undefined;
  const enqueue=(write:()=>Promise<unknown>)=>{pending=pending.then(async()=>{if(!persistFailed)await write();}).catch(()=>{persistFailed=true;controller.abort();});};
  const done=(async()=>{
   try{
    const outcome=await requestPerformance.run(timings,()=>modelExecutionContext.run({role:"foreground",taskId:id,tasks},()=>publicAnswerContext.run(allowPublic?{onText:delta=>enqueue(async()=>{
     if(!await chat.appendAgUiText(id,delta))throw Error("公开正文未被原运行采纳。");
    })}:undefined,()=>{
     if(prepared.kind==="research")return Promise.resolve({kind:"research" as const,checkpoint:prepared.checkpoint});
     return prepared.run(id,signal,event=>enqueue(()=>chat.append(id,event)));
    })));
    await pending;signal.throwIfAborted();
    if(outcome.kind==="research")await chat.promote(id,"handoff" in outcome?outcome.handoff:undefined,outcome.checkpoint);
    else {retained=outcome.payload;await chat.finish(id,outcome.payload.error?"failed":"complete",workspaceReply(id,outcome.payload));}
   }catch{
    await pending;if(controller.signal.reason instanceof TaskCancelled)return;
    await chat.finish(id,"failed",{...retained,error:stopping?"服务中断了本轮运行。":signal.aborted?"本轮运行已超时或中断。":"本轮未形成经过核验的答复。",code:stopping?"chat_interrupted":persistFailed?"public_delivery_failed":"run_failed"});
   }
  })().catch(()=>console.error("OneEarth AG-UI could not persist the original run ending")).finally(()=>active.delete(id));
  active.set(id,{controller,done});
 }
 async function stream(id:string,res:Response){
  let cursor=0,closed=false,lastWrite=Date.now();const controller=new AbortController();
  const close=()=>{closed=true;controller.abort();};res.once("close",close);
  res.status(200).set({"Content-Type":"text/event-stream; charset=utf-8","Cache-Control":"no-store","X-Accel-Buffering":"no"});res.flushHeaders();
  try{while(!closed){
   const events=await chat.agUiEvents(id,cursor);
   for(const {seq,event} of events){
    if(closed)return;
    if(!res.write("data: "+JSON.stringify(event)+"\n\n")){
     await new Promise<void>(resolve=>{const done=()=>{res.off("drain",done);res.off("close",done);resolve();};res.once("drain",done);res.once("close",done);});
    }
    lastWrite=Date.now();cursor=seq;if(event.type==="RUN_FINISHED"||event.type==="RUN_ERROR"){res.end();return;}
   }
   if(!closed&&Date.now()-lastWrite>=10000){res.write(": keep-alive\n\n");lastWrite=Date.now();}
   if(!events.length&&!closed)await delay(40,undefined,{signal:controller.signal});
  }}catch{if(!closed)res.destroy();}finally{res.off("close",close);}
 }
 app.post(nativeAgUiPath,async(req,res)=>{
  if(!req.is("application/json")){res.status(415).json({error:"AG-UI 需要 application/json。"});return;}
  if(!req.accepts("text/event-stream")){res.status(406).json({error:"AG-UI 需要 text/event-stream。"});return;}
  if(stopping){res.status(503).json({error:"正在停止接收运行。"});return;}
  try{
   const {id,body,fingerprint}=readAgUiInput(req.body);
   const previous=await tasks.get(id);
   if(previous){
    res.status(409).set("Location","/api/tasks/"+id).json({error:previous.fingerprint===submissionFingerprint(JSON.stringify(body))?"该运行已受理，请只读原状态与归档。":"该运行编号已用于另一份提交。",code:"RUN_ALREADY_ACCEPTED"});return;
   }
   const prepared=await prepare(id,body);
   if("error" in prepared){res.status(400).json({error:prepared.error});return;}
   const admitted=await chat.admit(id,body,4,{threadId:body.conversationId,turnId:body.turnId,fingerprint});
   if(!admitted){res.status(429).set("Retry-After","2").json({error:"前台正在处理其他运行。"});return;}
   if(!admitted.started){res.status(409).set("Location","/api/tasks/"+id).json({error:"该运行已受理，请只读原状态与归档。",code:"RUN_ALREADY_ACCEPTED"});return;}
   start(id,prepared,authorizedFlashApi(body.config));await stream(id,res);
  }catch(error){
   if(res.headersSent){res.destroy();return;}
   if(error instanceof AgUiInputError){res.status(error.status).json({error:error.message});return;}
   if(error instanceof TaskConflict){res.status(409).json({error:error.message});return;}
   res.status(503).json({error:"运行未能持久受理。"});
  }
 });
 return {cancel(id:string){active.get(id.toLowerCase())?.controller.abort(new TaskCancelled());},async close(){stopping=true;for(const row of active.values())row.controller.abort();await Promise.allSettled([...active.values()].map(row=>row.done));}};
}
