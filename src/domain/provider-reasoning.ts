import type {ProviderReasoningSnapshot,RunTrace} from "./types";

// Match the runtime archive retention window.
const snapshotLimit=12;

function validProviderReasoning(value:unknown):value is ProviderReasoningSnapshot {
  if(!value || typeof value!=="object" || Array.isArray(value))return false;
  const snapshot=value as ProviderReasoningSnapshot;
  return typeof snapshot.id==="string" && !!snapshot.id.trim() &&
    Number.isSafeInteger(snapshot.revision) && snapshot.revision>=0 &&
    (snapshot.kind==="summary" || snapshot.kind==="deepseek-thinking") &&
    typeof snapshot.text==="string" && !!snapshot.text.trim() &&
    (snapshot.complete===undefined || typeof snapshot.complete==="boolean") &&
    (snapshot.truncated===undefined || typeof snapshot.truncated==="boolean");
}

export function mergeProviderReasoning(current:ProviderReasoningSnapshot[]|undefined,incoming:unknown,retired?:Set<string>) {
  let merged=current;
  for(const snapshot of Array.isArray(incoming) ? incoming : [incoming]){
    if(!validProviderReasoning(snapshot) || retired?.has(snapshot.id))continue;
    const index=merged?.findIndex(item=>item.id===snapshot.id) ?? -1;
    if(index>=0 && merged![index].revision>=snapshot.revision)continue;
    if(merged===current)merged=[...(current ?? [])];
    if(index<0){
      merged!.push(snapshot);
      if(merged!.length>snapshotLimit){
        const removed=merged!.shift()!;
        retired?.add(removed.id);
      }
    }else merged![index]=snapshot;
  }
  return merged;
}

export function traceWithProviderReasoning(trace:RunTrace|undefined,reasoning:ProviderReasoningSnapshot[]|undefined):RunTrace|undefined {
  if(!reasoning?.length || trace?.providerReasoning===reasoning)return trace;
  return {...(trace ?? {started:Date.now(),stages:[],calls:[]}),providerReasoning:reasoning};
}
