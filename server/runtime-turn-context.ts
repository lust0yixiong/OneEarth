import type {TaskStore,Task} from "./task-store";
import {taskIdPattern} from "./task-store";
import type {RuntimeTurnInput} from "./runtime-turn-handoff";
import type {DiscoveryResponse,DiscoveryContext} from "../src/domain/types";
import type {WorkspaceViewContext} from "../src/domain/workspace-view-context";
import type {ResultBatch,WorkspaceReceipt} from "../src/domain/turn-context";
import {validBrowserTurnFrame} from "../src/domain/turn-context";
import {modelSafeValue} from "./model-context-safety";

type ResearchState="not-requested"|"planned"|"running"|"waiting-input"|"complete"|"partial"|"failed"|"cancelled"|"unknown";
type ResearchExecution={status:"queued"|"running"|"complete"|"failed"|"cancelled";bindings:{taskId:string;messageId:string;state:string;operation:"discover"|"read"}[]};
type ContextStore=TaskStore&{workspaceReceipt?:(id:string)=>Promise<WorkspaceReceipt|undefined>;researchExecution?:(id:string)=>Promise<ResearchExecution|undefined>};
type ContextRecord={taskId:string;turnId?:string;question:string;taskState:string;assistantText?:string;
  conditions:{origin:"user-message"|"browser-view"|"authoritative-scope"|"model-summary";taskId:string;value:unknown}[];
  execution:{research:ResearchState;plannedAction?:string;bindings?:ResearchExecution["bindings"];tools:{id:string;state:string;title:string}[];workspace:{state:"proposed"|"applied"|"stale"|"failed"|"unknown";effectId?:string}};
  batch?:ResultBatch;referenceKeys?:string[];observationFacts?:"separate-authority"};
export type RuntimeTurnContext={version:1;current:{taskId:string;turnId:string;conversationId:string;question:string};
  history:ContextRecord[];unavailableRelations:{taskId:string;reason:"unavailable"|"foreign-conversation"|"turn-mismatch"|"limit"}[];
  frozenView?:WorkspaceViewContext;browserObservations?:RuntimeTurnInput["context"]["browserTurnFrame"];
  visibleBatch:{state:"verified"|"legacy-verified"|"unbound"|"invalid";originTaskId?:string;batch?:ResultBatch;visibleIds:string[];query?:string;reason?:string};
  rule:string};
type Loaded={task:Task;body:RuntimeTurnInput;result?:DiscoveryResponse;record:ContextRecord};
const clip=(value:unknown,max:number)=>typeof value==="string"?value.slice(0,max):"";
const parse=(text:unknown):any=>{try{return typeof text==="string"?JSON.parse(text):text;}catch{return;}};

function verifiedBatch(value:ResultBatch|undefined,task:Task,body:RuntimeTurnInput):ResultBatch|undefined{
  if(!value||!taskIdPattern.test(value.batchId)||value.taskId!==task.id||value.turnId!==body.turnId||value.conversationId!==body.conversationId||
    !["research","catalogue"].includes(value.kind)||!["complete","partial","failed"].includes(value.status)||typeof value.query!=="string"||
    !Array.isArray(value.itemIds)||value.itemIds.length>512||!value.itemIds.every(id=>typeof id==="string"&&id.length<=2300)||
    new Set(value.itemIds).size!==value.itemIds.length||!Array.isArray(value.channels)||value.channels.length>12||
    !value.channels.every(channel=>channel&&typeof channel.source==="string"&&channel.source.length<=200&&["done","partial","failed","not_requested","unavailable"].includes(channel.status)))return;
  return {...value,query:value.query.slice(0,1200),conditions:value.conditions?.slice(0,12).map(value=>value.slice(0,240))};
}
function boundedBatch(batch:ResultBatch){
  const itemIds=batch.itemIds.filter(id=>id.length<=200).slice(0,32);
  return {...batch,itemIds,itemCount:batch.itemIds.length,itemIdsTruncated:itemIds.length!==batch.itemIds.length};
}
function observationOwned(body:RuntimeTurnInput,result:DiscoveryResponse|undefined){
  return !!(body as any).observationCheck||body.context.attachedScope?.some(item=>item.kind==="observation")||
    result?.answerNotes?.references?.some(ref=>ref.kind==="asset"&&ref.evidenceLevel==="observation-file");
}
function contextRecord(task:Task,body:RuntimeTurnInput,result:DiscoveryResponse|undefined,receipt:WorkspaceReceipt|undefined,execution:ResearchExecution|undefined):ContextRecord{
  const calls=result?.runTrace?.calls?.slice(0,128)||[],plan=parse(calls.find(call=>call.id==="turn-action"&&call.status==="done")?.output),action=plan?.action;
  const acquisition=calls.filter(call=>call.kind==="tool"&&(call.id.endsWith(":discovery")||call.id.startsWith("read-source-")));
  const batch=verifiedBatch(result?.resultBatch,task,body),requested=["read","search"].includes(action),hasReceipt=acquisition.some(call=>call.status==="done"||call.status==="partial");
  let research:ResearchState=batch?batch.status:result?.discoveryClarification?"waiting-input":
    requested?(task.status==="queued"?"planned":task.status==="running"?"running":task.status==="failed"?"failed":task.status==="cancelled"?"cancelled":hasReceipt?"complete":"unknown"):
    action?"not-requested":"unknown";
  if(result?.questionCheck&&requested)research="waiting-input";
  if(execution){
    research=execution.bindings.some(binding=>binding.state==="TASK_STATE_INPUT_REQUIRED")?"waiting-input":
      execution.status==="queued"?"planned":execution.status==="running"?"running":execution.status==="cancelled"?"cancelled":
      execution.status==="failed"?"failed":batch?batch.status:execution.bindings.length&&execution.bindings.every(binding=>binding.state==="TASK_STATE_COMPLETED")?"complete":hasReceipt?"complete":"unknown";
  }
  const observation=observationOwned(body,result);
  const conditions:ContextRecord["conditions"]=[{origin:"user-message",taskId:task.id,value:clip(body.query,600)},
    {origin:"browser-view",taskId:task.id,value:{filters:body.context.filters,selectedGrid:body.context.selection?.id}}];
  if(result?.gridCoverage?.status==="ready")conditions.push({origin:"authoritative-scope",taskId:task.id,
    value:{revision:result.gridCoverage.revision,scopeId:result.gridCoverage.scopeId,count:result.gridCoverage.count,filters:result.gridCoverage.summary?.filters}});
  if(result?.researchIntent)conditions.push({origin:"model-summary",taskId:task.id,value:{goal:clip(result.researchIntent.task,500)}});
  const effect=result?.workspaceEffect,validReceipt=effect&&receipt?.taskId===task.id&&receipt.effectId===effect.effectId&&
    receipt.conversationId===body.conversationId&&receipt.turnId===body.turnId;
  return {taskId:task.id,turnId:body.turnId,question:observation?"观测材料历史由独立授权路径提供。":clip(body.query,600),taskState:task.status,
    ...(observation?{observationFacts:"separate-authority" as const}:result?.message?{assistantText:result.message.slice(0,420)}:{}),
    conditions:observation?[]:conditions,execution:{research,plannedAction:typeof action==="string"?action:undefined,bindings:execution?.bindings.slice(-6),
      tools:acquisition.slice(-6).map(call=>({id:call.id,state:call.status,title:clip(call.name,100)})),
      workspace:{state:validReceipt?receipt.state:effect?"proposed":"unknown",...(effect?{effectId:effect.effectId}:{})}},
    ...(!observation?{referenceKeys:result?.answerNotes?.references?.slice(0,32).map(ref=>ref.kind==="asset"?"asset:"+ref.id:"web:"+ref.url)}:{}),...(batch?{batch:boundedBatch(batch)}:{})};
}

/** Four explicit, same-conversation records at most; never scan history/progress or infer an execution from prose. */
export async function runtimeTurnContext(tasks:ContextStore,taskId:string,body:RuntimeTurnInput):Promise<RuntimeTurnContext>{
  const frame=validBrowserTurnFrame(body.context.browserTurnFrame)?body.context.browserTurnFrame:undefined;
  const unavailable:RuntimeTurnContext["unavailableRelations"]=[],loaded=new Map<string,Loaded>(),requested=new Set<string>();
  const relations=frame?.related||[];
  const queue=[frame?.batch?.answerId,body.previousTaskId,...relations.map(item=>item.taskId)].filter((id):id is string=>!!id);
  let reads=0;
  while(queue.length){
    const id=queue.shift()!;if(requested.has(id))continue;requested.add(id);
    if(reads>=4){unavailable.push({taskId:id,reason:"limit"});continue;}
    if(!taskIdPattern.test(id)){unavailable.push({taskId:id,reason:"unavailable"});continue;}
    reads++;const task=await tasks.get(id),previous=task?parse(task.body) as RuntimeTurnInput:undefined;
    if(!task||!previous?.context||!Array.isArray(previous.history)){unavailable.push({taskId:id,reason:"unavailable"});continue;}
    if(previous.conversationId!==body.conversationId){unavailable.push({taskId:id,reason:"foreign-conversation"});continue;}
    if(relations.some(ref=>ref.taskId===id&&ref.turnId!==undefined&&ref.turnId!==previous.turnId)){
      unavailable.push({taskId:id,reason:"turn-mismatch"});continue;
    }
    const result=(await tasks.terminal(id))?.result as DiscoveryResponse|undefined;
    const receipt=result?.workspaceEffect?await tasks.workspaceReceipt?.(id):undefined;
    const execution=await tasks.researchExecution?.(id);
    const record=contextRecord(task,previous,result,receipt,execution);loaded.set(id,{task,body:previous,result,record});
    if(previous.previousTaskId)queue.push(previous.previousTaskId);
  }
  const claimed=frame?.batch,visibleIds=(claimed?.visibleIds??body.context.candidateIds??[]).slice(0,32);
  let visible:RuntimeTurnContext["visibleBatch"]={state:"unbound",visibleIds,reason:"浏览器可见候选不是本轮检索事实；缺少可核对的来源批次引用。"};
  if(claimed?.answerId){
    const source=loaded.get(claimed.answerId),batch=source?verifiedBatch(source.result?.resultBatch,source.task,source.body):undefined;
    if(batch){
      const okay=claimed.batchId===batch.batchId&&visibleIds.every(id=>batch.itemIds.includes(id));
      visible=okay?{state:"verified",originTaskId:source!.task.id,batch:{...boundedBatch(batch),itemIds:visibleIds},visibleIds,query:batch.query}:
        {state:"invalid",visibleIds:[],reason:"批次身份或候选成员与同会话原记录不一致，不能据此声称已查获或执行编号动作。"};
    }else if(source&&!claimed.batchId){
      const ids=source.result?.modelIds,known=source.record.execution.research!=="unknown"&&source.record.execution.research!=="not-requested";
      visible=known&&Array.isArray(ids)&&ids.length>0&&visibleIds.every(id=>ids.includes(id))?
        {state:"legacy-verified",originTaskId:source.task.id,visibleIds,query:source.body.query,reason:"旧档核对了原结果成员与调用记录；没有新的批次或本轮检索回执。"}:
        {state:"unbound",visibleIds,reason:"旧记录缺少足以核对的原批次执行证据；可见候选的来源保持未知。"};
    }else visible={state:"invalid",visibleIds:[],reason:"来源记录不可用或不属于当前研究会话。"};
  }else if(claimed?.batchId)visible={state:"invalid",visibleIds:[],reason:"批次必须引用其原任务记录，不能只凭浏览器批次编号。"};
  return modelSafeValue({version:1,current:{taskId,turnId:body.turnId,conversationId:body.conversationId,question:body.query},
    history:[...loaded.values()].map(value=>value.record),unavailableRelations:unavailable.slice(0,12),
    ...(body.context.workspaceView?{frozenView:structuredClone(body.context.workspaceView)}:{}),...(frame?{browserObservations:structuredClone(frame)}:{}),visibleBatch:visible,
    rule:"current是本轮原话；history的用户原话、浏览条件、模型归纳和真实执行分别标出处。assistantText仅是以前的答复，不能当执行回执。frozenView/browserObservations是描述而非检索/读取许可；visibleBatch的来源及原查询与当前视图条件独立。旧批与旧材料不得冒称本轮新查获；工具完成、研究完成、提案已发、网页实际应用是不同状态。unknown或unbound须如实说明，不从说过/候选存在推成做过。"} as RuntimeTurnContext);
}

/** Invalid claims lose action/read hints, while the original browser frame stays descriptive. */
export function boundTurnContext(context:DiscoveryContext,turn:RuntimeTurnContext):DiscoveryContext{
  if(context.browserTurnFrame?.batch?.expanded===false&&turn.visibleBatch.state!=="invalid")
    return {...context,...(context.workspaceView?{workspaceView:{...context.workspaceView,candidateItems:[]}}:{})};
  if(turn.visibleBatch.state!=="invalid")return context;
  return {...context,candidateIds:[],candidateVersions:{},inCandidateScope:false,
    ...(context.workspaceView?{workspaceView:{...context.workspaceView,candidateItems:[],candidates:{count:0,title:"来源批次无法核对"}}}:{})};
}

export function modelTurnContext(context:RuntimeTurnContext|undefined){
  if(!context)return;
  const {frozenView:_view,...rest}=context;
  return {...rest,history:context.history.map(({referenceKeys:_keys,...record})=>record)};
}
