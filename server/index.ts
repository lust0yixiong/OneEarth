import {literatureText,literatureDisplay} from "../src/domain/literature-label";
import {requestPerformance,type ExecutorTiming} from './request-performance';
import {questionGridEvidence} from "./question-grid";
import {ExecutorFailure} from "./executor-failure";
import {prepareTurn,turnMetadata,turnPlanSchema,type TurnPlan} from "./turn-planning";
import {readPlannedSources} from "./turn-reading";
import {rememberConversationReferences} from "../src/domain/reference-memory";
import {conversationScope,scopedReply} from "./conversation-scope";
import {discoverConversation} from "./conversation-discovery";
import {dataAccessIndex,dataAccessRouter} from "./data-access";
import {hainaService} from "./haina-search";
import {earthquakeDay,seismicStations} from "./earthquakes";
import {weatherStations} from "./weather-stations";
import {worldLightning} from "./world-lightning";
import {lightning} from "./lightning";

import {researchPdf} from "./research-pdf";
import { openTaskStore, workTasks } from "./task-store";
import { priorResult } from "./runtime-input";
import { discoverThroughService } from "./discovery-contract";
import {AnswerReferenceError,synthesisFailureDiagnostic} from "./scientific-answer";
import {scopeLabel} from "../src/domain/question-scope";
import {administrativeOrientation} from "./admin-orientation";
import {researchRegions} from "./research-region";
import {navigationTarget,parseCoordinates,photonLookup,wikipediaLookup,placeVariants,canonicalPlaceNames,placeLookupSchema,geocoderEnabled,type NavigationTarget,type PlaceHit} from "./place-lookup";
import {chinaBoundary,chinaBoundaryEnabled} from "./china-boundaries";
import {validResearchRegion} from "../src/domain/research-region";
import type {ResearchRegion} from "../src/domain/research-region";
import { deepSeekKey, serviceModels, setServiceKey } from "./model-service";
import type { AnswerReference, DiscoveryResponse, RunTrace, ToolCall, SearchRun } from "../src/domain/types";
import { paperCache } from "./earthnano";
import { cachedPaperIds } from "./paper-discovery";
import { mkdirSync } from "node:fs";
import { accessGuard } from "./access";
import { staticAssets } from "./static-assets";
import { listModels } from "./model-list";
import { randomUUID } from "node:crypto";
import { runExecutor, modelReply, validHistory } from "./chat-executor";
import { validChatModel } from "../src/domain/chat-model";
import {chatHomeSettings} from "./chat-home";
import {sourcePreview} from "./source-preview";
import { simulationGrid } from "./simulation-grid";
import { constellationService, parseSources } from "./constellations";
import { discoverObservations } from "./observation-query";
import { assets, assetById, registerObservations, registerPapers, observationAssets, subscribeCatalog } from "../src/domain/datasets";
import { coverageIndex, coverageScope } from "./coverage-index";
import { spatialProxy } from "./spatial-proxy";
import { regionRecords } from "../src/domain/product-distribution";
import { emptyFilters } from "../src/domain/spatial";
import { resolveSceneQuery } from "./earth-search";
import express from "express";
import { resultSnapshots } from "./result-snapshots";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import { decodeWind, installWindData } from "../src/domain/wind";
import { discover } from "../src/domain/discovery";
import { cases, resources } from "../src/domain/catalog";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (existsSync(path.join(root, ".env")))
  process.loadEnvFile(path.join(root, ".env"));
const distDir=process.env.ONEEARTH_DIST_DIR || path.join(root,"dist");
const stateDir=process.env.ONEEARTH_STATE_DIR||path.join(root,".local");
const dataDir =
  process.env.ONEEARTH_DATA_DIR ||
  path.resolve(root, "../产品设计/prototype/oneearth-data-globe/dist");
const windFile = path.join(root, "public/visualizations/gfs/wind.bin");
if (existsSync(windFile)) {
  const bytes = readFileSync(windFile);
  installWindData(
    decodeWind(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    ),
  );
}
const app = express();
const researchRegionService=researchRegions(process.env.ONEEARTH_ADMIN_BOUNDARY_DIR || path.join(root,".local","admin-boundaries"));
const canonicalCache=new Map<string,{at:number;names:string[]}>();
app.use(accessGuard(process.env.ONEEARTH_ALLOWED_HOSTS));
app.use("/api/simulation-grid", simulationGrid(path.join(dataDir,"grid-data")));
app.disable("x-powered-by");
app.use("/api/orientation",administrativeOrientation(process.env.ONEEARTH_ADMIN_BOUNDARY_DIR || path.join(root,".local","admin-boundaries"),
  {baseUrl:process.env.ONEEARTH_ADMIN_BOUNDARIES_URL}));
const pushSources = parseSources(process.env.ONEEARTH_PUSH_SOURCES);
const push = constellationService(process.env.ONEEARTH_OBSERVATION_DB || path.join(stateDir, "observations.sqlite"), pushSources);
app.use("/api/constellations",push.router);
app.use("/api/results", resultSnapshots(process.env.ONEEARTH_RESULT_DB || process.env.ONEEARTH_OBSERVATION_DB || path.join(stateDir, "results.sqlite")));
app.use("/api/tasks",spatialProxy(process.env.ONEEARTH_RUNTIME_URL || "http://127.0.0.1:5277"));
const geo = spatialProxy(process.env.ONEEARTH_SPATIAL_URL || "http://127.0.0.1:5276");
app.use(["/api/coverage","/api/spatial","/precip-data","/visualizations/haina/1846764","/visualizations/haina/1846639"],geo);
app.use("/api/data-access",express.json({limit:"8mb"}));
app.get("/api/lightning/world",worldLightning(path.join(root,".local","lightning")));
app.get("/api/lightning", lightning);
app.get("/api/earthquakes/day",earthquakeDay);
app.get("/api/earthquakes/stations",seismicStations);
app.get("/api/weather/stations",weatherStations);

app.use("/api/research-record",researchPdf());
// Leave room for the bounded source identity, web and assertion evidence memories.
app.use("/api/paper-records",spatialProxy(process.env.ONEEARTH_DISCOVERY_URL || "http://127.0.0.1:5275"));
app.use(express.json({ limit: "192kb" }));
mkdirSync(stateDir, {recursive:true});
app.use("/api/settings/chat-home",chatHomeSettings(path.join(stateDir,"chat-home.json")));
app.use("/api/source-preview",sourcePreview(path.join(stateDir,"source-preview")));
const tasks = openTaskStore(path.join(stateDir,"runtime.sqlite"));
const cachedPapers = paperCache(path.join(stateDir,"paper-evidence.sqlite"));
const haina=hainaService(path.join(stateDir,"haina-catalog.json"),{publicDir:path.join(root,"public")});
if (process.env.ONEEARTH_ROLE !== "worker") haina.start();
app.get("/api/haina/catalog",async(req,res)=>{
  const cursor=Number(req.query.cursor||0),limit=Number(req.query.limit||250);
  if(!Number.isSafeInteger(cursor)||cursor<0||!Number.isSafeInteger(limit)||limit<1||limit>250){res.status(400).json({error:"海纳目录分页参数无效。"});return;}
  try{res.set("Cache-Control","no-store").json(await haina.page(cursor,limit));}
  catch(error){res.status(502).json({error:error instanceof Error?error.message:"海纳目录读取失败。"});}
});
registerPapers(cachedPapers.list());
registerObservations(push.latest().records,true);
const coverage=coverageIndex(process.env.ONEEARTH_COVERAGE_DB || path.join(stateDir,process.env.ONEEARTH_ROLE === "worker" ? "worker-coverage.sqlite" : "coverage.sqlite"));
let coverageTimer:ReturnType<typeof setTimeout>|undefined;
const warmCoverage=()=>void coverage.warm(coverageScope(regionRecords(emptyFilters())).geometries)
  .catch(error=>console.error("Coverage index:",error instanceof Error?error.message:error));
subscribeCatalog(()=>{clearTimeout(coverageTimer);coverageTimer=setTimeout(warmCoverage,20);});
warmCoverage();
const accessIndex=dataAccessIndex(path.join(stateDir,"data-access.sqlite"));
let accessDirty=true;
let accessObservationVersion="";
subscribeCatalog(()=>{accessDirty=true;});
app.use("/api/data-access",dataAccessRouter(accessIndex,()=>{
  const version=push.version();
  if(accessDirty||version!==accessObservationVersion){accessIndex.replace(assets,push.catalogRecords());accessDirty=false;accessObservationVersion=version;}
},push.status));
app.get("/api/health", (_req, res) =>
  res.json({
    status: "ok",
    mode: "oneearth-next",
    version: "0.1.0",
    sources: { constellationPush: Object.keys(pushSources).length, earthSearch: "collection-snapshot-and-live-item-search" },
    cases: cases.length,
    verifiedCases: cases.filter((c) => c.verified).length,
    spatialDataReady: existsSync(path.join(dataDir, "s2-data/manifest.json")),
  }),
);
app.get("/api/catalog", (_req, res) => {
  registerObservations(push.latest().records,true);
  res.json({cases,resources:[...resources,...observationAssets()]});
});
app.use(["/api/chat","/api/models"],(req,res,next)=>{
  if (req.method==="POST" && !req.is("application/json")) {
    res.status(403).json({error:"请通过 OneEarth 页面提交模型请求。"}); return;
  }
  next();
});
app.post("/api/models/service/:action",async(req,res)=>{
  const {config,key}=req.body || {};
  if (!validChatModel(config) || !config.provider || config.provider==="native") {res.status(400).json({error:"请核对模型服务地址。"});return;}
  if(req.params.action==="key" && typeof key==="string" && key.trim() && key.length<8192 && !/[\r\n]/.test(key)){
    setServiceKey(config,key.trim());res.json({ok:true});return;
  }
  if(req.params.action!=="list"){res.status(400).json({error:"无效的服务设置。"});return;}
  try {res.set("Cache-Control","no-store").json({models:await serviceModels(config)});}
  catch(err){res.status(502).json({error:err instanceof Error?err.message:"无法读取模型清单。"});}
});
app.get("/api/models/deepseek/tools", (_req,res) => res.set("Cache-Control","no-store").json({
  configured:!!deepSeekKey(),
  defaults:{search:process.env.ONEEARTH_DEEPSEEK_SEARCH==="true",fetch:process.env.ONEEARTH_DEEPSEEK_FETCH==="true"},
}));
app.get("/api/models/:executor",async(req,res)=>{
  const executor=req.params.executor;
  if(executor!=="codex" && executor!=="claude"){res.status(400).json({error:"未知执行器。"});return;}
  try {res.set("Cache-Control","no-store").json({models:await listModels(executor)});}
  catch(err){res.status(502).json({error:err instanceof Error?err.message:"无法读取模型列表。"});}
});
app.post("/api/models/test",async(req,res)=>{
  const config=req.body;
  if(!validChatModel(config)){res.status(400).json({error:"模型配置无效。"});return;}
  const controller=new AbortController();
  res.once("close",()=>{if(!res.writableEnded)controller.abort();});
  try {
    const token="OneEarth-"+randomUUID().slice(0,8);
    const start=Date.now();
    const reply=await runExecutor(config,"Reply with exactly this text: "+token,controller.signal);
    if(!reply.includes(token))throw Error("执行器已响应，但回复未通过连接校验。");
    res.json({elapsedMs:Date.now()-start});
  } catch(err){if(!controller.signal.aborted)res.status(502).json({error:err instanceof Error?err.message:"连接失败。"});}
});
async function executeTurn(taskId: string, body: {
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
  const {query, context, history, questionDecision: decision} = body;
  const controller = {signal};
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
  try {
    event({conversationId:body.conversationId,turnId:body.turnId, ...(decision ? {continuedFrom:decision.checkMessageId} : {})});
    stage("正在理解问题");
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
        conversationContext:(meta.conversationContext||query).slice(0,1600),searchPlan:undefined};
      stage("正在定位「"+target.place+"」");
      report({id:"turn-action",kind:"tool",name:"本轮目标与动作规划",input:JSON.stringify({question:query,targets:[]}),status:"done",
        output:JSON.stringify({action:"workspace",goal,reason:plan.reason})});
      return {plan,retrieval:undefined};
    }
    const navigation = navigationTarget(query);
    const prior = priorResult(tasks,body.conversationId,body.previousTaskId);
    const ordinal = /^\s*(?:(?:请问|请告诉我|刚才的)\s*)?第([一二三四五六七八九]|[1-9])篇(?:论文|文献)(?=.{0,25}(?:用|采用|使用|数据|方法))/u.exec(query);
    const paperOrdinal = ordinal ? ("一二三四五六七八九".includes(ordinal[1]) ? "一二三四五六七八九".indexOf(ordinal[1])+1 : Number(ordinal[1])) : 0;
    const paperSequence = prior?.answerNotes?.references?.filter(ref => ref.kind==="asset" && ref.sourceChannel==="assertion") ?? [];
    const ordinalPaper = paperOrdinal > 0 ? paperSequence[paperOrdinal-1] : undefined;
    const ordinalPlan:TurnPlan | undefined = ordinalPaper?.kind === "asset" ? {
      ...turnMetadata(query,{previousResearchIntent:planningIntent,history,conversationContext}),
      action:"respond",goal:query,evidenceNeed:"existing",
      targets:[{key:"asset:"+ordinalPaper.id,id:ordinalPaper.id,kind:"asset",title:ordinalPaper.title,basis:"history",alreadyRead:true}],
      reason:"按上一条回答中实际展示的文献引用顺序定位。",clarification:null,searchPlan:undefined,
    } : undefined;
    if(ordinalPlan)report({id:"citation-ordinal",name:"定位上一回答的文献引用",kind:"tool",status:"done",
      input:JSON.stringify({previousTaskId:body.previousTaskId,paperOrdinal}),output:JSON.stringify({sourceId:ordinalPlan.targets[0].id})});
    const prepared = navigation ? navigationTurn(navigation) : ordinalPlan ? {plan:ordinalPlan,retrieval:undefined} : await prepareTurn({
      question:query, context, history, conversationContext,
      previousResearchIntent:planningIntent, confirmedQuestion:decision?.dataQuestion,
    }, signal, {
      run: prompt => runExecutor(body.config, prompt, signal, {outputSchema:turnPlanSchema}),
      stage, report,
      search: async turn => {
        const call = {id:taskId + ":discovery", kind:"tool" as const, name:"独立数据发现服务", input:taskId};
        report({...call,status:"running"});
        try {
          const result = await discoverThroughService(taskId, {
            query, config:body.config, deepseekTools:body.deepseekTools, decision,
            continuedFrom:decision?.checkMessageId,
            initialPlan:turn.searchPlan, conversationContext, previousResearchIntent:planningIntent,
            history, currentDatasets, conversationEvidence,
            scope:{filters:context.filters,selection:context.selection,caseId:context.caseId,citation:context.citation,attachedScope:context.attachedScope},
            references:rememberConversationReferences(history.filter(t=>t.role==="assistant").at(-1)?.conversationReferences||[],
              turn.targets.flatMap<AnswerReference>(t=>t.id?[{kind:"asset",id:t.id,title:t.title,source:assetById.get(t.id)?.source||"所引资料"}]:t.url?[{kind:"web",title:t.title,url:t.url}]:[])),
          }, signal, update => {
            if(update.planned){
              const plan = update.planned;
              regionTask=researchRegionService.locate(plan.questionMode==="reframe"?null:plan.researchIntent?.region,
                plan.questionMode==="reframe"?undefined:attachedGrid?.selection).then(region=>{
                researchRegion=region;event({researchRegion});
              }).catch(()=>{researchRegion=null;event({researchRegion});});
            }
            if(update.stage)stage(update.stage,update.searches);
            if(update.call)report(update.call);
            if(update.finding){
              const finding=update.finding;
              const findings=[...(runTrace.findings||[])], index=findings.findIndex(f=>f.id===finding.id);
              if(index<0)findings.push(finding);else findings[index]=finding;
              runTrace.findings=findings;
              event({finding,traceStarted:runTrace.started});
            }
          });
          report({...call,status:"done",output:JSON.stringify({discoveryId:taskId,channels:result.sourceStatus})});
          return result;
        } catch(error) {
          report({...call,status:"failed",error:error instanceof Error?error.message:"发现服务未完成。"});
          throw error;
        }
      },
    });
    const turn=prepared?.plan,retrieved=prepared?.retrieval;
    await regionTask;
    if(turn && turn.action!=="search"){
      const complete=(reply:DiscoveryResponse)=>{
        reply.runTrace=literatureDisplay(runTrace);
        return {result:literatureDisplay(reply)};
      };
      const continuity={researchIntent:turn.researchIntent,conversationContext:turn.conversationContext,conversationEvidence,conversationAssertionEvidence};
      if(turn.action==="clarify"){
        return complete({message:turn.clarification!,clarification:true,...continuity});
      }
      const targetQuery=decision?.dataQuestion||query;
      const pinnedIds=turn.targets.flatMap(t=>t.id?[t.id]:[]),pinnedPapers=pinnedIds.flatMap(id=>cachedPapers.get(id)||[]);
      if(pinnedPapers.length)registerPapers(pinnedPapers,false);
      const chinaBoundaryDirectory=path.join(process.env.ONEEARTH_ADMIN_BOUNDARY_DIR || path.join(root,".local","admin-boundaries"),"datav");
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
          prompt=>runExecutor(body.config,prompt,AbortSignal.any([controller.signal,AbortSignal.timeout(20000)]),{outputSchema:placeLookupSchema}));
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
      const readRuns=await readPlannedSources(turn,targetQuery,controller.signal,{stage,report});
      let summary="本轮只处理已指定对象和已有内容，没有执行数据发现检索。";
      if(turn.action==="read" && turn.targets.some(t=>t.kind==="grid")){
        const grid=await questionGridEvidence(context,coverage,controller.signal);
        summary+=grid?"所引网格与时段的目录定位索引匹配 "+grid.count+" 种数据集；这不是观测条数，也不证明有当地有效测量。":"本轮未取得所引网格的索引，不能声称本格有观测。";
        report({id:"question-grid",kind:"tool",name:"读取所引网格索引",input:context.selection?.id||"",status:grid?"done":"failed",output:summary});
      }
      if(pinnedIds.length)report({id:"referenced-material",kind:"tool",name:"采用所引资料的已存内容",input:pinnedIds.join("、"),
        status:pinnedIds.every(id=>assetById.has(id))?"done":"partial",output:"已存资料身份 "+pinnedIds.filter(id=>assetById.has(id)).length+" 项；没有重新检索文献库或海纳。"});
      const reply=await modelReply(targetQuery,context,{message:summary},history,body.config,controller.signal,
        stage,false,pinnedPapers,"",undefined,undefined,report,{plan:turn,searches:readRuns});
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
      return {result:reply};
    }
    for(const record of retrieved?.papers||[])cachedPapers.save(record);
    if(retrieved?.papers.length)registerPapers(retrieved.papers);
    // Auxiliary data framing must not replace the user's operation or scope.
    const lookupQuery=[decision?.dataQuestion || query,retrieved?.plan.conversationContext].filter(Boolean).join("\n");
    const catalogCall={id:"catalog",kind:"tool" as const,name:"OneEarth 数据目录",input:lookupQuery};
    report({...catalogCall,status:"running"});
    const scopedContext=conversationScope(context,retrieved?.plan);
    let gridEvidence;
    if(context.attachedScope?.some(i=>i.kind==="grid")){
      stage("正在核对所引网格的目录定位依据");
      gridEvidence=await questionGridEvidence(scopedContext,coverage,controller.signal).catch(()=>undefined);
      controller.signal.throwIfAborted();
      const detail=gridEvidence?"该网格与所选时段下，目录内有 "+gridEvidence.count+" 种可定位数据集。索引关联不证明有当地有效观测。":"暂未取得网格索引，不能判断格内数量。";
      report({id:"question-grid",name:"所引网格定位依据",input:scopedContext.selection!.id,kind:"tool",status:gridEvidence?"done":"failed",output:detail});
      if(gridEvidence && !scopedContext.candidateIds?.length && gridEvidence.ids.length){
        scopedContext.candidateIds=gridEvidence.ids;scopedContext.inCandidateScope=true;
      }
    }
    const observation=discoverObservations(lookupQuery,scopedContext,push);
    const constellationFeed=observation?.pushFeed || push.latest();
    registerObservations(constellationFeed.records,!observation);
    const discovery=retrieved?discoverConversation(decision?.dataQuestion || query,scopedContext,retrieved.plan.conversationContext):discover(query,scopedContext);
    const result=scopedReply(observation || await resolveSceneQuery(lookupQuery,discovery),scopedContext,retrieved?.plan);
    if(context.attachedScope?.some(i=>i.kind==="grid"))result.message+="\n"+(gridEvidence?
      "OneEarth 本格目录定位索引匹配 "+gridEvidence.count+" 种数据集（不是观测条数）；对应来源记录示例 ID："+gridEvidence.ids.join("、"):"本格目录定位名单尚未取得，不能声称有本地观测。");
    report({...catalogCall,status:"done",output:result.message});
    {
      const paperTrace=retrieved!.sourceStatus.map(s=>s.source+" "+(s.status==="done"?"完成":s.status==="partial"?"部分完成":"未完成")+" · "+s.count+" 项").join("；");
      const reply:DiscoveryResponse=await modelReply(query,scopedContext,result,history,body.config,controller.signal,
        stage,true,retrieved!.papers,paperTrace,
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
    const code=err instanceof AnswerReferenceError||err instanceof ExecutorFailure?err.code:undefined;
    const executorDiagnostic=err instanceof ExecutorFailure?err.diagnostic:undefined;
    if(err instanceof AnswerReferenceError)runTrace.calls.push({id:"synthesis-validation",kind:"tool",name:"回答引用校验",input:"核对本轮来源编号与正文引用",status:"failed",error,output:JSON.stringify(synthesisFailureDiagnostic(err))});
    for(const call of runTrace.calls) if(call.status==="running") {call.status="failed";call.error=error;}
    return {error,code,executorDiagnostic,runTrace};
  }
}

const workerOnly = process.env.ONEEARTH_ROLE === "worker";
if (workerOnly) {
  workTasks(tasks, ({id,body}, signal, emit) => {
    const timings: ExecutorTiming[] = [];
    return requestPerformance.run(timings, () => executeTurn(id, body, signal, emit));
  });
  console.log("OneEarth runtime worker started");
}
app.use("/grid-data", express.static(path.join(dataDir, "grid-data")));
app.use("/s2-data", express.static(path.join(dataDir, "s2-data")));
app.use(["/grid-data", "/s2-data"], (_req, res) =>
  res.status(404).json({ error: "网格数据文件未找到，请检查数据目录。" }),
);
app.use("/api", (_req, res) =>
  res.status(404).json({ error: "未找到对应接口。" }),
);
if (process.env.ONEEARTH_ROLE === "worker") {
  // The worker consumes the queue and has no browser listener.
} else if (process.env.NODE_ENV === "production") {
  app.use("/assets", staticAssets(path.join(distDir, "assets")));
  app.use(express.static(distDir));
  app.get("/{*path}", (_req, res) =>
    res.sendFile(path.join(distDir, "index.html")),
  );
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    root,
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
}
app.use(
  (
    error: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    const large = (error as {type?:string})?.type === "entity.too.large";
  res.status(large ? 413 : error instanceof SyntaxError ? 400 : 500).json({
      error:
        large ? "推送内容超过大小限制。" : error instanceof SyntaxError
          ? "请求内容无效，请重新提交。"
          : "服务暂时无法完成请求。",
    });
  },
);
const port = Number(process.env.PORT || 5274);
const host = process.env.ONEEARTH_HOST || "127.0.0.1";
if (!workerOnly) {
const server = app.listen(port, host, () =>
  console.log("OneEarth app http://" + (host.includes(":") ? `[${host}]` : host) + ":" + port),
);
server.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});

}
