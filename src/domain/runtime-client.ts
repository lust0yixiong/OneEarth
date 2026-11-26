import {readTaskLifecycle,type TaskLifecycle} from "./task-lifecycle-client";
import type {DiscoveryAttempt,DiscoveryResponse,Message} from "./types";
import {validBrowserWorkspaceReceipt,type BrowserWorkspaceReceipt,type WorkspaceReceipt,type WorkspaceRecoveryInput} from "./turn-context";

export const chatMessagesPath = "/api/chat/messages";

export async function cancelChatRequest(id:string,signal:AbortSignal) {
  const response=await fetch("/api/tasks/"+encodeURIComponent(id),{method:"DELETE",signal,redirect:"error"});
  if (response.status!==204 && response.status!==409) throw Error("暂时无法取消本轮，请重试。");
  return response.status===204;
}

export const researchRecordId = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

export function discoveryClarificationResult(result:Pick<DiscoveryResponse,"clarification"|"discoveryClarification"|"questionCheck">):boolean {
  return result.clarification===true && result.discoveryClarification===true && !result.questionCheck;
}

export function isClarificationAttempt(attempt:DiscoveryAttempt|undefined) {
  return !!(attempt?.nativeResume || attempt?.clarificationAnswer || attempt?.clarificationReply);
}

export function displayedChatMessages(messages:Message[], recoverable:ReadonlySet<string>) {
  const turns=new Set(messages.filter(m=>m.role==="user" && (m.clarificationAnswer || m.clarificationReply)).map(m=>m.id));
  const finished=new Set(messages.flatMap(m=>m.role==="assistant" && !m.failed && m.replyTo ? [m.replyTo] : []));
  const failure=new Map<string,string>();
  const isReplyFailure=(m:Message)=>m.role==="assistant" && m.failed && m.replyTo &&
    (turns.has(m.replyTo) || isClarificationAttempt(m.retry));
  for(const m of messages){
    if(!isReplyFailure(m))continue;
    const turn=m.replyTo!, current=failure.get(turn);
    if(!current || recoverable.has(m.id) && !recoverable.has(current))failure.set(turn,m.id);
  }
  return messages.filter(m=>!isReplyFailure(m) ||
    (!finished.has(m.replyTo!) && failure.get(m.replyTo!)===m.id));
}

export interface ResearchRecord {
  id:string;
  question:string;
  conversationId:string;
  turnId:string;
  created:number;
  updated:number;
  result:DiscoveryResponse;
  interrupt?:unknown;
  workspaceReceipt?:WorkspaceReceipt;
  taskLifecycle?:TaskLifecycle;
}

export async function loadResearchRecord(id:string,signal?:AbortSignal):Promise<ResearchRecord>{
  if(!researchRecordId.test(id))throw Error("研究记录编号无效。");
  const timeout=AbortSignal.timeout(10000);
  const response=await fetch("/api/tasks/"+id+"/record",{cache:"no-store",redirect:"error",
    signal:signal ? AbortSignal.any([signal,timeout]) : timeout});
  if(!response.ok)throw Error("没有找到已完成的研究记录。");
  const record:ResearchRecord=await response.json();
  if(record.id!==id||typeof record.question!=="string"||typeof record.conversationId!=="string"||
    typeof record.turnId!=="string"||typeof record.result?.message!=="string")throw Error("研究记录格式无效。");
  return {...record,taskLifecycle:readTaskLifecycle(record)};
}


export function readWorkspaceReceipt(receipt:WorkspaceReceipt|undefined,taskId:string,conversationId:string,turnId:string) {
  if(!receipt || receipt.taskId!==taskId || !Number.isFinite(receipt.reportedAt) || receipt.turnId!==turnId ||
    receipt.conversationId!==conversationId || receipt.effectId!=="workspace:"+taskId)return;
  const {taskId:_taskId,reportedAt:_reportedAt,observationReportedAt:_observationReportedAt,recovery,...wire}=receipt;
  if(recovery && (!["running","complete","failed"].includes(recovery.state) ||
    !Number.isSafeInteger(recovery.observedAt) || recovery.observedAt<=0 ||
    recovery.message!==undefined && typeof recovery.message!=="string"))return;
  return validBrowserWorkspaceReceipt(wire) ? receipt : undefined;
}

export async function reportWorkspaceReceipt(id:string,receipt:BrowserWorkspaceReceipt) {
  const res=await fetch(chatMessagesPath+"/"+encodeURIComponent(id)+"/workspace-receipt",{
    method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(receipt),signal:AbortSignal.timeout(8000),
  });
  const saved=res.ok ? await res.json().catch(()=>undefined) : undefined;
  return {settled:res.ok || res.status===400 || res.status===404 || res.status===409,
    receipt:readWorkspaceReceipt(saved,id,receipt.conversationId,receipt.turnId)};
}

export async function requestWorkspaceRecovery(id:string,input:WorkspaceRecoveryInput,signal:AbortSignal) {
  const res=await fetch(chatMessagesPath+"/"+encodeURIComponent(id)+"/workspace-recovery",{
    method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(input),signal,
  });
  if(!res.ok)return;
  return readWorkspaceReceipt(await res.json(),id,input.conversationId,input.turnId);
}
