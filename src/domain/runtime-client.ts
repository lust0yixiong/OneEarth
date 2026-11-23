import type {DiscoveryResponse,Message} from "./types";
import {createClarificationPrompt,validClarificationPrompt} from "./clarification";

export const chatMessagesPath = "/api/chat/messages";
export async function openTaskEvents(id: string, body: string, signal: AbortSignal, legacy = false, onAccepted?:()=>void) {
  const input: unknown = JSON.parse(body);
  const created = await fetch(legacy ? "/api/tasks" : chatMessagesPath, {
    method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({id, input}), signal,
  });
  if (!created.ok) return chatTransportResponse(created);
  onAccepted?.();
  const events=await fetch("/api/tasks/" + encodeURIComponent(id) + "/events", {signal, cache:"no-store"});
  return chatTransportResponse(events);
}

function chatTransportResponse(response:Response) {
  if (response.status===408 || response.status===429 || response.status>=500)
    throw Error("连接暂不可用，可接回本轮请求。");
  return response;
}

export async function cancelChatRequest(id:string,signal:AbortSignal) {
  const response=await fetch("/api/tasks/"+encodeURIComponent(id),{method:"DELETE",signal});
  if (response.status!==204 && response.status!==409) throw Error("暂时无法取消本轮，请重试。");
  return response.status===204;
}

export const researchRecordId = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

export function discoveryClarificationResult(result:Pick<DiscoveryResponse,"clarification"|"discoveryClarification"|"questionCheck">):boolean {
  return result.clarification===true && result.discoveryClarification===true && !result.questionCheck;
}

export function canReplyToDiscoveryClarification(message?:Message):boolean {
  return !!message && message.role==="assistant" && !message.failed &&
    discoveryClarificationResult(message) && researchRecordId.test(message.id);
}

export function messageClarificationPrompt(message?:Message) {
  if (!message || message.role!=="assistant" || message.failed || message.questionCheck || !researchRecordId.test(message.id)) return;
  if (validClarificationPrompt(message.clarificationPrompt)) return message.clarificationPrompt;
  if (!canReplyToDiscoveryClarification(message)) return;
  const text=message.text.trim();
  return createClarificationPrompt("research",text.length>500 ? text.slice(0,499)+"…" : text || "请补充研究所需的信息。");
}

export function answeredClarificationIds(messages:Message[],unansweredId:string|null) {
  return new Set(messages.flatMap(message=>{
    const id=message.clarificationAnswer?.parentTaskId ?? message.clarificationReply?.parentTaskId;
    return message.role==="user" && message.id!==unansweredId && id ? [id] : [];
  }));
}

interface ResearchRecord {
  id:string;
  question:string;
  conversationId:string;
  turnId:string;
  created:number;
  updated:number;
  result:DiscoveryResponse;
}

export async function loadResearchRecord(id:string):Promise<ResearchRecord>{
  if(!researchRecordId.test(id))throw Error("研究记录编号无效。");
  const response=await fetch("/api/tasks/"+id+"/record",{cache:"no-store",signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Error("没有找到已完成的研究记录。");
  const record:ResearchRecord=await response.json();
  if(record.id!==id||typeof record.question!=="string"||typeof record.conversationId!=="string"||
    typeof record.turnId!=="string"||typeof record.result?.message!=="string")throw Error("研究记录格式无效。");
  return record;
}
