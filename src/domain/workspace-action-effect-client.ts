import {readWorkspaceActionEffect,workspaceEffectReceiptPath,workspacePageHeader,
  type WorkspaceActionEffect,type WorkspaceEffectReceipt} from "./workspace-action-effect";

export function createWorkspacePageToken() {
  return Array.from(globalThis.crypto.getRandomValues(new Uint8Array(32)),
    byte=>byte.toString(16).padStart(2,"0")).join("");
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
      if(saved?.effectId===effect.effectId && saved.conversationId===effect.conversationId && saved.turnId===effect.turnId)
        return saved;
      return;
    }
    if(response && response.status<500)return;
  }
}
