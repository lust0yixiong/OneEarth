import {readWorkspaceActionEffect,workspaceEffectReceiptPath,workspacePageHeader,
  type WorkspaceActionEffect,type WorkspaceEffectReceipt} from "./workspace-action-effect";

export function createWorkspacePageToken() {
  return Array.from(globalThis.crypto.getRandomValues(new Uint8Array(32)),
    byte=>byte.toString(16).padStart(2,"0")).join("");
}

function sameWorkspaceEffect(a:WorkspaceActionEffect,b:WorkspaceActionEffect){
  return a.runId===b.runId && a.conversationId===b.conversationId && a.turnId===b.turnId &&
    a.actionId===b.actionId && a.operationId===b.operationId && a.effectId===b.effectId &&
    a.stepId===b.stepId && a.stepOrder===b.stepOrder && a.kind===b.kind;
}

export function advancesWorkspaceActionEffect(current:WorkspaceActionEffect|undefined,next:WorkspaceActionEffect){
  if(!current)return true;
  if(sameWorkspaceEffect(current,next))return current.status==="waiting" || next.status===current.status;
  return current.runId===next.runId && current.conversationId===next.conversationId && current.turnId===next.turnId &&
    current.actionId===next.actionId && !!current.operationId && current.operationId===next.operationId &&
    current.effectId!==next.effectId && current.stepId!==next.stepId &&
    current.stepOrder!==undefined && next.stepOrder!==undefined && next.stepOrder>current.stepOrder;
}

export async function reportWorkspaceActionEffect(effect:WorkspaceActionEffect,token:string,receipt:WorkspaceEffectReceipt) {
  const endpoint=workspaceEffectReceiptPath(effect.conversationId,effect.actionId,effect.effectId);
  const body=JSON.stringify(receipt);
  // A lost HTTP response can only replay the same already observed fact.
  for(let attempt=0;attempt<2;attempt++){
    const response=await fetch(endpoint,{method:"PUT",body,cache:"no-store",redirect:"error",keepalive:true,
      headers:{"Content-Type":"application/json",[workspacePageHeader]:token},signal:AbortSignal.timeout(4000)})
      .catch(()=>undefined);
    if(response?.ok){
      const saved=readWorkspaceActionEffect(await response.json().catch(()=>undefined),effect.runId);
      if(saved && sameWorkspaceEffect(saved,effect))return saved;
      return;
    }
    if(response && response.status<500)return;
  }
}
