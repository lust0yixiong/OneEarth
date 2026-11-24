import type {DiscoveryResponse} from "../src/domain/types";
import {validBrowserWorkspaceReceipt,validWorkspaceObservation,type BrowserLayerPresentation,type BrowserTurnFrame,type WorkspaceReceipt} from "../src/domain/turn-context";
import {workspaceObservationTarget} from "../src/domain/workspace-published-layer";
import type {RuntimeTurnContext} from "./runtime-turn-context";
import type {TaskStore} from "./task-store";
import {modelSafeValue} from "./model-context-safety";

const fields=["workspaceAction","workspaceLayerOpen","workspaceOperation","view","catalogQuery","inspectId","camera","filters","caseId","dataView","visualization","mesh","gridSystem","layer","previewNeed","previewCaseId","visualizeNeed","previewKind","clearSelection","selectCenter"] as const;
type Target=NonNullable<ReturnType<typeof workspaceObservationTarget>>;
type Owner={taskId:string;turnId:string;conversationId:string};
export type RuntimeWorkspaceState={state:"proposed"|"applied"|"stale"|"failed"|"unknown";effectId?:string;
  operation?:{source:"server-terminal";fields:string[];values:Partial<DiscoveryResponse>;target?:Target};
  receipt?:{source:"original-operation-browser-receipt";state:WorkspaceReceipt["state"];reportedAt:number;reason?:WorkspaceReceipt["reason"];
    observation?:WorkspaceReceipt["observation"];observationReportedAt?:number;recovery?:WorkspaceReceipt["recovery"]};
  atSubmission?:{source:"current-message-browser-frame";capturedAt?:number;visible:boolean;presentation?:BrowserLayerPresentation;sameTarget?:boolean};
  receiptRefresh?:"unavailable"};

export function workspaceReceiptMatches(owner:Owner,effectId:string|undefined,receipt:WorkspaceReceipt|undefined){
  if(!effectId||!receipt||receipt.taskId!==owner.taskId||receipt.turnId!==owner.turnId||receipt.conversationId!==owner.conversationId||receipt.effectId!==effectId)return false;
  const {taskId:_id,reportedAt,observationReportedAt:_time,recovery:_recovery,...browser}=receipt;
  return Number.isSafeInteger(reportedAt)&&reportedAt>0&&validBrowserWorkspaceReceipt(browser);
}

function adoptReceipt(state:RuntimeWorkspaceState,owner:Owner,receipt:WorkspaceReceipt|undefined):RuntimeWorkspaceState{
  if(!workspaceReceiptMatches(owner,state.effectId,receipt))return state;
  if(state.receipt&&(receipt!.reportedAt<state.receipt.reportedAt||receipt!.state!==state.receipt.state))return state;
  const target=state.operation?.target,observation=receipt!.observation;
  const bound=target&&validWorkspaceObservation(observation)&&observation.datasetId===target.datasetId&&observation.valueId===target.valueId&&observation.publicationRevision===target.publicationRevision;
  const old=state.receipt?.observation;
  const keepOld=old&&(!bound||observation!.observedAt<old.observedAt||old.state!=="loading"&&observation!.state==="loading");
  const recovery=receipt!.recovery;
  return {...state,state:receipt!.state,receipt:{source:"original-operation-browser-receipt",state:receipt!.state,reportedAt:receipt!.reportedAt,
    ...(receipt!.reason?{reason:receipt!.reason}:{}),...(keepOld?{observation:old,observationReportedAt:state.receipt?.observationReportedAt}:bound?{observation,observationReportedAt:receipt!.observationReportedAt}:{}),
    ...(recovery&&["running","complete","failed"].includes(recovery.state)&&Number.isSafeInteger(recovery.observedAt)&&recovery.observedAt>0?
      {recovery:{state:recovery.state,observedAt:recovery.observedAt,...(typeof recovery.message==="string"?{message:recovery.message.slice(0,1200)}:{}),
        ...(["explain","ask-confirmation","unavailable"].includes(recovery.nextStep||"")?{nextStep:recovery.nextStep}:{})}}:{})}};
}

export function runtimeWorkspaceState(owner:Owner,result:DiscoveryResponse|undefined,receipt:WorkspaceReceipt|undefined,frame:BrowserTurnFrame|undefined):RuntimeWorkspaceState{
  const effect=result?.workspaceEffect;
  let state:RuntimeWorkspaceState={state:effect?"proposed":"unknown",...(effect?{effectId:effect.effectId}:{})};
  if(effect&&Array.isArray(effect.fields)){
    const selected=fields.filter(field=>effect.fields.includes(field)),target=workspaceObservationTarget(result);
    state.operation={source:"server-terminal",fields:selected,values:Object.fromEntries(selected.filter(key=>result?.[key]!==undefined).map(key=>[key,result![key]])),...(target?{target}:{})};
    const layer=target&&frame?.globe?.layers.find(layer=>layer.id===target.datasetId);
    if(layer)state.atSubmission={source:"current-message-browser-frame",capturedAt:frame?.capturedAt,visible:layer.visible,
      ...(layer.presentation?{presentation:layer.presentation,sameTarget:layer.presentation.valueId===target!.valueId&&layer.presentation.publicationRevision===target!.publicationRevision}:{})};
  }
  state=adoptReceipt(state,owner,receipt);
  return modelSafeValue(state);
}

/** Refresh receipt observations only; the original intent, batch conditions and frozen frame stay intact. */
export async function refreshWorkspaceObservations(tasks:Pick<TaskStore,"workspaceReceipt">,context:RuntimeTurnContext):Promise<RuntimeTurnContext>{
  if(!tasks.workspaceReceipt)return context;
  const history=await Promise.all(context.history.slice(0,4).map(async record=>{
    const state=record.execution.workspace;if(!state.effectId)return record;
    let workspace:RuntimeWorkspaceState;
    try{workspace=adoptReceipt(state,{taskId:record.taskId,turnId:record.turnId||"",conversationId:context.current.conversationId},await tasks.workspaceReceipt!(record.taskId));}
    catch{workspace={...state,receiptRefresh:"unavailable"};}
    return {...record,execution:{...record.execution,workspace:modelSafeValue(workspace)}};
  }));
  return {...context,history};
}
