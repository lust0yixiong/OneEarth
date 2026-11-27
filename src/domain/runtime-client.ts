import {matchesTaskIdentity,readTaskLifecycle,type TaskLifecycle} from "./task-lifecycle-client";
import type {DiscoveryAttempt,DiscoveryResponse,Message,RunTrace} from "./types";
import {validBrowserWorkspaceReceipt,type BrowserWorkspaceReceipt,type WorkspaceReceipt} from "./turn-context";

import {workspaceToolCallId,workspaceToolReceiptPath} from "./native-workspace-tool";
import {samePublishedRaster} from "./published-raster-observation";
import {archivedNativeSummaries} from "./native-summary-client";
import {workspaceObservationTarget} from "./workspace-published-layer";

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
  workspaceTool?:unknown;
  workspaceReceipt?:WorkspaceReceipt;
  taskLifecycle?:TaskLifecycle;
  researchProgress?:unknown;
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


/** Project the saved stages, public reasoning summaries and invocation summaries. */
export function readArchivedChatTrace(record:ResearchRecord,identity:{id:string;conversationId:string;turnId:string},text:string):RunTrace|undefined {
  if(!matchesTaskIdentity(record,identity) || record.result.message!==text)return;
  const trace=record.result.runTrace;
  if(!trace || !Number.isFinite(trace.started))return;
  const stages=(Array.isArray(trace.stages)?trace.stages:[]).filter((stage):stage is string=>
    typeof stage==="string" && !!stage.trim());
  const calls=(Array.isArray(trace.calls)?trace.calls:[]).flatMap(call=>
    call && typeof call.id==="string" && typeof call.name==="string" && !!call.name.trim() &&
      (call.kind==="Skill" || call.kind==="MCP" || call.kind==="tool") &&
      (call.status==="done" || call.status==="partial" || call.status==="failed")
      ? [{id:call.id,kind:call.kind,name:call.name,status:call.status,input:""}] : []);
  const providerReasoning=archivedNativeSummaries(identity.id,trace.providerReasoning);
  if(stages.length || calls.length || providerReasoning.length)
    return {started:trace.started,stages,calls,...(providerReasoning.length ? {providerReasoning} : {})};
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

export function readRecordWorkspaceReceipt(record:ResearchRecord) {
  const receipt=readWorkspaceReceipt(record.workspaceReceipt,record.id,record.conversationId,record.turnId);
  if(receipt?.observation && !samePublishedRaster(receipt.observation,workspaceObservationTarget(record.result)))return;
  return receipt;
}

export async function reportWorkspaceReceipt(id:string,receipt:BrowserWorkspaceReceipt) {
  const res=await fetch(workspaceToolReceiptPath(id,workspaceToolCallId(id)),{
    method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(receipt),
    cache:"no-store",redirect:"error",signal:AbortSignal.timeout(8000),
  });
  const saved=res.ok ? await res.json().catch(()=>undefined) : undefined;
  const verified=readWorkspaceReceipt(saved,id,receipt.conversationId,receipt.turnId);
  return {settled:res.ok || res.status===400 || res.status===404 || res.status===409,
    receipt:verified?.observation && !samePublishedRaster(verified.observation,receipt.observation) ? undefined : verified};
}
