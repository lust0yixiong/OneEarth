import express from "express";
import {parseWebToolCall,webToolPath,type WebToolOperation,type WebToolValue} from "./web-tool-contract";
import {runWebTool,webToolFailure} from "./runtime-web-tool-adapter";
import {WebToolAccessError,type RuntimeWebToolStore,type WebToolClaim} from "./runtime-web-tool-store";
import type {ChatModel} from "../src/domain/chat-model";

type Run=(operation:WebToolOperation,signal:AbortSignal,options:{nativeModel?:ChatModel;sourceSnapshotScope?:string})=>Promise<WebToolValue>;
/** This scheduler lives in the runtime API process, independently of a parent
 * research worker awaiting A2A. POST only submits or reads a durable receipt. */
export async function runtimeWebToolChannel(store:RuntimeWebToolStore,options:{run?:Run;capacity?:number;pollMs?:number}={}){
  const capacity=options.capacity??2,pollMs=options.pollMs??40,run=options.run??runWebTool;
  if(!Number.isSafeInteger(capacity)||capacity<1||capacity>8)throw Error("Invalid runtime web tool capacity");
  let stopped=false,timer:ReturnType<typeof setTimeout>|undefined,tick:Promise<void>|undefined;
  const active=new Map<string,{call:WebToolClaim;controller:AbortController;done:Promise<void>}>();
  await store.coordinate(()=>{stopped=true;clearTimeout(timer);for(const job of active.values())job.controller.abort();});
  async function poll(){
    for(const job of active.values())if(!await store.active(job.call))job.controller.abort();
    while(!stopped&&active.size<capacity){
      const call=await store.claim();if(!call)return;const controller=new AbortController();
      const done=(async()=>{
        try{
          if(!await store.active(call))throw new DOMException("Grant ended","AbortError");
          const value=await run(call.operation,AbortSignal.any([controller.signal,AbortSignal.timeout(35_000)]),{nativeModel:call.nativeModel,sourceSnapshotScope:call.sourceSnapshotScope});
          await store.finish(call,{state:"complete",value});
        }catch(error){await store.finish(call,{state:"failed",error:webToolFailure(error)});}
      })().catch(()=>console.error("OneEarth web tool receipt could not be saved"))
        .finally(()=>active.delete(call.callId));
      active.set(call.callId,{call,controller,done});
    }
  }
  function schedule(){if(stopped)return;tick=poll().catch(()=>{for(const job of active.values())job.controller.abort();console.error("OneEarth web tool queue unavailable");}).finally(()=>{if(!stopped)timer=setTimeout(schedule,pollMs).unref();});}
  schedule();
  const router=express.Router();router.post(webToolPath,express.json({limit:"64kb"}),async(req,res)=>{
    const token=/^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.get("authorization")||"")?.[1];
    if(!token){res.status(403).json({error:{message:"工具请求缺少本次委托授权。"}});return;}
    const call=parseWebToolCall(req.body);if(!call){res.status(400).json({error:{message:"工具调用身份或输入无效。"}});return;}
    try{const receipt=await store.request(token,call);res.status(receipt.state==="pending"?202:200).set("Cache-Control","no-store").json(receipt);}
    catch(error){res.status(error instanceof WebToolAccessError?error.status:503).set("Cache-Control","no-store").json({error:{message:error instanceof WebToolAccessError?error.message:"工具执行通道暂时不可用。"}});}
  });
  return {router,async close(){stopped=true;clearTimeout(timer);await tick;for(const job of active.values())job.controller.abort();await Promise.allSettled([...active.values()].map(job=>job.done));}};
}
