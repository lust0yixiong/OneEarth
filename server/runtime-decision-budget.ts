import {runtimeStepContext} from "./runtime-step";
export const evidenceDecisionLimits={modelCalls:8,acquisitions:2,locations:4,toolAttempts:6,milliseconds:110000} as const;
export const foregroundDecisionLimits={modelCalls:4,milliseconds:110000} as const;

/** Local decision expiry is distinct from user cancellation and never raises
 * the downstream tool or answer-generation allowance. */
export function decisionDeadline(parent:AbortSignal,milliseconds:number){
 const controller=new AbortController(),expiresAt=runtimeStepContext.getStore()?.budget(milliseconds)??Date.now()+milliseconds;
 const timer=setTimeout(()=>controller.abort(Error("有界取证判断达到时间预算。")),Math.max(0,expiresAt-Date.now()));
 const signal=AbortSignal.any([parent,controller.signal]);
 return {signal,remainingMs:()=>Math.max(0,expiresAt-Date.now()),
  async run<T>(action:(signal:AbortSignal)=>Promise<T>){
   if(Date.now()>=expiresAt&&!controller.signal.aborted)controller.abort(Error("有界取证判断达到时间预算。"));
   signal.throwIfAborted();let listener:()=>void=()=>{};
   try{return await Promise.race([action(signal),new Promise<never>((_,reject)=>{listener=()=>reject(signal.reason);signal.addEventListener("abort",listener,{once:true});if(signal.aborted)listener();})]);}
   finally{signal.removeEventListener("abort",listener);}
  },close(){clearTimeout(timer);}};
}
