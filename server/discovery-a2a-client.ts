import {setTimeout as delay} from "node:timers/promises";
import type {DataSearchResult} from "./data-search";
import type {DiscoveryInput, DiscoveryEvent} from "./discovery-contract";
import {TaskCancelled} from "./task-cancellation";
import {randomUUID} from "node:crypto";
import {paperId,validPaperRecord} from "../src/domain/paper-record";
import {paperQueryKind,paperResultKind,sourceReadKind,hainaCatalogQueryKind,hainaCatalogResultKind,sceneCatalogQueryKind,sceneCatalogResultKind,
  type HainaCatalogPage,type PaperQuery,type PaperQueryOutput,type SceneCatalogQuery,type SceneCatalogResult,type SourceReadInput,type SourceReadResult} from "./discovery-materials-contract";
import {validHainaRecord} from "../src/domain/haina-record";
import {webToolGrantPattern} from "./web-tool-contract";

export type MaterialEvent=DiscoveryEvent&{sourceReadResult?:SourceReadResult;sourceReadProgress?:Partial<SourceReadResult>};

export type DiscoveryBusinessInput = Omit<DiscoveryInput, "config"|"initialPlan"|"clarificationReply">;
export type DiscoveryClarificationInput={continuedFrom:string;clarificationReply:{text:string;afterSeq:number};runtimeWebToolGrant?:string};
export type DiscoveryA2AInput=DiscoveryBusinessInput|DiscoveryClarificationInput;
export type DiscoveryBinding = {
  transport:"a2a"; messageId:string; discoveryId:string; contextId?:string; state:string; lastSeq?:number;
};
export type DiscoveryA2AOptions = {
  onAccepted?:(binding:DiscoveryBinding)=>Promise<void>;
  onCheckpoint?:(binding:DiscoveryBinding)=>Promise<void>;
  onEvent?:(event:MaterialEvent)=>Promise<void>;
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
  if(input.runtimeWebToolGrant!==undefined&&!webToolGrantPattern.test(input.runtimeWebToolGrant))throw new DiscoveryA2AError("运行时工具委托授权无效。");
  if("clarificationReply" in input){
    const reply=input.clarificationReply;
    if(!identifier(input.continuedFrom)||!reply||typeof reply.text!=="string"||!reply.text.trim()||reply.text.length>4000||
      !Number.isSafeInteger(reply.afterSeq)||reply.afterSeq<0)throw new DiscoveryA2AError("澄清续行缺少原委托或有效等待水位。");
    return {continuedFrom:input.continuedFrom,clarificationReply:{text:reply.text,afterSeq:reply.afterSeq},...(input.runtimeWebToolGrant?{runtimeWebToolGrant:input.runtimeWebToolGrant}:{})};
  }
  const clean:Record<string,unknown>={};
  for(const key of ["query","decision","continuedFrom","continuation","researchGoal","evidenceGap","runtimeWebToolGrant",
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

function directMessageData(receipt: unknown, status: number, kind: string) {
  const message = object(receipt) ? receipt.message : undefined;
  if (status!==200 || !object(receipt) || receipt.task!==undefined || receipt.error!==undefined || !object(message) ||
    message.role!=="ROLE_AGENT" || !identifier(message.messageId) || !identifier(message.contextId) ||
    message.taskId!==undefined || !Array.isArray(message.parts) || message.parts.length!==1)
    throw new DiscoveryA2AError("发现服务没有返回带有效上下文的 A2A Message。");
  const data = message.parts[0]?.data;
  if (!object(data) || data.kind!==kind)
    throw new DiscoveryA2AError("发现服务返回的查询成果类型不匹配。");
  return data;
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
function artifactEvent(value:unknown):{id:string;event:MaterialEvent;fingerprint:string}|undefined{
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
  return taskThroughA2A(messageId,{kind:"oneearth.discovery.request.v1",input:discoveryBusinessInput(input)},event=>{
    if(event.sourceReadResult||event.sourceReadProgress)throw new DiscoveryA2AError("开放发现不能混入其他受托业务的材料。");
    return event.result;
  },signal,emit,options,cancellation);
}

async function taskThroughA2A<Result>(messageId:string,data:{kind:string;input:unknown},resultFrom:(event:MaterialEvent)=>Result|undefined,
  signal:AbortSignal,emit:(event:MaterialEvent)=>void,options:DiscoveryA2AOptions={},cancellation?:ReturnType<typeof discoveryA2ACancellation>):Promise<Result>{
  signal.throwIfAborted();
  if(!identifier(messageId))throw new DiscoveryA2AError("发现委托的消息身份无效。");
  const base=process.env.ONEEARTH_DISCOVERY_URL||"http://127.0.0.1:5275";
  const body=JSON.stringify({message:{messageId,role:"ROLE_USER",
    ...(options.target?{taskId:options.target.discoveryId,...(options.target.contextId?{contextId:options.target.contextId}:{})}:{}),
    parts:[{data}]},configuration:{returnImmediately:true}});
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
    try{await options.onAccepted?.({...binding});}
    catch{throw new DiscoveryA2AError("发现受理身份未能写入运行时归档。",false,undefined,"RUNTIME_PERSISTENCE_FAILED");}
    signal.throwIfAborted();

    const seen=new Map<number,{id:string;fingerprint:string}>(),ids=new Map<string,number>();
    let result:Result|undefined,remoteError:string|undefined,lastSeq=options.afterSeq??0;
    if(!Number.isSafeInteger(lastSeq)||lastSeq<0)throw new DiscoveryA2AError("已存发现事件序号无效。");
    async function consume(artifacts:unknown[]){
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
        const delivered=resultFrom(entry.event);if(delivered!==undefined)result=delivered;
        if(entry.event.error)remoteError=entry.event.error;
        try{await options.onEvent?.(entry.event);}
        catch{throw new DiscoveryA2AError("已取得的受托材料未能写入运行时归档。",false,undefined,"RUNTIME_PERSISTENCE_FAILED");}
        emit(entry.event);
      }
    }
    async function snapshot(value:unknown){
      const current=task(value,binding!);binding!.state=current.status.state;
      if(binding!.contextId===undefined&&current.contextId!==undefined)binding!.contextId=current.contextId;
      await consume(current.artifacts||[]);
      if(terminal.has(binding!.state))submission.terminal();
    }
    async function complete(strict=false):Promise<Result|undefined>{
      if(!terminal.has(binding!.state)&&!interrupted.has(binding!.state))return;
      if(result){
        try{await options.onCheckpoint?.({...binding!,lastSeq});}
        catch{throw new DiscoveryA2AError("发现消费水位未能写入运行时归档。",false,undefined,"RUNTIME_PERSISTENCE_FAILED");}
        submission.terminal();return result;
      }
      if(strict)throw new DiscoveryA2AError(remoteError||"发现任务已结束或等待输入，但没有可恢复的发现结果（"+binding!.state+"）。");
    }
    await snapshot(accepted);
    let ready=await complete();if(ready)return ready;
    for(let attempt=0;attempt<=3;attempt++){
      try{
        await snapshot(await getTask(base,binding,signal));
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
          if(frame.task)await snapshot(frame.task);
          else if(frame.artifactUpdate){
            const update=frame.artifactUpdate;
            if(update.taskId!==binding.discoveryId||!identifier(update.contextId)||
              (binding.contextId!==undefined&&update.contextId!==binding.contextId)||update.append||update.lastChunk===false)
              throw new DiscoveryA2AError("发现产物更新的任务归属或分块语义无效。");
            binding.contextId??=update.contextId;
            await consume([update.artifact]);
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

function paperQuery(input:PaperQuery):PaperQuery{
  switch(input.operation){
    case "records":
      if(!Array.isArray(input.ids)||!input.ids.length||input.ids.length>20||!input.ids.every(paperId))break;
      return {operation:"records",ids:[...input.ids]};
    case "list":
      if(!["full","catalog","map"].includes(input.view)||typeof input.cursor!=="string"||input.cursor.length>1000||!Number.isInteger(input.limit)||input.limit<1||input.limit>500)break;
      return {operation:"list",view:input.view,cursor:input.cursor,limit:input.limit};
    case "questions":
      if(!paperId(input.id)||typeof input.cursor!=="string"||input.cursor.length>3000)break;
      return {operation:"questions",id:input.id,cursor:input.cursor};
    case "evidence":if(paperId(input.id))return {operation:"evidence",id:input.id};break;
    case "search":if(typeof input.query==="string"&&input.query.trim()&&input.query.trim().length<=240)return {operation:"search",query:input.query.trim()};
  }
  throw new DiscoveryA2AError("纸本查询参数无效。");
}
function paperValue(input:PaperQuery,value:unknown):boolean{
  const records=(v:unknown)=>Array.isArray(v)&&v.every(validPaperRecord);
  const cursor=(v:unknown)=>v===null||typeof v==="string";
  if(input.operation==="records")return records(value)&&(value as {id:string}[]).every(r=>input.ids.includes(r.id));
  if(!object(value))return false;
  if(input.operation==="list")return records(value.records)&&cursor(value.nextCursor)&&Number.isSafeInteger(value.total)&&value.total>=0&&
    typeof value.cached==="boolean"&&object(value.catalog)&&typeof value.catalog.complete==="boolean";
  if(input.operation==="search")return records(value.records)&&typeof value.cached==="boolean"&&
    (value.incomplete===undefined||(Array.isArray(value.incomplete)&&value.incomplete.every((v:unknown)=>typeof v==="string")));
  if(input.operation==="questions")return Array.isArray(value.items)&&cursor(value.nextCursor)&&value.items.every((q:any)=>
    object(q)&&["paperId","rqId","datasetId","paperTitle","question"].every(k=>typeof q[k]==="string"));
  return (value.dataset===null||object(value.dataset))&&Array.isArray(value.papers);
}

/** Deterministic catalogue reads are direct Messages, never a model or a delegated Task. */
export async function queryPapers<Q extends PaperQuery>(input:Q,signal:AbortSignal):Promise<PaperQueryOutput[Q["operation"]]>{
  const clean=paperQuery(input),messageId=randomUUID();
  const deadline=AbortSignal.any([signal,AbortSignal.timeout(clean.operation==="search"?35000:12000)]);
  const body=JSON.stringify({message:{messageId,role:"ROLE_USER",parts:[{data:{kind:paperQueryKind,input:clean}}]}});
  const base=process.env.ONEEARTH_DISCOVERY_URL||"http://127.0.0.1:5275";
  for(let attempt=0;;attempt++){
    try{
      const response=await fetch(new URL("/message:send",base),{method:"POST",headers,body,signal:deadline,redirect:"error"});
      const data=directMessageData(await json(response),response.status,paperResultKind);
      if(data.operation!==clean.operation||!paperValue(clean,data.value))
        throw new DiscoveryA2AError("纸本查询响应的种类、操作或材料身份无效。");
      return data.value;
    }catch(error){
      signal.throwIfAborted();
      if(deadline.aborted)throw new DiscoveryA2AError("发现服务纸本查询在时限内未返回。",false,503);
      // Search can publish newly retrieved records: an uncertain direct response
      // has no accepted Task identity that would authorize repeating that work.
      if(clean.operation==="search"||attempt>=2||(error instanceof DiscoveryA2AError&&!error.retryable))throw error;
    }
  }
}

/** Read only the exact selected sources; the independent provider owns all fetching/parsing. */
export async function readSourcesThroughA2A(messageId:string,input:SourceReadInput,signal:AbortSignal,
  emit:(event:MaterialEvent)=>void,options:DiscoveryA2AOptions={},cancellation?:ReturnType<typeof discoveryA2ACancellation>):Promise<SourceReadResult>{
  if(typeof input.question!=="string"||!input.question.trim()||input.question.length>4000||!Array.isArray(input.targets)||
    !input.targets.length||input.targets.length>3||(input.deepseekFetch!==undefined&&typeof input.deepseekFetch!=="boolean"))
    throw new DiscoveryA2AError("精确补读需要原问题和一至三个明确来源。");
  const targets=input.targets.map(target=>{
    if(target.kind==="paper"&&paperId(target.id))return {kind:"paper" as const,id:target.id};
    if(target.kind==="web"&&typeof target.url==="string"&&target.url.length<=2000&&typeof target.title==="string"&&target.title.length<=360&&
      (target.discoveredBy===undefined||["user","assistant"].includes(target.discoveredBy))){
      try{const url=new URL(target.url);if(!["http:","https:"].includes(url.protocol)||url.username||url.password)throw Error();}
      catch{throw new DiscoveryA2AError("精确补读的来源地址无效。");}
      return {kind:"web" as const,url:target.url,title:target.title,...(target.discoveredBy?{discoveredBy:target.discoveredBy}:{})};
    }
    throw new DiscoveryA2AError("精确补读的来源身份无效。");
  });
  if(options.target||options.afterSeq!==undefined)throw new DiscoveryA2AError("新的精确补读不能冒用其他受托任务。");
  if(input.runtimeWebToolGrant!==undefined&&!webToolGrantPattern.test(input.runtimeWebToolGrant))throw new DiscoveryA2AError("运行时补读授权无效。");
  return taskThroughA2A(messageId,{kind:sourceReadKind,input:{question:input.question,targets,
    ...(input.runtimeWebToolGrant?{runtimeWebToolGrant:input.runtimeWebToolGrant}:{}),
    ...(input.deepseekFetch!==undefined?{deepseekFetch:input.deepseekFetch}:{})}},event=>{
    if(event.result)throw new DiscoveryA2AError("精确补读不能使用开放发现结果冒充材料。");
    const urls=new Set(targets.flatMap(t=>t.kind==="web"?[t.url]:[])),ids=new Set(targets.flatMap(t=>t.kind==="paper"?[t.id]:[]));
    function validate(value:unknown,partial=false){
      if(!object(value)||(!partial&&!["searches","papers","issues"].every(key=>Array.isArray(value[key])))||
        (value.issues!==undefined&&(!Array.isArray(value.issues)||!value.issues.every((v:unknown)=>typeof v==="string")))||
        (value.papers!==undefined&&(!Array.isArray(value.papers)||!value.papers.every((p:any)=>validPaperRecord(p)&&!p.catalogSummary&&ids.has(p.id))))||
        (value.searches!==undefined&&(!Array.isArray(value.searches)||!value.searches.every((run:any)=>object(run)&&typeof run.engine==="string"&&
          ["done","partial","failed"].includes(run.status)&&urls.has(run.query)&&Array.isArray(run.hits)&&run.hits.every((hit:any)=>object(hit)&&
          typeof hit.url==="string"&&typeof hit.title==="string"&&typeof hit.snippet==="string"))))||
        (value.paperEvidence!==undefined&&(!Array.isArray(value.paperEvidence)||!value.paperEvidence.every((item:any)=>object(item)&&ids.has(item.id)&&
          typeof item.readAt==="string"&&Number.isFinite(Date.parse(item.readAt))&&object(item.evidence)&&Array.isArray(item.evidence.papers)))))
        throw new DiscoveryA2AError("精确补读材料缺少有效来源或越过已委托对象。");
    }
    if(event.sourceReadProgress!==undefined)validate(event.sourceReadProgress,true);
    if(event.searches!==undefined)validate({searches:event.searches.filter(run=>run.status==="done")},true);
    const value=event.sourceReadResult;
    if(value!==undefined)validate(value);
    return value;
  },signal,emit,options,cancellation);
}

/** Called only for an explicit current-catalogue view, never to hydrate an old research answer. */
export async function queryHainaCatalog(cursor:number,limit:number,signal:AbortSignal):Promise<HainaCatalogPage>{
  if(!Number.isSafeInteger(cursor)||cursor<0||!Number.isSafeInteger(limit)||limit<1||limit>250)
    throw new DiscoveryA2AError("海纳目录分页参数无效。",false,400);
  const deadline=AbortSignal.any([signal,AbortSignal.timeout(12000)]),messageId=randomUUID();
  const body=JSON.stringify({message:{messageId,role:"ROLE_USER",parts:[{data:{kind:hainaCatalogQueryKind,input:{cursor,limit}}}]}});
  const base=process.env.ONEEARTH_DISCOVERY_URL||"http://127.0.0.1:5275";
  for(let attempt=0;;attempt++){
    try{
      const response=await fetch(new URL("/message:send",base),{method:"POST",headers,body,signal:deadline,redirect:"error"});
      const value=directMessageData(await json(response),response.status,hainaCatalogResultKind).value;
      if(!object(value)||!Array.isArray(value.records)||value.records.length>limit||
        !value.records.every(validHainaRecord)||new Set(value.records.map((r:any)=>r.id)).size!==value.records.length||
        value.records.some((r:any,i:number)=>r.id<=(i?value.records[i-1].id:cursor))||
        !Number.isSafeInteger(value.total)||value.total<value.records.length||value.complete!==true||
        !(value.nextCursor===null||(Number.isSafeInteger(value.nextCursor)&&value.nextCursor>cursor&&value.nextCursor===value.records.at(-1)?.id))||
        typeof value.synced!=="string"||!Number.isFinite(Date.parse(value.synced))||typeof value.endpoint!=="string"||typeof value.areaId!=="string"||
        typeof value.warning!=="string"||typeof value.refreshing!=="boolean")
        throw new DiscoveryA2AError("发现服务没有返回有效的海纳目录快照分页。");
      return value as HainaCatalogPage;
    }catch(error){
      signal.throwIfAborted();if(deadline.aborted)throw new DiscoveryA2AError("发现服务海纳目录查询在时限内未返回。",false,503);
      if(attempt>=2||(error instanceof DiscoveryA2AError&&!error.retryable))throw error;
    }
  }
}

/** Query the explicitly selected STAC collections; result rows are scoped to that query. */
export async function querySceneCatalogue(input: SceneCatalogQuery, signal: AbortSignal): Promise<SceneCatalogResult> {
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(12_000)]);
  const base = process.env.ONEEARTH_DISCOVERY_URL || "http://127.0.0.1:5275";
  const body = JSON.stringify({message:{messageId:randomUUID(),role:"ROLE_USER",
    parts:[{data:{kind:sceneCatalogQueryKind,input}}]}});
  const response = await fetch(new URL("/message:send",base), {method:"POST",headers,body,signal:deadline,redirect:"error"});
  const value = directMessageData(await json(response),response.status,sceneCatalogResultKind).value;
  if (!object(value) || !Array.isArray(value.lookups) || !Array.isArray(value.failures))
    throw new DiscoveryA2AError("影像目录结果缺少实际状态。");

  const remaining = new Set<string>(input.assetIds);
  const validUrl = (v: unknown) => {
    const url = typeof v === "string" ? URL.parse(v) : null;
    return url && ["https:", "http:"].includes(url.protocol) && !url.username && !url.password;
  };
  const requested = (item: unknown) => object(item) && remaining.delete(item.assetId) && validUrl(item.url);
  const samePair = (a: unknown, b: [number, number] | undefined) =>
    b ? Array.isArray(a) && a.length === 2 && a[0] === b[0] && a[1] === b[1] : a === undefined;
  if (!value.lookups.every(result => requested(result) &&
    samePair(result.point,input.point) && samePair(result.years,input.years) && samePair(result.utcWindow,input.utcWindow) &&
    Number.isSafeInteger(result.matched) && result.matched>=0 && Number.isFinite(Date.parse(result.checkedAt)) &&
    Array.isArray(result.items) && result.items.length===Math.min(5,result.matched) &&
    result.items.every((item: unknown) => object(item) && identifier(item.id) &&
      typeof item.datetime==="string" && Number.isFinite(Date.parse(item.datetime)) &&
      (item.cloud===null || Number.isFinite(item.cloud)) && validUrl(item.url)) &&
    new Set(result.items.map((item: {id:string})=>item.id)).size===result.items.length) ||
    !value.failures.every(requested) || remaining.size)
    throw new DiscoveryA2AError("影像目录结果与已委托的集合、点和时段不一致。");
  return value as SceneCatalogResult;
}
