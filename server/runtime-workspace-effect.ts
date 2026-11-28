import {gridSpec} from "../src/domain/spatial";
import {matchesFlightGround} from "../src/domain/flight-catalogue";
import {normalizeResearchCoverage,sameResearchFilters} from "../src/domain/workspace-research-state";
import type {DiscoveryResponse} from "../src/domain/types";
import type {ResearchRangeInput} from "../src/domain/research-range";
import {executeTurn,type RuntimeServices,type RuntimeTurnInput} from "./runtime-turn";
import type {WorkspaceEffectsStore} from "./postgres-workspace-effects";
import {TaskParked,type Payload} from "./task-store";
import {readWorkspaceResearchCoverage} from "./workspace-research-state";

export function presentationMessage(receipts:NonNullable<import("../src/domain/catalogue-presentation").CataloguePresentationWrite["items"]>){
  const rendered=receipts.filter(item=>item.state==="rendered").length;
  const failed=receipts.filter(item=>item.state==="failed").length;
  const superseded=receipts.filter(item=>item.state==="superseded").length;
  return "原页面绘制回执："+[rendered&&rendered+" 项已绘制",failed&&failed+" 项绘制失败",superseded&&superseded+" 项因后续操作未呈现"].filter(Boolean).join("，")+"。";
}
export async function runWorkspaceActionEffect(services:RuntimeServices,effects:Pick<WorkspaceEffectsStore,"execution">,
  task:{id:string;body:RuntimeTurnInput;checkpoint:Payload},signal:AbortSignal,emit:(payload:Payload)=>void){
  const {id,body,checkpoint}=task;
  const retained=checkpoint.result as DiscoveryResponse;
  const effect=await effects.execution(id);
  if(!effect||effect.effectId!==checkpoint.effectId||effect.turnId!==body.turnId||effect.conversationId!==body.conversationId)return new TaskParked();
  if(effect.status==="waiting")return new TaskParked();
  const {command,receipt}=effect;
  const finish=(message:string)=>({result:{...retained,message}});
  if(effect.status==="expired")return finish(command.kind==="flight"?
    "等待原页面的飞行到达回执已超时，本轮未查询目录。":
    retained.message+"\n\n等待原页面完整绘制回执已超时。未确认的条目未计作已绘制。");
  if(effect.status!=="received"||!receipt)return new TaskParked();
  signal.throwIfAborted();
  if(receipt.kind==="catalogue-presentation")return finish(retained.message+"\n\n"+presentationMessage(receipt.presentation.items));
  const flight=receipt.flight;
  if(flight.state!=="arrived")return finish(
    flight.state==="superseded"?"飞行已被后续地图操作替代，本轮未查询目录。":
    flight.state==="cancelled"?"原页面飞行已取消，本轮未查询目录。":"原页面未能核对可靠地面范围，本轮未查询目录。");
  return readFlightCatalogue(services,{runId:id,body,flight,place:command.kind==="flight"?command.placeLabel:"",retained,
    batchId:effect.effectId,scope:checkpoint.flightScope as ResearchRangeInput["scope"]|undefined,
    saveScope:scope=>services.tasks.saveStep?.(id,{...checkpoint,flightScope:scope})},signal,emit);
}

export async function readFlightCatalogue(services:RuntimeServices,input:{runId:string;body:RuntimeTurnInput;
  flight:Extract<import("../src/domain/flight-catalogue").FlightMapReceipt,{state:"arrived"}>;place:string;
  retained:DiscoveryResponse;batchId:string;scope?:ResearchRangeInput["scope"];present?:boolean;
  saveScope:(scope:ResearchRangeInput["scope"])=>boolean|Promise<boolean>|undefined},
  signal:AbortSignal,emit:(payload:Payload)=>void){
  const {flight,body,retained}=input;
  const {point,id:cell,level}=flight.ground;
  const selection={point,id:cell,grid:gridSpec("h3",level)};
  const unavailable="已收到实际到达回执，但暂时无法核对其地面范围的权威覆盖，本轮没有另行搜索。";
  const failure=()=>({result:{...retained,message:unavailable}});
  let scope=input.scope;
  if(!scope){
    const attachment=await services.coverage.registerSelection?.(body.context.filters,selection,signal);
    if(!attachment||typeof attachment==="string"||!matchesFlightGround(flight.ground,attachment.summary.selection)||
      !sameResearchFilters(attachment.summary.filters,body.context.filters)||attachment.summary.candidateCount!==null||
      attachment.summary.candidateIdentity!==null||attachment.summary.caseId!==null||attachment.summary.layer!=="all"||
      attachment.summary.metric!=="products")return failure();
    const summary=normalizeResearchCoverage(attachment.summary);
    scope={kind:"grid",selection:summary.selection,place:input.place,
      coverageScope:{...attachment,summary}};
    if(!await input.saveScope(scope))return new TaskParked();
  }
  if(!matchesFlightGround(flight.ground,scope.selection))return failure();
  const fact={id:"workspace-flight-catalogue",area:"catalog"} as const;
  emit({researchProgressFact:{...fact,status:"running"}});
  const evidence=await readWorkspaceResearchCoverage(scope,services.coverage,signal,true);
  if(evidence.status!=="ready"||!evidence.summary){
    emit({researchProgressFact:{...fact,status:evidence.status==="unknown"&&evidence.reason==="pending"?"timeout":"failed"}});
    return {result:{...retained,message:unavailable,gridCoverage:evidence}};
  }
  emit({researchProgressFact:{...fact,status:"done",...(evidence.count<=1_000_000?{count:evidence.count}:{})}});
  const queryBody={...body,serverWorkspaceResearch:undefined,serverWorkspaceResearchAction:undefined,
    context:{...body.context,workspaceView:undefined,layerObservationRef:undefined,caseObservationRef:undefined,
      gridSystem:selection.grid.system,selection,attachedScope:[scope],filters:evidence.summary.filters,caseId:null,layer:"all" as const}};
  return executeTurn(services,input.runId,queryBody,signal,emit,{priorResult:null,flightCatalogue:{evidence,
    trace:retained.runTrace,batchId:input.batchId,present:input.present}});
}
