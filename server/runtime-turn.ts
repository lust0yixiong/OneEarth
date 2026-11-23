import {literatureText,literatureDisplay} from "../src/domain/literature-label";
import {isDeepStrictEqual} from "node:util";
import { requestPerformance } from "./request-performance";
import type { TaskStore } from "./task-store";
import type { researchRegions } from "./research-region";
import type { spatialCoverageClient } from "./spatial-coverage-client";
import {runtimeTurnPapers} from "./runtime-turn-papers";
import type {RuntimeWebToolAuthority} from "./runtime-web-tool-store";
import {runtimeMaterialHistory,archivedReadEvidence,type RuntimeMaterialReceipt} from "./runtime-material-history";
import {runtimeTurnHaina,type RuntimeHainaMaterials} from "./runtime-turn-haina";
import type {CurrentAssertionReading} from "./runtime-assertion-evidence";
import {paperId} from "../src/domain/paper-record";
import type { constellationService } from "./constellations";
import { assetById, registerObservations, registerPapers } from "../src/domain/datasets";
import { modelReply } from "./research-answer";
import { validHistory } from "./turn-history";
import path from "node:path";
import {gridCoverageSummary,questionGridEvidence,verifiedGridContext} from "./question-grid";
import {gridQueryLimits,gridCataloguePaperIds,gridCatalogueAnswer} from "./grid-catalogue-answer";
import {ExecutorFailure} from "./executor-failure";
import {prepareTurn,turnMetadata,turnPlanningSchema,TurnPlanningFailure,type TurnPlan} from "./turn-planning";
import {randomUUID} from "node:crypto";
import {researchExecutor,discoveryProtocol} from "./research-executor";
import {discoveryConfirmation} from "./discovery-bindings";
import {assertDiscoveryWaiting,queryPapers,type DiscoveryBinding,type DiscoveryA2AInput} from "./discovery-a2a-client";
import {clarificationParent,guardClarification,clarificationGuardSchema,type ClarificationReply} from "./clarification-guard";
import {continueResearch, evidenceDecisionSchema, scopedDiscoverySources} from "./research-evidence";
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

export interface RuntimeServices {
  webTools?:RuntimeWebToolAuthority;
  tasks: TaskStore;
  push: ReturnType<typeof constellationService>;
  coverage: ReturnType<typeof spatialCoverageClient>;
  researchRegionService: ReturnType<typeof researchRegions>;
  adminBoundaryDir: string;
  canonicalCache: Map<string,{at:number;names:string[]}>;
}

export async function executeTurn(services: RuntimeServices, taskId: string, body: {
  query: string;
  conversationId: string;
  turnId: string;
  previousTaskId?: string;
  context: import("../src/domain/types").DiscoveryContext;
  history: import("./turn-planning").TurnHistory;
  config: import("../src/domain/chat-model").ChatModel;
  questionDecision?: import("../src/domain/types").QuestionDecision;
  deepseekTools?: import("../src/domain/deepseek-tools").DeepSeekTools;
  clarificationReply?:ClarificationReply;
}, signal: AbortSignal, publish: (payload:Record<string, unknown>) => void, internal:{observationUnavailable?:boolean}={}): Promise<Record<string, unknown>> {
  const {tasks, push, coverage, researchRegionService, adminBoundaryDir, canonicalCache} = services;
  const cachedPapers=runtimeTurnPapers();
  const haina=runtimeTurnHaina();
  const currentAssertionReadings:CurrentAssertionReading[]=[];
  let context=body.context;
  const controller = {signal};
  let activeExecutor:ReturnType<typeof researchExecutor>|undefined;
  const runTrace:RunTrace = {started:Date.now(),stages:[],calls:[],timings:requestPerformance.getStore()};
  let researchRegion:ResearchRegion|null|undefined;
  let regionTask:Promise<void>|undefined;
  function event(value:Record<string, unknown>) { publish(literatureDisplay(value)); }
  function stage(text:string, searches?:SearchRun[]) {
    if(runTrace.stages.at(-1)!==text)runTrace.stages.push(text);
    if(searches)runTrace.searches=searches;
    event({stage:text,searches,traceStarted:runTrace.started});
  }
  function report(call:ToolCall) {
    const i=runTrace.calls.findIndex(old=>old.id===call.id);
    if(i<0)runTrace.calls.push(call);else runTrace.calls[i]=call;
    event({call,traceStarted:runTrace.started});
  }
  async function readCoverage(scope:typeof context) {
    const evidence = await questionGridEvidence(scope,coverage,signal);
    if (evidence) report({id:"question-grid",kind:"tool",name:"读取所引网格的覆盖修订",input:evidence.cellId,
      status:evidence.status==="ready"?"done":"partial",output:gridCoverageSummary(evidence)});
    return evidence;
  }
  try {
    const clarification=body.clarificationReply?await clarificationParent(tasks,body):undefined;
    const query=clarification?.original.query??body.query;
    let history=clarification?.original.history??body.history;
    const decision=clarification?.original.questionDecision??body.questionDecision;
    if(clarification)context=clarification.context;
    const executor=activeExecutor=researchExecutor(body.config,clarification?clarification.original.deepseekTools:body.deepseekTools,signal,
      services.webTools?{researchTaskId:taskId,authority:services.webTools}:undefined);
    event({conversationId:body.conversationId,turnId:body.turnId, ...(decision ? {continuedFrom:decision.checkMessageId} : {})});
    stage("正在理解问题");
    const gridCoverage=await readCoverage(context);
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
      if(checked.action==="clarify")return {result:{message:checked.clarification!,clarification:true,runTrace}};
    }
    const gridLimits=gridCoverage&&!clarification&&!decision?gridQueryLimits(query):undefined;
    const prior = await priorResult(tasks,body.conversationId,body.previousTaskId);
    const candidatePaperIds=[...(context.candidateIds||[]),...(context.attachedScope?.flatMap(s=>s.kind==="dataset"?[s.id]:[])||[]),
      ...(gridCoverage?gridCataloguePaperIds(gridCoverage):[]),
      ...(prior?.answerNotes?.references?.flatMap(r=>r.kind==="asset"?[r.id]:[])||[])];
    const archived=await runtimeMaterialHistory(tasks,body.conversationId,[body.previousTaskId,decision?.checkMessageId,body.clarificationReply?.parentTaskId],
      {paperIds:candidatePaperIds.filter(paperId),includeSources:!prior});
    cachedPapers.remember(archived.papers);
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
      await tasks.append(taskId,{researchMaterials:material});
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
    const navigation = clarification?undefined:navigationTarget(query);
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
    let initialDiscoveryId:string|undefined,initialBinding:DiscoveryBinding|undefined,lastBinding:DiscoveryBinding|undefined;
    let lastDiscoveryResult:import("./data-search").DataSearchResult|undefined;
    async function find(turn:TurnPlan,continuation?:DiscoveryInput["continuation"]){
      const messageId=continuation?randomUUID():taskId;
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
        await tasks.append(taskId,{discoveryBinding:{...binding,kind:continuation?"continuation":"initial"}});
      };
      report({...call,status:"running"});
      try {
        const request:DiscoveryA2AInput=clarification&&!continuation?{
          continuedFrom:clarification.binding.discoveryId,clarificationReply:{text:body.query,afterSeq:clarification.binding.lastSeq},
        }:{
          query:clarification?clarification.delegation.query:newTarget??query,
          decision:clarification?clarification.delegation.decision:newTarget?undefined:decision, continuation,
          continuedFrom:clarification?undefined:confirmation?.continuedFrom,
          researchGoal:clarification?clarification.goal:newTarget??decision?.dataQuestion??turn.goal, evidenceGap:continuation?.focus||turn.evidenceGap,
          conversationContext, previousResearchIntent:planningIntent,
          history, currentDatasets, conversationEvidence,
          scope:{filters:context.filters,selection:context.selection,caseId:context.caseId,citation:context.citation,attachedScope:context.attachedScope},
          references:rememberConversationReferences(history.filter(t=>t.role==="assistant").at(-1)?.conversationReferences||[],
            turn.targets.flatMap<AnswerReference>(t=>t.id?[{kind:"asset",id:t.id,title:t.title,source:assetById.get(t.id)?.source||"所引资料"}]:t.url?[{kind:"web",title:t.title,url:t.url}]:[])),
        };
        const result = await executor.discover(messageId, request, update => {
          if(update.planned&&!continuation){
            const plan = update.planned;
            regionTask=researchRegionService.locate(plan.questionMode==="reframe"?null:plan.researchIntent?.region,
              plan.questionMode==="reframe"?undefined:attachedGrid?.selection).then(region=>{
              researchRegion=region;event({researchRegion});
            }).catch(()=>{researchRegion=null;event({researchRegion});});
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
        },{onAccepted:saveBinding,onCheckpoint:saveBinding,webToolQuestion:clarification?.delegation.query,onEvent:async update=>{
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
        report({...call,status:"failed",error:error instanceof Error?error.message:"发现服务未完成。",
          output:JSON.stringify({messageId,...(discoveryId?{discoveryId}:{})})});
        throw error;
      }
    }
    const prepared = clarification?{plan:{action:"search",evidenceNeed:"discover",goal:clarification.goal,targets:[],
      reason:"研究者明确补充原委托，沿已受理发现身份和等待水位继续。",clarification:null,
      ...turnMetadata(query,{previousResearchIntent:planningIntent,history,conversationContext})} as TurnPlan,retrieval:undefined as import("./data-search").DataSearchResult|undefined}:
      navigation ? navigationTurn(navigation) : await prepareTurn({
      question:decision?.dataQuestion||query, context, history, conversationContext,gridCoverage,
      ...(internal.observationUnavailable?{observationUnavailable:true as const}:{}),
      previousResearchIntent:planningIntent,confirmedQuestion:decision?.dataQuestion,numbered:selected,
      numberedRead:ref?.kind==="web"?savedReadings.find(read=>read.url===ref.url):undefined,
      numberedAssertion:ref?.kind==="asset"?prior?.conversationAssertionEvidence?.find(read=>read.assetId===ref.id):undefined,
    }, signal, {
      run: prompt => executor.model(prompt, {outputSchema:turnPlanningSchema({gridCoverage,observationUnavailable:internal.observationUnavailable?true:undefined})}),
      stage, report,
      search:p=>scopeUnverified||p.gridIntent==="count"||p.gridIntent==="catalogue"||gridLimits?.currentCoverageOnly||gridLimits?.noDiscovery?Promise.resolve(undefined):find(p),
    });
    if(clarification)prepared.retrieval=await find(prepared.plan);
    const turn=prepared.plan;
    if(turn.observationUse==="unavailable")return {result:{message:turn.clarification!,clarification:true,runTrace,
      ...turnMetadata(query,{history,conversationContext}),observationMaterialsUnavailable:true}};
    const gridQuestion=turn.gridIntent==="count"||turn.gridIntent==="catalogue"?turn.gridIntent:gridLimits?.currentCoverageOnly?"catalogue":undefined;
    if(gridQuestion&&gridCoverage){
      const archivedIds=gridCataloguePaperIds(gridCoverage).filter(id=>cachedPapers.get(id));
      const papers=gridQuestion==="catalogue"?await loadPapers(gridCataloguePaperIds(gridCoverage)):[];
      const other=gridCoverage.status==="ready"?gridCoverage.sourceIds.flatMap(id=>!paperId(id)&&assetById.get(id)?[assetById.get(id)!]:[]):[];
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
      if(hainaRecords.length&&!hainaCatalog&&reply.answerNotes)reply.answerNotes.limitation+="\n已保留原档海纳对象，但未取得对应目录状态；不能据此声称当前海纳目录已核实。";
      return {result:literatureDisplay({...reply,runTrace,modelExecutor:executor.name,researchIntent:turn.researchIntent,
        conversationContext:turn.conversationContext,conversationEvidence,conversationAssertionEvidence,
        hainaRecords,...(hainaCatalog?{hainaCatalog}:{})})};
    }
    if(gridCoverage&&gridLimits?.noDiscovery&&turn.action==="search")return {result:{message:"本轮已限定不另行搜索，尚未执行新发现。可依据已有材料继续，或明确要读取的具体来源。",clarification:true,gridCoverage,runTrace}};
    let retrieved=prepared.retrieval;
    let readRuns:SearchRun[]=[];
    const readTargets=(plan:TurnPlan,question:string,callPrefix?:string)=>executor.read(plan,question,{stage,report,callPrefix,
      options:{onAccepted:async binding=>{await tasks.append(taskId,{sourceReadBinding:binding});},
        onCheckpoint:async binding=>{await tasks.append(taskId,{sourceReadBinding:binding});}},onResult:retainMaterials});
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
      return {result:literatureDisplay({message,runTrace,researchRegion,gridCoverage,
        researchIntent:retrieved.plan.researchIntent||turn.researchIntent,
        conversationContext:retrieved.plan.conversationContext||turn.conversationContext,
        ...(retrieved.hainaCatalog?{hainaCatalog:retrieved.hainaCatalog}:{})})};
    }
    if(!retrieved?.questionCheck&&!retrieved?.clarification&&(retrieved||turn.action==="read")){
      const targetQuery=decision?.dataQuestion||query;
      if(turn.action==="read")readRuns=await readTargets(turn,targetQuery);
      // Workspace and exact reference routing retain their existing scope. A review
      // receives actual results from each action, never a hypothetical tool result.
      if(retrieved||readRuns.length||currentAssertionReadings.length){
        const outcome=await continueResearch(targetQuery,turn,{retrieval:retrieved,reads:readRuns,assertionReadings:currentAssertionReadings},signal,{
          model:prompt=>executor.model(prompt,{outputSchema:evidenceDecisionSchema}),
          read:(targets,focus,step)=>readTargets({...turn,action:"read",targets},targetQuery+"\n"+focus,"research-read-"+step+"-"),
          discover:focus=>{
            if(!initialDiscoveryId)throw Error("本轮发现没有已确认的服务任务身份，不能猜测补查父任务。");
            return find(turn,{previousId:initialDiscoveryId,focus});
          },stage,report,
        },decision);
        if(outcome.clarification){
          const material=outcome.retrieval;
          if(material?.papers.length)cachedPapers.remember(material.papers);
          runTrace.searches=[...(material?.searches||[]),...outcome.reads];
          return {result:literatureDisplay({
          message:outcome.clarification,clarification:true,runTrace,researchRegion,
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
      }
    }
    if(turn && turn.action!=="search"){
      const complete=(reply:DiscoveryResponse)=>{
        reply.runTrace=literatureDisplay(runTrace);
        if(gridCoverage)reply.gridCoverage=gridCoverage;
        if(haina.records().length)reply.hainaRecords=haina.records();
        if(haina.status())reply.hainaCatalog=haina.status();
        return {result:literatureDisplay(reply)};
      };
      const continuity={researchIntent:turn.researchIntent,conversationContext:turn.conversationContext,conversationEvidence,conversationAssertionEvidence};
      if(turn.action==="clarify"){
        return complete({message:turn.clarification!,clarification:true,...continuity});
      }
      const targetQuery=decision?.dataQuestion||query;
      const pinnedIds=turn.targets.flatMap(t=>t.id?[t.id]:[]);
      const pinnedPapers=turn.action==="workspace"?await loadPapers(pinnedIds.length?pinnedIds:context.candidateIds||[]):
        pinnedIds.flatMap(id=>cachedPapers.get(id)||[]);
      if(pinnedPapers.length)registerPapers(pinnedPapers,false);
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
        const operationContext={...context,...(pinnedIds.length?{candidateIds:pinnedIds,inCandidateScope:true}:{})};
        let operation=discoverConversation(targetQuery,operationContext);
        if(pinnedIds.length===1 && (assetById.has(pinnedIds[0])||/^haina:\d+$/.test(pinnedIds[0])) && /^(?:请|帮我)?(?:打开|预览|查看)/.test(targetQuery))
          operation={message:"已打开「"+(assetById.get(pinnedIds[0])?.title||turn.targets.find(t=>t.id===pinnedIds[0])?.title||pinnedIds[0])+"」的数据速览。",inspectId:pinnedIds[0]};
        const operationKeys=["camera","gridSystem","filters","clearSelection","view","selectCenter","previewNeed","inspectId","dataView","visualization","catalogQuery","mesh","layer","researchRegion"];
        const isActionable=()=>operationKeys.some(key=>Object.hasOwn(operation,key));
        let actionable=isActionable(),navigationHandled=false;
        if(!actionable){
          const navigation=navigationTarget(targetQuery);
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
        report({id:"workspace-action",kind:"tool",name:"执行当前界面操作",input:targetQuery,status:actionable?"done":"partial",
          output:actionable||navigationHandled?operation.message:"本轮未识别到可执行的界面变更。"});
        return complete({...operation,...(!actionable&&!navigationHandled?{message:"本轮没有执行界面切换。可点击引用打开预览，或明确指定要切换的网格、时段或图层。"}:{}),...continuity});
      }
      let summary="本轮只处理已指定对象和已有内容，没有执行数据发现检索。";
      const priorEvidence=context.citation||context.attachedScope?.some(item=>item.kind!=="reference")
        ?undefined:parentResearchEvidence(prior,turn,targetQuery);
      if(gridCoverage)summary+="\n"+gridCoverageSummary(gridCoverage);
      if(pinnedIds.length)report({id:"referenced-material",kind:"tool",name:"采用所引资料的已存内容",input:pinnedIds.join("、"),
        status:pinnedIds.every(id=>assetById.has(id))?"done":"partial",output:"已存资料身份 "+pinnedIds.filter(id=>assetById.has(id)).length+" 项；没有重新检索文献库或海纳。"});
      const reply=await modelReply(targetQuery,context,{message:summary,gridCoverage},history,executor,signal,
        stage,pinnedPapers,"",undefined,undefined,report,{plan:turn,searches:readRuns,priorEvidence},currentAssertionReadings,{record:prior,searches:archived.searches});
      if(pinnedPapers.length)reply.paperRecords=literatureDisplay(pinnedPapers);
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
    const localResult=()=>retrieved?discoverConversation(decision?.dataQuestion || query,scopedContext,retrieved.plan.conversationContext):discover(query,scopedContext);
    const result=gridCoverage?{message:gridCoverageSummary(gridCoverage),gridCoverage}:
      scopedReply(observation || (restricted&&!restricted.includes("web")?{message:"按用户限定的来源整理本轮实得资料。"}:
        await resolveSceneQuery(lookupQuery,localResult(),signal)),scopedContext,retrieved?.plan);
    report({...catalogCall,status:gridCoverage?.status==="unknown"?"partial":"done",output:result.message});
    {
      const paperTrace=retrieved!.sourceStatus.map(s=>s.source+" "+(s.status==="done"?"完成":s.status==="partial"?"部分完成":s.status==="not_requested"?"未请求":"未完成")+" · "+s.count+" 项").join("；");
      const reply:DiscoveryResponse=await modelReply(decision?.dataQuestion||query,scopedContext,result,history,executor,signal,
        stage,retrieved!.papers,paperTrace,
        !context.filters.source || context.filters.source==="constellation"?constellationFeed:undefined,retrieved,report,undefined,currentAssertionReadings,{record:prior,searches:archived.searches});
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
    if(signal.aborted)throw err;
    const error=err instanceof SyntaxError?"模型回复格式异常，请重试。":err instanceof Error?err.message:"数据发现请求未能完成。";
    const code=err instanceof AnswerReferenceError||err instanceof ExecutorFailure||err instanceof TurnPlanningFailure?err.code:undefined;
    const executorDiagnostic=err instanceof ExecutorFailure?err.diagnostic:undefined;
    if(err instanceof AnswerReferenceError)runTrace.calls.push({id:"synthesis-validation",kind:"tool",name:"回答引用校验",input:"核对本轮来源编号与正文引用",status:"failed",error,output:JSON.stringify(synthesisFailureDiagnostic(err))});
    for(const call of runTrace.calls) if(call.status==="running") {call.status="failed";call.error=error;}
    return {error,code,executorDiagnostic,runTrace};
  } finally {try{await activeExecutor?.close();}finally{cachedPapers.close();haina.close();}}
}
