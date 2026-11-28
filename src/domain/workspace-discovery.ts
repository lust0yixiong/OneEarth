import {workspaceIdPattern} from "./workspace-research-state";

export const workspaceDiscoveryAccessHeader="X-OneEarth-Operation-Key";
export const workspaceDiscoveryKeyPattern=/^[a-f0-9]{64}$/u;

export type WorkspaceDiscoveryAction={
  kind:"discover-materials";
  actionId:string;
  expectedRevision:number;
  query:string;
};
export type WorkspaceDiscoveryReference={operationId:string;batchId:string;accessKey:string};
export type WorkspaceDiscoveryAccepted={operationId:string;actionId:string;conversationId:string;status:"queued"};
export type WorkspaceDiscoveryItem={kind:"paper"|"dataset";id:string;title:string;source:string;url?:string;excerpt?:string};
export type WorkspaceDiscoveryResult={batchId:string;query:string;items:WorkspaceDiscoveryItem[];complete:boolean;limitation?:string};
export type WorkspaceDiscoveryView=Omit<WorkspaceDiscoveryAccepted,"status">&{
  version:1;
  status:"queued"|"running"|"waiting-input"|"complete"|"failed"|"cancelled";
  query:string;
  revision:number;
  result?:WorkspaceDiscoveryResult;
};

const object=(value:unknown):value is Record<string,unknown>=>value!==null&&typeof value==="object"&&!Array.isArray(value);
const id=(value:unknown):value is string=>typeof value==="string"&&workspaceIdPattern.test(value);
export const validWorkspaceDiscoveryKey=(value:unknown):value is string=>typeof value==="string"&&workspaceDiscoveryKeyPattern.test(value);
const revision=(value:unknown):value is number=>typeof value==="number"&&Number.isSafeInteger(value)&&value>=0;
const text=(value:unknown,max:number):value is string=>typeof value==="string"&&value.length<=max&&!!value.trim()&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value);

export function workspaceDiscoveryQuery(value:unknown){
  if(!text(value,1200))return;
  const normal=value.trim().replace(/\s+/gu," ");
  if(normal.length<=800)return normal;
}
export function hasWorkspaceDiscoveryIntent(value:unknown){
  return typeof value==="string"&&/^发现资料\s*[：:]/u.test(value.trim());
}
export function workspaceDiscoveryIntent(value:unknown){
  if(typeof value!=="string")return;
  const match=/^发现资料\s*[：:]\s*([\s\S]*)$/u.exec(value.trim());
  return match?workspaceDiscoveryQuery(match[1]):undefined;
}
export function readWorkspaceDiscoveryAction(value:unknown):WorkspaceDiscoveryAction|undefined{
  if(!object(value)||Object.keys(value).length!==4||value.kind!=="discover-materials"||!id(value.actionId)||
    !revision(value.expectedRevision))return;
  const query=workspaceDiscoveryQuery(value.query);
  if(query)return {kind:"discover-materials",actionId:value.actionId,expectedRevision:value.expectedRevision,query};
}
export function readWorkspaceDiscoveryReference(value:unknown):WorkspaceDiscoveryReference|undefined{
  if(!object(value)||Object.keys(value).length!==3||!id(value.operationId)||!id(value.batchId)||!validWorkspaceDiscoveryKey(value.accessKey))return;
  return {operationId:value.operationId,batchId:value.batchId,accessKey:value.accessKey};
}
export function readWorkspaceDiscoveryAccepted(value:unknown):WorkspaceDiscoveryAccepted|undefined{
  if(!object(value)||!id(value.operationId)||!id(value.actionId)||!id(value.conversationId)||value.status!=="queued")return;
  return {operationId:value.operationId,actionId:value.actionId,conversationId:value.conversationId,status:value.status};
}
function publicUrl(value:unknown):value is string{
  if(!text(value,1600))return false;
  try{
    const url=new URL(value);
    return (url.protocol==="https:"||url.protocol==="http:")&&!url.username&&!url.password;
  }catch{return false;}
}
export function readWorkspaceDiscoveryResult(value:unknown):WorkspaceDiscoveryResult|undefined{
  if(!object(value)||!id(value.batchId)||!text(value.query,800)||typeof value.complete!=="boolean"||
    !Array.isArray(value.items)||value.items.length>24||value.limitation!==undefined&&!text(value.limitation,800))return;
  const items:WorkspaceDiscoveryItem[]=[],seen=new Set<string>();
  for(const item of value.items){
    if(!object(item)||(item.kind!=="paper"&&item.kind!=="dataset")||!text(item.id,450)||!text(item.title,300)||
      !text(item.source,160)||item.url!==undefined&&!publicUrl(item.url)||item.excerpt!==undefined&&!text(item.excerpt,800))return;
    const identity=item.kind+":"+item.id;
    if(seen.has(identity))return;
    seen.add(identity);items.push({kind:item.kind,id:item.id,title:item.title,source:item.source,
      ...(typeof item.url==="string"?{url:item.url}:{}),...(typeof item.excerpt==="string"?{excerpt:item.excerpt}:{})});
  }
  return {batchId:value.batchId,query:value.query,items,complete:value.complete,
    ...(typeof value.limitation==="string"?{limitation:value.limitation}:{})};
}
export function readWorkspaceDiscoveryView(value:unknown):WorkspaceDiscoveryView|undefined{
  if(!object(value)||value.version!==1||!id(value.operationId)||!id(value.actionId)||!id(value.conversationId)||
    !revision(value.revision)||!text(value.query,800))return;
  const status=value.status;
  if(status!=="queued"&&status!=="running"&&status!=="waiting-input"&&status!=="complete"&&status!=="failed"&&status!=="cancelled")return;
  const result=readWorkspaceDiscoveryResult(value.result);
  if(value.result!==undefined&&!result||result&&result.query!==value.query)return;
  return {version:1,operationId:value.operationId,actionId:value.actionId,conversationId:value.conversationId,
    status,query:value.query,revision:value.revision,...(result?{result}:{})};
}
