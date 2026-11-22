import {setTimeout as delay} from "node:timers/promises";
import type {DataSearchResult} from "./data-search";
import type {DiscoveryInput, DiscoveryEvent} from "./discovery-contract";
import {TaskCancelled} from "./task-cancellation";

export type DiscoveryBusinessInput = Omit<DiscoveryInput, "config"|"initialPlan"|"clarificationReply">;
export type DiscoveryClarificationInput={continuedFrom:string;clarificationReply:{text:string;afterSeq:number}};
export type DiscoveryA2AInput=DiscoveryBusinessInput|DiscoveryClarificationInput;
export type DiscoveryBinding = {
  transport:"a2a"; messageId:string; discoveryId:string; contextId?:string; state:string; lastSeq?:number;
};
export type DiscoveryA2AOptions = {
  onAccepted?:(binding:DiscoveryBinding)=>Promise<void>;
  onCheckpoint?:(binding:DiscoveryBinding)=>Promise<void>;
  target?:Pick<DiscoveryBinding,"discoveryId"|"contextId">;
  afterSeq?:number;
};
type Task = {id:string; contextId?:string; status:{state:string}; artifacts?:unknown[]};
const states = new Set(["UNSPECIFIED","SUBMITTED","WORKING","COMPLETED","FAILED","CANCELED","INPUT_REQUIRED","REJECTED","AUTH_REQUIRED"].map(s=>"TASK_STATE_"+s));
const terminal = new Set(["COMPLETED","FAILED","CANCELED","REJECTED"].map(s=>"TASK_STATE_"+s));
const interrupted = new Set(["TASK_STATE_INPUT_REQUIRED","TASK_STATE_AUTH_REQUIRED"]);
const headers = {"A2A-Version":"1.0","Content-Type":"application/a2a+json",Accept:"application/a2a+json"};
const object = (v:unknown):v is Record<string,any>=>!!v&&typeof v==="object"&&!Array.isArray(v);
const identifier = (v:unknown):v is string=>typeof v==="string"&&!!v.trim()&&v.length<=1200;

export class DiscoveryA2AError extends Error {
  constructor(message:string, readonly retryable=false, readonly status?:number, readonly reason?:string) {super(message);}
}

/** Only the authorized business envelope crosses the independent service boundary. */
export function discoveryBusinessInput(input:DiscoveryA2AInput):DiscoveryA2AInput {
  if("clarificationReply" in input){
    const reply=input.clarificationReply;
    if(!identifier(input.continuedFrom)||!reply||typeof reply.text!=="string"||!reply.text.trim()||reply.text.length>4000||
      !Number.isSafeInteger(reply.afterSeq)||reply.afterSeq<0)throw new DiscoveryA2AError("澄清续行缺少原委托或有效等待水位。");
    return {continuedFrom:input.continuedFrom,clarificationReply:{text:reply.text,afterSeq:reply.afterSeq}};
  }
  const clean:Record<string,unknown>={};
  for(const key of ["query","decision","continuedFrom","continuation","researchGoal","evidenceGap",
    "conversationContext","previousResearchIntent","history","references","scope","currentDatasets","conversationEvidence"] as const)
    if(input[key]!==undefined)clean[key]=input[key];
  if(input.deepseekTools!==undefined){
    const {search,fetch}=input.deepseekTools;
    if(typeof search!=="boolean"||typeof fetch!=="boolean")throw new DiscoveryA2AError("本次发现的网页工具授权无效。");
    clean.deepseekTools={search,fetch};
  }
  return clean as DiscoveryBusinessInput;
}

function task(value:unknown, expected?:Pick<DiscoveryBinding,"discoveryId"|"contextId">):Task {
  if(!object(value)||!identifier(value.id)||!object(value.status)||!states.has(value.status.state)||
    (value.contextId!==undefined&&!identifier(value.contextId))||
    (value.artifacts!==undefined&&!Array.isArray(value.artifacts))||
    (expected&&(value.id!==expected.discoveryId||(expected.contextId!==undefined&&value.contextId!==expected.contextId))))
    throw new DiscoveryA2AError("发现服务返回了无效或不匹配的 A2A Task。");
  return value as Task;
}
async function json(response:Response):Promise<any> {
  if(!response.headers.get("content-type")?.split(";")[0].trim().match(/^application\/(?:a2a\+)?json$/i))
    throw new DiscoveryA2AError("发现服务没有返回 A2A JSON。");
  let value:any;
  try{value=await response.json();}catch{throw new DiscoveryA2AError("发现服务的 A2A JSON 不完整。",true,response.status);}
  if(!response.ok){
    const error=object(value?.error)?value.error:value;
    const detail=Array.isArray(error?.details)?error.details.find((d:any)=>d?.domain==="a2a-protocol.org"):undefined;
    throw new DiscoveryA2AError(typeof error?.message==="string"?error.message:"发现服务请求失败（HTTP "+response.status+"）。",
      response.status>=500||response.status===408||response.status===429,response.status,detail?.reason);
  }
  return value;
}
async function getTask(base:string,binding:Pick<DiscoveryBinding,"discoveryId"|"contextId">,signal:AbortSignal){
  const response=await fetch(new URL("/tasks/"+encodeURIComponent(binding.discoveryId),base),{headers,signal,redirect:"error"});
  return task(await json(response),binding);
}

/** A stale card cannot wake a later wait within the same external Task. */
export async function assertDiscoveryWaiting(binding:Pick<DiscoveryBinding,"discoveryId"|"contextId">,afterSeq:number,signal:AbortSignal){
  const current=await getTask(process.env.ONEEARTH_DISCOVERY_URL||"http://127.0.0.1:5275",binding,signal);
  if(current.status.state!=="TASK_STATE_INPUT_REQUIRED")throw new DiscoveryA2AError("原发现委托已不在等待这次补充，请查看当前研究记录。");
  const results=(current.artifacts||[]).map(artifactEvent).filter(v=>v?.event.result);
  const latest=results.length?Math.max(...results.map(v=>v!.event.seq!)):undefined;
  if(!Number.isSafeInteger(afterSeq)||afterSeq<0||latest!==afterSeq)
    throw new DiscoveryA2AError("原澄清的等待水位已变化或无法重开，请使用当前待补充记录。");
}
async function cancelTask(base:string,binding:DiscoveryBinding) {
  const deadline=AbortSignal.timeout(3000);
  let last="unreachable";
  for(let attempt=0;!deadline.aborted;attempt++){
    try{
      const response=await fetch(new URL("/tasks/"+encodeURIComponent(binding.discoveryId)+":cancel",base),
        {method:"POST",headers,body:"{}",signal:deadline,redirect:"error"});
      const stopped=task(await json(response),binding);
      if(terminal.has(stopped.status.state))return;
      last=stopped.status.state;
    }catch(error){
      if(error instanceof DiscoveryA2AError){
        last=error.reason||"HTTP "+error.status;
        // Completion racing cancellation is resolved only against the known Task.
        if(error.reason==="TASK_NOT_CANCELABLE"){
          try{if(terminal.has((await getTask(base,binding,deadline)).status.state))return;}catch{}
        }
      }
    }
    try{await delay(Math.min(100*2**attempt,500),undefined,{signal:deadline});}catch{break;}
  }
  console.error("OneEarth discovery cancellation unconfirmed: "+binding.discoveryId+" ("+last+")");
}

export function discoveryA2ACancellation(signal:AbortSignal){
  const unfinished=new Map<string,{base:string;binding?:DiscoveryBinding}>();
  let cancellation:Promise<void>|undefined;
  const cancel=()=>{
    if(signal.reason instanceof TaskCancelled)cancellation??=Promise.all([...unfinished].map(([messageId,entry])=>{
      if(entry.binding)return cancelTask(entry.base,entry.binding);
      console.error("OneEarth discovery cancellation unconfirmed: "+messageId+" (submission not acknowledged)");
    })).then(()=>{});
  };
  signal.addEventListener("abort",cancel,{once:true});
  return {
    track(messageId:string,base:string){
      signal.throwIfAborted();
      const entry:{base:string;binding?:DiscoveryBinding}={base};
      unfinished.set(messageId,entry);
      return {
        accept(binding:DiscoveryBinding){signal.throwIfAborted();entry.binding=binding;},
        terminal(){unfinished.delete(messageId);},
      };
    },
    async settled(){await cancellation;},
    async close(){signal.removeEventListener("abort",cancel);await cancellation;unfinished.clear();},
  };
}

function canonical(value:any):string {
  return JSON.stringify(value,(_key,v)=>object(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
}
function artifactEvent(value:unknown):{id:string;event:DiscoveryEvent;fingerprint:string}|undefined{
  if(!object(value)||!identifier(value.artifactId)||!Array.isArray(value.parts)||!value.parts.length)
    throw new DiscoveryA2AError("发现服务返回了无效的证据产物。");
  const parts=value.parts.filter((p:any)=>object(p?.data)&&p.data.kind==="oneearth.discovery.event.v1");
  if(!parts.length)return;
  if(parts.length!==1)throw new DiscoveryA2AError("一个发现事件产物必须对应一条归档事件。");
  const event=parts[0].data.event;
  if(!object(event)||!Number.isSafeInteger(event.seq)||event.seq<0||
    (event.error!==undefined&&typeof event.error!=="string")||
    (event.result!==undefined&&(!object(event.result)||!object(event.result.plan)||
      !["papers","haina","searches","sourceStatus","issues"].every(k=>Array.isArray(event.result[k])))))
    throw new DiscoveryA2AError("发现证据产物缺少有效的归档事件或序号。");
  return {id:value.artifactId,event,fingerprint:canonical(event)};
}

async function* sse(response:Response):AsyncGenerator<unknown>{
  if(!response.body||response.headers.get("content-type")?.split(";")[0].trim()!=="text/event-stream")
    throw new DiscoveryA2AError("发现服务未返回 A2A SSE 进展。");
  const reader=response.body.pipeThrough(new TextDecoderStream()).getReader();
  let pending="",data:string[]=[];
  try{
    for(;;){
      const {value,done}=await reader.read();
      if(done)return;
      pending+=value;
      if(pending.length+data.reduce((n,s)=>n+s.length,0)>16*1024*1024)throw new DiscoveryA2AError("发现 SSE 帧超过限制。");
      let newline:number;
      while((newline=pending.indexOf("\n"))>=0){
        const line=pending.slice(0,newline).replace(/\r$/,"");pending=pending.slice(newline+1);
        if(!line){
          if(data.length){
            let frame:unknown;
            try{frame=JSON.parse(data.join("\n"));}catch{throw new DiscoveryA2AError("发现 SSE 事件不是有效 JSON。");}
            data=[];yield frame;
          }
        }else if(line.startsWith("data:"))data.push(line.slice(5).replace(/^ /,""));
      }
    }
  }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}

export async function discoverThroughA2A(messageId:string,input:DiscoveryA2AInput,signal:AbortSignal,
  emit:(event:DiscoveryEvent)=>void,options:DiscoveryA2AOptions={},cancellation?:ReturnType<typeof discoveryA2ACancellation>):Promise<DataSearchResult>{
  signal.throwIfAborted();
  if(!identifier(messageId))throw new DiscoveryA2AError("发现委托的消息身份无效。");
  if(options.target){
    if(options.afterSeq===undefined)throw new DiscoveryA2AError("同一发现委托续行需要已存等待水位。");
  }
  if("clarificationReply" in input){
    const reply=input.clarificationReply;
    if(!reply||!options.target||options.target.discoveryId!==input.continuedFrom||options.afterSeq!==reply.afterSeq)
      throw new DiscoveryA2AError("澄清续行必须使用同一已受理发现任务及已存等待水位。");
  }
  const base=process.env.ONEEARTH_DISCOVERY_URL||"http://127.0.0.1:5275";
  const body=JSON.stringify({message:{messageId,role:"ROLE_USER",
    ...(options.target?{taskId:options.target.discoveryId,...(options.target.contextId?{contextId:options.target.contextId}:{})}:{}),
    parts:[{data:{kind:"oneearth.discovery.request.v1",input:discoveryBusinessInput(input)}}]},configuration:{returnImmediately:true}});
  const delegations=cancellation??discoveryA2ACancellation(signal),submission=delegations.track(messageId,base);
  let binding:DiscoveryBinding|undefined;
  try{
    let accepted:Task|undefined;
    for(let attempt=0;attempt<3;attempt++){
      try{
        const response=await fetch(new URL("/message:send",base),{method:"POST",headers,body,signal,redirect:"error"});
        if(response.status>=400&&response.status<500)submission.terminal();
        const receipt=await json(response);
        if(response.status!==200||!object(receipt)||!receipt.task||receipt.message||receipt.error)
          throw new DiscoveryA2AError("发现服务没有返回有效的 A2A 任务受理确认。");
        accepted=task(receipt.task,options.target);break;
      }catch(error){
        signal.throwIfAborted();
        if(attempt===2||(error instanceof DiscoveryA2AError&&!error.retryable))throw error;
      }
    }
    if(!accepted)throw new DiscoveryA2AError("发现任务尚未确认受理。");
    binding={transport:"a2a",messageId,discoveryId:accepted.id,...(accepted.contextId?{contextId:accepted.contextId}:{}),state:accepted.status.state};
    submission.accept(binding);
    if(terminal.has(binding.state))submission.terminal();
    await options.onAccepted?.({...binding});
    signal.throwIfAborted();

    const seen=new Map<number,{id:string;fingerprint:string}>(),ids=new Map<string,number>();
    let result:DataSearchResult|undefined,remoteError:string|undefined,lastSeq=options.afterSeq??0;
    if(!Number.isSafeInteger(lastSeq)||lastSeq<0)throw new DiscoveryA2AError("已存发现事件序号无效。");
    function consume(artifacts:unknown[]){
      const entries=artifacts.map(artifactEvent).filter((v):v is NonNullable<typeof v>=>!!v).sort((a,b)=>a.event.seq!-b.event.seq!);
      for(const entry of entries){
        const seq=entry.event.seq!;
        if(seq<=(options.afterSeq??-1))continue;
        const previous=seen.get(seq),oldSeq=ids.get(entry.id);
        if(previous){
          if(previous.id!==entry.id||previous.fingerprint!==entry.fingerprint)throw new DiscoveryA2AError("已归档的发现事件发生冲突。");
          continue;
        }
        if(oldSeq!==undefined&&oldSeq!==seq)throw new DiscoveryA2AError("发现产物身份被用于不同事件。");
        seen.set(seq,entry);ids.set(entry.id,seq);lastSeq=Math.max(lastSeq,seq);
        if(entry.event.result)result=entry.event.result;
        if(entry.event.error)remoteError=entry.event.error;
        emit(entry.event);
      }
    }
    function snapshot(value:unknown){
      const current=task(value,binding!);binding!.state=current.status.state;
      if(binding!.contextId===undefined&&current.contextId!==undefined)binding!.contextId=current.contextId;
      consume(current.artifacts||[]);
      if(terminal.has(binding!.state))submission.terminal();
    }
    async function complete(strict=false):Promise<DataSearchResult|undefined>{
      if(!terminal.has(binding!.state)&&!interrupted.has(binding!.state))return;
      if(result){
        await options.onCheckpoint?.({...binding!,lastSeq});
        submission.terminal();return result;
      }
      if(strict)throw new DiscoveryA2AError(remoteError||"发现任务已结束或等待输入，但没有可恢复的发现结果（"+binding!.state+"）。");
    }
    snapshot(accepted);
    let ready=await complete();if(ready)return ready;
    for(let attempt=0;attempt<=3;attempt++){
      try{
        snapshot(await getTask(base,binding,signal));
        ready=await complete(true);if(ready)return ready;
        if(attempt===3)break;
        const response=await fetch(new URL("/tasks/"+encodeURIComponent(binding.discoveryId)+":subscribe",base),
          {method:"POST",headers:{...headers,Accept:"text/event-stream"},body:"{}",signal,redirect:"error"});
        if(!response.ok)await json(response);
        let first=true;
        for await(const frame of sse(response)){
          if(!object(frame))throw new DiscoveryA2AError("发现 SSE 帧不是协议对象。");
          if(first&&!frame.task)throw new DiscoveryA2AError("发现订阅首帧缺少 Task 快照。");
          first=false;
          if(frame.task)snapshot(frame.task);
          else if(frame.artifactUpdate){
            const update=frame.artifactUpdate;
            if(update.taskId!==binding.discoveryId||!identifier(update.contextId)||
              (binding.contextId!==undefined&&update.contextId!==binding.contextId)||update.append||update.lastChunk===false)
              throw new DiscoveryA2AError("发现产物更新的任务归属或分块语义无效。");
            binding.contextId??=update.contextId;
            consume([update.artifact]);
          }else if(frame.statusUpdate){
            const update=frame.statusUpdate;
            if(update.taskId!==binding.discoveryId||!identifier(update.contextId)||
              (binding.contextId!==undefined&&update.contextId!==binding.contextId)||!states.has(update.status?.state))
              throw new DiscoveryA2AError("发现任务状态更新的归属无效。");
            binding.contextId??=update.contextId;
            binding.state=update.status.state;
            if(terminal.has(binding.state))submission.terminal();
          }else throw new DiscoveryA2AError("发现 SSE 帧不包含任务、状态或证据产物。");
          ready=await complete();if(ready)return ready;
          if(terminal.has(binding.state)||interrupted.has(binding.state))break;
        }
      }catch(error){
        signal.throwIfAborted();
        // A terminal task may reject subscribe between GET and subscription.
        if(error instanceof DiscoveryA2AError&&!error.retryable&&error.reason!=="UNSUPPORTED_OPERATION")throw error;
        if(attempt===3)throw error;
      }
    }
    throw new DiscoveryA2AError("发现进展暂时无法接回。已取得的材料和受理身份已保留，请明确重试未完成的工作。");
  }finally{
    if(cancellation)await delegations.settled();else await delegations.close();
  }
}
