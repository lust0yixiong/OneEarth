import type {DiscoveryResponse,Message} from "./types";

export async function openTaskEvents(id: string, body: string, signal: AbortSignal) {
  const input: unknown = JSON.parse(body);
  const created = await fetch("/api/tasks", {
    method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({id, input}), signal,
  });
  if (!created.ok) return created;
  return fetch("/api/tasks/" + encodeURIComponent(id) + "/events", {signal, cache:"no-store"});
}

export const researchRecordId = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

export function discoveryClarificationResult(result:Pick<DiscoveryResponse,"clarification"|"discoveryClarification"|"questionCheck">):boolean {
  return result.clarification===true && result.discoveryClarification===true && !result.questionCheck;
}

export function canReplyToDiscoveryClarification(message?:Message):boolean {
  return !!message && message.role==="assistant" && !message.failed &&
    discoveryClarificationResult(message) && researchRecordId.test(message.id);
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
