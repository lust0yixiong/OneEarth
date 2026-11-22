import {literatureText,literatureDisplay} from "../src/domain/literature-label";
import { requestPerformance } from "./request-performance";
import type { TaskStore } from "./task-store";
import type { researchRegions } from "./research-region";
import type { spatialCoverageClient } from "./spatial-coverage-client";
import type { runtimePaperEvidence } from "./runtime-paper-evidence";
import type { hainaService } from "./haina-search";
import type { constellationService } from "./constellations";
import { assetById, registerObservations, registerPapers } from "../src/domain/datasets";
import { modelReply } from "./research-answer";
import { validHistory } from "./turn-history";
import path from "node:path";
import {gridCoverageSummary,questionGridEvidence,verifiedGridContext} from "./question-grid";
import {ExecutorFailure} from "./executor-failure";
import {prepareTurn,turnMetadata,turnPlanSchema,TurnPlanningFailure,type TurnPlan} from "./turn-planning";
import {randomUUID} from "node:crypto";
import {researchExecutor} from "./research-executor";
import {continueResearch, evidenceDecisionSchema} from "./research-evidence";
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
import { cachedPaperIds } from "./paper-discovery";
import { discoverObservations } from "./observation-query";
import { resolveSceneQuery } from "./earth-search";
import { discover } from "../src/domain/discovery";

export interface RuntimeServices {
  tasks: TaskStore;
  cachedPapers: ReturnType<typeof runtimePaperEvidence>;
  haina: ReturnType<typeof hainaService>;
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
}, signal: AbortSignal, publish: (payload:Record<string, unknown>) => void): Promise<Record<string, unknown>> {
  const {tasks, cachedPapers, haina, push, coverage, researchRegionService, adminBoundaryDir, canonicalCache} = services;
  const {query,history,questionDecision:decision}=body;
  let context=body.context;
  const controller = {signal};
  const executor=researchExecutor(body.config,body.deepseekTools,signal);
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
    cachedPapers.refresh();
    const existing = cachedPaperIds(context).flatMap(id => cachedPapers.get(id) || []);
    registerPapers(existing,false);
    const conversationContext=validHistory(history)
      ?history.filter(t=>t.role==="assistant" && t.conversationContext!==undefined).at(-1)?.conversationContext:undefined;
    const conversationEvidence=validHistory(history)
      ?history.filter(t=>t.role==="assistant" && t.conversationEvidence!==undefined).at(-1)?.conversationEvidence:undefined;
    const conversationAssertionEvidence=validHistory(history)
      ?history.filter(t=>t.role==="assistant" && t.conversationAssertionEvidence!==undefined).at(-1)?.conversationAssertionEvidence:undefined;
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
    const navigation = navigationTarget(query);
    const prior = await priorResult(tasks,body.conversationId,body.previousTaskId);
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
    async function find(turn:TurnPlan,continuation?:DiscoveryInput["continuation"]){
      const discoveryId=continuation?randomUUID():taskId;
      const prefix=continuation?discoveryId+":":"";
      const call={id:discoveryId+":discovery",kind:"tool" as const,name:"独立数据发现服务",
        input:continuation?JSON.stringify({discoveryId,previousId:continuation.previousId,focus:continuation.focus}):taskId};
      report({...call,status:"running"});
      try {
        const result = await executor.discover(discoveryId, {
          query, decision, continuation,
          continuedFrom:decision?.checkMessageId,
          researchGoal:decision?.dataQuestion||turn.goal, evidenceGap:continuation?.focus||turn.evidenceGap,
          conversationContext, previousResearchIntent:planningIntent,
          history, currentDatasets, conversationEvidence,
          scope:{filters:context.filters,selection:context.selection,caseId:context.caseId,citation:context.citation,attachedScope:context.attachedScope},
          references:rememberConversationReferences(history.filter(t=>t.role==="assistant").at(-1)?.conversationReferences||[],
            turn.targets.flatMap<AnswerReference>(t=>t.id?[{kind:"asset",id:t.id,title:t.title,source:assetById.get(t.id)?.source||"所引资料"}]:t.url?[{kind:"web",title:t.title,url:t.url}]:[])),
        }, update => {
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
        });
        report({...call,status:"done",output:JSON.stringify({discoveryId,channels:result.sourceStatus.map(({source,status,count})=>({source,status,count})),
          materials:{papers:result.papers.map(record=>record.id),haina:result.haina.map(asset=>asset.id),
            web:[...new Set(result.searches.flatMap(search=>search.hits.map(hit=>hit.url)))]}})});
        return result;
      } catch(error) {
        report({...call,status:"failed",error:error instanceof Error?error.message:"发现服务未完成。"});
        throw error;
      }
    }
    const prepared = navigation ? navigationTurn(navigation) : await prepareTurn({
      question:decision?.dataQuestion||query, context, history, conversationContext,
      previousResearchIntent:planningIntent,confirmedQuestion:decision?.dataQuestion,numbered:selected,
      numberedRead:ref?.kind==="web"?prior?.conversationEvidence?.find(read=>read.url===ref.url):undefined,
      numberedAssertion:ref?.kind==="asset"?prior?.conversationAssertionEvidence?.find(read=>read.assetId===ref.id):undefined,
    }, signal, {
      run: prompt => executor.model(prompt, {outputSchema:turnPlanSchema}),
      stage, report,
      search:p=>scopeUnverified?Promise.resolve(undefined):find(p),
    });
    const turn=prepared.plan;
    let retrieved=prepared.retrieval;
    let readRuns:SearchRun[]=[];
    await regionTask;
    if(gridCoverage&&!gridCoverage.summary&&(turn.action==="search" || turn.action==="clarify")){
      return {result:literatureDisplay({message:gridCoverageSummary(gridCoverage),clarification:true,gridCoverage,runTrace,
        researchIntent:turn.researchIntent,conversationContext:turn.conversationContext})};
    }
    if(!retrieved?.questionCheck&&!retrieved?.clarification&&(retrieved||turn.action==="read")){
      const targetQuery=decision?.dataQuestion||query;
      if(turn.action==="read")readRuns=await executor.read(turn,targetQuery,{stage,report});
      // Workspace and exact reference routing retain their existing scope. A review
      // receives actual results from each action, never a hypothetical tool result.
      if(retrieved||readRuns.length){
        const outcome=await continueResearch(targetQuery,turn,{retrieval:retrieved,reads:readRuns},signal,{
          model:prompt=>executor.model(prompt,{outputSchema:evidenceDecisionSchema}),
          read:(targets,focus,step)=>executor.read({...turn,action:"read",targets},targetQuery+"\n"+focus,
            {stage,report,callPrefix:"research-read-"+step+"-"}),
          discover:focus=>find(turn,{previousId:taskId,focus}),stage,report,
        },decision);
        if(outcome.clarification)return {result:literatureDisplay({
          message:outcome.clarification,clarification:true,runTrace,researchRegion,
          researchIntent:retrieved?.plan.researchIntent||turn.researchIntent,
          conversationContext:retrieved?.plan.conversationContext||turn.conversationContext,
          conversationEvidence,conversationAssertionEvidence,
        })};
        retrieved=outcome.retrieval;
        readRuns=outcome.reads;
      }
    }
    if(turn && turn.action!=="search"){
      const complete=(reply:DiscoveryResponse)=>{
        reply.runTrace=literatureDisplay(runTrace);
        if(gridCoverage)reply.gridCoverage=gridCoverage;
        return {result:literatureDisplay(reply)};
      };
      const continuity={researchIntent:turn.researchIntent,conversationContext:turn.conversationContext,conversationEvidence,conversationAssertionEvidence};
      if(turn.action==="clarify"){
        return complete({message:turn.clarification!,clarification:true,...continuity});
      }
      const targetQuery=decision?.dataQuestion||query;
      const pinnedIds=turn.targets.flatMap(t=>t.id?[t.id]:[]),pinnedPapers=pinnedIds.flatMap(id=>cachedPapers.get(id)||[]);
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
        if(pinnedIds.length===1 && assetById.has(pinnedIds[0]) && /^(?:请|帮我)?(?:打开|预览|查看)/.test(targetQuery))
          operation={message:"已打开「"+assetById.get(pinnedIds[0])!.title+"」的数据速览。",inspectId:pinnedIds[0]};
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
        stage,pinnedPapers,"",undefined,undefined,report,{plan:turn,searches:readRuns,priorEvidence});
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
    const observation=gridCoverage?undefined:discoverObservations(lookupQuery,scopedContext,push);
    const constellationFeed=observation?.pushFeed || push.latest();
    registerObservations(constellationFeed.records,!observation);
    const localResult=()=>retrieved?discoverConversation(decision?.dataQuestion || query,scopedContext,retrieved.plan.conversationContext):discover(query,scopedContext);
    const result=gridCoverage?{message:gridCoverageSummary(gridCoverage),gridCoverage}:
      scopedReply(observation || await resolveSceneQuery(lookupQuery,localResult()),scopedContext,retrieved?.plan);
    report({...catalogCall,status:gridCoverage?.status==="unknown"?"partial":"done",output:result.message});
    {
      const paperTrace=retrieved!.sourceStatus.map(s=>s.source+" "+(s.status==="done"?"完成":s.status==="partial"?"部分完成":"未完成")+" · "+s.count+" 项").join("；");
      const reply:DiscoveryResponse=await modelReply(decision?.dataQuestion||query,scopedContext,result,history,executor,signal,
        stage,retrieved!.papers,paperTrace,
        !context.filters.source || context.filters.source==="constellation"?constellationFeed:undefined,retrieved,report);
      if(retrieved!.papers.length)reply.paperRecords=literatureDisplay(retrieved!.papers);
      reply.hainaRecords=retrieved!.haina.flatMap(asset=>{
        const recordId=Number(asset.datasetId.slice(6));
        return haina.records().filter(r=>r.id===recordId);
      });
      reply.hainaCatalog=haina.status();
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
  } finally { await executor.close(); }
}
