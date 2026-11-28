import {plainPublicAnswer} from "./public-answer-stream";
import {runtimeStepContext} from "./runtime-step";
import {TaskParked} from "./task-store";
import {delegatedResearchProgress,isResearchTimeout,type ResearchProgressFact} from "./research-progress";
import {literatureText,literatureDisplay} from "../src/domain/literature-label";
import {providerReasoningArchive} from "./provider-reasoning";
import {isDeepStrictEqual} from "node:util";
import { requestPerformance } from "./request-performance";
import type { TaskStore } from "./task-store";
import type { researchRegions } from "./research-region";
import type { spatialCoverageClient } from "./spatial-coverage-client";
import {runtimeTurnPapers} from "./runtime-turn-papers";
import type {RuntimeWebToolAuthority} from "./runtime-web-tool-store";
import {runtimeMaterialHistory,archivedReadEvidence,type RuntimeMaterialReceipt} from "./runtime-material-history";
import {readGridHainaRecords,runtimeTurnHaina,type RuntimeHainaMaterials} from "./runtime-turn-haina";
import type {CurrentAssertionReading} from "./runtime-assertion-evidence";
import {paperId} from "../src/domain/paper-record";
import type { constellationService } from "./constellations";
import { assetById, registerObservations, registerPapers } from "../src/domain/datasets";
import { modelReply } from "./research-answer";
import { validHistory } from "./turn-history";
import path from "node:path";
import {gridCoverageSummary,questionGridEvidence,verifiedGridContext} from "./question-grid";
import {flightCataloguePlace} from "../src/domain/flight-catalogue";
import {researchRegionCamera} from "../src/domain/research-region";
import {gridQueryLimits,gridCataloguePaperIds,gridCatalogueAnswer} from "./grid-catalogue-answer";
import {cataloguePresentationTarget} from "../src/domain/catalogue-presentation";
import {ExecutorFailure} from "./executor-failure";
import {prepareTurn,parseTurnPlan,turnPlanningTargets,turnMetadata,turnPlanningSchema,TurnPlanningFailure,type TurnPlan,type TurnInput} from "./turn-planning";
import {randomUUID} from "node:crypto";
import {researchExecutor,discoveryProtocol} from "./research-executor";
import {discoveryConfirmation} from "./discovery-bindings";
import {assertDiscoveryWaiting,queryPapers,type DiscoveryBinding,type DiscoveryA2AInput} from "./discovery-a2a-client";
import {clarificationParent,guardClarification,clarificationGuardSchema,type ClarificationReply} from "./clarification-guard";
import {continueResearch, evidenceDecisionSchema, scopedDiscoverySources,researchEvidenceAuthority} from "./research-evidence";
import type {DiscoveryInput} from "./discovery-contract";
import {rememberConversationReferences} from "../src/domain/reference-memory";
import {conversationScope,scopedReply} from "./conversation-scope";
import {discoverConversation} from "./conversation-discovery";
import { priorResult } from "./runtime-input";
import { numberedReference } from "./follow-up-reference";
import { parentResearchEvidence } from "./parent-research-evidence";
import {AnswerReferenceError,synthesisFailureDiagnostic} from "./scientific-answer";
import {scopeLabel} from "../src/domain/question-scope";
import {navigationTarget,parseCoordinates,photonLookup,wikipediaLookup,placeVariants,canonicalPlaceNames,placeLookupSchema,geocoderEnabled,type NavigationTarget,type PlaceHit} from "./place-lookup";
import {chinaBoundary,chinaBoundaryEnabled} from "./china-boundaries";
import {validResearchRegion} from "../src/domain/research-region";
import type {ResearchRegion} from "../src/domain/research-region";
import type { AnswerReference, DiscoveryResponse, RunTrace, ToolCall, SearchRun } from "../src/domain/types";
import { discoverObservations } from "./observation-query";
import { resolveSceneQuery } from "./earth-search";
import { discover } from "../src/domain/discovery";
import {authorizesWorkspaceViewAction,workspaceViewActionAllowed} from "../src/domain/workspace-view-context";
import {resolveWorkspaceC40Publication} from "./workspace-c40-publication";
import {resolveWorkspaceForestPublication} from "./workspace-forest-publication";
import {resolveWorkspacePublishedLayer} from "./workspace-published-layer";
import {runtimeTurnContext,boundTurnContext} from "./runtime-turn-context";
import {refreshWorkspaceObservations} from "./runtime-workspace-state";
import {discoveryResultBatch,gridCatalogueBatch} from "./runtime-result-batch";
import {modelSafeValue,modelSafeText} from "./model-context-safety";
import {answerLayerObservation,stripLayerObservationContext} from "./runtime-layer-observation";
import {answerCaseObservation} from "./runtime-case-observation";
import {runtimeTurnFingerprint,runtimeTurnHandoff,validRuntimeTurnHandoff,type RuntimeTurnInput,type RuntimeTurnHandoff,type RuntimeTurnOptions,type ForegroundTurnOutcome} from "./runtime-turn-handoff";
import {createClarificationPrompt,clarificationAnswerText,type ClarificationPrompt} from "../src/domain/clarification";
import {authorizesResearchRangeAdoption,authorizesResearchRangeClear,type WorkspaceOperationKind} from "../src/domain/workspace-operations";
import {readResearchRangeScope} from "../src/domain/research-range";
import {readWorkspaceResearchCoverage,type WorkspaceResearchStateStore} from "./workspace-research-state";
import type {GridCoverageEvidence} from "../src/domain/grid-coverage";
export {validRuntimeTurnHandoff} from "./runtime-turn-handoff";
export type {RuntimeTurnInput,RuntimeTurnHandoff,RuntimeTurnOptions,ForegroundTurnOutcome} from "./runtime-turn-handoff";

export interface RuntimeServices {
  workspaceResearch?: Pick<WorkspaceResearchStateStore,"apply">;
  webTools?:RuntimeWebToolAuthority;
  tasks: TaskStore;
  push: ReturnType<typeof constellationService>;
  coverage: ReturnType<typeof spatialCoverageClient>;
  researchRegionService: ReturnType<typeof researchRegions>;
  adminBoundaryDir: string;
  canonicalCache: Map<string,{at:number;names:string[]}>;
}

export function researchClarificationPrompt(result:import("./data-search").DataSearchResult|undefined,binding:DiscoveryBinding|undefined):ClarificationPrompt|undefined{
  if(result?.clarificationOptions===undefined||!result.clarification||result.questionCheck||binding?.state!=="TASK_STATE_INPUT_REQUIRED")return;
  return createClarificationPrompt("research",result.clarification,result.clarificationOptions);
}

export async function runForegroundTurn(services:RuntimeServices,taskId:string,body:RuntimeTurnInput,signal:AbortSignal,
  emit:(payload:Record<string,unknown>)=>void,options:RuntimeTurnOptions={}):Promise<ForegroundTurnOutcome>{
  if(options.turnContext&&(options.turnContext.current.taskId!==taskId||options.turnContext.current.turnId!==body.turnId||options.turnContext.current.conversationId!==body.conversationId))
    return {kind:"reply",payload:{error:"本轮上下文与任务归属不一致，未执行。",code:"TURN_CONTEXT_INVALID"}};
  const pending=options.pending,answer=pending?.answer,prompt=pending?.clarificationPrompt;
  const boundAnswer=!!prompt&&answer?.parentTaskId===pending?.taskId&&body.previousTaskId===pending?.taskId&&
    body.clarificationAnswer?.parentTaskId===answer?.parentTaskId&&body.clarificationAnswer?.optionId===answer?.optionId&&
    body.clarificationAnswer?.text===answer?.text&&clarificationAnswerText(prompt,answer!)===body.query;
  signal.throwIfAborted();
  if((answer||body.clarificationAnswer)&&!boundAnswer)return {kind:"reply",payload:{error:"本轮没有与原追问一致的实际弹框答复，未执行操作。",code:"TURN_CLARIFICATION_BINDING_INVALID"}};
  const exactConfirmation=boundAnswer&&prompt?.kind==="confirmation";
  if(exactConfirmation&&answer?.optionId==="decline"&&answer.text===undefined){
    const runTrace:RunTrace={started:Date.now(),stages:[],calls:[{id:"workspace-confirmation",kind:"tool",name:"研究者拒绝原提案",input:pending!.taskId,status:"done",output:"未执行任何界面操作。"}]};
    emit({call:runTrace.calls[0],traceStarted:runTrace.started});return {kind:"reply",payload:{result:{message:"已取消这次提案，未执行任何界面操作。",runTrace}}};
  }
  const payload=await executeTurn(services,taskId,body,signal,emit,{...options,foreground:true,semanticDecision:true,
    approvedConfirmation:!!exactConfirmation&&answer?.optionId==="approve"&&answer.text===undefined});
  return validRuntimeTurnHandoff(payload.runtimeTurnHandoff)?{kind:"research",checkpoint:payload.runtimeTurnHandoff}:{kind:"reply",payload};
}
export async function resumePlannedTurn(services:RuntimeServices,taskId:string,body:RuntimeTurnInput,checkpoint:RuntimeTurnHandoff,
  signal:AbortSignal,emit:(payload:Record<string,unknown>)=>void,options:RuntimeTurnOptions={}):Promise<Record<string,unknown>>{
  signal.throwIfAborted();
  if(!validRuntimeTurnHandoff(checkpoint)||runtimeTurnFingerprint(body)!==checkpoint.inputFingerprint)
    return {error:"后台交接与已核验的前台输入不一致，未执行研究。",code:"TURN_HANDOFF_INVALID"};
  if(checkpoint.turnContext&&(checkpoint.turnContext.current.taskId!==taskId||checkpoint.turnContext.current.turnId!==body.turnId||checkpoint.turnContext.current.conversationId!==body.conversationId))
    return {error:"后台上下文与原任务归属不一致，未执行研究。",code:"TURN_HANDOFF_INVALID"};
  const task=await services.tasks.get(taskId);
  if(task&&!["queued","running"].includes(task.status))return {error:"任务已结束，未继续执行研究。",code:"TURN_HANDOFF_TERMINAL"};
  if(checkpoint.plan.observationUse==="selected")return {error:"本次决定须由已授权的观测资料流程继续。",code:"OBSERVATION_HANDOFF_REQUIRED"};
  return executeTurn(services,taskId,body,signal,emit,{...options,
    ...(checkpoint.priorOverride&&!Object.hasOwn(options,"priorResult")?{priorResult:null}:{}),observationUnavailable:checkpoint.observationUnavailable,
    observationAvailable:checkpoint.observationAvailable,observationMaterials:checkpoint.observationMaterials,semanticDecision:true,handoff:checkpoint});
}

const discoveryProgressAreas:ReadonlySet<ResearchProgressFact["area"]>=new Set(["literature","haina","web"]);

export async function executeTurn(services:RuntimeServices,taskId:string,body:RuntimeTurnInput,signal:AbortSignal,
  publish:(payload:Record<string,unknown>)=>void,internal:RuntimeTurnOptions&{foreground?:boolean;semanticDecision?:boolean;handoff?:RuntimeTurnHandoff;approvedConfirmation?:boolean;
    flightCatalogue?:{evidence:GridCoverageEvidence;trace?:RunTrace;batchId:string;present?:boolean}}={}):Promise<Record<string,unknown>>{
  const {tasks, push, coverage, researchRegionService, adminBoundaryDir, canonicalCache} = services;
  const turnContext=internal.turnContext??internal.handoff?.turnContext??await runtimeTurnContext(tasks,taskId,body);
  const batchOwner={batchId:internal.flightCatalogue?.batchId??runtimeStepContext.getStore()?.stableId("result-batch")??randomUUID(),taskId,turnId:body.turnId,conversationId:body.conversationId};
  const cachedPapers=runtimeTurnPapers();
  const haina=runtimeTurnHaina();
  const savedMaterials=runtimeStepContext.getStore()?.state.cancelledResult as DiscoveryResponse|undefined;
  if(savedMaterials?.paperRecords?.length)cachedPapers.remember(savedMaterials.paperRecords);
  const currentAssertionReadings:CurrentAssertionReading[]=[];
  let idSequence=0;const nextId=()=>runtimeStepContext.getStore()?.stableId("turn-"+idSequence++)??randomUUID();
  let context=stripLayerObservationContext(boundTurnContext(body.context,turnContext));
  const controller = {signal};
  let activeExecutor:ReturnType<typeof researchExecutor>|undefined;
  const savedTrace=internal.handoff?.runTrace??internal.flightCatalogue?.trace;
  const runTrace:RunTrace = savedTrace?structuredClone(savedTrace):{started:runtimeStepContext.getStore()?.state.startedAt??Date.now(),stages:[],calls:[],timings:requestPerformance.getStore()};
  if(internal.handoff&&requestPerformance.getStore()){
    requestPerformance.getStore()!.unshift(...(runTrace.timings||[]));runTrace.timings=requestPerformance.getStore();
  }
  let researchRegion:ResearchRegion|null|undefined;
  let regionTask:Promise<void>|undefined;
  function event(value:Record<string, unknown>) { publish(literatureDisplay(value)); }
  const researchProgress=(fact:ResearchProgressFact)=>event({researchProgressFact:fact});
  const synthesisProgress=(status:ResearchProgressFact["status"])=>researchProgress({id:"answer-synthesis",area:"synthesis",status});
  function stage(text:string, searches?:SearchRun[]) {
    if(runTrace.stages.at(-1)!==text)runTrace.stages.push(text);
    if(searches)runTrace.searches=searches;
    event({stage:text,searches,traceStarted:runTrace.started});
  }
  function report(call:ToolCall) {
    call=modelSafeValue(call);
    const i=runTrace.calls.findIndex(old=>old.id===call.id);
    if(i<0)runTrace.calls.push(call);else runTrace.calls[i]=call;
    event({call,traceStarted:runTrace.started});
  }
  const reasoning=providerReasoningArchive(taskId,runTrace.providerReasoning,snapshot=>{
    if(signal.aborted)return;
    runTrace.providerReasoning=reasoning.values;
    publish({providerReasoning:snapshot,traceStarted:runTrace.started});
  });
  if(reasoning.values.length)runTrace.providerReasoning=reasoning.values;
  async function synthesisContext(){
    const latest=await refreshWorkspaceObservations(tasks,turnContext);
    if(latest.history.some(record=>record.execution.workspace.effectId))report({id:"workspace-observation-refresh",kind:"tool",name:"读取原操作的最新已存浏览器回执",input:"仅刷新已经核验归属的原操作回执，不替换冻结意图或浏览快照",status:"done",
      output:JSON.stringify({frame:"原发问快照保持冻结",capturedAt:latest.browserObservations?.capturedAt,
        operations:latest.history.filter(record=>record.execution.workspace.effectId).map(record=>({taskId:record.taskId,workspace:record.execution.workspace}))})});
    return latest;
  }
  async function readCoverage(scope:typeof context,adopted:boolean) {
    const hasScope=scope.attachedScope?.some(item=>item.kind==="grid"&&!!item.coverageScope);
    const action={id:"grid-catalogue",area:"catalog"} as const;
    if(hasScope)researchProgress({...action,status:"running"});
    let evidence;
    try {
      const frozen=body.serverWorkspaceResearch&&scope.attachedScope?.find(item=>item.kind==="grid"&&
        item.conditionRevision===body.serverWorkspaceResearch!.revision);
      const researchRange=readResearchRangeScope(frozen);
      evidence=researchRange?await readWorkspaceResearchCoverage(researchRange,coverage,signal,true):
        await questionGridEvidence(scope,coverage,signal);
    }
    catch(error){
      if(hasScope&&!signal.aborted)researchProgress({...action,status:isResearchTimeout(error)?"timeout":"failed"});
      throw error;
    }
    if(hasScope&&evidence)researchProgress(evidence.status==="ready"?
      {...action,status:"done",...(evidence.count<=1_000_000?{count:evidence.count}:{})}:{...action,status:"failed"});
    const unavailableDefault=adopted&&evidence?.status==="unknown";
    if (evidence) report({id:unavailableDefault?"adopted-grid-availability":"question-grid",kind:"tool",
      name:unavailableDefault?"尝试核对会话研究范围":"读取所引网格的覆盖修订",input:evidence.cellId,
      status:evidence.status==="ready"?"done":"partial",output:gridCoverageSummary(evidence)});
    return evidence;
  }
  try {
    const clarification=body.clarificationReply?await clarificationParent(tasks,body):undefined;
    const archivedPending=internal.handoff?.pending;
    const chatOriginal=archivedPending?.clarificationPrompt?.kind==="chat"&&body.clarificationAnswer&&
      archivedPending.answer?.parentTaskId===body.clarificationAnswer.parentTaskId?archivedPending.originalQuestion:undefined;
    const query=clarification?.original.query??chatOriginal??body.query;
    let history=clarification?.original.history??body.history;
    if(chatOriginal)history=[...history.slice(-7),{role:"user",text:body.query}];
    const decision=clarification?.original.questionDecision??body.questionDecision;
    const flightPlace=internal.foreground&&!clarification&&!decision&&!body.clarificationAnswer&&context.workspaceView?.surface==="earth"
      ?flightCataloguePlace(query):undefined;
    if(clarification)context={...clarification.context,workspaceView:body.context.workspaceView};
    const rangeObservation=internal.foreground&&!clarification&&!decision&&!body.clarificationAnswer&&services.workspaceResearch
      ?body.serverWorkspaceResearchAction:undefined;
    const clearRange=rangeObservation&&authorizesResearchRangeClear(query);
    const adoptRange=rangeObservation?.range&&authorizesResearchRangeAdoption(query);
    if (context.workspaceView) {
      const operations:WorkspaceOperationKind[]=(context.workspaceView.operations??[]).filter(kind=>kind!=="adopt-research-range"&&kind!=="clear-research-range");
      if(adoptRange)operations.push("adopt-research-range");
      if(clearRange)operations.push("clear-research-range");
      context={...context,workspaceView:{...context.workspaceView,operations}};
    }
    const executor=activeExecutor=researchExecutor(body.config,clarification?clarification.original.deepseekTools:body.deepseekTools,signal,
      services.webTools?{researchTaskId:taskId,authority:services.webTools}:undefined,{taskId,onSnapshot:snapshot=>{if(!signal.aborted)reasoning.accept(snapshot);}});
    event({conversationId:body.conversationId,turnId:body.turnId, ...(decision ? {continuedFrom:decision.checkMessageId} : {})});
    stage("正在理解问题");
    const adoptedRange=context.attachedScope?.find(item=>item.kind==="grid"&&item.conditionRevision!==undefined);
    const checkedCoverage=internal.flightCatalogue?.evidence??(flightPlace||clearRange||adoptRange?undefined:await readCoverage(context,!!adoptedRange));
    const unavailableRange=adoptedRange&&checkedCoverage?.status==="unknown"?checkedCoverage:undefined;
    const gridCoverage=unavailableRange?undefined:checkedCoverage;
    const gridLimits=checkedCoverage&&!clarification&&!decision?gridQueryLimits(query):undefined;
    const unavailableReply=()=>({result:{message:gridCoverageSummary(unavailableRange!),clarification:true,gridCoverage:unavailableRange,runTrace}});
    if(unavailableRange&&(clarification||decision||gridLimits?.currentCoverageOnly))return unavailableReply();
    if(unavailableRange)context=verifiedGridContext(context,{...unavailableRange,summary:undefined});
    if(gridCoverage){
      const time=context.attachedScope?.find(item=>item.kind==="time");
      const authoritative=gridCoverage.summary?.filters;
      if(authoritative&&time&&(JSON.stringify(time.period)!==JSON.stringify(authoritative.period)||
        JSON.stringify(time.utcWindow)!==JSON.stringify(authoritative.utcWindow??null))){
        return {result:literatureDisplay({message:"附加的时间和已确认网格范围的时间不一致。请保留一个范围后继续。",clarification:true,runTrace})};
      }
      context=verifiedGridContext(context,gridCoverage);
    }
    const scopeUnverified=!!gridCoverage&&!gridCoverage.summary;
    if(clarification){
      if(scopeUnverified)return {result:{message:gridCoverageSummary(gridCoverage!),clarification:true,gridCoverage,runTrace}};
      if(gridCoverage?.summary&&clarification.result.gridCoverage?.summary&&!isDeepStrictEqual(gridCoverage.summary,clarification.result.gridCoverage.summary))
        return {result:{message:"原澄清的地图范围或修订已变化，请重新确认范围后继续。",clarification:true,gridCoverage,runTrace}};
      await assertDiscoveryWaiting(clarification.binding,clarification.binding.lastSeq,signal);
      stage("正在核对原委托与这次补充");
      report({id:"clarification-guard",kind:"tool",name:"核对补充是否仍属原委托",input:body.clarificationReply!.parentTaskId,status:"running"});
      const checked=await guardClarification({...clarification,context},body.query,prompt=>executor.model(prompt,{outputSchema:clarificationGuardSchema}));
      report({id:"clarification-guard",kind:"tool",name:"核对补充是否仍属原委托",input:JSON.stringify({parentTaskId:body.clarificationReply!.parentTaskId,
        discoveryId:clarification.binding.discoveryId,afterSeq:clarification.binding.lastSeq}),status:"done",output:JSON.stringify(checked)});
      if(checked.action==="new_goal")return {result:{message:"这次补充改变了原委托的目标或范围，请先确认新的研究问题。",
        questionCheck:{originalQuestion:body.query,proposedQuestion:checked.proposedQuestion!},runtimeQuestionCheck:true,runTrace}};
      if(checked.action==="clarify")return {clarificationContinuation:true,result:{message:checked.clarification!,clarification:true,discoveryClarification:true,
        clarificationPrompt:createClarificationPrompt("research",checked.clarification!),runTrace}};
    }
    const priorRecord = Object.hasOwn(internal,"priorResult")?internal.priorResult??undefined:await priorResult(tasks,body.conversationId,body.previousTaskId);
    const prior=priorRecord?.caseObservation||priorRecord?.layerObservation?undefined:priorRecord;
    const candidatePaperIds=[...(context.candidateIds||[]),...(context.attachedScope?.flatMap(s=>s.kind==="dataset"?[s.id]:[])||[]),
      ...(gridCoverage?gridCataloguePaperIds(gridCoverage):[]),
      ...(prior?.answerNotes?.references?.flatMap(r=>r.kind==="asset"?[r.id]:[])||[])];
    const priorOverridden=Object.hasOwn(internal,"priorResult");
    const archived=await runtimeMaterialHistory(tasks,body.conversationId,[priorOverridden?undefined:body.previousTaskId,decision?.checkMessageId,body.clarificationReply?.parentTaskId],
      {paperIds:candidatePaperIds.filter(paperId),includeSources:!prior&&!priorOverridden});
    cachedPapers.remember(archived.papers);
    if(priorOverridden)cachedPapers.remember(prior?.paperRecords||[]);
    haina.remember(archived);
    const savedReadings=prior?.conversationEvidence?.length?prior.conversationEvidence:archivedReadEvidence(archived);
    if(savedReadings.length||prior?.conversationAssertionEvidence?.length){
      let last=history.length-1;while(last>=0&&history[last].role!=="assistant")last--;
      const original=last>=0?history[last]:{role:"assistant" as const,text:""};
      const saved={...original,conversationEvidence:savedReadings,
        conversationAssertionEvidence:prior?.conversationAssertionEvidence,
        conversationReferences:prior?.answerNotes?.references||savedReadings.map(read=>({kind:"web" as const,url:read.url,title:read.title,sourceChannel:"web" as const,referenceType:read.referenceType}))};
      history=last>=0?history.map((turn,index)=>index===last?saved:turn):[...history.slice(-7),saved];
    }
    async function retainMaterials(material:RuntimeMaterialReceipt){
      // Persist full acquired content before synthesis; call logs contain identities only.
      if(!runtimeStepContext.getStore()){if(internal.foreground)event({researchMaterials:material});else await tasks.append(taskId,{researchMaterials:material});}
      await runtimeStepContext.getStore()?.captureMaterial(material);
      cachedPapers.remember(material.papers);
      haina.remember(material);
      for(const reading of material.paperEvidence||[])if(!currentAssertionReadings.some(old=>isDeepStrictEqual(old,reading)))currentAssertionReadings.push(reading);
    }
    async function retainDiscoveryMaterials(result:import("./data-search").DataSearchResult){
      const material=result as typeof result&RuntimeHainaMaterials;
      const selected=new Set(result.haina.flatMap(asset=>[asset.id,asset.datasetId]));
      if(material.hainaRecords?.some(record=>!selected.has("haina:"+record.id)))throw Error("受托海纳记录不属于本次实得对象。");
      await retainMaterials({papers:result.papers,searches:result.searches,issues:result.issues,
        ...(material.hainaRecords?{hainaRecords:material.hainaRecords}:{}),...(material.hainaCatalog?{hainaCatalog:material.hainaCatalog}:{})});
    }
    async function loadPapers(ids:string[]){
      const wanted=[...new Set(ids.filter(paperId))],missing=wanted.filter(id=>!cachedPapers.get(id));
      for(let i=0;i<missing.length;i+=20){
        try{
          const papers=await queryPapers({operation:"records",ids:missing.slice(i,i+20)},signal);
          await retainMaterials({papers,searches:[],issues:[]});
          report({id:"paper-details-"+i,kind:"tool",name:"取得精确版本的已发布论文记录",status:"done",
            input:JSON.stringify(missing.slice(i,i+20)),output:JSON.stringify({papers:papers.map(p=>p.id),level:"published-record"})});
        }catch(error){
          signal.throwIfAborted();report({id:"paper-details-"+i,kind:"tool",name:"取得精确版本的已发布论文记录",status:"failed",
            input:JSON.stringify(missing.slice(i,i+20)),error:error instanceof Error?error.message:"发现服务未返回指定版本。"});
        }
      }
      return wanted.flatMap(id=>cachedPapers.get(id)||[]);
    }
    const conversationContext=validHistory(history)
      ?history.filter(t=>t.role==="assistant" && t.conversationContext!==undefined).at(-1)?.conversationContext:undefined;
    const conversationEvidence=prior?.conversationEvidence??(validHistory(history)
      ?history.filter(t=>t.role==="assistant" && t.conversationEvidence!==undefined).at(-1)?.conversationEvidence:undefined);
    const conversationAssertionEvidence=prior?.conversationAssertionEvidence??(validHistory(history)
      ?history.filter(t=>t.role==="assistant" && t.conversationAssertionEvidence!==undefined).at(-1)?.conversationAssertionEvidence:undefined);
    const priorIds=validHistory(history)
      ? history.filter(t=>t.role==="assistant").at(-1)?.assetIds || [] : [];
    const currentDatasets=[...new Set([...priorIds,...(context.candidateIds || [])])].slice(0,40)
      .flatMap(id=>{const asset=assetById.get(id);return asset?[{id,title:asset.title,source:asset.source}]:[];});
    const priorIntent=validHistory(history)?history.filter(t=>t.role==="assistant"&&t.researchIntent).at(-1)?.researchIntent:undefined;
    const attachedTime=context.attachedScope?.find(s=>s.kind==="time"),attachedGrid=context.attachedScope?.find(s=>s.kind==="grid");
    const planningIntent=attachedTime||attachedGrid?{...(priorIntent||{purpose:query,task:query,region:null,time:null,months:[]}),
      ...(attachedTime?{time:scopeLabel(attachedTime),months:[]}:{}),...(attachedGrid?{region:scopeLabel(attachedGrid)}:{})}:priorIntent;
    // An explicit "move the view" request is resolved without a model call: the
    // command and the place are both local, so quota and planner drift cannot block it.
    function navigationTurn(target:NavigationTarget){
      const meta=turnMetadata(query,{previousResearchIntent:planningIntent,history,conversationContext});
      const coordinate=parseCoordinates(target.place);
      const goal=("移动地图视野到「"+target.place+"」").slice(0,1200);
      const plan:TurnPlan={action:"workspace",goal,evidenceNeed:"none",targets:[],
        reason:"用户明确要求定位或移动地图视野；这是界面操作，直接定位，不进入数据检索。",
        clarification:null,researchIntent:{...meta.researchIntent,region:coordinate?null:target.place.slice(0,1200)},
        conversationContext:(meta.conversationContext||query).slice(0,1600)};
      stage("正在定位「"+target.place+"」");
      report({id:"turn-action",kind:"tool",name:"本轮目标与动作规划",input:JSON.stringify({question:query,targets:[]}),status:"done",
        output:JSON.stringify({action:"workspace",goal,reason:plan.reason})});
      return {plan,retrieval:undefined};
    }
    const navigation = internal.semanticDecision||clarification||context.workspaceView?undefined:navigationTarget(query);
    const selected=navigation?undefined:numberedReference(query,prior);
    const ref=selected?.reference;
    if(selected){
      const label=selected.scope==="literature"?"文献":"来源";
      report({id:"citation-ordinal",name:"定位上一回答的"+label,kind:"tool",status:ref?"done":"failed",
        input:JSON.stringify({previousTaskId:body.previousTaskId,ordinal:selected.ordinal,scope:selected.scope}),
        ...(ref?{output:JSON.stringify({sourceId:ref.kind==="asset"?ref.id:ref.url})}:{error:"该编号不在原回答中。"})});
      if(!ref)return {result:literatureDisplay({message:"上一条回答里没有第 "+selected.ordinal+" 条"+label+"。你可以点击原引用，或告诉我标题。",
        clarification:true,runTrace,conversationEvidence,conversationAssertionEvidence,...turnMetadata(query,{
          previousResearchIntent:planningIntent,history,conversationContext,
        })})};
    }
    function discoveryAuthority(plan:TurnPlan,continuing=false){
      const original=clarification?.delegation.query??query;
      const question=decision?.choice==="edited"?decision.dataQuestion:original;
      const authority=researchEvidenceAuthority(question,plan,continuing||clarification?undefined:prior);
      const reply=clarification?researchEvidenceAuthority(body.query,plan):undefined;
      return {...authority,discoveryLimit:authority.discoveryLimit??reply?.discoveryLimit,
        allowDiscovery:authority.allowDiscovery&&reply?.allowDiscovery!==false&&!scopeUnverified&&
          !requiresUnavailableRange(plan)&&!gridLimits?.currentCoverageOnly&&!gridLimits?.noDiscovery};
    }
    function requiresUnavailableRange(plan:TurnPlan) {
      if(!unavailableRange)return false;
      if(plan.gridIntent&&plan.gridIntent!=="none")return true;
      // The adopted scope is the default for research. A separately attached
      // range/referral is handled by the existing explicit request path.
      return plan.action==="search"||
        plan.action==="read"&&(!plan.targets.length||plan.targets.some(target=>target.kind==="grid"));
    }
    let initialDiscoveryId:string|undefined,initialBinding:DiscoveryBinding|undefined,lastBinding:DiscoveryBinding|undefined,actualDiscoveryQuery:string|undefined;
    let lastDiscoveryResult:import("./data-search").DataSearchResult|undefined;
    async function find(turn:TurnPlan,continuation?:DiscoveryInput["continuation"],evidenceGap?:string,executionSignal?:AbortSignal){
      if(!discoveryAuthority(turn,!!continuation).allowDiscovery)
        throw Error("原任务没有允许独立补查的范围，本轮未启动新的发现。");
      if(continuation)continuation={...continuation,focus:modelSafeText(continuation.focus)};
      if(evidenceGap!==undefined)evidenceGap=modelSafeText(evidenceGap);
      const messageId=continuation?nextId():taskId;
      const a2a=discoveryProtocol()==="a2a";
      let discoveryId=a2a?undefined:messageId;
      const confirmation=clarification?{continuedFrom:clarification.binding.discoveryId,options:{target:{discoveryId:clarification.binding.discoveryId,
        contextId:clarification.binding.contextId},afterSeq:clarification.binding.lastSeq}}:
        decision?await discoveryConfirmation(tasks,body.conversationId,decision.checkMessageId):undefined;
      const newTarget=confirmation&&"newTask" in confirmation&&confirmation.newTask?decision!.dataQuestion:undefined;
      const prefix=continuation?messageId+":":"";
      const call={id:messageId+":discovery",kind:"tool" as const,name:"独立数据发现服务",
        input:JSON.stringify({messageId,...(discoveryId?{discoveryId}:{}),...(continuation?{previousId:continuation.previousId,focus:continuation.focus}:{})})};
      const saveBinding=async(binding:DiscoveryBinding)=>{
        discoveryId=binding.discoveryId;
        lastBinding=binding;
        if(!continuation){initialDiscoveryId=discoveryId;initialBinding=binding;}
        if(!runtimeStepContext.getStore()?.replaying)await tasks.append(taskId,{discoveryBinding:{...binding,kind:continuation?"continuation":"initial"}});
      };
      report({...call,status:"running"});
      try {
        const request:DiscoveryA2AInput=clarification&&!continuation?{
          continuedFrom:clarification.binding.discoveryId,clarificationReply:{text:body.query,afterSeq:clarification.binding.lastSeq},
        }:{
          query:clarification?clarification.delegation.query:newTarget??query,
          decision:clarification?clarification.delegation.decision:newTarget?undefined:decision, continuation,
          continuedFrom:clarification?undefined:confirmation?.continuedFrom,
          researchGoal:clarification?clarification.goal:newTarget??decision?.dataQuestion??turn.goal, evidenceGap:(continuation?.focus||evidenceGap||turn.evidenceGap)?modelSafeText(continuation?.focus||evidenceGap||turn.evidenceGap!):undefined,
          conversationContext, previousResearchIntent:planningIntent,
          history, currentDatasets, conversationEvidence,
          scope:{filters:context.filters,selection:context.selection,caseId:context.caseId,citation:context.citation,attachedScope:context.attachedScope},
          references:rememberConversationReferences(history.filter(t=>t.role==="assistant").at(-1)?.conversationReferences||[],
            turn.targets.flatMap<AnswerReference>(t=>t.id?[{kind:"asset",id:t.id,title:t.title,source:assetById.get(t.id)?.source||"所引资料"}]:t.url?[{kind:"web",title:t.title,url:t.url}]:[])),
        };
        actualDiscoveryQuery??="query" in request?request.query:clarification?.delegation.query;
        const result = await executor.discover(messageId, request, update => {
          if(update.planned&&!continuation){
            const plan = update.planned;
            regionTask=researchRegionService.locate(plan.questionMode==="reframe"?null:plan.researchIntent?.region,
              plan.questionMode==="reframe"?undefined:attachedGrid?.selection).then(region=>{
              researchRegion=region;event({researchRegion});
            }).catch(()=>{researchRegion=null;event({researchRegion});});
          }
          if(!a2a){
            const fact=delegatedResearchProgress(messageId,update.researchProgressFact,discoveryProgressAreas);
            if(fact)researchProgress(fact);
          }
          if(update.stage)stage(update.stage,update.searches);
          if(update.call)report({...update.call,id:prefix+update.call.id});
          if(update.finding){
            const finding={...update.finding,id:prefix+update.finding.id};
            const findings=[...(runTrace.findings||[])], index=findings.findIndex(f=>f.id===finding.id);
            if(index<0)findings.push(finding);else findings[index]=finding;
            runTrace.findings=findings;
            event({finding,traceStarted:runTrace.started});
          }
        },{onAccepted:saveBinding,onCheckpoint:saveBinding,webToolQuestion:clarification?.delegation.query,executionSignal,onEvent:async update=>{
          if(!runtimeStepContext.getStore()?.replaying){
            const fact=delegatedResearchProgress(messageId,update.researchProgressFact,discoveryProgressAreas);
            if(fact)await tasks.append(taskId,{researchProgressFact:fact});
          }
          if(update.result)await retainDiscoveryMaterials(update.result);
        },...(!continuation?confirmation?.options:{})});
        if(!a2a)await retainDiscoveryMaterials(result);
        if(!continuation)initialDiscoveryId=discoveryId;
        lastDiscoveryResult=result;
        report({...call,status:"done",output:JSON.stringify({messageId,discoveryId,channels:result.sourceStatus.map(({source,status,count})=>({source,status,count})),
          materials:{papers:result.papers.map(record=>record.id),haina:result.haina.map(asset=>asset.id),
            web:[...new Set(result.searches.flatMap(search=>search.hits.map(hit=>hit.url)))]}})});
        return result;
      } catch(error) {
        if(error instanceof TaskParked)throw error;
        report({...call,status:"failed",error:error instanceof Error?error.message:"发现服务未完成。",
          output:JSON.stringify({messageId,...(discoveryId?{discoveryId}:{})})});
        throw error;
      }
    }
    const c40View=context.workspaceView?.activeLayer?.id==="c40";
    const c40PublicationRequested=c40View&&
      context.workspaceView?.activeLayer?.controls.some(control=>control.publication?.kind==="c40-cities");
    const workspaceResolution=clarification?undefined:await resolveWorkspaceC40Publication(context.workspaceView,decision?.dataQuestion||query,signal,{semanticDecision:internal.semanticDecision});
    if(workspaceResolution){
      context={...context,workspaceView:workspaceResolution.view};
      if(c40PublicationRequested)report({id:"workspace-c40-publication",kind:"tool",name:"核对当前已发布城市选项",status:workspaceResolution.issue?"partial":"done",
        input:JSON.stringify({revision:body.context.workspaceView?.activeLayer?.controls.find(control=>control.id==="city")?.publication?.revision}),
        output:JSON.stringify({revision:workspaceResolution.proof?.revision,shortlist:workspaceResolution.proof?.ids,
          matched:workspaceResolution.matches,read:workspaceResolution.read,issue:workspaceResolution.issue})});
    }
    const forestPublicationRequested=context.workspaceView?.activeLayer?.id==="forest"&&
      context.workspaceView.activeLayer.controls.some(control=>control.publication?.kind==="forest-frames");
    const forestResolution=clarification?undefined:await resolveWorkspaceForestPublication(context.workspaceView,signal);
    if(forestResolution){
      context={...context,workspaceView:forestResolution.view};
      if(forestPublicationRequested)report({id:"workspace-forest-publication",kind:"tool",name:"核对当前已发布森林日期",status:forestResolution.issue?"partial":"done",
        input:JSON.stringify({revision:body.context.workspaceView?.activeLayer?.controls.find(control=>control.id==="time")?.publication?.revision}),
        output:JSON.stringify({revision:forestResolution.proof?.revision,shortlist:forestResolution.proof?.ids,summary:forestResolution.proof?.summary,
          read:forestResolution.read,issue:forestResolution.issue})});
    }
    const controlResolution=(layerId:string)=>layerId==="forest"?forestResolution:workspaceResolution;
    const planningInput:TurnInput={
      question:decision?.dataQuestion||query,context,history,conversationContext,gridCoverage,
      caseObservation:internal.caseObservation&&{kind:internal.caseObservation.kind,status:internal.caseObservation.status},
      layerObservation:internal.layerObservation&&{kind:internal.layerObservation.kind,status:internal.layerObservation.status},
      adoptedRangeUnavailable:!!unavailableRange,workspacePublication:workspaceResolution?.proof,
      forestPublication:forestResolution?.proof,
      turnContext,conversationHistory:internal.conversationHistory,historicalTargets:internal.handoff?.historicalTargets,
      ...(internal.publicAnswer?{publicAnswer:true as const}:{}),
      ...(internal.semanticDecision?{semanticDecision:true,pending:internal.pending??internal.handoff?.pending}:{}),...(internal.observationUnavailable?{observationUnavailable:true}:{}),
      ...(internal.observationAvailable?{observationAvailable:true,observationMaterials:internal.observationMaterials}:{}),
      previousResearchIntent:planningIntent,confirmedQuestion:decision?.dataQuestion,numbered:selected,
      numberedRead:ref?.kind==="web"?savedReadings.find(read=>read.url===ref.url):undefined,
      numberedAssertion:ref?.kind==="asset"?prior?.conversationAssertionEvidence?.find(read=>read.assetId===ref.id):undefined,
    };
    function resumedPlan():TurnPlan{
      const saved=internal.handoff!.plan,available=turnPlanningTargets(planningInput);
      for(const target of saved.targets){
        const current=available.find(item=>item.key===target.key);
        if(!current||["kind","id","url","basis"].some(key=>current[key as keyof typeof current]!==target[key as keyof typeof target]))
          throw Error("原计划的确切来源已无法核对，未执行研究。 ");
      }
      return parseTurnPlan(JSON.stringify({...saved,targets:saved.targets.map(target=>target.key),evidenceGap:saved.evidenceGap??null}),{...planningInput,storedPlan:true},available);
    }
    function approvedPlan(){
      const goal=(internal.pending?.originalQuestion||query).slice(0,1200),meta=turnMetadata(goal,{history,conversationContext,previousResearchIntent:planningIntent});
      const plan:TurnPlan={action:"workspace",goal,evidenceNeed:"none",targets:[],reason:"研究者已通过存档确认问题明确批准原具体提案。",clarification:null,
        ...meta,pendingTaskId:internal.pending!.taskId,pendingApproval:true,workspaceAction:null};
      report({id:"turn-action",kind:"tool",name:"继续已核验的确认提案",input:JSON.stringify({parentTaskId:internal.pending!.taskId,optionId:"approve"}),status:"done",
        output:JSON.stringify({...plan,decisionSource:"stored-confirmation",authorization:{parentTaskId:internal.pending!.taskId,optionId:"approve"},modelPlanning:{attempts:0,workspaceAction:internal.pending?.proposedAction}})});
      return {plan,retrieval:undefined as import("./data-search").DataSearchResult|undefined};
    }
    const prepared = internal.flightCatalogue?{plan:{action:"respond",goal:query,evidenceNeed:"none",targets:[],reason:"依据原飞行到达回执读取权威目录。",
      clarification:null,gridIntent:"catalogue",...turnMetadata(query,{history,conversationContext})} as TurnPlan,retrieval:undefined}:
      flightPlace?{plan:{action:"workspace",goal:query,evidenceNeed:"none",targets:[],reason:"按明确的先飞行、后读取顺序执行。",
      clarification:null,workspaceNavigation:{kind:"navigate-map",place:flightPlace},
      ...turnMetadata(query,{history,conversationContext})} as TurnPlan,retrieval:undefined}:
      internal.approvedConfirmation?approvedPlan():internal.handoff?{plan:resumedPlan(),retrieval:undefined as import("./data-search").DataSearchResult|undefined}:clarification?{plan:{action:"search",evidenceNeed:"discover",goal:clarification.goal,targets:[],
      reason:"研究者明确补充原委托，沿已受理发现身份和等待水位继续。",clarification:null,
      ...turnMetadata(query,{previousResearchIntent:planningIntent,history,conversationContext})} as TurnPlan,retrieval:undefined as import("./data-search").DataSearchResult|undefined}:
      navigation ? navigationTurn(navigation) : await prepareTurn(planningInput, signal, {
      run: (prompt,modelSignal,schema) => executor.model(prompt, {outputSchema:schema??turnPlanningSchema({...planningInput,workspaceView:context.workspaceView})},modelSignal||signal),
      stage, report,
      search:p=>internal.foreground||p.gridIntent==="count"||p.gridIntent==="catalogue"||!discoveryAuthority(p).allowDiscovery?Promise.resolve(undefined):find(p),
    });
    const restrictedConfirmation=internal.pending?.clarificationPrompt?.kind==="confirmation"&&!internal.approvedConfirmation&&internal.pending.answer!==undefined;
    if(restrictedConfirmation&&(["read","search"].includes(prepared.plan.action)||prepared.plan.observationUse==="selected"))
      return {result:{message:"本次答复未批准原提案，也未启动新的研究。若要改变研究目的，请另行明确提出。",clarification:true,runTrace}};
    if(prepared.plan.caseObservationUse==="selected"&&internal.foreground&&internal.caseObservation)
      return {result:answerCaseObservation(internal.caseObservation,runTrace)};
    if(prepared.plan.layerObservationUse==="selected"&&internal.foreground&&internal.layerObservation)
      return {result:answerLayerObservation(internal.layerObservation,runTrace)};
    if(requiresUnavailableRange(prepared.plan))return unavailableReply();
    if(internal.foreground&&(["read","search"].includes(prepared.plan.action)||prepared.plan.observationUse==="selected")){
      signal.throwIfAborted();
      const {caseObservationUse:_caseUse,layerObservationUse:_layerUse,...researchPlan}=prepared.plan;
      return {runtimeTurnHandoff:runtimeTurnHandoff(body,researchPlan,runTrace,{...internal,turnContext,historicalTargets:internal.conversationHistory?turnPlanningTargets(planningInput).filter(target=>target.basis==="history"&&internal.conversationHistory!.sourceTargets(query).some(({reference})=>reference.kind==="asset"?target.id===reference.id:target.url===reference.url)):internal.handoff?.historicalTargets})};
    }
    const turn=prepared.plan,evidenceAuthority=discoveryAuthority(turn);
    if((clarification||internal.handoff&&turn.action==="search")&&evidenceAuthority.allowDiscovery&&turn.gridIntent!=="count"&&turn.gridIntent!=="catalogue")
      prepared.retrieval=await find(turn);
    const blockedDiscovery=turn.action==="search"&&!evidenceAuthority.allowDiscovery;
    const blockedReason=blockedDiscovery?(evidenceAuthority.discoveryLimit||"原任务没有允许独立发现的范围，未发出该请求。"):undefined;
    const priorReferences=prior?.answerNotes?.references||[];
    const evidencePlan:TurnPlan=blockedDiscovery?{...turn,action:"respond",goal:(decision?.dataQuestion||query).slice(0,1200),
      evidenceGap:undefined,evidenceNeed:"none",targets:turnPlanningTargets(planningInput).filter(target=>
      ["attachment","citation","numbered","question"].includes(target.basis)||
      target.basis==="history"&&priorReferences.length===1&&priorReferences.some(ref=>ref.kind==="web"?ref.url===target.url:ref.id===target.id))
      .map(target=>target.kind==="web"?{...target,alreadyRead:false}:target)}:turn;
    if(turn.observationUse==="unavailable")return {result:{message:turn.clarification!,clarification:true,runTrace,
      ...turnMetadata(query,{history,conversationContext}),observationMaterialsUnavailable:true}};
    const gridQuestion=turn.gridIntent==="count"||turn.gridIntent==="catalogue"?turn.gridIntent:gridLimits?.currentCoverageOnly?"catalogue":undefined;
    if(gridQuestion&&gridCoverage){
      const archivedIds=gridCataloguePaperIds(gridCoverage).filter(id=>cachedPapers.get(id));
      const papers=gridQuestion==="catalogue"?await loadPapers(gridCataloguePaperIds(gridCoverage)):[];
      const coveredHaina=gridQuestion==="catalogue"&&gridCoverage.status==="ready"
        ? [...new Set(gridCoverage.sourceIds.filter(id=>/^haina:[1-9][0-9]*$/.test(id)))].slice(0,20) : [];
      const archivedHaina=coveredHaina.filter(id=>haina.has(id));
      const missingHaina=coveredHaina.filter(id=>!haina.has(id));
      const matchedHaina=new Set(archivedHaina);
      if(missingHaina.length){
        const exact=await readGridHainaRecords(missingHaina,signal);
        const resolved=exact.hainaRecords?.map(row=>"haina:"+row.id)??[];
        haina.remember(exact);
        for(const id of resolved)matchedHaina.add(id);
        report({id:"grid-catalogue-haina",kind:"tool",name:"按覆盖来源身份读取海纳目录记录",
          input:JSON.stringify({requested:missingHaina}),status:resolved.length===missingHaina.length?"done":"partial",
          output:JSON.stringify({level:"catalogue-record",resolved})});
      }
      const other=gridCoverage.status==="ready"?gridCoverage.sourceIds.flatMap(id=>{
        const asset=!paperId(id)&&(!id.startsWith("haina:")||matchedHaina.has(id))?assetById.get(id):undefined;
        return asset?[asset]:[];
      }):[];
      const reply=gridCatalogueAnswer(gridCoverage,gridQuestion,papers,other,archivedIds);
      if(gridLimits?.currentCoverageOnly&&(turn.gridIntent==="deeper"||turn.gridIntent==="none"||turn.action==="clarify")){
        reply.clarification=true;
        reply.message="当前覆盖结果仅支持目录定位，尚不足以判断论文原文、方法或科学结论。以下保留可核对的目录身份；本轮没有另行搜索或读取原文。\n\n"+reply.message;
      }
      const used=reply.answerNotes?.references?.flatMap(r=>r.kind==="asset"?[r.id]:[])||[];
      const incomplete=gridCoverage.status==="ready"&&gridQuestion==="catalogue"&&gridCoverage.count>0&&
        (!gridCoverage.sourceIds.length||gridCoverage.sourceIds.some(id=>!used.includes(id)));
      report({id:"grid-catalogue-answer",kind:"tool",name:"按权威覆盖范围整理目录条目",status:reply.clarification||incomplete?"partial":"done",
        input:JSON.stringify({plannedAction:turn.action,scopeId:gridCoverage.status==="ready"?gridCoverage.scopeId:undefined,revision:gridCoverage.revision}),
        output:JSON.stringify({mode:gridQuestion,papers:reply.paperRecords?.map(p=>p.id)||[],archivedIds,level:"catalogue-location",discoveryDelegated:false,sourceRead:false})});
      if(reply.answerNotes){reply.answerNotes.elapsedMs=Date.now()-runTrace.started;reply.answerNotes.executor=executor.name==="codex"?"Codex":"Claude Code";}
      const hainaRecords=haina.records().filter(r=>used.includes("haina:"+r.id)),hainaCatalog=haina.status();
      if(archivedHaina.some(id=>used.includes(id))&&reply.answerNotes)
        reply.answerNotes.limitation+="\n部分海纳条目沿用同会话的原目录记录，不代表重新核实了当前目录内容。";
      if(hainaRecords.length&&!hainaCatalog&&reply.answerNotes)reply.answerNotes.limitation+="\n已保留原档海纳对象，但未取得对应目录状态；不能据此声称当前海纳目录已核实。";
      const result:DiscoveryResponse={...reply,runTrace,modelExecutor:executor.name,researchIntent:turn.researchIntent,
        resultBatch:gridCatalogueBatch(batchOwner,query,used,gridCoverage.revision,!incomplete&&!reply.clarification&&gridCoverage.status==="ready"),
        conversationContext:turn.conversationContext,conversationEvidence,conversationAssertionEvidence,
        hainaRecords,...(hainaCatalog?{hainaCatalog}:{})};
      if(turn.workspaceOperation==="present-catalogue"||internal.flightCatalogue?.present){
        const target=!result.clarification&&cataloguePresentationTarget(result,{runId:taskId,conversationId:body.conversationId,turnId:body.turnId});
        if(target)result.workspaceOperation={kind:"present-catalogue",batchId:target.batchId};
        else if(result.answerNotes)
          result.answerNotes.limitation+="\n本轮目录中没有可核对版本的绘制对象，未提交球面呈现。";
      }
      return {result:literatureDisplay(result)};
    }
    if(gridCoverage&&gridLimits?.noDiscovery&&turn.action==="search")return {result:{message:"本轮已限定不另行搜索，尚未执行新发现。可依据已有材料继续，或明确要读取的具体来源。",clarification:true,gridCoverage,runTrace}};
    let retrieved=prepared.retrieval;
    let readRuns:SearchRun[]=[];
    let readIssues:string[]=[];
    const readTargets=async(plan:TurnPlan,question:string,callPrefix?:string,executionSignal?:AbortSignal)=>{
      readIssues=[];
      const policy=evidenceAuthority.sourcePolicy;
      const sources=policy?.mode==="restricted"?(policy.fallback?scopedDiscoverySources(lastDiscoveryResult??retrieved)||policy.sources.slice(0,1):policy.sources):undefined;
      const allowed=plan.targets.filter(target=>!sources||(target.kind==="asset"&&target.id&&paperId(target.id)?sources.includes("paper"):!target.url||sources.includes("web")));
      if(allowed.length!==plan.targets.length){
        const message="原来源范围不允许读取这些对象；未对被排除的来源发出请求。";readIssues.push(message);
        report({id:(callPrefix||"initial-")+"read-scope",kind:"tool",name:"核对原读取范围",input:JSON.stringify({allowed:allowed.map(t=>t.key)}),status:"partial",error:message});
      }
      const progress:SearchRun[]=[];
      const searches=await executor.read({...plan,targets:allowed},question,{stage,report,callPrefix,executionSignal,onFailure:message=>{readIssues.push(message);},
      persistProgress:async fact=>{await tasks.append(taskId,{researchProgressFact:fact});},
      options:{onAccepted:async binding=>{if(!runtimeStepContext.getStore()?.replaying)await tasks.append(taskId,{sourceReadBinding:binding});},
        onCheckpoint:async binding=>{if(!runtimeStepContext.getStore()?.replaying)await tasks.append(taskId,{sourceReadBinding:binding});}},onResult:async material=>{readIssues.push(...material.issues);await retainMaterials(material);progress.push(...material.searches);}});
      return [...new Map([...progress,...searches].map(run=>[JSON.stringify(run),run])).values()];
    };
    await regionTask;
    if(gridCoverage&&!gridCoverage.summary&&(turn.action==="search" || turn.action==="clarify" || turn.action==="read")){
      return {result:literatureDisplay({message:gridCoverageSummary(gridCoverage),clarification:true,gridCoverage,runTrace,
        researchIntent:turn.researchIntent,conversationContext:turn.conversationContext})};
    }
    const policy=retrieved?.plan.sourcePolicy;
    const restricted=scopedDiscoverySources(retrieved);
    if(retrieved&&policy?.mode==="restricted"&&restricted&&!retrieved.questionCheck&&!retrieved.clarification&&
      !policy.sources.includes("constellation")&&!restricted.includes("web")&&!retrieved.haina.length&&!retrieved.papers.length&&
      !retrieved.searches.some(run=>run.hits.length)){
      const checked=retrieved.sourceStatus.filter(row=>row.status!=="not_requested");
      const zero=checked.length===policy.sources.length&&checked.every(row=>row.status==="done"&&row.count===0);
      const labels=(zero||!restricted.length?policy.sources:restricted).map(source=>({haina:"海纳目录",paper:"论文断言库",web:"公开网络",constellation:"星座接收库"})[source]).join("、");
      const message=zero
        ? "本轮仅查找了"+labels+"，未返回符合条件的资料。你希望我扩大到其他来源吗？"
        : "本轮范围限于"+labels+"，查询未完整完成，目前无法确认有无匹配资料。你希望重试该范围，还是查其他来源？";
      return {result:literatureDisplay({message,runTrace,researchRegion,gridCoverage,resultBatch:discoveryResultBatch(batchOwner,actualDiscoveryQuery||query,retrieved),
        researchIntent:retrieved.plan.researchIntent||turn.researchIntent,
        conversationContext:retrieved.plan.conversationContext||turn.conversationContext,
        ...(retrieved.hainaCatalog?{hainaCatalog:retrieved.hainaCatalog}:{})})};
    }
    if(!retrieved?.questionCheck&&!retrieved?.clarification&&(retrieved||turn.action==="read"||blockedDiscovery)){
      const targetQuery=decision?.dataQuestion||query;
      if(turn.action==="read"){
        readRuns=await readTargets(turn,targetQuery);
        if(!readRuns.length&&!currentAssertionReadings.length&&!readIssues.length)readIssues.push("本轮未取得新的网页或文献资料节选，未确认成功读取正文。");
      }
      // Workspace and exact reference routing retain their existing scope. A review
      // receives actual results from each action, never a hypothetical tool result.
      if(turn.action==="read"||blockedDiscovery||retrieved||readRuns.length||currentAssertionReadings.length||readIssues.length){
        const outcome=await continueResearch(targetQuery,evidencePlan,{retrieval:retrieved,reads:readRuns,assertionReadings:currentAssertionReadings,issues:readIssues,
          blockedDiscovery:blockedReason,attemptedReadTargets:turn.action==="read"?turn.targets.flatMap(target=>target.url?[target.url]:[]):[]},signal,{
          model:(prompt,operationSignal)=>executor.model(prompt,{outputSchema:evidenceDecisionSchema},operationSignal),
          read:async(targets,focus,step,operationSignal)=>{const searches=await readTargets({...evidencePlan,action:"read",targets},targetQuery+"\n"+focus,"research-read-"+step+"-",operationSignal);return {searches,issues:readIssues};},
          discover:(focus,_step,operationSignal)=>initialDiscoveryId?find(turn,{previousId:initialDiscoveryId,focus},undefined,operationSignal):find(turn,undefined,focus,operationSignal),stage,report,
        },decision,evidenceAuthority);
        if(outcome.clarification){
          const material=outcome.retrieval??lastDiscoveryResult;
          if(material?.papers.length)cachedPapers.remember(material.papers);
          runTrace.searches=[...(material?.searches||[]),...outcome.reads];
          return {result:literatureDisplay({
          message:outcome.clarification,clarification:true,runTrace,researchRegion,
          ...(lastDiscoveryResult?.questionCheck?{questionCheck:lastDiscoveryResult.questionCheck}:{}),
          ...(material?{resultBatch:discoveryResultBatch(batchOwner,actualDiscoveryQuery||query,lastDiscoveryResult??material)}:{}),
          ...(researchClarificationPrompt(lastDiscoveryResult,lastBinding)?{clarificationPrompt:researchClarificationPrompt(lastDiscoveryResult,lastBinding)}:{}),
          ...(lastDiscoveryResult?.clarification&&lastBinding?.state==="TASK_STATE_INPUT_REQUIRED"?{discoveryClarification:true}:{}),
          ...(material?.papers.length?{paperRecords:material.papers}:{}),
          hainaRecords:(material?.haina||[]).flatMap(asset=>haina.records().filter(r=>r.id===Number(asset.datasetId.slice(6)))),
          ...(gridCoverage?{gridCoverage}:{}),
          researchIntent:retrieved?.plan.researchIntent||turn.researchIntent,
          conversationContext:retrieved?.plan.conversationContext||turn.conversationContext,
          conversationEvidence,conversationAssertionEvidence,
        })};
        }
        retrieved=outcome.retrieval;
        readRuns=outcome.reads;
        readIssues=outcome.issues||[];
        report({id:"research-assessment",kind:"tool",name:"记录有界取证判断的实际结果",input:"不把停止或无效输出当作证据充分",status:outcome.assessment==="answer"?"done":"partial",output:JSON.stringify({assessment:outcome.assessment,issues:readIssues})});
      }
    }
    if(turn.action!=="search"||blockedDiscovery){
      const complete=(reply:DiscoveryResponse)=>{
        reply.runTrace=literatureDisplay(runTrace);
        if(gridCoverage)reply.gridCoverage=gridCoverage;
        if(haina.records().length)reply.hainaRecords=haina.records();
        if(haina.status())reply.hainaCatalog=haina.status();
        return {result:literatureDisplay(reply)};
      };
      const continuity={researchIntent:turn.researchIntent,conversationContext:turn.conversationContext,conversationEvidence,conversationAssertionEvidence};
      const pending=internal.pending??internal.handoff?.pending;
      const boundPending=internal.approvedConfirmation||turn.pendingTaskId&&turn.pendingTaskId===pending?.taskId?pending:undefined;
      const boundProposal=boundPending?.proposedAction;
      if(boundPending&&turn.pendingApproval&&!boundProposal){
        return complete({message:"原待办还没有确定的操作目标，不能仅凭同意替你选择。请明确要操作的对象。",clarification:true,
          workspacePending:{question:boundPending.question,originalQuestion:boundPending.originalQuestion},...continuity});
      }
      const continuingProposal=!!boundProposal&&internal.approvedConfirmation;
      if(continuingProposal){
        if(turn.action==="workspace"&&!turn.pendingApproval||turn.workspaceReply||turn.workspaceOperation||turn.workspaceNavigation||turn.workspaceLayerRequest)
          return complete({message:"这次决定不符合原待办的具体操作，尚未执行。请明确新的目标或确认原提案。",clarification:true,...continuity});
        if(!turn.workspaceAction&&!turn.workspaceLookup&&!turn.workspaceDateLookup)turn.workspaceAction=structuredClone(boundProposal);
      }
      if(turn.workspaceLookup){
        const resolved=workspaceResolution?.lookup?.(turn.workspaceLookup.query);
        report({id:"workspace-city-lookup",kind:"tool",name:"核对模型所指城市的发布身份",input:JSON.stringify(turn.workspaceLookup),
          status:resolved?.choice?"done":"partial",output:JSON.stringify(resolved||{issue:"当前城市目录不可用"})});
        if(!resolved?.choice||!workspaceResolution?.proof)return complete({message:resolved?.issue||"当前城市目录不可用，本轮未切换城市。",clarification:true,...continuity});
        const layer=context.workspaceView!.activeLayer!,control=layer.controls.find(control=>control.id==="city")!;
        if(!control.options.some(option=>option.id===resolved.choice!.id))control.options=[...control.options,resolved.choice];
        turn.workspaceAction={kind:"set-control",layerId:"c40",controlId:"city",valueId:resolved.choice.id,publicationRevision:workspaceResolution.proof.revision};
      }
      if(turn.workspaceDateLookup){
        const resolved=forestResolution?.lookup?.(turn.workspaceDateLookup);
        report({id:"workspace-date-lookup",kind:"tool",name:"核对模型所指的已发布森林日期",input:JSON.stringify(turn.workspaceDateLookup),
          status:resolved?.choice?"done":"partial",output:JSON.stringify(resolved||{issue:"当前森林日期目录不可用"})});
        if(!resolved?.choice||!forestResolution?.proof)return complete({message:resolved?.issue||"当前森林日期目录不可用，本轮未切换。",clarification:true,...continuity});
        const layer=context.workspaceView!.activeLayer!,control=layer.controls.find(control=>control.id==="time")!;
        if(!control.options.some(option=>option.id===resolved.choice!.id))control.options=[...control.options,resolved.choice];
        turn.workspaceAction={kind:"set-control",layerId:"forest",controlId:"time",valueId:resolved.choice.id,publicationRevision:forestResolution.proof.revision};
      }
      // A model action never releases an earlier proposal, including legacy
      // records without a dialog. Re-issue that exact proposal for explicit UI approval.
      const sameProposedTarget=!!pending?.proposedAction&&turn.workspaceAction?.kind===pending.proposedAction.kind&&
        turn.workspaceAction.layerId===pending.proposedAction.layerId&&turn.workspaceAction.controlId===pending.proposedAction.controlId&&turn.workspaceAction.valueId===pending.proposedAction.valueId;
      if(pending?.proposedAction&&!internal.approvedConfirmation&&turn.action==="workspace"&&(pending.answer!==undefined||sameProposedTarget)){
        turn.action="clarify";turn.workspacePending=true;turn.clarification="原具体提案仍需明确确认；本轮没有执行。";
        turn.workspaceAction=structuredClone(pending.proposedAction);
        delete turn.workspaceLookup;delete turn.workspaceDateLookup;delete turn.workspaceNavigation;delete turn.workspaceReply;delete turn.workspaceOperation;delete turn.workspaceLayerRequest;
        const action=turn.workspaceAction,control=context.workspaceView?.activeLayer?.controls.find(control=>control.id===action.controlId);
        if(control&&!control.options.some(choice=>choice.id===action.valueId)&&control.publication?.revision===action.publicationRevision){
          const choice=action.layerId==="forest"?forestResolution?.lookup?.({mode:"exact",date:action.valueId}).choice:workspaceResolution?.lookup?.(action.valueId).choice;
          if(choice?.id===action.valueId)control.options=[...control.options,choice];
        }
        if(!pending.proposalOrigin)return complete({message:"旧提案缺少可核对的原控件状态，不能代为确认。请按当前视图重新提出目标。",clarification:true,...continuity});
        if(pending.proposalOrigin){
          const origin=pending.proposalOrigin,current=context.workspaceView?.activeLayer;
          if(current?.id!==origin.layerId||current.controls.find(control=>control.id===origin.controlId)?.current.id!==origin.valueId)
            return complete({message:"原提案的控件状态已变化，请按当前视图重新发问。",clarification:true,...continuity});
        }
      }
      if(continuingProposal){
        const action=turn.workspaceAction,control=context.workspaceView?.activeLayer?.controls.find(control=>control.id===action?.controlId);
        const tuple=(value:typeof action)=>value?[value.kind,value.layerId,value.controlId,value.valueId,value.publicationRevision??null]:null;
        if(!action||!isDeepStrictEqual(tuple(action),tuple(boundProposal))||control?.publication?.revision!==action.publicationRevision)
          return complete({message:"这次目标或目录修订与原提案不一致，尚未执行。请重新提出并确认目标。",clarification:true,...continuity});
        if(control?.publication&&!control.options.some(choice=>choice.id===action.valueId)){
          const choice=action.layerId==="forest"?forestResolution?.lookup?.({mode:"exact",date:action.valueId}).choice:workspaceResolution?.lookup?.(action.valueId).choice;
          if(choice?.id===action.valueId)control.options=[...control.options,choice];
        }
        if(!workspaceViewActionAllowed(context.workspaceView,action))return complete({message:"原提案的控件或发布目录已不可用，尚未执行。",clarification:true,...continuity});
        if(pending?.clarificationPrompt?.kind==="confirmation"){
          const origin=pending.proposalOrigin,current=context.workspaceView?.activeLayer;
          if(!origin||current?.id!==origin.layerId||current.controls.find(control=>control.id===origin.controlId)?.current.id!==origin.valueId)
            return complete({message:"提出确认后工作台控件已改变，原提案已过期，未执行操作。",clarification:true,...continuity});
        }
      }
      if(turn.action==="clarify"){
        const proposal=turn.workspacePending?turn.workspaceAction:undefined;
        if(proposal&&(!workspaceViewActionAllowed(context.workspaceView,proposal)||proposal.publicationRevision&&!await controlResolution(proposal.layerId)?.revalidate?.(signal)))
          return complete({message:"提案的控件或目录修订已不可用，尚未形成可确认目标。请刷新后重新选择。",clarification:true,...continuity});
        if(proposal)report({id:"workspace-proposal",kind:"tool",name:"保存未执行的界面提案",input:JSON.stringify(proposal),status:"done",output:"仅等待研究者确认，未交付界面动作。"});
        const proposedControl=proposal?context.workspaceView?.activeLayer?.controls.find(control=>control.id===proposal.controlId):undefined;
        const proposedLabel=proposedControl?.options.find(choice=>choice.id===proposal?.valueId)?.label;
        const suffix=proposal?" 待执行目标："+proposedControl!.label+" → "+proposedLabel+"。":"";
        const question=proposal?turn.clarification!.slice(0,Math.max(0,500-suffix.length))+suffix:turn.clarification!;
        const clarificationPrompt=createClarificationPrompt(proposal?"confirmation":"chat",question,turn.clarificationOptions);
        if(!clarificationPrompt)throw new TurnPlanningFailure();
        const reply={message:question,clarification:true,...continuity,
          clarificationPrompt,
          ...(turn.workspacePending?{workspacePending:{question,originalQuestion:boundPending?.originalQuestion??body.query,
            ...(proposal?{proposedAction:proposal,proposalOrigin:{layerId:context.workspaceView!.activeLayer!.id,controlId:proposedControl!.id,valueId:proposedControl!.current.id}}:{})}}:{})};
        return complete(reply);
      }
      if(turn.action==="workspace"&&turn.workspaceLayerRequest){
        const request=turn.workspaceLayerRequest;
        const resolved=await resolveWorkspacePublishedLayer(request.datasetId,request.selection,signal);
        report({id:"workspace-published-layer",kind:"tool",name:"核对模型选择的已发布图层条目",input:JSON.stringify(request),status:resolved.action?"done":"partial",
          output:JSON.stringify({action:resolved.action,read:resolved.read,issue:resolved.issue})});
        if(!resolved.action)return complete({message:resolved.issue||"所选发布图层暂不可用，本轮未加载。",clarification:true,...continuity});
        const current=await resolved.revalidate?.(signal);
        report({id:"workspace-published-layer-final",kind:"tool",name:"重验加载条目的发布修订",input:JSON.stringify(resolved.action),status:current?"done":"partial",
          output:current?"修订未变；仅交由网页核验后加载，尚非网页应用回执。":"发布目录变化或不可用，未交付加载动作。"});
        if(!current)return complete({message:"发布目录已变化或暂不可用，本轮未加载。请按当前目录重新选择。",clarification:true,...continuity});
        signal.throwIfAborted();
        return complete({message:"将加载「"+resolved.title+"」并选择「"+resolved.label+"」，由网页核验原工作台状态后应用。",workspaceLayerOpen:resolved.action,...continuity});
      }
      const hasSourceMaterial=turn.targets.length||context.citation||context.attachedScope?.some(item=>item.kind==="dataset"||item.kind==="reference")||
        conversationEvidence?.length||conversationAssertionEvidence?.length||prior?.answerNotes?.references?.length;
      if(internal.foreground&&internal.publicAnswer&&turn.action==="respond"&&!hasSourceMaterial)
        return complete({message:await plainPublicAnswer(body,{...internal,turnContext},executor,signal),...continuity});
      if(internal.foreground&&turn.action==="respond"&&turn.foregroundReply&&!hasSourceMaterial)
        return complete({message:turn.foregroundReply,...continuity});
      if(turn.workspaceOperation){
        if(turn.workspaceOperation==="present-catalogue")throw new TurnPlanningFailure();
        const kind=turn.workspaceOperation;
        if(kind==="adopt-research-range"||kind==="clear-research-range"){
          if(!rangeObservation||!services.workspaceResearch)throw new TurnPlanningFailure();
          const {actionId,expectedRevision,range}=rangeObservation;
          if(kind==="adopt-research-range"&&(!adoptRange||!range)||kind==="clear-research-range"&&!clearRange)
            throw new TurnPlanningFailure();
          const action=kind==="adopt-research-range"&&range?{kind,range,actionId,expectedRevision} as const:
            {kind:"clear-research-range",actionId,expectedRevision} as const;
          signal.throwIfAborted();
          const decision=await services.workspaceResearch.apply(body.conversationId,action,{source:"chat",runId:taskId,turnId:body.turnId},signal);
          report({id:"workspace-research-action",kind:"tool",name:"保存会话研究范围",status:decision.status===200?"done":"partial",
            input:action.actionId,output:decision.status===200?"会话范围操作已保存。":decision.error});
          if(decision.status!==200)return complete({message:decision.error,workspaceResearchError:decision.code,...continuity});
          const message=kind==="adopt-research-range"?"已采用发问时选中的网格作为会话研究范围。":"已清除会话研究范围。";
          return complete({message,workspaceResearchState:decision.state,...continuity});
        }
        const message="已确定当前工作台操作。";
        const reply={message,workspaceOperation:{kind:turn.workspaceOperation},...continuity};
        report({id:"workspace-action",kind:"tool",name:"确认当前工作台操作",input:JSON.stringify(reply.workspaceOperation),status:"done",output:"交由网页按原工作台状态核验后执行。"});
        return complete(reply);
      }
      if(turn.action==="workspace"&&turn.workspaceAction){
        if(!internal.semanticDecision&&!authorizesWorkspaceViewAction(decision?.dataQuestion||query)||!workspaceViewActionAllowed(context.workspaceView,turn.workspaceAction))throw new TurnPlanningFailure();
        const action=turn.workspaceAction,layer=context.workspaceView!.activeLayer!,control=layer.controls.find(c=>c.id===action.controlId)!;
        if(action.publicationRevision&&!await controlResolution(action.layerId)?.revalidate?.(signal)){
          report({id:action.layerId==="forest"?"workspace-forest-publication-final":"workspace-c40-publication-final",kind:"tool",name:"重验控件选择的发布修订",input:action.publicationRevision,status:"partial",output:"目录已变化或暂不可用，未交付切换动作。"});
          return complete({message:"发布目录已变化或暂不可用，本轮未切换。请刷新当前目录后再选择。",clarification:true,...continuity});
        }
        const choice=control.options.find(c=>c.id===action.valueId)!;
        report({id:"workspace-action",kind:"tool",name:"确认当前界面控件目标",input:JSON.stringify(action),status:"done",
          output:JSON.stringify({validated:true,application:"交由网页核对发问时状态后应用"})});
        return complete({message:"将「"+layer.title+"」的「"+control.label+"」切换为「"+choice.label+"」。",workspaceAction:action,...continuity});
      }
      const targetQuery=decision?.dataQuestion||query;
      const pinnedIds=turn.targets.flatMap(t=>t.id?[t.id]:[]);
      const pinnedPapers=turn.action==="workspace"?await loadPapers(pinnedIds.length?pinnedIds:context.workspaceView||internal.semanticDecision?[]:context.candidateIds||[]):
        pinnedIds.flatMap(id=>cachedPapers.get(id)||[]);
      if(pinnedPapers.length)registerPapers(pinnedPapers,false);
      if(turn.workspaceReply)return complete({...turn.workspaceReply,...continuity,...(pinnedPapers.length?{paperRecords:pinnedPapers}:{})});
      const chinaBoundaryDirectory=path.join(adminBoundaryDir,"datav");
      const administrativeLevel=(place:string,photon?:PlaceHit):"city"|"district"|null=>{
        // Towns and villages have no boundary in the dataset; never borrow the county's.
        if(/[镇乡村]$/u.test(place)||/街道$/u.test(place))return null;
        if(/[市州盟]$/u.test(place))return "city";
        if(/[区县旗]$/u.test(place))return "district";
        if(photon?.type==="city")return "city";
        if(photon?.type==="county"||photon?.type==="district")return "district";
        return null;
      };
      const administrativeReply=async(name:string,point:[number,number],hints:{province?:string;city?:string;level?:"city"|"district"|null}):Promise<DiscoveryResponse|null>=>{
        if(!chinaBoundaryEnabled()||!hints.level)return null;
        const hit=await chinaBoundary(name,point,hints,chinaBoundaryDirectory);
        if(!hit)return null;
        const region={label:hit.name,status:"located" as const,geometry:hit.geometry,precision:"boundary" as const,
          source:"DataV.GeoAtlas",sourceUrl:"https://datav.aliyun.com/portal/school/atlas/area_selector",
          note:"行政区轮廓仅用于定位，不代表研究区边界或数据覆盖。"};
        if(!validResearchRegion(region))return null;
        return {message:"已定位到「"+hit.name+"」并高亮行政区轮廓。轮廓来自 DataV.GeoAtlas，仅用于定位，不代表研究区或数据覆盖。",researchRegion:region};
      };
      const photonReply=(hit:PlaceHit):DiscoveryResponse=>({message:"已定位到「"+hit.label+"」"+(hit.detail?"（"+hit.detail+"）":"")+"。地名位置来自 OpenStreetMap，只用于移动视图，不代表研究区或数据覆盖。",
        camera:{center:hit.center,zoom:hit.zoom,reason:"地名定位 · "+hit.label},fly:true,placeLabel:hit.label});
      const wikipediaReply=(hit:PlaceHit):DiscoveryResponse=>({message:"已按维基百科「"+hit.label+"」定位到近似中心。该位置只用于移动视图，不代表流域边界、研究区或数据覆盖。",
        camera:{center:hit.center,zoom:hit.zoom,reason:"地名定位 · "+hit.label},fly:true,placeLabel:hit.label});
      /** Local atlas first, then OSM, then the encyclopedia for basin names and shorthands. */
      async function placeReplyFor(name:string):Promise<DiscoveryResponse|null>{
        const region=await researchRegionService.locate(name).catch(()=>null);
        if(region?.status==="located"&&region.precision==="global")
          return {message:"已回到全球视图。",camera:{center:[105,20],zoom:1,reason:"全球总览"},fly:true};
        if(region?.status==="located")
          return {message:"已定位到「"+region.label+"」。"+(region.precision==="boundary"?"轮廓仅用于定位，不代表研究区或数据覆盖。":""),researchRegion:region};
        if(!geocoderEnabled())return null;
        const photon=await photonLookup(name,controller.signal).catch(()=>null);
        if(photon&&!photon.weak){
          const level=administrativeLevel(photon.label,photon);
          const boundary=level?await administrativeReply(photon.label,photon.center,{province:photon.province,city:photon.city,level}):null;
          return boundary??photonReply(photon);
        }
        const wikipedia=await wikipediaLookup(name,controller.signal).catch(()=>null);
        if(wikipedia){
          const level=administrativeLevel(wikipedia.label);
          const boundary=level?await administrativeReply(wikipedia.label,wikipedia.center,{level}):null;
          return boundary??wikipediaReply(wikipedia);
        }
        return null;
      }
      async function resolveNavigation(navigation:NavigationTarget):Promise<DiscoveryResponse>{
        const tried=new Set<string>();
        for(const name of placeVariants(navigation.place)){
          if(tried.has(name))continue;
          tried.add(name);
          const reply=await placeReplyFor(name);
          if(reply)return reply;
        }
        if(internal.semanticDecision)return {message:"没有找到「"+navigation.place+"」的权威定位，尚未移动地图。可补充更确切的地名或坐标。",clarification:true};
        // Last resort: the model only standardizes the name; coordinates still come from a geocoder.
        const canonical=canonicalCache.get(navigation.place);
        const names=canonical&&Date.now()-canonical.at<3600000?canonical.names:await canonicalPlaceNames(navigation.place,
          prompt=>executor.model(prompt,{outputSchema:placeLookupSchema},AbortSignal.any([signal,AbortSignal.timeout(20000)])));
        if(!canonical||Date.now()-canonical.at>=3600000)canonicalCache.set(navigation.place,{at:Date.now(),names});
        for(const name of names.flatMap(placeVariants)){
          if(tried.has(name))continue;
          tried.add(name);
          const reply=await placeReplyFor(name);
          if(reply)return {...reply,message:"「"+navigation.place+"」按「"+name+"」定位。"+reply.message};
        }
        return {message:"没有找到「"+navigation.place+"」的位置。可以补充更完整的具体名称（例如所在市、县或全称），或直接给出经纬度（例如 120.2E, 30.3N）。"};
      }
      if(turn.action==="workspace"){
        if(internal.semanticDecision&&!turn.workspaceNavigation){
          const target=turn.targets.length===1?turn.targets[0]:undefined;
          if(target?.kind==="asset"&&target.id)return complete({message:"将打开「"+target.title+"」的数据速览。",inspectId:target.id,...continuity});
          return complete({message:"还没有确定可执行的界面目标。请明确要打开的对象或当前可用控件。",clarification:true,...continuity});
        }
        const operationContext={...context,...(pinnedIds.length?{candidateIds:pinnedIds,inCandidateScope:true}:{})};
        let operation=internal.semanticDecision?{message:"正在核对模型所指位置。"} as DiscoveryResponse:discoverConversation(targetQuery,operationContext);
        if(pinnedIds.length===1 && (assetById.has(pinnedIds[0])||/^haina:\d+$/.test(pinnedIds[0])) && /^(?:请|帮我)?(?:打开|预览|查看)/.test(targetQuery))
          operation={message:"已打开「"+(assetById.get(pinnedIds[0])?.title||turn.targets.find(t=>t.id===pinnedIds[0])?.title||pinnedIds[0])+"」的数据速览。",inspectId:pinnedIds[0]};
        const operationKeys=["camera","gridSystem","filters","clearSelection","view","selectCenter","previewNeed","inspectId","dataView","visualization","catalogQuery","mesh","layer","researchRegion"];
        const isActionable=()=>operationKeys.some(key=>Object.hasOwn(operation,key));
        let actionable=isActionable(),navigationHandled=false;
        const requestedNavigation=turn.workspaceNavigation?{verb:"model",place:turn.workspaceNavigation.place}:navigationTarget(targetQuery,!!context.workspaceView);
        if(turn.workspaceNavigation){operation={message:"正在核对模型所指位置。"};actionable=false;}
        const menuTarget=requestedNavigation&&["切换到","切到"].includes(requestedNavigation.verb);
        const explicitCameraNavigation=requestedNavigation&&!menuTarget;
        const localCameraOperation=operation.camera?.reason==="按对话调整视野"||operation.view||operation.gridSystem||operation.visualization||operation.dataView;
        if(c40View&&menuTarget&&!localCameraOperation&&
          !["inspectId","previewNeed","selectCenter","catalogQuery","mesh","layer"].some(key=>Object.hasOwn(operation,key))){
          // A failed menu selection must not reuse a research case's place filter.
          operation={message:"当前目录没有确定的城市选择。"};actionable=false;
        }
        if(c40View&&!explicitCameraNavigation&&operation.camera&&!localCameraOperation){
          delete operation.camera;delete operation.fly;delete operation.clearSelection;delete operation.placeLabel;actionable=isActionable();
        }
        if(!actionable&&(!c40View||explicitCameraNavigation)){
          const navigation=requestedNavigation;
          if(navigation){
            navigationHandled=true;
            try{
              const coordinate=parseCoordinates(navigation.place);
              if(coordinate)
                operation={message:"已定位到 "+coordinate.label+"。",camera:{center:coordinate.center,zoom:coordinate.zoom??60,reason:"地名定位 · "+coordinate.label},fly:true,placeLabel:coordinate.label};
              else
                operation=await resolveNavigation(navigation);
            }catch(error){
              if(controller.signal.aborted)throw error;
              operation={message:"地名定位暂时不可用，可直接给出经纬度（例如 120.2E, 30.3N）。"};
            }
            actionable=isActionable();
          }
        }
        if(flightPlace){
          const target=operation.camera??(operation.researchRegion?researchRegionCamera(operation.researchRegion):null);
          if(!target)return complete({...operation,...continuity});
          report({id:"workspace-flight-locate",kind:"tool",name:"核对飞行地名与原定位来源",input:flightPlace,
            status:"done",output:JSON.stringify({location:operation.message,camera:target,source:operation.researchRegion?.source})});
          return complete({message:"将飞到「"+flightPlace+"」。飞行完成并核对中心地面网格后再查目录。",
            camera:target,fly:true,placeLabel:flightPlace,flightCatalogue:true,...continuity});
        }
        report({id:"workspace-action",kind:"tool",name:"执行当前界面操作",input:targetQuery,status:actionable?"done":"partial",
          output:actionable||navigationHandled?operation.message:"本轮未识别到可执行的界面变更。"});
        return complete({...operation,...(!actionable&&!navigationHandled?c40View
          ?{message:(workspaceResolution?.issue||"没有确定当前界面中的可选城市")+"。本轮未切换城市；请明确目录中的城市名称或刷新后选择。",clarification:true}
          :{message:"本轮没有执行界面切换。可点击引用打开预览，或明确指定要切换的网格、时段或图层。"}:{}),...continuity});
      }
      const discoveryAttempt=initialBinding?"accepted" as const:actualDiscoveryQuery?"submission-attempted" as const:undefined;
      let summary=retrieved?"本轮在指定对象读取之外取得了独立发现回执。":discoveryAttempt==="accepted"?"补查委托已受理，尚未取得结果。":
        discoveryAttempt==="submission-attempted"?"曾尝试提交补查，未确认受理，也未取得结果。":"本轮只处理已指定对象和已有内容，没有启动独立发现。";
      if(readIssues.length)summary+="\n"+readIssues.join("\n");
      const deliveryPlan=blockedDiscovery&&readRuns.length?{...evidencePlan,action:"read" as const,evidenceNeed:"read" as const}:evidencePlan;
      const priorEvidence=context.citation||context.attachedScope?.some(item=>item.kind!=="reference")
        ?undefined:parentResearchEvidence(prior,deliveryPlan,targetQuery);
      if(gridCoverage)summary+="\n"+gridCoverageSummary(gridCoverage);
      if(pinnedIds.length)report({id:"referenced-material",kind:"tool",name:"采用所引资料的已存内容",input:pinnedIds.join("、"),
        status:pinnedIds.every(id=>assetById.has(id))?"done":"partial",output:"已存资料身份 "+pinnedIds.filter(id=>assetById.has(id)).length+" 项；这条所引资料的身份来自已存记录。"});
      const combinedSearches=[...new Map([...(retrieved?.searches||[]),...readRuns].map(run=>[JSON.stringify(run),run])).values()];
      const acquired=retrieved?{...retrieved,searches:combinedSearches,issues:[...new Set([...retrieved.issues,...readIssues])]}:undefined;
      const papers=[...new Map([...pinnedPapers,...(acquired?.papers||[])].map(paper=>[paper.id,paper])).values()];
      const currentBatch=acquired?discoveryResultBatch(batchOwner,actualDiscoveryQuery||query,acquired):undefined;
      if(currentBatch)event({resultBatch:currentBatch});
      const reply=await modelReply(targetQuery,context,{message:summary,gridCoverage},history,executor,signal,
        stage,papers,"",undefined,acquired,report,{plan:deliveryPlan,searches:readRuns,priorEvidence,discoveryAttempt},currentAssertionReadings,{record:prior,searches:archived.searches},await synthesisContext(),currentBatch,{onProgress:synthesisProgress});
      if(reply.answerNotes && deliveryPlan.action==="respond" && deliveryPlan.evidenceNeed==="existing" &&
          !discoveryAttempt && !combinedSearches.length && body.previousTaskId){
        const selected=new Set(context.attachedScope?.flatMap(item=>
          item.kind==="reference"&&item.messageId===body.previousTaskId&&item.reference.kind==="asset"?[item.reference.id]:[]));
        const catalogue=new Set(prior?.answerNotes?.references?.flatMap(ref=>
          ref.kind==="asset"&&ref.evidenceLevel==="catalogue-record"&&selected.has(ref.id)?[ref.id]:[]));
        if(catalogue.size)reply.answerNotes.references=reply.answerNotes.references?.map(ref=>
          ref.kind==="asset"&&catalogue.has(ref.id)?{...ref,evidenceLevel:"catalogue-record"}:ref);
      }
      if(currentBatch)reply.resultBatch=currentBatch;
      if(papers.length)reply.paperRecords=literatureDisplay(papers);
      reply.hainaRecords=pinnedIds.flatMap(id=>id.startsWith("haina:")?haina.records().filter(r=>String(r.id)===id.slice(6)):[]);
      if(reply.answerNotes)reply.answerNotes.elapsedMs=Date.now()-runTrace.started;
      return complete(reply);
    }
    if(retrieved?.questionCheck || retrieved?.clarification){
      const reply:DiscoveryResponse= retrieved.questionCheck
        ? {message:"继续前，先确认我是否理解了你的问题：",questionCheck:retrieved.questionCheck,runTrace,
          researchIntent:retrieved.plan.researchIntent,conversationContext:retrieved.plan.conversationContext,conversationEvidence,conversationAssertionEvidence}
        : {message:retrieved.clarification!,clarification:true,runTrace,researchIntent:retrieved.plan.researchIntent,conversationContext:retrieved.plan.conversationContext,conversationEvidence,conversationAssertionEvidence};
      reply.researchRegion=researchRegion;
      reply.resultBatch=discoveryResultBatch(batchOwner,actualDiscoveryQuery||query,retrieved);
      if(!retrieved.questionCheck){const prompt=researchClarificationPrompt(retrieved,initialBinding);if(prompt)reply.clarificationPrompt=prompt;}
      if(gridCoverage)reply.gridCoverage=gridCoverage;
      if(retrieved.clarification&&initialBinding?.state==="TASK_STATE_INPUT_REQUIRED")Object.assign(reply,{discoveryClarification:true});
      return {result:reply};
    }
    if(retrieved&&readRuns.length)retrieved={...retrieved,searches:[...retrieved.searches,...readRuns]};
    if(retrieved?.papers.length)cachedPapers.remember(retrieved.papers);
    // Auxiliary data framing must not replace the user's operation or scope.
    const lookupQuery=[decision?.dataQuestion || query,retrieved?.plan.conversationContext].filter(Boolean).join("\n");
    const catalogCall={id:"catalog",kind:"tool" as const,name:"OneEarth 数据目录",input:lookupQuery};
    report({...catalogCall,status:"running"});
    const scopedContext=gridCoverage?{...context}:conversationScope(context,retrieved?.plan);
    if(gridCoverage?.status==="ready" && !scopedContext.candidateIds?.length && gridCoverage.sourceIds.length){
      scopedContext.candidateIds=gridCoverage.sourceIds.slice(0,32);scopedContext.inCandidateScope=true;
    }
    const allowConstellation=!restricted||restricted.includes("constellation");
    if(restricted?.length===1&&restricted[0]==="constellation"){
      scopedContext.filters={...scopedContext.filters,source:"constellation"};
    }
    const observation=gridCoverage||!allowConstellation?undefined:discoverObservations(lookupQuery,scopedContext,push);
    const constellationFeed=allowConstellation?(observation?.pushFeed||push.latest()):undefined;
    if(constellationFeed)registerObservations(constellationFeed.records,!observation);
    const localResult=async()=>{
      const action={id:"local-catalogue",area:"catalog"} as const;
      researchProgress({...action,status:"running"});
      try {
        const local=retrieved?discoverConversation(decision?.dataQuestion || query,scopedContext,retrieved.plan.conversationContext):discover(query,scopedContext);
        researchProgress({...action,status:"done"});
        return resolveSceneQuery(lookupQuery,local,signal,researchProgress);
      } catch(error) {
        if(!signal.aborted)researchProgress({...action,status:isResearchTimeout(error)?"timeout":"failed"});
        throw error;
      }
    };
    const result=gridCoverage?{message:gridCoverageSummary(gridCoverage),gridCoverage}:
      scopedReply(observation || (restricted&&!restricted.includes("web")?{message:"按用户限定的来源整理本轮实得资料。"}:
        await localResult()),scopedContext,retrieved?.plan);
    report({...catalogCall,status:gridCoverage?.status==="unknown"?"partial":"done",output:result.message});
    {
      const paperTrace=retrieved!.sourceStatus.map(s=>s.source+" "+(s.status==="done"?"完成":s.status==="partial"?"部分完成":s.status==="not_requested"?"未请求":"未完成")+" · "+s.count+" 项").join("；");
      const currentBatch=discoveryResultBatch(batchOwner,actualDiscoveryQuery||query,retrieved!);
      event({resultBatch:currentBatch});
      const reply:DiscoveryResponse=await modelReply(decision?.dataQuestion||query,scopedContext,result,history,executor,signal,
        stage,retrieved!.papers,paperTrace,
        !context.filters.source || context.filters.source==="constellation"?constellationFeed:undefined,retrieved,report,undefined,currentAssertionReadings,{record:prior,searches:archived.searches},await synthesisContext(),currentBatch,{onProgress:synthesisProgress});
      reply.resultBatch=currentBatch;
      if(retrieved!.papers.length)reply.paperRecords=literatureDisplay(retrieved!.papers);
      reply.hainaRecords=retrieved!.haina.flatMap(asset=>{
        const recordId=Number(asset.datasetId.slice(6));
        return haina.records().filter(r=>r.id===recordId);
      });
      if(haina.status())reply.hainaCatalog=haina.status();
      if(reply.answerNotes){
        reply.answerNotes.paperTrace=paperTrace;
        reply.answerNotes.elapsedMs=Date.now()-runTrace.started;
      }
      reply.message=literatureText(reply.message);
      if(reply.answerNotes)reply.answerNotes=literatureDisplay(reply.answerNotes);
      reply.runTrace=literatureDisplay(runTrace);
      reply.researchRegion=researchRegion;
      return {result:reply};
    }
  } catch(err) {
    if(err instanceof TaskParked)throw err;
    if(signal.aborted)throw err;
    const error=modelSafeText(err instanceof SyntaxError?"模型回复格式异常，请重试。":err instanceof Error?err.message:"数据发现请求未能完成。");
    const code=err instanceof AnswerReferenceError||err instanceof ExecutorFailure||err instanceof TurnPlanningFailure?err.code:undefined;
    const executorDiagnostic=err instanceof ExecutorFailure?err.diagnostic:undefined;
    if(err instanceof AnswerReferenceError)runTrace.calls.push({id:"synthesis-validation",kind:"tool",name:"回答引用校验",input:"核对本轮来源编号与正文引用",status:"failed",error,output:JSON.stringify(synthesisFailureDiagnostic(err))});
    for(const call of runTrace.calls) if(call.status==="running") {call.status="failed";call.error=error;}
    return {error,code,executorDiagnostic,runTrace};
  } finally {try{await activeExecutor?.close();}finally{cachedPapers.close();haina.close();}}
}
