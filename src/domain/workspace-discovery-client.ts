import {randomId} from "./id";
import {workspaceIdPattern,workspaceResearchPath} from "./workspace-research-state";
import {readWorkspaceDiscoveryAccepted,readWorkspaceDiscoveryView,validWorkspaceDiscoveryKey,workspaceDiscoveryAccessHeader,
  type WorkspaceDiscoveryView} from "./workspace-discovery";

export type WorkspaceDiscoveryAdmission={actionId:string;expectedRevision:number;accessKey:string};
export type WorkspaceDiscoveryHandle=Pick<WorkspaceDiscoveryAdmission,"actionId"|"accessKey"> & {operationId?:string};

const storageKey=(conversationId:string)=>`oneearth.workspace-discovery.v1.${conversationId}`;
const maxSavedOperations=8;

export function newWorkspaceDiscoveryHandle():WorkspaceDiscoveryHandle {
  const bytes=crypto.getRandomValues(new Uint8Array(32));
  const accessKey=Array.from(bytes,byte=>byte.toString(16).padStart(2,"0")).join("");
  return {actionId:randomId(),accessKey};
}

function isHandle(value:unknown):value is WorkspaceDiscoveryHandle {
  if(!value || typeof value!=="object")return false;
  const {actionId,accessKey,operationId}=value as Partial<WorkspaceDiscoveryHandle>;
  return typeof actionId==="string" && workspaceIdPattern.test(actionId) &&
    validWorkspaceDiscoveryKey(accessKey) &&
    (operationId===undefined || (typeof operationId==="string" && workspaceIdPattern.test(operationId)));
}

export function savedWorkspaceDiscoveries(conversationId:string):WorkspaceDiscoveryHandle[] {
  try {
    const saved:unknown=JSON.parse(localStorage.getItem(storageKey(conversationId)) ?? "[]");
    if(!Array.isArray(saved))return [];
    return saved.slice(0,maxSavedOperations).filter(isHandle).map(({actionId,accessKey,operationId})=>
      ({actionId,accessKey,operationId}));
  } catch {return [];}
}

export function saveWorkspaceDiscovery(conversationId:string,handle:WorkspaceDiscoveryHandle) {
  const saved=savedWorkspaceDiscoveries(conversationId);
  const index=saved.findIndex(item=>item.actionId===handle.actionId);
  if(index===-1)saved.unshift(handle);
  else saved[index]=handle;
  localStorage.setItem(storageKey(conversationId),JSON.stringify(saved.slice(0,maxSavedOperations)));
}

export function removeWorkspaceDiscovery(conversationId:string,actionId:string) {
  const saved=savedWorkspaceDiscoveries(conversationId).filter(item=>item.actionId!==actionId);
  localStorage.setItem(storageKey(conversationId),JSON.stringify(saved));
}

function operationUrl(conversationId:string,id:string){
  return `${workspaceResearchPath(conversationId)}/operations/${encodeURIComponent(id)}`;
}

function fetchOperation(path:string,accessKey:string,options:RequestInit={}) {
  const timeout=AbortSignal.timeout(10000);
  return fetch(path,{...options,cache:"no-store",redirect:"error",
    signal:options.signal ? AbortSignal.any([timeout,options.signal]) : timeout,
    headers:{...options.headers,[workspaceDiscoveryAccessHeader]:accessKey},
  });
}

function readAdmission(value:unknown,conversationId:string,actionId:string):string|undefined {
  const receipt=readWorkspaceDiscoveryAccepted(value);
  if(receipt?.conversationId===conversationId && receipt.actionId===actionId)return receipt.operationId;
}

export class DiscoveryNotAccepted extends Error {
  constructor(message:string,readonly revisionConflict=false){super(message);}
}

export async function submitWorkspaceDiscovery(conversationId:string,handle:WorkspaceDiscoveryHandle,expectedRevision:number,query:string) {
  const response=await fetchOperation(`${workspaceResearchPath(conversationId)}/actions`,handle.accessKey,{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({kind:"discover-materials",actionId:handle.actionId,expectedRevision,query}),
  });
  if(response.status===202){
    const operationId=readAdmission(await response.json(),conversationId,handle.actionId);
    if(operationId)return operationId;
  }
  if(response.status===409)throw new DiscoveryNotAccepted("会话研究状态已变化，请核对后重新查找。",true);
  if([400,401,403,404,413,415,422].includes(response.status))throw new DiscoveryNotAccepted("查找未受理，请检查查找内容后再试。");
  throw Error("暂时无法确认查找是否受理，正在读取原操作。");
}

export async function readWorkspaceDiscoveryAdmission(conversationId:string,handle:WorkspaceDiscoveryHandle,signal:AbortSignal) {
  const path=`${workspaceResearchPath(conversationId)}/actions/${encodeURIComponent(handle.actionId)}`;
  const response=await fetchOperation(path,handle.accessKey,{signal});
  if(response.status===404)return;
  const operationId=response.ok && readAdmission(await response.json(),conversationId,handle.actionId);
  if(operationId)return operationId;
  throw Error("暂时无法核对原操作是否受理。");
}

export async function loadWorkspaceDiscovery(conversationId:string,handle:WorkspaceDiscoveryHandle & {operationId:string},signal:AbortSignal):Promise<WorkspaceDiscoveryView> {
  const response=await fetchOperation(operationUrl(conversationId,handle.operationId),handle.accessKey,{signal});
  const view=response.ok && readWorkspaceDiscoveryView(await response.json());
  if(view && view.operationId===handle.operationId && view.actionId===handle.actionId && view.conversationId===conversationId)
    return view;
  throw Error("暂时无法读取原查找操作。");
}

export async function cancelWorkspaceDiscovery(conversationId:string,handle:WorkspaceDiscoveryHandle & {operationId:string}) {
  const response=await fetchOperation(operationUrl(conversationId,handle.operationId),handle.accessKey,{method:"DELETE"});
  if(!response.ok && response.status!==409)throw Error("暂时无法确认取消，请查看原操作状态。");
}
