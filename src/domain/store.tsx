import { canReplyToDiscoveryClarification, discoveryClarificationResult, loadResearchRecord, openTaskEvents } from "./runtime-client";
import {datasetScope,mergeScope,scopedQuestionContext,scopeDetail,scopeLabel,type ScopeItem} from "./question-scope";
import {previewableTab} from "./web-preview";
import {rememberReadEvidence} from "./read-evidence";
import {conversationReferenceMemory} from "./reference-memory";
import {researchRegionCamera,validResearchRegion,sameResearchRegion,type ResearchRegion,type ResearchRegionLayer} from "./research-region";
import {answerMapBatch,answerFilters,initialAnswerCamera,gridCamera,evidenceCamera,evidenceSelection} from "./answer-map";
import { globeCases,regionalIds,layerFrameCount,datasetLayers,regionalForDataset,type RegionalId } from "./regional-cases";
import { paperId, asksForPapers } from "./paper-record";
import { loadPaperCatalog,readPaperCatalogStatus, type PaperCatalogStatus } from "./paper-catalog-client";
import { randomId } from "./id";
import { ChatResponseError, readChatResponse } from "./chat-response";
import {readDeepSeekTools,loadDeepSeekTools} from "./deepseek-tools";
import { readChatModel } from "./chat-model";
import { identifyCase } from "./research-chat";
import {materialAnswer} from "./material-summary";
import {selectedDistribution} from "./results";
import {geoBounds,geoCentroid} from "d3-geo";
import {checkedScenes, observationUnit, products, frequencySummary,globalProduct} from "./product-distribution";
import {validWindow,windowFilters,windowLabel} from "./time-window";
import { observationIntent } from "./observation-intent";
import { observationBatchCamera, observationById, pushId, type PushFeed } from "./push-observations";
import { isWorkspaceCommand } from "./research-question";
import {makeQuestionDecision} from "./question-confirmation";
import type {ClarificationReply, QuestionDecision} from "./types";
import {validAccessSection,initialAccessSection} from "./data-access";
import { registerHaina, registerObservations, registerPapers, loadRemoteAssetIds } from "./datasets";
import {loadHainaCatalog,type HainaCatalogStatus} from "./haina-catalog-client";
import { type ChatDelivery, saveChatDelivery, unfinishedChatDeliveries, removeChatDelivery, legacySession, mergeMessages, readFavorites, readSession, readSessionMessage, sessionMessages, sessionSummaries, writeFavorite, writeSession } from "./session-storage";
import { sampleCamera } from "./earth-search";
import { catalogResults, type SearchState } from "./results";
import { assetById, assetIdentity, assets } from "./datasets";
import { evaluateBatch } from "./research-assessment";
import { catalogBatch, searchConditions } from "./batch-context";
import { saveReaderCheckpoint, restoreReaderCheckpoint } from "./reader-checkpoint";
import { useResultLink } from "./use-result-link";
import { createResearchList, persistResearchList, type SavedEvidence } from "./research-list";
import { comparison, makeCandidates, makeMappedCandidates } from "./results";
import type { CandidateSet } from "./types";
import { defaultWindState, loadWindData, windDocument } from "./wind";
import {
  validVisualization,
  visualizationCatalog,
} from "./visualization-catalog";
import {
  createContext,
  useContext,
  useReducer,
  useRef,
  useEffect,
  useMemo,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import type {
  DataView,
  VisualizationState,
  Camera,
  Citation,
  DiscoveryResponse,
  DiscoveryAttempt,
  EvidenceDocument,
  Filters,
  GridSystem,
  MapLayer,
  Message,
  Selection,
  View,
} from "./types";
import {
  scopedDataView,
  createDataView,
  dataCamera,
  reconcileDataView,
} from "./visualization";
import { caseById, resources, sourceLabels } from "./catalog";
import { emptyFilters, fitCamera, gridSpec, cellAt } from "./spatial";
import { assetMaterials, evidenceFor } from "./evidence";
import { resolution } from "../data/evidence/globe-navigation.mjs";
import september from "../data/evidence/september-sea-ice-pdo.json";
const emptySearch: SearchState = {
  query: "",
  type: "",
  source: "",
  savedOnly: false,
  kind: "all",
  result: null,
  compare: [],
};
type Inspector =
  | {
      assetId: string;
      filters: Filters;
      selection: Selection | null;
      parent?: CandidateSet;
    }
  | { comparison: EvidenceDocument; comparedBatch?: CandidateSet }
  | { batch: CandidateSet };
export interface State {
  researchRegion?:ResearchRegionLayer|null;
  draftScope: ScopeItem[] | null;
  clarificationReply?: ClarificationReply | null;
  attachingMapScope?: boolean;
  flight?: {id:string;camera:Camera;kind?:"research-region"|"place"|"grid";label?:string}|null;
  mapFocus?: {answerId:string;assetId:string;locked:boolean}|null;
  sessionId: string;
  resumeLinkedWorkspace: boolean;
  sessionError: string | null;
  unansweredQuestionId: string | null;
  readerPosition: { tab: number; page: number } | null;
  linkStatus: "loading" | "failed" | null;
  pushFeed: {configured:number; keys:string[]; checkedAt:string; offline:boolean} | null;
  paperFeed: PaperCatalogStatus | null;
  hainaFeed?:HainaCatalogStatus;
  listLibraryOpen: boolean;
  comparisonYear: number;
  inspector: Inspector | null;
  mapResult: CandidateSet | null;
  search: SearchState;
  overview: "catalog" | "simulation";
  origin: ReturnPoint | null;
  fieldLayer: {id:RegionalId;frame:number;year?:number} | null;
  visualization: VisualizationState | null;
  view: View;
  caseId: string | null;
  filters: Filters;
  camera: Camera;
  gridSystem: GridSystem;
  layer: MapLayer;
  selection: Selection | null;
  mesh: boolean;
  source: number;
  messages: Message[];
  citation: Citation | null;
  evidence: EvidenceDocument | null;
  pending: boolean;
  chatStage?: string;
  liveTrace?:import("./types").RunTrace;
  webMode?: "auto" | "on" | "off";
  liveSearches?:import("./types").SearchRun[];
  error: string | null;
  chatOpen: boolean;
  saved: string[];
  previewKind: string | null;
  dataView: DataView | null;
}
const workspaceFields = [
  "view", "caseId", "filters", "camera", "gridSystem", "layer", "selection", "mesh", "source",
  "inspector", "mapResult", "search", "overview", "origin", "visualization", "fieldLayer", "dataView",
  "comparisonYear", "listLibraryOpen", "citation", "evidence", "previewKind", "readerPosition",
  "chatOpen", "saved", "clarificationReply",
  "researchRegion",
] as const satisfies readonly (keyof State)[];
export type WorkspaceSnapshot = Pick<State, (typeof workspaceFields)[number]> & { resultId?: string | null };
function captureWorkspace(state: State) {
  return {
    ...Object.fromEntries(workspaceFields.map(key => [key, state[key]])),
    resultId: state.linkStatus && !state.resumeLinkedWorkspace ? null : new URL(location.href).searchParams.get("result"),
  } as WorkspaceSnapshot;
}
function sessionTitle(state: State) {
  return state.mapResult?.title || state.search.result?.title || caseById(state.caseId)?.title || "新对话";
}
type ReturnPoint = Pick<
  State,
  | "view"
  | "caseId"
  | "filters"
  | "camera"
  | "gridSystem"
  | "selection"
  | "source"
  | "layer"
  | "mesh"
  | "dataView"
  | "visualization"
  | "fieldLayer"
  | "search"
  | "citation"
  | "mapResult"
  | "overview"
  | "inspector"
> & { origin: ReturnPoint | null };
function remember(s: State): ReturnPoint {
  const {
    view,
    caseId,
    filters,
    camera,
    gridSystem,
    selection,
    source,
    layer,
    mesh,
    dataView,
    visualization,fieldLayer,
    search,
    citation,
    overview,
    inspector,
    origin,
    mapResult,
  } = s;
  return {
    view,
    caseId,
    filters,
    camera,
    gridSystem,
    selection,
    source,
    layer,
    mesh,
    dataView,
    visualization,fieldLayer,
    search,
    citation,
    overview,
    inspector,
    origin,
    mapResult,
  };
}
function bindEvidenceBatch(doc: EvidenceDocument, s: State): EvidenceDocument {
  if (doc.sourceBatch || doc.id.includes("-excerpt-")) return doc;
  const id = doc.assetId || doc.id, asset = assetById.get(id);
  if (!asset) return doc;
  const item = s.inspector && "assetId" in s.inspector && s.inspector.assetId === id ? s.inspector : null;
  const parent = [item?.parent, s.view === "discover" ? s.search.result : s.mapResult,
    s.search.result?.caseId === s.caseId ? s.search.result : null].find(batch => batch?.ids.includes(id));
  const sourceBatch: CandidateSet = {
    ...(parent || {}), title: parent?.title || asset.title, ids: parent?.ids || [id], caseId: parent ? parent.caseId : asset.caseId,
    filters: item?.filters || parent?.filters || s.filters,
    selection: item ? item.selection : parent ? parent.selection : s.selection,
    layer: parent?.layer || s.layer, camera: parent?.camera || s.camera, gridSystem: parent?.gridSystem || s.gridSystem,
  };
  return { ...doc, assetId:id, sourceBatch,
    ...(doc.fullSource ? {fullSource:{...doc.fullSource, sourceBatch:{...sourceBatch, selection:null, filters:{...sourceBatch.filters,place:""}}}} : {}),
  };
}
function focusedMaterial(s: State, batch: CandidateSet | null) {
  const doc = s.evidence || s.citation?.excerpt;
  const inspector = s.inspector && "assetId" in s.inspector ? s.inspector : null;
  const evidenceId = doc?.assetId || doc?.locator?.documentId || doc?.id;
  const id = doc ? (assetById.has(evidenceId || "") ? evidenceId :
    evidenceId?.split("-excerpt-")[0].replace(/-source$|\/\d+$/g, "")) : inspector?.assetId;
  const record = id ? assetById.get(id) : undefined;
  const asset = doc?.version !== undefined && doc.version !== (record?.version ?? null) ? undefined : record;
  const original = doc?.sourceBatch;
  const sameInspector = inspector?.assetId === id ? inspector : null;
  const parent = original || sameInspector?.parent || (id && batch?.ids.includes(id) ? batch : null);
  const missingScope = !!doc && !!(doc.locator || doc.id.includes("-excerpt-")) && !(id && original?.ids.includes(id));
  return {
    id, asset, doc, parent, missingScope,
    filters: original?.filters || sameInspector?.filters || parent?.filters || s.filters,
    selection: original ? original.selection : sameInspector ? sameInspector.selection : parent ? parent.selection : s.selection,
  };
}
function requestWorkspaceKey(s: State) {
  return JSON.stringify([s.view, s.caseId, s.filters, s.gridSystem, s.layer, s.selection, s.camera,
    s.dataView, s.visualization, s.fieldLayer, s.overview, s.mapResult, s.search, s.inspector]);
}
type Action =
  | { type: "patch"; value: Partial<State> }
  | { type: "messages"; sessionId: string; messages: Message[] };
const defaultCamera: Camera = {
  center: [105, 25],
  zoom: 1,
  reason: "全球 H3 R2 总览。缩放可观察更细层级的数据聚集。",
};
const storageKey = "oneearth.workspace.v1";
function initial(sessionId: string, url = new URL(location.href), saved: Record<string, any> = {}): State {
  const requested =
    url.searchParams.get("task") ||
    url.searchParams.get("case") ||
    (url.searchParams.get("topic") === "glacier" ? "glacier" : null);
  const caseId =
    url.searchParams.get("viz") === "gfs-wind"
      ? "wind"
      : caseById(requested)?.id || null;
  const filters = emptyFilters();
  const restore = saved.caseId === caseId;
  if (restore && saved.filters && typeof saved.filters === "object") {
    for (const key of ["type", "source", "place"] as const)
      if (
        typeof saved.filters[key] === "string" &&
        saved.filters[key].length <= 100
      )
        filters[key] = saved.filters[key];
    if (
      Number.isInteger(saved.filters.need) &&
      saved.filters.need >= -1 &&
      saved.filters.need < (caseById(caseId)?.needs.length || 0)
    )
      filters.need = saved.filters.need;
    if (
      saved.filters.maxDem === null ||
      (typeof saved.filters.maxDem === "number" &&
        Number.isFinite(saved.filters.maxDem) &&
        saved.filters.maxDem > 0)
    )
      filters.maxDem = saved.filters.maxDem;
    if(validWindow(saved.filters.utcWindow)) Object.assign(filters,windowFilters(saved.filters.utcWindow));
    for (const key of ["period", "depth"] as const) {
      const value = saved.filters[key];
      if (
        Array.isArray(value) &&
        value.length === 2 &&
        value.every((v: any) => typeof v === "number" && Number.isFinite(v)) &&
        value[0] <= value[1]
      )
        filters[key] = [value[0], value[1]];
    }
  }
  const oldCamera = saved.camera;
  const restoreCamera =
    restore &&
    oldCamera &&
    Array.isArray(oldCamera.center) &&
    oldCamera.center.length === 2 &&
    oldCamera.center.every(
      (n: any) => typeof n === "number" && Number.isFinite(n),
    ) &&
    Math.abs(oldCamera.center[0]) <= 180 &&
    Math.abs(oldCamera.center[1]) <= 90 &&
    oldCamera.zoom >= 1 &&
    oldCamera.zoom <= 2200 &&
    typeof oldCamera.reason === "string";
  const requestedView = url.searchParams.get("view");
  const catalogSource = url.searchParams.get("source") || "";
  const view: View =
    requestedView === "discover" || requestedView === "cases"
      ? requestedView
      : "earth";
  const visualization =
    url.searchParams.get("viz") === "gfs-wind"
      ? restore && validVisualization(saved.visualization)
        ? saved.visualization
        : defaultWindState()
      : null;
  if (visualization && matchMedia("(prefers-reduced-motion: reduce)").matches)
    visualization.playing = false;
  const requestedLayer=url.searchParams.get("viz");
  const fieldId=requestedLayer && Object.hasOwn(globeCases,requestedLayer) ? requestedLayer as RegionalId : undefined;
  const fieldLayer=fieldId && view==="earth" ? {id:fieldId,frame:restore && saved.fieldLayer?.id===fieldId && Number.isInteger(saved.fieldLayer.frame) && saved.fieldLayer.frame>=0 && saved.fieldLayer.frame<layerFrameCount(fieldId)?saved.fieldLayer.frame:globeCases[fieldId].month} : null;
  if(fieldLayer?.id==="rain"){
    const requested=Number(url.searchParams.get("rainYear"));
    const savedYear=restore?saved.fieldLayer?.year:undefined;
    const year=Number.isInteger(requested)&&requested>=2000&&requested<=2026?requested:
      Number.isInteger(savedYear)&&savedYear>=2000&&savedYear<=2026?savedYear:2024;
    Object.assign(fieldLayer,{year});
    const month=Number(url.searchParams.get("rainMonth"));
    if(Number.isInteger(month)&&month>=1&&month<=12)fieldLayer.frame=month-1;
  }
  const dataParam = url.searchParams.get("data");
  const openPushGlobe = view==="earth" && !caseId && url.searchParams.get("source")==="constellation";
  if (openPushGlobe) Object.assign(filters,emptyFilters(),{source:"constellation"});
  const dataView =
    caseId === "Q19" && dataParam === "ctd"
      ? createDataView(caseId, 4, filters)
      : caseId === "Q20" && dataParam === "front"
        ? createDataView(caseId, 1, filters)
        : null;
  if (dataView) {
    filters.need = dataView.kind === "ctd" ? 4 : 1;
    filters.type = "";
    filters.source = "";
  }
  return {
    sessionId,
    flight:null,mapFocus:null,researchRegion:null,
    resumeLinkedWorkspace: false,
    sessionError: null,
    unansweredQuestionId: null,
    readerPosition: null,
    origin: null,
    linkStatus: url.searchParams.has("result") ? "loading" : null,
    pushFeed: null,
    paperFeed: null,
    comparisonYear: 2012,
    listLibraryOpen: false,
    inspector: null,
    mapResult: null,
    search: { ...emptySearch,
      ...((view === "discover" && Object.hasOwn(sourceLabels, catalogSource)) || openPushGlobe?{source:catalogSource}:{}),
      ...(view==="discover"&&validAccessSection(url.searchParams.get("section"))?{section:url.searchParams.get("section") as import("./data-access").AccessSection}:{}),
      ...(view==="discover"&&/^\d{1,6}$/.test(url.searchParams.get("catalogPage")||"")?{page:Number(url.searchParams.get("catalogPage"))}:{}),
      ...(view==="discover"?{query:(url.searchParams.get("q")||"").slice(0,1000),type:(url.searchParams.get("dataType")||"").slice(0,240),savedOnly:url.searchParams.get("saved")==="1",
        ...(["map","request","local"].includes(url.searchParams.get("capability")||"")?{capability:url.searchParams.get("capability") as SearchState["capability"]}:{})}:{}),
    },
    overview: "catalog",
    fieldLayer,visualization,
    view,
    caseId,
    filters,
    camera: openPushGlobe ? {...defaultCamera,reason:"等待星座观测范围"} : dataView
      ? dataCamera(dataView)
      : restoreCamera
        ? oldCamera
        : fieldLayer ? {center:globeCases[fieldLayer.id].center,zoom:globeCases[fieldLayer.id].zoom,reason:globeCases[fieldLayer.id].title} : caseId
          ? fitCamera(caseId, filters, "all") || defaultCamera
          : defaultCamera,
    gridSystem: saved.gridSystem === "s2" ? "s2" : "h3",
    layer: openPushGlobe ? "all" : dataView
      ? "all"
      : restore && ["all", "verified", "joint", "paired"].includes(saved.layer)
        ? saved.layer
        : "all",
    selection: null,
    mesh: visualization || fieldLayer ? false : saved.mesh !== false,
    source: -1,
    draftScope: (() => {
      const id = fieldLayer?.id === "forest" ? "haina:1846764" : fieldLayer?.id === "c40" ? "haina:1846639" : null;
      const asset = id ? assetById.get(id) : undefined;
      return asset ? [datasetScope(asset)] : null;
    })(),
    messages: Array.isArray(saved.messages)
      ? saved.messages
          .filter(
            (m: any) =>
              m &&
              typeof m.text === "string" &&
              ["user", "assistant"].includes(m.role),
          )
          .map((m: Message, i: number) => ({...m, id: m.id || "legacy-message-" + i, time: Number.isFinite(m.time) ? m.time : i}))
      : [],
    citation: null,
    evidence: null,
    pending: false,
    error: null,
    chatOpen: (fieldLayer?.id === "forest" || fieldLayer?.id === "c40" || !fieldLayer) && (requestedView === "chat" || innerWidth > 760),
    saved: Array.isArray(saved.saved)
      ? Array.from(
          new Set<string>(
            saved.saved
              .filter((v: any) => typeof v === "string")
              .flatMap((v: string) => {
                const direct = assetById.get(v);
                if (direct) return [assetIdentity(direct)];
                if (assets.some((a) => assetIdentity(a) === v)) return [v];
                const matches = assets.filter(
                  (a) => a.datasetId === v || a.url?.split("#")[0] === v,
                );
                return matches.length
                  ? Array.from(new Set(matches.map(assetIdentity)))
                  : [v];
              }),
          ),
        )
      : [],
    previewKind: null,
    dataView,
  };
}
const sessionFailure = "浏览器未能保存会话。请检查本地存储空间或权限，保留此标签页以便重试。";
async function loadInitialSession(): Promise<State> {
  const url = new URL(location.href);
  const entry = history.state;
  const remembered = entry?.oneearthPath === url.pathname + url.search ? entry.oneearthSession : null;
  let state = initial(remembered || randomId(), url);
  try {
    let raw: string | null = null;
    try { raw = localStorage.getItem(storageKey); } catch { /* IndexedDB may still be available. */ }
    let migrated: State | null = null;
    let firstMigration = false;
    if (raw) {
      let legacy;
      try { legacy = JSON.parse(raw); } catch { /* Keep an unreadable legacy record intact. */ }
      if (legacy && typeof legacy === "object") {
        const oldUrl = new URL(url.pathname, url);
        if (caseById(legacy.caseId)) oldUrl.searchParams.set("task", legacy.caseId);
        if (validVisualization(legacy.visualization)) oldUrl.searchParams.set("viz", "gfs-wind");
        migrated = initial(legacySession, oldUrl, legacy);
        firstMigration = await writeSession(legacySession, sessionTitle(migrated), captureWorkspace(migrated), migrated.messages, true);
        try { localStorage.removeItem(storageKey); } catch { /* Migration is idempotent. */ }
      }
    }
    const matchesLegacy = migrated && (!url.search || (
      !url.searchParams.has("result") && state.caseId === migrated.caseId &&
      Array.from(url.searchParams.keys()).every(key => ["task", "case", "topic"].includes(key))
    ));
    const resume = remembered || (firstMigration && matchesLegacy ? legacySession : null);
    const record = resume ? await readSession(resume) : null;
    if (record) {
      state.sessionId = resume;
      const { resultId, ...workspace } = record.workspace;
      if (!url.searchParams.has("result") || (remembered && resultId === url.searchParams.get("result"))) {
        Object.assign(state, workspace);
        if (remembered) state.readerPosition = restoreReaderCheckpoint(state.sessionId, state.evidence, state.readerPosition);
        state.resumeLinkedWorkspace = !!resultId && state.linkStatus === "loading";
      }
      state.messages = record.messages;
    }
    state.saved = await readFavorites();
    const researchId=url.searchParams.get("research");
    const cachedResearch=researchId?state.messages.find(message=>message.id===researchId):undefined;
    const needsArchivedCatalogue=cachedResearch?.answerNotes?.references
      ?.some(reference=>reference.kind==="asset"&&reference.evidenceLevel==="catalogue-record");
    if(researchId&&(!cachedResearch||needsArchivedCatalogue)){
      try{
        const saved=await loadResearchRecord(researchId);
        const reply=saved.result;
        if(reply.paperRecords)registerPapers(reply.paperRecords,false);
        if(reply.hainaRecords?.length&&reply.hainaCatalog)
          registerHaina(reply.hainaRecords,reply.hainaCatalog.synced,reply.hainaCatalog.endpoint,false);
        state.chatOpen=true;
        if(!cachedResearch){
          const stored=await readSession(saved.conversationId);
          state.clarificationReply=stored?.workspace.clarificationReply ?? null;
          const messages:Message[]=[
            {id:saved.turnId,role:"user",text:saved.question,time:saved.created},
            {id:saved.id,role:"assistant",text:reply.message,time:saved.updated,replyTo:saved.turnId,
              researchIntent:reply.researchIntent,conversationContext:reply.conversationContext,
              conversationEvidence:reply.conversationEvidence,conversationAssertionEvidence:reply.conversationAssertionEvidence,
              answerNotes:reply.answerNotes,runTrace:reply.runTrace,researchRegion:reply.researchRegion,
              gridCoverage:reply.gridCoverage,
              ...(discoveryClarificationResult(reply)?{clarification:true,discoveryClarification:true}:{})},
          ];
          state.sessionId=saved.conversationId;
          state.messages=mergeMessages(stored?.messages||[],messages);
          await writeSession(state.sessionId,saved.question,captureWorkspace(state),state.messages);
        }
      }catch(error){
        state.sessionError=error instanceof Error?error.message:"研究记录暂时无法打开。";
      }
    }else if(!record)await writeSession(state.sessionId,sessionTitle(state),captureWorkspace(state));
  } catch {
    // If the remembered snapshot could not be read, keep that record intact.
    if (remembered && state.sessionId === remembered && !state.messages.length)
      state.sessionId = randomId();
    state.sessionError = sessionFailure;
  }
  return normalizeInspector(state);
}
// Older sessions stored open grid evidence in the dataset inspector.
function normalizeInspector(state: State): State {
  if(state.researchRegion && (!validResearchRegion(state.researchRegion.region) || typeof state.researchRegion.visible!=="boolean"))state={...state,researchRegion:null};
  if (state.overview === "simulation") state = { ...state, overview:"catalog", source:-1, selection:null, inspector:null, evidence:null };
  return state.inspector && "gridDetail" in state.inspector
    ? { ...state, inspector: null }
    : state;
}

function reducer(s: State, a: Action): State {
  if (a.type === "patch") return normalizeInspector({ ...s, ...a.value });
  if (s.sessionId !== a.sessionId) return s;
  const messages = mergeMessages(s.messages, a.messages);
  return messages === s.messages ? s : { ...s, messages };
}
const Context = createContext<ReturnType<typeof useWorkspaceValue> | null>(
  null,
);
function useWorkspaceValue(initialState: State) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const historyIds=useMemo(()=>new Set(state.messages.map(m=>m.id)),[state.sessionId]);
  const latest = useRef(state);
  latest.current = state;
  const request = useRef<AbortController | null>(null);
  const serial = useRef(0);
  const patch = useCallback((value: Partial<State>) => {
    const scopeChange=["caseId","view","mapResult","filters","selection","gridSystem"].some(key=>Object.hasOwn(value,key));
    if(scopeChange && !Object.hasOwn(value,"flight"))value={...value,flight:null};
    if(["caseId","mapResult","filters"].some(key=>Object.hasOwn(value,key)) && !Object.hasOwn(value,"mapFocus"))value={...value,mapFocus:null};
    if (scopeChange) serial.current++;
    if (Object.hasOwn(value, "caseId") && !Object.hasOwn(value, "dataView"))
      value = { ...value, dataView: null };
    if (
      (Object.hasOwn(value, "caseId") || value.dataView) &&
      !Object.hasOwn(value, "visualization")
    )
      value = { ...value, visualization: null };
    if (
      !Object.hasOwn(value, "origin") &&
      (Object.hasOwn(value, "caseId") ||
        (value.view && value.view !== latest.current.view))
    )
      value = { ...value, origin: null };
    if(!Object.hasOwn(value,"fieldLayer") && (Object.hasOwn(value,"caseId") || value.dataView || value.visualization))value={...value,fieldLayer:null};
    if (Object.hasOwn(value, "caseId") && !Object.hasOwn(value, "mapResult"))
      value = { ...value, mapResult: null };
    if (
      !Object.hasOwn(value, "inspector") &&
      (Object.hasOwn(value, "caseId") ||
        (value.view && value.view !== latest.current.view))
    )
      value = { ...value, inspector: null };
    if (Object.hasOwn(value, "evidence") && !Object.hasOwn(value, "readerPosition"))
      value = { ...value, readerPosition: null };
    if (value.evidence) {
      const doc = bindEvidenceBatch(value.evidence, {...latest.current, ...value});
      const tabs = doc.tabs.filter(previewableTab);
      const full = doc.fullSource;
      const fullTabs = full?.tabs.filter(previewableTab);
      if (tabs.length)
        value = {
          ...value,
          evidence: {
            ...doc,
            tabs,
            fullSource:
              full && fullTabs?.length
                ? { ...full, tabs: fullTabs }
                : undefined,
          },
        };
      else {
        const asset = assetById.get(doc.id);
        value = asset
          ? {
              ...value,
              evidence: null,
              inspector: {
                assetId: asset.id,
                filters: latest.current.filters,
                selection: latest.current.selection,
              },
            }
          : {
              ...value,
              evidence: null,
              error: "当前只有来源说明，尚无可预览的原始材料。",
            };
      }
    }
    if (
      !Object.hasOwn(value, "inspector") &&
      (Object.hasOwn(value, "filters") ||
        Object.hasOwn(value, "layer") ||
        Object.hasOwn(value, "selection"))
    ) {
      value = { ...value, inspector: null };
    }
    if (
      !Object.hasOwn(value, "listLibraryOpen") &&
      (value.view || (Object.hasOwn(value, "inspector") && value.inspector))
    )
      value = { ...value, listLibraryOpen: false };
    if (Object.hasOwn(value, "readerPosition")) {
      const doc = Object.hasOwn(value, "evidence") ? value.evidence : latest.current.evidence;
      try { saveReaderCheckpoint(latest.current.sessionId, doc || null, value.readerPosition || null); }
      catch { value = { ...value, sessionError: sessionFailure }; }
    }
    dispatch({ type: "patch", value });
  }, []);
  useEffect(() => {
    const dayMs = 24 * 60 * 60 * 1000;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const controller=new AbortController();
    async function poll(){
      let delay = dayMs;
      try {
        const res=await fetch("/api/constellations/observations",{signal:controller.signal});
        if(!res.ok) throw Error("feed");
        const feed:PushFeed=await res.json();
        if(!active) return;
        const changed=registerObservations(feed.records,true);
        const old=latest.current.pushFeed;
        if(changed || !old || old.offline || old.configured!==feed.configured)
          patch({...(feed.records.length && latest.current.view==="earth" && latest.current.filters.source==="constellation" && latest.current.camera.reason==="等待星座观测范围"
            ? {camera:observationBatchCamera(feed.records)} : {}),
            pushFeed:{configured:feed.configured,keys:feed.records.map(pushId),checkedAt:feed.checkedAt,offline:false}});
      } catch {
        delay = 60_000;
        if(active && !latest.current.pushFeed?.offline) patch({pushFeed:{configured:latest.current.pushFeed?.configured || 0, keys:latest.current.pushFeed?.keys || [], checkedAt:latest.current.pushFeed?.checkedAt || "",offline:true}});
      } finally {
        if (active) timer = setTimeout(poll, delay);
      }
    }
    void poll();
    return ()=>{active=false;controller.abort();clearTimeout(timer);};
  },[patch]);
  const paperCatalogLoaded=useRef(false);
  useEffect(() => {
    const controller=new AbortController();
    const work=state.view==="discover"||paperCatalogLoaded.current
      ?readPaperCatalogStatus(controller.signal,latest.current.paperFeed?.loaded||0).then(status=>patch({paperFeed:status}))
      :loadPaperCatalog(controller.signal,(records,status)=>{
      registerPapers(records);
      if(!status.loading)paperCatalogLoaded.current=true;
      patch({paperFeed:status});
    });
    void work.catch(error=>{
      if(!controller.signal.aborted)patch({paperFeed:{loaded:latest.current.paperFeed?.loaded||0,total:latest.current.paperFeed?.total||0,
        loading:false,complete:false,sourceTotal:null,filteredOut:0,updatedAt:null,error:error instanceof Error?error.message:"未能载入论文目录。"}});
    });
    return ()=>controller.abort();
  },[patch,state.view]);
  useEffect(()=>{
    const controller=new AbortController();
    let timer:ReturnType<typeof setTimeout>;
    async function load(){
      try{
        const c=await loadHainaCatalog(controller.signal);
        registerHaina(c.records,c.synced,c.endpoint);
        patch({hainaFeed:{total:c.total,synced:c.synced,endpoint:c.endpoint,warning:c.warning}});
      }catch(error){if(!controller.signal.aborted)patch({hainaFeed:{total:latest.current.hainaFeed?.total||0,synced:latest.current.hainaFeed?.synced||"",endpoint:latest.current.hainaFeed?.endpoint||"",warning:error instanceof Error?error.message:"海纳目录载入失败。"}});}
      finally{if(!controller.signal.aborted)timer=setTimeout(load,300000);}
    }
    void load();
    return ()=>{controller.abort();clearTimeout(timer);};
  },[patch]);
  useEffect(() => {
    const s = latest.current;
    const ids = [...(s.mapResult?.ids || []), ...(s.search.result?.ids || [])];
    for (const message of s.messages) {
      const referenced=[...(message.candidates?.ids || []), ...(message.answerNotes?.sources.map(source=>source.id) || [])];
      ids.push(...(historyIds.has(message.id)?referenced.filter(id=>!paperId(id)):referenced));
    }
    for (const value of s.saved) {
      try { const savedId = JSON.parse(value)?.[2]; if (typeof savedId==="string" && paperId(savedId)) ids.push(savedId); } catch { /* Older favorites can be plain identifiers. */ }
    }
    if (s.inspector) {
      if ("assetId" in s.inspector) ids.push(s.inspector.assetId, ...(s.inspector.parent?.ids || []));
      if ("batch" in s.inspector) ids.push(...s.inspector.batch.ids);
      if ("comparedBatch" in s.inspector) ids.push(...(s.inspector.comparedBatch?.ids || []));
    }
    if (ids.some(id => (paperId(id) || id.startsWith("constellation:") || id.startsWith("haina:")) && !assetById.has(id))) {
      void loadRemoteAssetIds(ids).then(() => {
        if (latest.current.sessionId === s.sessionId) dispatch({ type: "patch", value: {} });
      }).catch(() => {});
    }
  }, [state.sessionId, state.messages, state.saved, historyIds]);
  const channel = useRef<BroadcastChannel | null>(null);
  const writes = useRef(new Set<Promise<void>>());
  const failedMessages = useRef(new Map<string, Message>());
  const failedFavorites = useRef(new Map<string, boolean>());
  const dirtyWorkspace = useRef(false);
  const lastSnapshot = useRef(captureWorkspace(initialState));
  const lastMessageTime = useRef(0);
  const switchVersion = useRef(0);
  const recordWrite = useCallback((operation: Promise<unknown>, onError: () => void) => {
    const tracked = operation.then(() => {}, () => {
      onError();
      dispatch({ type: "patch", value: { sessionError: sessionFailure } });
    });
    writes.current.add(tracked);
    void tracked.then(() => writes.current.delete(tracked));
    return tracked;
  }, []);
  const automaticAnswerIds=useRef(new Set<string>());
  const add = useCallback((role: Message["role"], text: string, extra: Partial<Message> = {}) => {
    const s = latest.current;
    // Local actions can add both the question and answer in the same millisecond.
    lastMessageTime.current = Math.max(Date.now(), lastMessageTime.current + 1, (s.messages.at(-1)?.time || 0) + 1);
    const message = { id: randomId(), role, text, time: lastMessageTime.current, ...extra };
    if(role==="assistant" && message.candidates)automaticAnswerIds.current.add(message.id);
    dispatch({ type: "messages", sessionId: s.sessionId, messages: [message] });
    return recordWrite(writeSession(s.sessionId, sessionTitle(s), undefined, [message]).then(() => {
      channel.current?.postMessage({sessionId: s.sessionId, id: message.id});
    }), () => failedMessages.current.set(message.id, message));
  }, [recordWrite]);
  useEffect(() => {
    const previous = lastSnapshot.current;
    const snapshot = captureWorkspace(state);
    if (previous.resultId === snapshot.resultId && workspaceFields.every(key => previous[key] === state[key])) return;
    lastSnapshot.current = snapshot;
    recordWrite(writeSession(state.sessionId, sessionTitle(state), lastSnapshot.current), () => { dirtyWorkspace.current = true; });
  }, [state, recordWrite]);
  useEffect(() => {
    const sync = () => {
      const sessionId = latest.current.sessionId;
      void sessionMessages(sessionId).then(messages => dispatch({ type: "messages", sessionId, messages })).catch(() => {});
    };
    if (typeof BroadcastChannel !== "undefined") {
      channel.current = new BroadcastChannel("oneearth.session-messages.v1");
      channel.current.onmessage = event => {
        const {sessionId, id} = event.data || {};
        if (sessionId !== latest.current.sessionId) return;
        if (!id) { sync(); return; }
        void readSessionMessage(sessionId, id).then(message => {
          if (message) dispatch({ type: "messages", sessionId, messages: [message] });
        }).catch(() => {});
      };
    }
    sync();
    window.addEventListener("focus", sync);
    return () => { channel.current?.close(); channel.current = null; window.removeEventListener("focus", sync); };
  }, [state.sessionId]);
  async function flushSession() {
    await Promise.all(writes.current);
    const s = latest.current;
    if (!s.sessionError && !dirtyWorkspace.current && !failedMessages.current.size && !failedFavorites.current.size) return;
    const messages = Array.from(failedMessages.current.values());
    await writeSession(s.sessionId, sessionTitle(s), captureWorkspace(s), messages);
    for (const message of messages) failedMessages.current.delete(message.id);
    for (const [id, selected] of failedFavorites.current) {
      await writeFavorite(id, selected);
      failedFavorites.current.delete(id);
    }
    dirtyWorkspace.current = false;
    channel.current?.postMessage({sessionId: s.sessionId});
  }
  async function retrySessionSave() {
    try {
      await flushSession();
      dispatch({ type: "patch", value: { sessionError: null } });
    } catch {
      dispatch({ type: "patch", value: { sessionError: sessionFailure } });
    }
  }
  async function switchSession(id?: string) {
    const s = latest.current;
    if (id === s.sessionId) return true;
    const switchId = ++switchVersion.current;
    try {
      await flushSession();
      const record = id ? await readSession(id) : null;
      if (id && !record) throw Error("此会话已无法从当前浏览器读取。");
      const next = initial(id || randomId(), new URL(location.pathname, location.origin));
      if (record) {
        const { resultId: _resultId, ...workspace } = record.workspace;
        Object.assign(next, workspace, { messages: record.messages });
      }
      next.chatOpen = true;
      next.pushFeed = latest.current.pushFeed;
      next.paperFeed = latest.current.paperFeed;
      next.hainaFeed = latest.current.hainaFeed;
      next.saved = await readFavorites();
      if (!id) await writeSession(next.sessionId, sessionTitle(next), { ...captureWorkspace(next), resultId: null });
      if (switchVersion.current !== switchId || s.sessionId !== latest.current.sessionId) return false;
      request.current?.abort();
      request.current = null;
      serial.current++;
      lastSnapshot.current = captureWorkspace(next);
      const url = new URL(location.href);
      for (const k of ["result", "research", "case", "topic"]) url.searchParams.delete(k);
      if (url.hash.startsWith("#snapshot=")) url.hash = "";
      history.replaceState({...history.state,oneearthSession:next.sessionId,oneearthPath:url.pathname+url.search}, "", url);
      try { saveReaderCheckpoint(next.sessionId, next.evidence, next.readerPosition); }
      catch { next.sessionError = sessionFailure; }
      latest.current = next;
      dispatch({ type: "patch", value: next });
      return true;
    } catch {
      dispatch({ type: "patch", value: { sessionError: "暂时无法切换会话。请检查浏览器存储后重试，当前对话仍在此页。" } });
      return false;
    }
  }
  useEffect(() => {
    const url = new URL(location.href);
    if (state.caseId) url.searchParams.set("task", state.caseId);
    else url.searchParams.delete("task");
    if (state.view === "discover" && state.search.source)
      url.searchParams.set("source", state.search.source);
    else if (state.view === "earth" && !state.caseId && state.filters.source === "constellation" && !state.mapResult)
      url.searchParams.set("source", "constellation");
    else url.searchParams.delete("source");
    if (state.view !== "cases") {url.searchParams.delete("atlas");url.searchParams.delete("detail");}
    if (state.view !== "earth") url.searchParams.set("view", state.view);
    else url.searchParams.delete("view");
    if(state.view==="discover"){
      url.searchParams.set("section",initialAccessSection(state.search));
      if(state.search.page)url.searchParams.set("catalogPage",String(state.search.page));else url.searchParams.delete("catalogPage");
      for(const [key,value] of [["q",state.search.query],["dataType",state.search.type],["capability",state.search.capability],["saved",state.search.savedOnly?"1":""]])
        if(value)url.searchParams.set(key!,value);else url.searchParams.delete(key!);
    }else{for(const key of ["section","catalogPage","q","dataType","capability","saved"])url.searchParams.delete(key);}
    if (state.dataView) url.searchParams.set("data", state.dataView.kind);
    else url.searchParams.delete("data");
    if(state.fieldLayer && state.view==="earth")url.searchParams.set("viz",state.fieldLayer.id);
    else if (state.visualization)
      url.searchParams.set("viz", state.visualization.id);
    else url.searchParams.delete("viz");
    if(state.fieldLayer?.id==="rain"){
      url.searchParams.set("rainYear",String(state.fieldLayer.year??2024));
      url.searchParams.set("rainMonth",String(state.fieldLayer.frame+1));
    }else{url.searchParams.delete("rainYear");url.searchParams.delete("rainMonth");}
    history.replaceState({ ...history.state, oneearthSession: state.sessionId, oneearthPath: url.pathname + url.search }, "", url);
  }, [state.sessionId, state.caseId, state.view, state.search.source,state.search.section,state.search.page,state.search.query,state.search.type,state.search.capability,state.search.savedOnly, state.filters.source, state.mapResult, state.dataView, state.visualization,state.fieldLayer?.id,state.fieldLayer?.year,state.fieldLayer?.frame]);
  useEffect(() => () => request.current?.abort(), []);
  const openCase = useCallback(
    (id: string, need = -1) => {
      const c = caseById(id);
      if (!c) return;
      const fromSearch =
        latest.current.view === "discover"
          ? latest.current.search.result
          : null;
      const filters = {
        ...(fromSearch?.caseId === id ? fromSearch.filters : emptyFilters()),
        need,
      };
      patch({
        origin:
          latest.current.view === "discover" ? remember(latest.current) : null,
        caseId: id,
        search: {...emptySearch},
        filters,
        layer: "all",
        selection: null,
        evidence: null,
        citation: null,
        view: "earth",
        camera: fitCamera(id, filters, "all") || latest.current.camera,
        error: null,
      });
    },
    [patch],
  );
  const setFilters = useCallback(
    (changes: Partial<Filters>, fit = false) => {
      const s = latest.current,
        filters = { ...s.filters, ...(Object.hasOwn(changes,"period") ? {utcWindow:null} : {}), ...changes };
      patch({
        filters,
        selection: Object.keys(changes).every(k=>k==="period"||k==="utcWindow") ? s.selection : null,
        dataView: reconcileDataView(s.dataView, filters),
        ...(fit && s.caseId
          ? { camera: fitCamera(s.caseId, filters, s.layer) || s.camera }
          : {}),
      });
    },
    [patch],
  );
  const leaveDetail = useCallback(() => {
    const s = latest.current;
    patch(
      s.origin
        ? {
            ...s.origin,
            evidence: null,
            error: null,
          }
        : {
            visualization: null,
            dataView: null,
            selection: null,
          },
    );
  }, [patch]);
  const mapCandidates = (ids: string[]) => {
    const s = latest.current;
    const result = catalogBatch(s.search, ids, s.camera, s.gridSystem);
    const observations=ids.flatMap(id=>observationById(id)||[]);
    if(observations.length && observations.length===ids.length && !result.selection) {
      result.camera=observationBatchCamera(observations);
      result.filters={...result.filters,source:"constellation"};
    }
    patch({
      view: "earth",
      caseId: null,
      filters: result.filters,
      camera: result.camera,
      selection: result.selection,
      gridSystem: result.gridSystem,
      layer: result.layer,
      overview: "catalog",
      mapResult: result,
      search: {...s.search, result, compare:s.search.compare.filter(id => ids.includes(id))},
      origin: remember(s),
      evidence: null,
    });
  };
  const activateAnswer = useCallback((message:Message,fit=true,reveal=false) => {
    const s=latest.current,batch=answerMapBatch(message);
    if(!batch)return;
    const region=message.researchRegion;
    const target=fit?(region?researchRegionCamera(region):initialAnswerCamera(batch)):null;
    patch({view:"earth",caseId:null,overview:"catalog",mapResult:batch,
      filters:batch.filters,selection:batch.selection,gridSystem:batch.gridSystem,layer:batch.layer,
      dataView:null,visualization:null,fieldLayer:null,mapFocus:null,
      ...(reveal && matchMedia("(max-width: 600px)").matches?{chatOpen:false}:{}),
      camera:s.camera,flight:target?{id:randomId(),camera:target}:region && s.researchRegion?.messageId===message.replyTo?s.flight:null,
      ...(region!==undefined?{researchRegion:region?{messageId:message.replyTo || message.id,region,
        visible:sameResearchRegion(s.researchRegion?.region,region)?s.researchRegion?.visible??true:true}:null}:{}),
      search:{...s.search,result:batch},origin:s.origin || remember(s)});
  },[patch]);
  const flyToResearchRegion=useCallback((region:ResearchRegion,messageId:string)=>{
    const target=researchRegionCamera(region);
    patch({view:"earth",researchRegion:{messageId,region,visible:true},
      ...(target?{flight:{id:randomId(),camera:target,kind:"research-region"}}:{}),
      ...(target && matchMedia("(max-width: 600px)").matches?{chatOpen:false}:{})});
  },[patch]);
  const flyToGrid = useCallback((selection:Selection) => {
    patch({
      view:"earth",
      selection,
      ...(matchMedia("(max-width: 600px)").matches?{chatOpen:false}:{}),
      gridSystem:selection.grid.system,
      flight:{id:randomId(),camera:gridCamera(selection),kind:"grid"},
    });
  },[patch]);
  const flyToEvidence = useCallback((message:Message,assetId:string) => {
    const s=latest.current;
    const batch=s.mapResult?.answerId===message.id?{...s.mapResult,filters:s.filters,layer:s.layer,camera:s.camera}:answerMapBatch(message);
    if(!batch)return;
    const target=evidenceCamera(batch,assetId,s.gridSystem);
    if(s.mapResult?.answerId!==message.id)activateAnswer(message,false);
    const selection=evidenceSelection(batch,assetId,s.gridSystem);
    patch({...(s.view!=="earth"?{view:"earth",origin:s.origin || remember(s)}:{}),mapFocus:{answerId:message.id,assetId,locked:true},
      flight:target?{id:randomId(),camera:target}:null,
      ...(selection?{selection,gridSystem:selection.grid.system}:{}),
      ...(target && matchMedia("(max-width: 600px)").matches?{chatOpen:false}:{})});
  },[patch,activateAnswer]);
  const focusAnswerEvidence = useCallback((message:Message,assetId:string|null,locked=false) => {
    const s=latest.current;
    if(!assetId) {
      if(!s.mapFocus?.locked)patch({mapFocus:null});
      return;
    }
    if(s.mapResult?.answerId!==message.id) {
      if(!locked)return;
      activateAnswer(message,false);
    }
    if(!locked && s.mapFocus?.locked)return;
    patch({mapFocus:{answerId:message.id,assetId,locked}});
  },[patch,activateAnswer]);
  const lastAnswerSync=useRef({session:initialState.sessionId,id:initialState.messages.at(-1)?.id});
  useEffect(()=>{
    const previous=lastAnswerSync.current,last=state.messages.at(-1);
    lastAnswerSync.current={session:state.sessionId,id:last?.id};
    if(previous.session!==state.sessionId || previous.id===last?.id || !last || last.role!=="assistant" ||
      !automaticAnswerIds.current.delete(last.id) || !last.candidates || last.historicalReply || last.failed)return;
    // Explicit content visualizations keep control of the globe. Late replies never move it.
    if(state.view!=="earth" || state.visualization || state.fieldLayer || state.dataView || state.evidence)return;
    const fit=!state.researchRegion && !state.mapResult?.answerId,key=requestWorkspaceKey(state);
    const ids=last.candidates.ids.filter(id=>!assetById.has(id));
    if(ids.length)void loadRemoteAssetIds(ids).then(()=>{
      const current=latest.current;
      if(current.sessionId===state.sessionId && current.messages.at(-1)?.id===last.id && requestWorkspaceKey(current)===key)activateAnswer(last,fit);
    }).catch(()=>{});
    else activateAnswer(last,fit);
  },[state.messages,state.sessionId,activateAnswer]);
  const inspectCandidates = useCallback(
    (batch: CandidateSet) => {
      patch({ inspector: { batch }, evidence: null });
    },
    [patch],
  );
  const showCandidates = useCallback(
    (result: CandidateSet, selectedId?: string, keepFilters = false) => {
      const s = latest.current;
      patch({
        view: "discover",
        caseId: result.caseId,
        filters: result.filters,
        selection: result.selection,
        layer: result.layer,
        gridSystem: result.gridSystem,
        camera: result.camera,
        search: keepFilters ? {...s.search, result, compare:s.search.compare.filter(id => result.ids.includes(id))}
          : {...emptySearch, result},
        origin: s.view === "earth" ? remember(s) : s.origin,
        inspector: selectedId
          ? {
              assetId: selectedId,
              parent: result,
              filters: result.filters,
              selection: result.selection,
            }
          : null,
        evidence: null,
      });
    },
    [patch],
  );
  function openMappedCatalog() {
    const s = latest.current;
    if (s.view !== "earth") { openCatalog(); return; }
    if (!s.mapResult) {
      if (!s.caseId && s.overview === "catalog" && (s.selection || JSON.stringify(s.filters)!==JSON.stringify(emptyFilters()))) {
        showCandidates(makeCandidates({title:"当前地球数据", caseId:null, filters:s.filters,
          selection:s.selection, gridSystem:s.gridSystem, camera:s.camera, layer:s.layer}));
      } else openCatalog();
      return;
    }
    const result = makeMappedCandidates(s.mapResult, {...s.mapResult, filters:s.filters,
      gridSystem:s.gridSystem, camera:s.camera, selection:s.selection, layer:s.layer});
    showCandidates(result, undefined, true);
  }
  function openCatalog() {
    const s = latest.current;
    patch({
      view: "discover",
      caseId: null,
      selection: null,
      filters: emptyFilters(),
      evidence: null,
      inspector: null,
      origin: s.view === "earth" ? remember(s) : s.origin,
      search: { ...emptySearch },
    });
  }
  function openEarth() {
    const s = latest.current;
    if (s.view === "discover" && s.search.result) {
      mapCandidates(catalogResults(s.search,s.saved).map(a => a.id));
    } else if (s.view === "discover" && s.origin?.view === "earth") leaveDetail();
    else patch({ view: "earth", evidence: null });
  }
  const preview = useCallback(
    async (
      id: string,
      index: number,
      kind: string | null = null,
      assetId?: string,
      scope?: Filters,
      selected?: Selection | null,
    ) => {
      const s = latest.current;
      if (id === "wind") {
        const view = s.visualization || defaultWindState();
        const version = serial.current;
        const stillCurrent = () => {
          const current = latest.current;
          return version === serial.current && current.sessionId === s.sessionId &&
            current.inspector === s.inspector && current.view === s.view &&
            current.caseId === s.caseId && current.visualization === s.visualization;
        };
        try {
          await loadWindData();
          if (!stillCurrent()) return false;
          patch({ evidence: windDocument(view, selected?.point), previewKind: kind || "table" });
          return true;
        } catch (error) {
          if (stillCurrent()) patch({ error: error instanceof Error ? error.message : "风场内容载入失败。" });
          return false;
        }
      }
      const doc = evidenceFor(
        id,
        index,
        scope || (id === s.caseId ? s.filters : emptyFilters()),
        undefined,
        assetId,
        selected === undefined
          ? s.view === "discover"
            ? s.search.result?.selection
            : s.caseId === id
              ? s.selection
              : null
          : selected,
      );
      if (!doc.tabs.length) {
        patch({ error: "该需求目前只有待取证线索，尚无可预览材料。" });
        return false;
      }
      patch({ evidence: doc, previewKind: kind });
      return true;
    },
    [patch],
  );
  const inspectAsset = (
    assetId: string,
    filters?: Filters,
    selection?: Selection | null,
    fromBatch?: CandidateSet,
  ) => {
    const s = latest.current;
    const asset = assetById.get(assetId);
    if (!asset) return;
    const batch =
      s.view === "discover"
        ? catalogBatch(s.search, catalogResults(s.search, s.saved).map(a => a.id), s.camera, s.gridSystem)
        : s.inspector && "batch" in s.inspector
          ? s.inspector.batch
          : s.mapResult;
    const parent =
      fromBatch ||
      batch ||
      makeCandidates({
        title: caseById(s.caseId)?.title || "当前数据",
        caseId: s.caseId,
        filters: filters || s.filters,
        selection: selection === undefined ? s.selection : selection,
        camera: s.camera,
        gridSystem: s.gridSystem,
        layer: s.layer,
      });
    patch({
      evidence: null,
      inspector: {
        assetId,
        parent: parent.ids.includes(assetId) ? parent : undefined,
        filters:
          filters ||
          batch?.filters ||
          (asset.caseId === s.caseId ? s.filters : emptyFilters()),
        selection:
          selection !== undefined
            ? selection
            : s.view === "discover"
              ? batch?.selection || null
              : s.selection,
      },
    });
  };
  const openData = useCallback(
    (
      caseId: string,
      index: number,
      scope?: Filters,
      selection?: Selection | null,
    ) => {
      const s = latest.current;
      const filters = scope
        ? { ...scope, need: index }
        : caseId === s.caseId
          ? { ...s.filters, need: index, type: "", source: "" }
          : { ...emptyFilters(), need: index };
      const selected =
        selection !== undefined
          ? selection
          : (s.view === "discover"
              ? s.search.result?.selection
              : s.selection) || null;
      const dataView = scopedDataView(
        caseId,
        index,
        filters,
        selected,
        s.dataView,
      );
      if (!dataView) {
        patch({ error: "当前条件下尚无可视化的数据内容，可先查看已核材料。" });
        return;
      }
      patch({
        origin: s.inspector ? remember(s) : s.origin || remember(s),
        caseId,
        filters,
        dataView,
        view: "earth",
        evidence: null,
        selection: selected,
        layer: "all",
        camera: dataCamera(dataView),
      });
    },
    [patch],
  );
  const executeDiscovery = useCallback(
    async (attempt: DiscoveryAttempt, retrying: boolean, saved?: ChatDelivery) => {
      if (request.current) return;
      const q = attempt.query;
      const current = latest.current;
      const until = current.messages.findIndex(m => m.id === attempt.userMessageId);
      const preceding = until < 0 ? current.messages : current.messages.slice(0,until);
      let conversationEvidence:import("./types").ReadEvidence[]=[];
      for(const message of preceding.filter(m=>m.role==="assistant" && !m.failed))
        conversationEvidence=message.conversationEvidence ?? rememberReadEvidence(conversationEvidence,message.answerNotes?.searches);
      const latestAssistant=preceding.filter(m=>m.role==="assistant" && !m.failed).at(-1)?.id;
      const conversationAssertionEvidence=preceding.filter(m=>m.role==="assistant" && !m.failed && m.conversationAssertionEvidence!==undefined).at(-1)?.conversationAssertionEvidence;
      const conversationReferences=conversationReferenceMemory(preceding);
      const previousAnswer = current.messages.slice().reverse().find(message => message.role==="assistant" && !message.failed && message.answerNotes);
      const payload = {query:q, context:attempt.context, config:readChatModel(), deepseekTools:readDeepSeekTools(),
        conversationId:current.sessionId, turnId:attempt.userMessageId, previousTaskId:attempt.clarificationReply?undefined:previousAnswer?.id,
        ...(attempt.questionDecision?{questionDecision:attempt.questionDecision}:{}),
        ...(attempt.clarificationReply?{clarificationReply:attempt.clarificationReply}:{}),
        history:preceding.filter(m=>!m.failed).slice(-8).map(m=>{
          const notes=m.answerNotes;
          const text=notes?.references
            ? m.text.replace(/〔(\d+)〕/g,(marker,n)=>notes.references?.[Number(n)-1] ? marker+"（"+notes.references[Number(n)-1].title+"）" : marker)
            : [m.text,...(notes?.sources || []).map(source=>(assetById.get(source.id)?.title || source.id)+" "+source.reason),...(notes?.webSources || []).map(h=>h.title+" "+h.url),notes?.limitation,notes?.followUp].filter(Boolean).join("\n");
          const attached=m.attachedScope?.map(i=>scopeLabel(i)+"（"+scopeDetail(i)+"）").join("；");
          return {role:m.role,text:(attached?text.slice(0,950)+"\n当轮用户引用："+attached:text).slice(0,1600),
            ...(m.role==="assistant" && m.conversationContext!==undefined?{conversationContext:m.conversationContext}:{}),
            ...(m.role==="assistant" && m.researchIntent?{researchIntent:m.researchIntent}:{}),
            ...(m.id===latestAssistant && (conversationEvidence.length || m.conversationEvidence!==undefined)?{conversationEvidence}:{}),
            ...(m.id===latestAssistant && conversationAssertionEvidence!==undefined?{conversationAssertionEvidence}:{}),
            ...(m.id===latestAssistant && conversationReferences.length?{conversationReferences}:{}),
            ...(m.role==="assistant" ? {assetIds:[...new Set(notes?.sources.map(source=>source.id) || [])].slice(0,100)} : {})};
        })};
      const detached = retrying && requestWorkspaceKey(current) !== attempt.workspaceKey;
      const s: State = {
        ...current, ...attempt.context, view: attempt.view ?? current.view,
        origin: detached ? null : current.origin,
        dataView: attempt.context.dataView ?? null, visualization: attempt.context.visualization ?? null,
      };
      const controller = new AbortController();
      request.current = controller;
      const delivery = saved || {id: randomId(), attempt, body: JSON.stringify(payload)};
      const session = current.sessionId;
      const isCurrent = () => !controller.signal.aborted && latest.current.sessionId === session && request.current === controller;
      const version = ++serial.current;
      let regionFlight:{id:string;camera:Camera;kind:"research-region"}|undefined;
      let regionReceived=false;
      // Only our own automatic camera move is exempt from the late-reply guard.
      // A drag/zoom/new flight or any scope edit still detaches this reply.
      const workspaceCurrent=()=>{
        const now=latest.current;
        const ownCamera=regionFlight && now.flight?.id===regionFlight.id &&
          (now.camera===current.camera || JSON.stringify(now.camera)===JSON.stringify(regionFlight.camera));
        return version===serial.current && requestWorkspaceKey(ownCamera?{...now,camera:current.camera}:now)===attempt.workspaceKey;
      };
      const receiveRegion=(region:ResearchRegion|null)=>{
        if(regionReceived || !isCurrent())return;
        regionReceived=true;
        if(!workspaceCurrent())return;
        const now=latest.current,previous=now.researchRegion;
        const changed=!sameResearchRegion(previous?.region,region);
        const layer=region?{messageId:attempt.userMessageId,region,visible:changed?true:previous?.visible??true}:null;
        const target=region && changed && now.view==="earth" && !now.visualization && !now.fieldLayer && !now.dataView && !now.evidence
          ? researchRegionCamera(region):null;
        if(target)regionFlight={id:randomId(),camera:target,kind:"research-region"};
        patch({researchRegion:layer,...(regionFlight?{flight:regionFlight}:{})});
      };
      const c = caseById(s.caseId);
      const context =
        [c?.title, s.filters.place, s.selection?.grid.label]
          .filter(Boolean)
          .join(" · ") || "全球视图";
      patch({ pending: true, liveTrace:{started:Date.now(),stages:[],calls:[]},liveSearches:[], chatStage:saved ? "正在接回本轮回答" : "正在提交问题", error: null, ...(retrying || attempt.clarificationReply ? {} : { citation: null }), ...(saved ? {} : {chatOpen:true}) });
      try {
        if (!saved) {
          payload.deepseekTools = await loadDeepSeekTools(controller.signal);
          delivery.body = JSON.stringify(payload);
        }
        if (!saved) await saveChatDelivery(session, delivery).catch(() => patch({sessionError:sessionFailure}));
        const receive = async () => {
          const response = await openTaskEvents(delivery.id, delivery.body, controller.signal);
          return readChatResponse(response, (text, liveSearches, liveTrace) => {
            if (isCurrent()) patch({chatStage:text,...(liveSearches ? {liveSearches} : {}),...(liveTrace ? {liveTrace} : {})});
          },receiveRegion);
        };
        let r: DiscoveryResponse;
        try { r = await receive(); }
        catch (error) {
          if (!isCurrent() || error instanceof ChatResponseError) throw error;
          patch({chatStage:"正在重新连接本轮回答"});
          r = await receive();
        }
        if (!isCurrent()) return;
        if(r.researchRegion===null || validResearchRegion(r.researchRegion))receiveRegion(r.researchRegion);
        if(r.clarification){
          patch({pending:false});
          await add("assistant",r.message,{id:delivery.id,replyTo:attempt.userMessageId,runTrace:r.runTrace,
            clarification:true,...(discoveryClarificationResult(r)?{discoveryClarification:true}:{}),researchRegion:r.researchRegion,researchIntent:r.researchIntent,conversationContext:r.conversationContext,conversationEvidence:r.conversationEvidence,conversationAssertionEvidence:r.conversationAssertionEvidence});
          if(!failedMessages.current.has(delivery.id))
            await removeChatDelivery(session,delivery.id).catch(()=>patch({sessionError:sessionFailure}));
          return;
        }
        if(r.questionCheck){
          patch({pending:false});
          await add("assistant",r.message,{id:delivery.id,replyTo:attempt.userMessageId,runTrace:r.runTrace,
            questionCheck:{...r.questionCheck,attempt},researchRegion:r.researchRegion,researchIntent:r.researchIntent,conversationContext:r.conversationContext,conversationEvidence:r.conversationEvidence,conversationAssertionEvidence:r.conversationAssertionEvidence});
          if(!failedMessages.current.has(delivery.id))
            await removeChatDelivery(session,delivery.id).catch(()=>patch({sessionError:sessionFailure}));
          return;
        }
        if(r.hainaRecords&&r.hainaCatalog)registerHaina(r.hainaRecords,r.hainaCatalog.synced,r.hainaCatalog.endpoint,false);
        const next: Partial<State> = { pending: false };
        if(r.hainaCatalog)next.hainaFeed=r.hainaCatalog;
        if (
          r.view === "earth" &&
          s.view === "discover" &&
          s.origin?.view === "earth"
        )
          Object.assign(next, s.origin, { evidence: null });
        else if (r.view) {
          next.view = r.view;
          if (r.view === "discover" && s.view === "earth")
            next.origin = remember(s);
        }
        if (r.catalogQuery !== undefined)
          next.search = { ...emptySearch, query: r.catalogQuery };
        if (r.inspectId && assetById.has(r.inspectId)) {
          next.inspector = {
            assetId: r.inspectId,
            filters: r.filters || s.filters,
            selection: s.selection,
          };
          next.evidence = null;
        }
        // A place lookup animates to the camera and lets the renderer commit the
        // settled position; writing it straight into state would cancel the flight.
        const placeFlight = r.fly && r.camera ? { id: randomId(), camera: r.camera, kind: "place" as const, ...(r.placeLabel ? { label: r.placeLabel } : {}) } : undefined;
        if (placeFlight) next.flight = placeFlight;
        for (const k of [
          "caseId",
          "filters",
          "gridSystem",
          "layer",
          "camera",
          "dataView",
          "visualization",
          "mesh",
        ] as const)
          if (r[k] !== undefined && !(k === "camera" && placeFlight)) (next as any)[k] = r[k];
        if (
          r.layer !== undefined &&
          r.visualizeNeed === undefined &&
          r.dataView === undefined
        )
          next.dataView = null;
        if (
          r.visualization &&
          !s.visualization &&
          matchMedia("(prefers-reduced-motion: reduce)").matches
        )
          next.visualization = { ...r.visualization, playing: false };
        if (r.clearSelection) next.selection = null;
        if (r.visualization && !s.visualization && s.selection) {
          next.selection = s.selection;
          next.camera = { ...s.camera, center: s.selection.point };
        }
        if (r.caseId !== undefined) {
          next.view = "earth";
          next.evidence = null;
        }
        if (r.visualizeNeed !== undefined) {
          const id = r.caseId || s.caseId;
          if (id) {
            const filters = {
              ...(r.filters || s.filters),
              need: r.visualizeNeed,
              type: "",
              source: "",
            };
            const selection = id === s.caseId ? s.selection : null;
            const dataView = scopedDataView(
              id,
              r.visualizeNeed,
              filters,
              selection,
              s.dataView,
            );
            if (dataView) {
              next.dataView = dataView;
              next.filters = filters;
              next.camera = dataCamera(dataView);
              next.view = "earth";
              next.evidence = null;
              next.selection = selection;
            } else {
              next.error = "当前选区和筛选条件下没有可探索的观测。";
            }
          }
        }
        if (
          r.filters &&
          r.visualizeNeed === undefined &&
          r.dataView === undefined &&
          r.caseId === undefined
        )
          next.dataView = reconcileDataView(s.dataView, r.filters);
        if (r.previewNeed !== undefined) {
          const id = r.previewCaseId || r.caseId || s.caseId;
          if (id) {
            if (id === "wind") await loadWindData();
            const doc =
              id === "wind"
                ? windDocument(
                    next.visualization || s.visualization || defaultWindState(),
                  )
                : evidenceFor(
                    id,
                    r.previewNeed,
                    r.filters || s.filters,
                    undefined,
                    undefined,
                    id === s.caseId && !r.clearSelection ? s.selection : null,
                  );
            const tabs = doc.tabs.filter((t) => t.kind !== "web");
            const tab = tabs.find(
              (t) => !r.previewKind || t.kind === r.previewKind,
            );
            if (tab) {
              next.evidence = { ...doc, tabs };
              next.previewKind = tab.kind;
            } else {
              r.message =
                "当前条件下没有可预览的对应材料，可查看资料速览中的获取入口。";
            }
          }
        }
        if (r.selectCenter) {
          const g = gridSpec(
            r.gridSystem || s.gridSystem,
            resolution((r.camera || s.camera).zoom),
          );
          next.selection = {
            id: cellAt(s.camera.center, g),
            grid: g,
            point: s.camera.center,
          };
        }
        if (r.paperRecords) registerPapers(r.paperRecords,false);
        if (r.paperOnly) next.fieldLayer=null;
        if(r.pushFeed) registerObservations(r.pushFeed.records);
        const match = r.catalogMatch;
        const support = r.gap?.dataSupport;
        const catalogBatchResult: CandidateSet | undefined = match ? {
          title: q, ids: match.ids, caseId: null, originKind: "chat",
          filters: answerFilters(s.filters,r.filters,r.paperOnly ? "paper" : r.pushFeed ? "constellation" : undefined), selection: match.selection ?? null, layer: "all",
          lookups: match.lookups,
          camera: r.pushFeed?.records.length ? observationBatchCamera(r.pushFeed.records) : match.lookups?.some(l => l.matched > 0) ? {center: match.lookups[0].point, zoom: 35, reason: "STAC 影像命中位置"} : match.sampleWindow ? sampleCamera : {center: [105,25], zoom: 1, reason: "集合级目录"},
          gridSystem: s.gridSystem, catalogConditions: match.conditions,
        } : support ? {
          title:q, ids:[...new Set(support.candidates.map(a => a.assetId))], caseId:null, originKind:"chat",
          filters:answerFilters(s.filters,r.filters), selection:null, layer:"all", camera:defaultCamera, gridSystem:s.gridSystem,
          catalogConditions:support.unmatchedInputs,
        } : undefined;
        if(match?.sampleWindow && catalogBatchResult){
          const scenes=checkedScenes(catalogBatchResult);
          if(scenes.length){
            const shape={type:"GeometryCollection" as const,geometries:scenes.map(r=>r.geometry)};
            const [[w,lo],[e,hi]]=geoBounds(shape);
            catalogBatchResult.camera={center:geoCentroid(shape),zoom:Math.max(1,Math.min(80,48/Math.max(.3,hi-lo,e-w))),reason:"本次找到的影像足迹"};
          }
        }
        if (catalogBatchResult) Object.assign(next, {
          view: "earth", overview: "catalog", caseId: null, dataView: null, visualization: null,
          selection: catalogBatchResult.selection, layer: "all", camera: catalogBatchResult.camera, filters: catalogBatchResult.filters,
          mapResult: catalogBatchResult, search: {...emptySearch, result: catalogBatchResult}, inspector: null, evidence: null,
          listLibraryOpen: false, citation: null, origin: null,
        });
        if (!isCurrent()) return;
        if (next.visualization || next.dataView)
          next.origin = s.origin || remember(s);
        if (s.visualization && r.visualization === null && s.origin)
          Object.assign(next, s.origin, { origin: null, evidence: null });
        const lastQuestion = latest.current.messages.slice().reverse().find(m => m.role === "user");
        const historicalReply = !workspaceCurrent() ||
          !!lastQuestion && lastQuestion.id !== attempt.userMessageId;
        const effective = { ...s, ...next };
        const modelBatch: CandidateSet | undefined = r.modelIds?.length ? {
          title:q, ids:r.modelIds, caseId:r.caseId || s.caseId, filters:answerFilters(s.filters,r.filters),
          camera:r.camera || s.camera, selection:r.clearSelection ? null : s.selection, gridSystem:s.gridSystem,
          layer:r.layer || s.layer, originKind:"chat"
        } : undefined;
        const recommendations = (match ? catalogBatchResult : undefined) || modelBatch || catalogBatchResult || (
          r.modelIds === undefined && (effective.caseId ||
            (effective.selection && !effective.selection.simulated)) &&
          (r.caseId ||
            r.research ||
            r.filters ||
            r.selectCenter ||
            /这里|选格/.test(q))
            ? makeCandidates({
                title: q,
                originKind: "chat",
                caseId: effective.caseId,
                filters: effective.filters,
                selection: effective.selection,
                layer: effective.layer,
                camera: effective.camera,
                gridSystem: effective.gridSystem,
              })
            : undefined);
        if(recommendations){
          recommendations.answerId=delivery.id;
          recommendations.researchRecord={question:q,intent:r.researchIntent,sessionId:session,messageId:delivery.id,notes:r.answerNotes?.researchNotes || []};
        }
        if (recommendations && !modelBatch && r.research)
          recommendations.ids = [
            ...new Set(r.research.rows.flatMap((row) => row.ids)),
          ];
        if (recommendations && !catalogBatchResult && r.catalogQuery === undefined)
          next.search = {...emptySearch, result:recommendations};
        if (recommendations && r.research) {
          next.inspector = null;
          if (r.previewNeed === undefined) next.evidence = null;
          next.origin = null;
          if (!recommendations.ids.length) {
            next.mapResult = recommendations;
            next.caseId = null;
            next.view = "earth";
            next.overview = "catalog";
          }
        }
        if (retrying) delete next.citation;
        // Catalogue recommendations must not replace the question-region flight
        // with a product's camera. Explicit content visualizations retain control.
        if(regionReceived && r.researchRegion && !next.visualization && !next.dataView && r.visualizeNeed===undefined){
          delete next.camera;next.flight=regionFlight || latest.current.flight;
        }
        patch(historicalReply ? {pending:false} : next);
        if (next.search && r.catalogQuery !== undefined)
          r.message +=
            " 当前匹配 " +
            catalogResults(next.search, effective.saved).length +
            " 份资料。";
        if (next.error && r.visualizeNeed !== undefined) r.message = next.error;
        await add("assistant", r.message, {
          id: delivery.id,
          researchRegion:r.researchRegion,
          researchIntent:r.researchIntent,conversationContext:r.conversationContext,
          conversationEvidence:r.conversationEvidence,
          conversationAssertionEvidence:r.conversationAssertionEvidence,
          runTrace:r.runTrace, answerNotes:r.answerNotes, gridCoverage:r.gridCoverage,
          replyTo: attempt.userMessageId,
          ...(historicalReply ? { historicalReply: true, context: "原问题 · " + q + " · " + context } : {}),
          ...(r.gap ? {dataSupport:r.gap.dataSupport} : {}),
          ...(match ? {catalogMatch: match} : {}),
          ...(r.research ? { research: r.research } : {}),
          ...(recommendations ? { candidates: recommendations } : {}),
          activity: {
            id: "discovery-" + randomId(),
            title: "数据发现 · 执行记录",
            scope: q,
            source: r.modelExecutor ? (r.modelExecutor==="codex"?"Codex":"Claude Code")+" · OneEarth 数据目录" : r.pushFeed ? "OneEarth 星座直推接收库" : match ? "Element 84 Earth Search · 目录快照" : "OneEarth 数据发现服务 · 案例材料模式",
            tabs: [
              {
                kind: "trace",
                label: "执行记录",
                steps: [
                  { title: "接收问题与上下文", detail: q + "\n" + context },
                  ...(r.answerNotes?.paperTrace ? [{title:"检索论文线索",detail:r.answerNotes.paperTrace}] : []),
                  ...(r.answerNotes?.searches || []).map(run=>({
                    title:run.engine+" · "+run.query,
                    detail:run.status==="failed" ? run.error || "搜索未完成" : run.hits.length+" 条结果\n"+run.hits.map(hit=>hit.title+" · "+hit.url).join("\n"),
                  })),
                  ...(r.research?.steps || []),
                  {
                    title: "获得服务响应",
                    detail:
                      "POST /api/tasks" +
                      "\n" +
                      r.message,
                  },
                  {
                    title: historicalReply ? "原请求的结果范围" : "应用到当前工作区",
                    detail: [
                      "视图：" +
                        {
                          earth: "数据地球",
                          discover: "数据触达",
                          cases: "研究案例",
                        }[effective.view],
                      "研究问题：" +
                        (caseById(effective.caseId)?.title || "全球视图"),
                      "网格体系：" + effective.gridSystem.toUpperCase(),
                      "视野中心：" +
                        effective.camera.center.join(", ") +
                        "；缩放 " +
                        effective.camera.zoom,
                      "筛选条件：" + JSON.stringify(effective.filters),
                      "数据输出：" +
                        (effective.visualization
                          ? "可视化探索 · " +
                            JSON.stringify(effective.visualization)
                          : effective.dataView
                            ? "内容查看 · " + JSON.stringify(effective.dataView)
                            : "资源分布"),
                    ].join("\n"),
                  },
                ],
              },
              {
                kind: "code",
                label: "请求与响应",
                language: "json",
                body: JSON.stringify(
                  {
                    request: JSON.parse(delivery.body),
                    response: r,
                  },
                  null,
                  2,
                ),
              },
            ],
          },
        });
      } catch (error) {
        if (!isCurrent()) return;
        patch({
          pending: false,
          error: error instanceof Error ? error.message : "请求失败，请重试。",
        });
        await add("assistant", error instanceof ChatResponseError && error.code==="invalid_answer_references"
          ? "这次回答的资料引用未通过核对，可按原条件重试。"
          : "这次请求没有完成，可按此轮原始条件重试。", {
          runTrace:error instanceof ChatResponseError ? error.runTrace || latest.current.liveTrace : latest.current.liveTrace,
          id: delivery.id, failed: true, retry: attempt, replyTo: attempt.userMessageId,
        });
      } finally {
        if (request.current === controller) request.current = null;
      }
      if (!failedMessages.current.has(delivery.id)) {
        await removeChatDelivery(session, delivery.id).catch(() => patch({sessionError:sessionFailure}));
      }
    },
    [add, patch],
  );
  const attachScope=(...items:ScopeItem[])=>{
    const previous=latest.current.draftScope || [];
    if (items.some(item=>item.kind==="time") && !items.some(item=>item.kind==="grid") &&
        previous.some(item=>item.kind==="grid" && item.coverageScope?.summary)) {
      patch({error:"已附加范围包含原时段。要改用其他时段，请重新附加地图范围。"});
      return;
    }
    const merged=mergeScope(previous,items);
    if(merged.length>10){patch({error:"一次最多引用 10 个对象，请先移除一项。"});return;}
    patch({draftScope:merged,chatOpen:true,inspector:null,evidence:null});
  };
  const confirmingQuestions=useRef(new Set<string>());
  const confirmQuestion = useCallback(async (messageId:string,choice:QuestionDecision["choice"],edited?:string)=>{
    const current=latest.current;
    const message=current.messages.find(m=>m.id===messageId),check=message?.questionCheck;
    if(!message || !check || current.pending || request.current || confirmingQuestions.current.has(messageId) ||
      current.messages.some(m=>m.role==="user" && m.time>message.time))return;
    let decision:QuestionDecision;
    try{decision=makeQuestionDecision(check,messageId,choice,edited);}
    catch(error){patch({error:error instanceof Error?error.message:"请核对问题内容。"});return;}
    const {clarificationReply: _clarificationReply,...checkedAttempt}=check.attempt;
    const attempt={...checkedAttempt,query:check.originalQuestion,userMessageId:randomId(),questionDecision:decision};
    confirmingQuestions.current.add(messageId);
    try{
      await add("user",(choice==="original"?"按原问题继续：":"按确认的问题继续：")+decision.dataQuestion,
        {id:attempt.userMessageId,questionDecision:decision,attachedScope:attempt.context.attachedScope});
      if(latest.current.sessionId===current.sessionId)await executeDiscovery(attempt,true);
    }finally{confirmingQuestions.current.delete(messageId);}
  },[add,patch,executeDiscovery]);
  useEffect(() => {
    let active = true;
    const session = state.sessionId;
    async function restore() {
      const last = latest.current.messages.at(-1);
      const deliveries = await unfinishedChatDeliveries(session);
      if (active && latest.current.sessionId === session && !deliveries.length && last?.role === "user" && !request.current) {
        patch({unansweredQuestionId:last.id});
      }
      for (const delivery of deliveries) {
        if (!active || latest.current.sessionId !== session) return;
        if (latest.current.messages.some(m => m.id === delivery.id)) {
          await removeChatDelivery(session, delivery.id);
        } else if (!request.current) {
          await executeDiscovery(delivery.attempt, true, delivery);
        }
      }
    }
    void restore().catch(() => { if (active) patch({sessionError:sessionFailure}); });
    return () => { active = false; };
  }, [state.sessionId, executeDiscovery, patch]);
  const openVisualization = useCallback(
    (id: "gfs-wind" | RegionalId | "catalog", selection?: Selection | null) => {
      const current=latest.current;
      if(current.view==="earth" && current.fieldLayer?.id===id){patch({inspector:null,evidence:null});return;}
      if(id!=="gfs-wind"){
        const fieldLayer=id==="catalog"?null:{id,frame:globeCases[id].month};
        const camera=fieldLayer?{center:globeCases[fieldLayer.id].center,zoom:globeCases[fieldLayer.id].zoom,reason:globeCases[fieldLayer.id].title}:defaultCamera;
        const layerAssetId=id==="forest"?"haina:1846764":id==="c40"?"haina:1846639":undefined;
        const layerAsset=layerAssetId?assetById.get(layerAssetId):undefined;
        patch({view:"earth",caseId:null,fieldLayer,visualization:null,dataView:null,overview:"catalog",filters:emptyFilters(),
          selection:null,layer:"all",mesh:!fieldLayer,origin:current.origin || remember(current),camera,inspector:null,evidence:null,error:null,
          ...(layerAsset?{draftScope:mergeScope(current.draftScope || [],[datasetScope(layerAsset)])}:{})});
        return;
      }
      if (
        latest.current.visualization?.id === id &&
        latest.current.view === "earth"
      )
        return;
      const recipe = visualizationCatalog.find((v) => v.id === id);
      if (!recipe) return;
      const s = latest.current;
      const selected =
        selection !== undefined
          ? selection
          : (s.view === "discover"
              ? s.search.result?.selection
              : s.selection) || null;
      const visualization = defaultWindState();
      if (matchMedia("(prefers-reduced-motion: reduce)").matches)
        visualization.playing = false;
      patch({
        origin: s.inspector ? remember(s) : s.origin || remember(s),
        caseId: recipe.caseId,
        visualization,
        dataView: null,
        filters: emptyFilters(),
        selection: selected,
        evidence: null,
        citation: null,
        view: "earth",
        mesh: false,
        layer: "all",
        error: null,
        camera: selected
          ? { ...s.camera, center: selected.point }
          : { center: [105, 20], zoom: 1, reason: "全球 GFS 风场" },
      });
    },
    [patch],
  );
  const send = useCallback(
    async (query: string, clarificationReply?: ClarificationReply) => {
      const q = query.trim(),
        s = latest.current;
      if (!q || s.pending || s.attachingMapScope || request.current) return;
      if (clarificationReply) {
        const {parentTaskId}=clarificationReply;
        const parent=s.messages.find(m=>m.id===parentTaskId);
        const alreadySent=s.messages.some(m=>m.role==="user" && m.id!==s.unansweredQuestionId &&
          m.clarificationReply?.parentTaskId===parentTaskId);
        if (!canReplyToDiscoveryClarification(parent) || alreadySent) return;
        const attempt:DiscoveryAttempt={query:q,userMessageId:randomId(),workspaceKey:requestWorkspaceKey(s),
          view:s.view,context:scopedQuestionContext([],null),clarificationReply};
        add("user",q,{id:attempt.userMessageId,clarificationReply});
        patch({clarificationReply:null,unansweredQuestionId:null});
        await executeDiscovery(attempt,false);
        return;
      }
      // Explicit workspace commands remain local after attachments are removed.
      // Ordinary science questions do not acquire an area or year just by browsing.
      const useComposerScope=!isWorkspaceCommand(q) && (s.draftScope!==null || (!s.caseId && !s.citation &&
        !!(s.selection || s.filters.period || s.filters.utcWindow) && !s.mapResult && s.view==="earth" && !s.fieldLayer && s.filters.source!=="constellation" &&
        !/当前(?:网格|选区|地图|范围|时段)|所选(?:网格|范围)|这个网格|此格|这格/.test(q)));
      if(useComposerScope){
        const items=s.draftScope || [];
        const citation=s.citation ? (({excerpt,...ref})=>ref)(s.citation):null;
        const context=scopedQuestionContext(items,citation);
        const attempt:DiscoveryAttempt={query:q,userMessageId:randomId(),workspaceKey:requestWorkspaceKey(s),view:s.view,context};
        add("user",q,{id:attempt.userMessageId,attachedScope:items,...(s.citation?{citation:s.citation}:{})});
        patch({draftScope:null});
        await executeDiscovery(attempt,false);return;
      }
      const lastBatch=s.messages.slice().reverse().find(m=>m.role==="assistant" && m.candidates)?.candidates;
      const contextAssetId=s.inspector && "assetId" in s.inspector ? s.inspector.assetId : lastBatch?.ids.length===1?lastBatch.ids[0]:undefined;
      const contextDataset=contextAssetId && assetById.get(contextAssetId)?.datasetId;
      const layerId=(Object.keys(globeCases) as RegionalId[]).find(id=>q.includes(datasetLayers[id]) || q.includes(globeCases[id].title) ||
        ({rain:/全球.*(?:陆地)?降水|GPM.?IMERG|IMERG.*降水|NOAA.?CPC|CPC.*降水/i,rivers:/巴西.*河|GloFAS/i,lightning:/美国.*(?:地闪|闪电)|NLDN/i,forest:/大兴安岭|森林.*嵌入|1846764/i,c40:/C40|landuse|城市.*嵌入|1846639/i})[id]?.test(q)) || (/这份|这个数据|该数据/.test(q) && contextDataset ? regionalForDataset(contextDataset) : undefined);
      if(layerId && isWorkspaceCommand(q) && /打开|切换|展示|显示|可视化|在球上看/.test(q) && !/能否|哪些|是否|有没有/.test(q)){
        add("user",q);openVisualization(layerId);
        add("assistant","已在数据地球打开「"+globeCases[layerId].title+"」。",{candidates:{
          caseId:null,ids:[datasetLayers[layerId]],title:globeCases[layerId].dataset,originKind:"chat",layer:"all",filters:emptyFilters(),selection:null,
          gridSystem:s.gridSystem,camera:{center:globeCases[layerId].center,zoom:globeCases[layerId].zoom,reason:globeCases[layerId].title}}});return;
      }
      const sourceBatch = s.view === "discover" ? s.search.result : s.view === "earth" ? s.mapResult : null;
      const activeObservations = (s.view === "discover" ? initialAccessSection(s.search)==="timely" :
        s.view === "earth" && s.filters.source === "constellation") || sourceBatch?.filters.source === "constellation";
      const frozenObservations = activeObservations && sourceBatch?.filters.source === "constellation" ? sourceBatch : null;
      let batch: CandidateSet | null = null;
      if (s.view === "discover") {
        batch = catalogBatch(
          s.search,
          s.search.pageIds||catalogResults(s.search, s.saved).map((a) => a.id),
          s.camera,
          s.gridSystem,
        );
      } else if (s.caseId || s.mapResult || s.selection || s.filters.period) {
        const scope = {
          title: caseById(s.caseId)?.title || s.mapResult?.title || "当前选区",
          caseId: s.caseId || s.mapResult?.caseId || null,
          filters: s.filters,
          selection: s.selection,
          layer: s.layer,
          camera: s.camera,
          gridSystem: s.gridSystem,
        };
        batch = s.mapResult
          ? makeMappedCandidates(s.mapResult, scope)
          : makeCandidates(scope);
        const last = s.search.result;
        const sameScope =
          last &&
          last.caseId === scope.caseId &&
          last.layer === scope.layer &&
          last.selection?.id === scope.selection?.id &&
          last.selection?.grid.key === scope.selection?.grid.key &&
          JSON.stringify(last.filters) === JSON.stringify(scope.filters);
        if (!s.mapResult && sameScope) {
          const referenced = last!;
          const available = new Set(
            batch.ids.map((id) =>
              assetById.has(id) ? assetIdentity(assetById.get(id)!) : undefined,
            ),
          );
          batch.ids = referenced.ids.filter((id) =>
            available.has(
              assetById.has(id) ? assetIdentity(assetById.get(id)!) : undefined,
            ),
          );
        }
      }
      if(s.fieldLayer && s.view==="earth" && !layerId){
        const id=s.fieldLayer.id;
        batch={title:globeCases[id].dataset,caseId:null,ids:[datasetLayers[id]],filters:s.filters,selection:s.selection,layer:s.layer,camera:s.camera,gridSystem:s.gridSystem};
      }
      const visibleBatch = batch;
      if (s.inspector && /这批|清单|当前选中|能否合用|联合使用判断/.test(q)) {
        if ("batch" in s.inspector) batch = s.inspector.batch;
        else if ("comparedBatch" in s.inspector && s.inspector.comparedBatch && !/整批|这批|全部|本轮/.test(q))
          batch = s.inspector.comparedBatch;
        else if ("parent" in s.inspector && s.inspector.parent)
          batch = s.inspector.parent;
      }
      async function sendDiscovery(batch: CandidateSet | null, observationQuery = false, observationParent?: CandidateSet | null) {
        const citation = s.citation ? (({ excerpt, ...reference }) => reference)(s.citation) : null;
        const filters = s.view==="discover" && batch ? {...s.filters,source:batch.filters.source,type:batch.filters.type} : s.filters;
        const attempt: DiscoveryAttempt = {
          query: q, userMessageId: randomId(), workspaceKey: requestWorkspaceKey(s), view: s.view,
          context: {
            caseId: s.caseId, filters, gridSystem: s.gridSystem, layer: s.layer,
            selection: s.selection, camera: s.camera, citation, dataView: s.dataView,
            visualization: s.visualization,
            ...(observationQuery && activeObservations ? {observationSource: true} : {}),
            ...(observationParent ? {observationBatch: {
              catalogConditions: observationParent.catalogConditions, selection: observationParent.selection,
              period: observationParent.filters.period, utcWindow: observationParent.filters.utcWindow,
            }} : {}),
            candidateIds: batch?.ids || [], inCandidateScope:!!batch,
            candidateVersions: Object.fromEntries((batch?.ids || []).flatMap(id => {
              const version = assetById.get(id)?.version;
              return version ? [[id, version]] : [];
            })),
          },
        };
        add("user", q, {
          id: attempt.userMessageId,
          context: [caseById(s.caseId)?.title, s.filters.place, s.selection?.grid.label].filter(Boolean).join(" · ") || "全球视图",
          ...(s.citation ? { citation: s.citation } : {}),
        });
        await executeDiscovery(attempt, false);
      }
      if(!isWorkspaceCommand(q)){
        const intent=!s.citation && observationIntent(q,activeObservations);
        const parent=intent==="refine"?frozenObservations:null;
        await sendDiscovery(parent || batch,!!intent,parent);
        return;
      }
      if (asksForPapers(q) && !s.selection && !s.filters.period && !s.filters.utcWindow && !s.filters.place && !s.filters.depth && !/^(?:请)?(?:在球上|在地图上|标出|高亮|显示|只看|切换|放大|缩小)/.test(q)) {
        await sendDiscovery(batch);
        return;
      }
      const clusterRequest = /局地聚集|数据聚集|数据集中在哪|哪些(?:地方|地区|区域).{0,18}(?:多种|多份|多类).{0,12}(?:实测|观测|数据)|(?:实测|观测|数据).{0,8}(?:聚集|集中分布)/.test(q);
      if (clusterRequest && !s.citation) {
        const topic = identifyCase(q) || (/冰川/.test(q) ? "glacier" : null);
        const parent = !topic || topic === batch?.caseId ? batch : null;
        const filters = {...(parent?.filters || (topic ? emptyFilters() : s.filters))};
        if (/论文|文献/.test(q)) filters.source = "paper";
        const caseId = topic || parent?.caseId || null;
        const selection = parent?.selection || null;
        const camera = !selection && caseId ? fitCamera(caseId, filters, "all") || s.camera : s.camera;
        const scope = { caseId, filters, camera, selection, gridSystem:s.gridSystem, layer:parent?.layer || "all" as const,
          title:(caseById(caseId)?.title || "当前资料") + " · 局地聚集" };
        const result = parent ? makeMappedCandidates(parent,scope) : makeCandidates(scope);
        result.clusterOverlay = true;
        result.originKind = "chat";
        result.metric = "products";
        add("user",q);
        patch({view:"earth",caseId:null,overview:"catalog",mapResult:result,filters,camera,selection,layer:scope.layer,
          visualization:null,dataView:null,inspector:null,evidence:null,origin:remember(s)});
        add("assistant","已按本轮资料的局地空间依据查找聚集。棕色轮廓旁标出格内产品数，可点选查看贡献产品。",{candidates:result});
        return;
      }
      if (!s.citation && /论文|文献/.test(q) && /线索|研究区|采样区|球上|地图|用过.{0,6}数据|涉及.{0,6}数据/.test(q)) {
        const topic = identifyCase(q);
        const inherit = !topic || topic === (s.caseId || batch?.caseId);
        const parent = inherit ? batch : null;
        const filters = {...(parent?.filters || emptyFilters()), source:"paper"};
        const caseId = topic || parent?.caseId || null;
        const selection = parent?.selection || null;
        const layer = parent?.layer || "all";
        const camera = selection ? s.camera : (caseId && fitCamera(caseId,filters,layer)) || s.camera;
        const scope = {caseId,filters,selection,layer,camera,gridSystem:s.gridSystem,
          title: (caseById(caseId)?.title || "当前目录") + " · 论文数据线索"};
        const result = parent ? makeMappedCandidates(parent,scope) : makeCandidates(scope);
        result.originKind = "chat";
        delete result.clusterOverlay;
        add("user",q);
        patch({view:"earth", caseId:null, overview:"catalog", mapResult:result, filters, layer, camera,
          selection, visualization:null, dataView:null, inspector:null, evidence:null, origin:remember(s)});
        add("assistant",result.ids.length
          ? `找到 ${result.ids.length} 条论文关联资料。球上用紫色虚线标出有空间依据的研究区或采样格。点选后可查看格内资料与出处，其余资料保留在本轮列表。`
          : "当前条件下没有找到论文关联资料。", {candidates:result});
        return;
      }
      const asksForMaterial=/^(?:请)?(?:这份|这批|这些|当前|这里|所选|哪些|有|查看|核对).{0,24}(?:可核对的内容|已核记录|已核实的记录|查到具体记录|可预览的材料|有原始记录|有原表|已核到的观测|查到具体观测)[？?。！!]*$/.test(q);
      if (!s.citation && asksForMaterial){
        const scope=batch||makeCandidates({title:"当前资料",caseId:s.caseId,filters:s.filters,selection:s.selection,layer:s.layer,camera:s.camera,gridSystem:s.gridSystem});
        const focus=focusedMaterial(s,scope);
        const chosen=focus.asset && /这份|当前资料|当前数据/.test(q)?{...scope,ids:[focus.asset.id]}:scope;
        add("user",q);
        add("assistant",materialAnswer(chosen),{candidates:chosen});
        return;
      }
      if(!s.citation && s.view==="earth" && !s.visualization && !s.dataView && !s.caseId && !activeObservations){
        const match=q.match(/^(?:只看|限定|切换到|时间轴(?:切换到)?)\s*(\d{4})年(?:(\d{1,2})月)?[。？！?]?$/);
        if(match && (!match[2] || (+match[2]>=1 && +match[2]<=12))){
          const y=+match[1],m=Number(match[2])||1;
          const f=match[2]?windowFilters([Date.UTC(y,m-1,1),Date.UTC(y,m,1)]):{period:[y,y] as [number,number],utcWindow:null};
          setFilters(f);add("user",q);add("assistant","已将数据地球的时间轴限定到"+(f.utcWindow?windowLabel(f.utcWindow):y+" 年")+"。");return;
        }
      }
      if(!s.citation && s.view==="earth" && !s.caseId && !s.visualization && !s.dataView && s.overview==="catalog"){
        if(/(?:哪些|列出|查看|有多少).{0,8}全球(?:连续)?覆盖|全球(?:连续)?覆盖.{0,8}(?:哪些|有多少)/.test(q)){
          const pool=s.mapResult?s.mapResult.ids.flatMap(id=>assetById.get(id)||[]):assets;
          const world=pool.filter(a=>globalProduct(a,s.filters));
          const group:CandidateSet={title:"当前条件下全球覆盖的产品",ids:world.map(a=>a.id),caseId:null,filters:s.filters,selection:null,layer:"all",camera:s.camera,gridSystem:s.gridSystem,originKind:"chat"};
          add("user",q);add("assistant","当前条件下有 "+products(world).size+" 种全球连续覆盖产品。"+world.map(a=>a.title).join("、")+"。具体地点的有效值仍需核对。",{candidates:group});return;
        }
        const frequency=/频次|观测频率|最频繁|最密集|拍得最多|观测.{0,3}最多/.test(q);
        const verified=/哪些.*(?:查到|核实|核到|确有).*景|已(?:经)?查到.*几景/.test(q);
        const pick=/^(?:请)?(?:看|打开|查看)/.test(q) && /那景|这景|号的?影像|日的?影像|LT0|LE0|LC0/.test(q);
        const goBack=/(?:回到|返回).*(?:分布|刚才的球)/.test(q);
        const saveScene=/(?:存|保存|加入|加到).*清单|把这景存下来/.test(q)&&!!s.mapResult?.sceneKey;
        if(frequency || verified || pick || goBack || saveScene){
          const current=batch || makeCandidates({title:"当前数据分布",caseId:null,filters:s.filters,selection:s.selection,layer:s.layer,camera:s.camera,gridSystem:s.gridSystem});
          const records=checkedScenes(current);
          add("user",q);
          if(saveScene||goBack){
            let saved="";
            if(saveScene){
              if(!records.length){add("assistant","当前选期中没有可保存的这景记录。");return;}
              try{persistResearchList(createResearchList(current),localStorage);window.dispatchEvent(new Event("oneearth-list-changed"));saved="已保存 "+records[0].id+" 及其采集时刻和来源。";}
              catch(e){add("assistant",e instanceof Error?e.message:"保存失败。");return;}
            }
            if(goBack){
              if(s.origin) {patch({...s.origin,evidence:null});saved+="已恢复上一幅分布及其时段与范围。";}
              else {patch({mapResult:s.mapResult?{...s.mapResult,metric:"products"}:null,evidence:null,inspector:null});saved+="当前按产品数显示。";}
            }
            add("assistant",saved);return;
          }
          if(frequency && !/拍|影像|卫星|逐景/.test(q) && current.ids.some(id=>!records.some(r=>r.asset.id===id))){
            add("assistant",materialAnswer(current)+"\n要比较频次，请指定同一种记录，例如同一变量的站点读数或同一类采样事件。",{candidates:current});return;
          }
          if(!records.length){add("assistant",materialAnswer(current),{candidates:current});return;}
          if(pick){
            const day=q.match(/(\d{1,2})\s*[日号]/),month=q.match(/(\d{1,2})\s*月/),year=q.match(/(\d{4})\s*年/);
            const hits=records.filter(r=>q.includes(r.id)||!!day && +r.date.slice(8,10)===+day[1] && (!month||+r.date.slice(5,7)===+month[1]) && (!year||+r.date.slice(0,4)===+year[1]));
            if(hits.length!==1){add("assistant",hits.length?"该日期有多景，请用影像编号选择："+hits.slice(0,8).map(r=>r.id).join("、"):"当前结果中没有匹配的影像，请指定日期或影像编号。");return;}
            const r=hits[0],t=Date.parse(r.date);
            const focused:CandidateSet={...current,title:r.id,sceneKey:r.id,ids:[r.asset.id],filters:{...current.filters,...windowFilters([t,t+1])},
              camera:{center:geoCentroid(r.geometry),zoom:Math.min(80,Math.max(12,current.camera.zoom)),reason:r.id},catalogConditions:[...(current.catalogConditions||[]),"逐景编号 "+r.id]};
            patch({origin:remember(s),mapResult:focused,camera:focused.camera,filters:focused.filters,inspector:{assetId:r.asset.id,parent:focused,filters:focused.filters,selection:focused.selection},evidence:null});
            add("assistant",r.id+" · "+r.date+"。已定位并打开这景的资料。",{candidates:focused});return;
          }
          const sceneBatch:CandidateSet={...current,ids:[...new Set(records.map(r=>r.asset.id))],metric:frequency?"scenes":current.metric||"products"};
          if(frequency)patch({mapResult:sceneBatch,origin:remember(s),evidence:null,inspector:null});
          add("assistant","当前时空范围已核 "+records.length+" "+observationUnit(records)+"，来自 "+products(records.map(r=>r.asset)).size+" 种产品。"+
            (frequency?(current.selection?"已按所选网格统计。":frequencySummary(records,gridSpec(current.gridSystem,resolution(s.camera.zoom))))+"球面按当前网格层级显示已核记录数。":"采集记录："+records.slice(0,6).map(r=>r.date.slice(0,10)+" · "+r.id).join("、")),{candidates:sceneBatch});return;
        }
        if(s.selection && /(?:这里|这个格|此格|这个网格).*(?:哪些|有什么|有多少).*(?:产品|数据|资料)/.test(q) && batch){
          const {total,globals}=selectedDistribution(batch);
          add("user",q);add("assistant","这个网格关联 "+total+" 种产品，其中 "+products(globals).size+" 种具有全球覆盖。\n"+materialAnswer(batch),{candidates:batch});return;
        }
      }
      const intent = !s.citation && observationIntent(q, activeObservations);
      if (intent) {
        let parent: CandidateSet | null = null;
        if (intent === "refine" && s.view === "discover" && visibleBatch) {
          const checked = /勾选|已选资料/.test(q) ||
            (s.search.compare.length > 0 && !/这批|整批|全部|当前结果/.test(q));
          const filtered = !!s.search.result || !!s.search.type || !!searchConditions(s.search).length;
          if (checked) parent = {...visibleBatch, ids:visibleBatch.ids.filter(id => s.search.compare.includes(id)),
            catalogConditions:[...(visibleBatch.catalogConditions || []), "目录勾选的资料"]};
          else if (filtered) parent = visibleBatch;
        } else if (intent === "refine") parent = frozenObservations;
        await sendDiscovery(parent || visibleBatch, true, parent);
        return;
      }

      if (
        !s.caseId &&
        s.view === "earth" &&
        s.overview === "simulation" &&
        /(?:打开|查看|比较|对比).*第|这里有.*(?:数据|依据)/.test(q)
      ) {
        add("user", q);
        add(
          "assistant",
          "当前图层展示模拟记录的来源计数。切换到「数据目录分布」即可点选网格并打开真实候选。",
        );
        return;
      }
      const recordAction = (message: string, action: string, details: string) =>
        add("assistant", message, {
          activity: {
            id: "action-" + randomId(),
            title: "工作区操作记录",
            scope: q,
            source: "OneEarth 当前工作区",
            tabs: [
              {
                kind: "trace",
                label: "执行记录",
                steps: [
                  { title: "读取请求", detail: q },
                  { title: action, detail: details },
                ],
              },
            ],
          },
        });
      const material = focusedMaterial(s, batch);
      const currentMaterialQuestion = /这(?:一)?份|该份|这个数据|当前(?:数据|表格|证据|引文|引用|资料)|这(?:段|条)引用/.test(q) ||
        /^(?:怎么获取|如何下载|从哪里下载|预览(?:PDF|表格|摘录)|打开原表)[？?。]?$/i.test(q);
      const asksSource = /来源|下载|获取/.test(q);
      const asksPreview = /预览|查看|打开|看一下/.test(q);
      if (currentMaterialQuestion && (asksSource || asksPreview) && !/保存|研究清单/.test(q)) {
        const {asset, doc, parent, filters, selection, missingScope} = material;
        add("user", q);
        if (!asset) {
          add("assistant", "当前资料及版次未能在目录中核对，请从原批次打开对应资料。");
          return;
        }
        if (asksSource) {
          const url = doc?.url || asset.url;
          recordAction(asset.title + " 的来源为 " + (doc?.source || asset.source) + "。" +
            (asset.profile?.access || "") + (url ? " 原始来源 " + url : ""),
            "读取获取条件", asset.id + " · " + (url || asset.source));
          return;
        }
        const kind = /pdf/i.test(q) ? "pdf" : /表格|原表|原网格/.test(q) ? "table" :
          /代码/.test(q) ? "code" : /摘录|片段/.test(q) ? "text" : null;
        const currentTab = doc?.tabs.find(t => t.kind !== "web" && (!kind || t.kind === kind));
        if (doc && currentTab) {
          if (s.evidence !== doc) patch({evidence:doc, previewKind:currentTab.kind});
          else if (kind && s.evidence.tabs[s.readerPosition?.tab ?? 0]?.kind !== kind)
            patch({readerPosition:{tab:doc.tabs.indexOf(currentTab), page:0}});
          recordAction("正在预览 " + doc.title + "。", "读取当前材料", asset.id + " · " + currentTab.label);
        } else if (missingScope) {
          add("assistant", "这条历史引用缺少原批次的范围记录。请从原批次重新打开资料后预览其他材料。");
        } else if (asset.caseId === "wind" && kind === "table") {
          const opened = await preview("wind", 0, "table");
          if (!opened || latest.current.sessionId !== s.sessionId) return;
          recordAction("查看当前数据材料 · " + asset.title, "读取已接入材料", asset.id + " · table");
        } else {
          const original = assetMaterials(asset, filters, selection, s.view === "earth" && s.caseId === asset.caseId ? s.dataView : null);
          const tabs = original.tabs.filter(t => t.kind !== "web" && (!kind || t.kind === kind) && (t.kind !== "table" || !!t.rows?.length));
          if (!tabs.length) add("assistant", asset.title + " 在当前范围没有这种可预览材料。");
          else {
            patch({evidence:{...original, sourceBatch:parent || undefined, tabs}, previewKind:tabs[0].kind});
            recordAction("查看当前数据材料 · " + asset.title, "读取已接入材料", asset.id + " · " + tabs[0].kind);
          }
        }
        return;
      }
      if (
        !s.citation &&
        /^(?:打开|查看)(?:我的|已保存的)?研究清单[。？！?]?$/.test(q)
      ) {
        add("user", q);
        patch({
          view: "discover",
          listLibraryOpen: true,
          evidence: null,
          inspector: null,
          origin: s.view === "earth" ? remember(s) : s.origin,
        });
        add("assistant", "已打开本浏览器保存的研究清单。");
        return;
      }
      if (
        /(?:保存|生成|存入|加入|添加到).*(?:清单)|(?:保存|存下)(?:当前)?(?:这份|这批|勾选的)(?:资料|数据)?[。？！?]?$/.test(q)
      ) {
        const single = /这(?:一)?份|该份|当前(?:这份|资料|数据集|这项)|这(?:一)?项/.test(q);
        const explicitChecked = !single && /勾选|已选|选中的/.test(q);
        const whole = /这批|整批|全部|本轮|当前结果/.test(q);
        const {id: focus, doc, asset, parent, filters, selection, missingScope} = material;
        const checked = explicitChecked || (!single && !whole && !focus && s.view === "discover" && s.search.compare.length > 0);
        const object = single || (!checked && !whole && focus) ? "当前资料" : checked ? "勾选资料" : "当前批次";
        let reference: SavedEvidence | undefined;
        if (object === "当前资料" && focus) {
          if (!asset) {
            add("user", q);
            add("assistant", "当前证据的资料或原版次无法在目录中核对，未保存研究清单。");
            return;
          }
          if (missingScope) {
            add("user", q);
            add("assistant", "这条历史引用缺少原批次的范围记录。请在原批次重新打开该资料后保存。");
            return;
          }
          batch = {...parent, title:parent?.title || asset.title, ids:[focus],
            caseId:parent ? parent.caseId : caseById(asset.caseId)?.id || null, filters, selection,
            layer:parent?.layer || s.layer, camera:parent?.camera || s.camera,
            gridSystem:selection?.grid.system || parent?.gridSystem || s.gridSystem};
          if (doc?.locator) reference = {assetId:focus, title:doc.title, locator:doc.locator, url:doc.url};
        }
        const chosen = object === "当前资料" ? (focus ? [focus] : []) :
          checked ? s.search.compare.filter(id => batch?.ids.includes(id)) : batch?.ids || [];
        add("user", q);
        if (!batch || !chosen?.length) {
          add("assistant", object + "为 0 项，未保存研究清单。" +
            (object === "当前资料" ? "请先打开要保存的资料。" : checked ? "请先在目录中勾选资料。" : ""));

          return;
        }
        try {
          persistResearchList(
            createResearchList({ ...batch, ids: chosen }, reference),
            localStorage,
          );
          window.dispatchEvent(new Event("oneearth-list-changed"));
          recordAction(
            "已保存 " + chosen.length + " 项资料（" + object + "）：" +
              chosen.map(id => assetById.get(id)!.title).join("、") +
              "。可在数据触达的「研究清单」中导出或恢复。",
            "保存研究清单",
            batch.title,
          );
        } catch (e) {
          add("assistant", e instanceof Error ? e.message : "保存失败。");
        }
        return;
      }
      if (
        batch &&
        !s.citation &&
        /(?:能否|能不能|是否可以|可否).*(?:合用|联用|一起用|共同使用)|查看联合使用判断/.test(
          q,
        )
      ) {
        add("user", q);
        const assessment = evaluateBatch(batch);
        inspectCandidates(batch);
        recordAction(
          assessment.status + "。" + assessment.summary,
          "查看联合使用判断",
          batch.title,
        );
        return;
      }
      if (
        !s.citation &&
        /^(?:打开|查看|显示|浏览)?(?:我的)?收藏(?:的资料|列表|夹)?[。？?]?$/.test(
          q,
        )
      ) {
        add("user", q);
        const search = { ...emptySearch, savedOnly: true };
        patch({ view: "discover", search, inspector: null, evidence: null });
        recordAction(
          "已打开收藏，当前有 " +
            catalogResults(search, s.saved).length +
            " 份资料。",
          "筛选收藏",
          "数据触达 · 仅收藏",
        );
        return;
      }
      if (
        batch &&
        !s.citation &&
        /(?:这批|这些|这次推荐|当前候选|这组|推荐结果)/.test(q)
      ) {
        if (/地球|球上|地图/.test(q)) {
          add("user", q);
          patch({
            view: "earth",
            caseId: null,
            filters: batch.filters,
            layer: batch.layer,
            camera: batch.camera,
            gridSystem: batch.gridSystem,
            selection: batch.selection,
            overview: "catalog",
            mapResult: batch,
            origin: remember(s),
            evidence: null,
          });
          recordAction(
            "已在地球上显示这批候选的空间依据。未定位资料仍保留在候选清单。",
            "应用候选范围",
            batch.title + " · " + batch.ids.length + " 份",
          );
          return;
        }
        if (/列表|目录|推荐结果|查看这次推荐/.test(q)) {
          add("user", q);
          showCandidates(batch);
          recordAction(
            "已打开这批推荐的完整目录。",
            "打开候选列表",
            batch.title + " · " + batch.ids.length + " 份",
          );
          return;
        }
      }
      if (
        s.origin &&
        /^(?:返回|回到)(?:进入前的结果|上一步|上一页|候选列表|之前的结果)[。？?]?$/.test(
          q,
        )
      ) {
        add("user", q);
        leaveDetail();
        recordAction(
          "已返回进入前的视图并恢复原筛选。",
          "恢复工作区",
          s.origin.view,
        );
        return;
      }
      if (
        batch?.caseId === "Q08" &&
        /对照|对齐|比较|时间序列|同期/.test(q) &&
        /海冰|PDO|两个序列|这两条|9月|九月/i.test(q) &&
        !s.citation
      ) {
        add("user", q);
        const period = batch.filters.period;
        const years = september.filter(([date]) => {
          const year = Number(String(date).slice(0, 4));
          return !period || (year >= period[0] && year <= period[1]);
        });
        if (
          !years.length ||
          !batch.ids.includes("Q08-0") ||
          !batch.ids.includes("Q08-1")
        ) {
          recordAction(
            !years.length
              ? "当前年份没有已读的 9 月配对值。本地两表共同覆盖 1979–2025 年，可调整年份或前往原表核对。"
              : "当前批次未同时包含海冰范围与 PDO 指数。请恢复这两项需求后再作同期对照。",
            "核对两表与时段",
            batch.title,
          );
          return;
        }
        inspectCandidates(batch);
        recordAction(
          "已打开 9 月海冰范围与 PDO 指数的逐年对照，可核对同年取值和来源。",
          "按年份对齐两条序列",
          "Q08-0 · Q08-1",
        );
        return;
      }
      if (
        batch &&
        /比较|对比|查看|打开|预览|获取|下载/.test(q) &&
        !s.citation
      ) {
        const numbers = Array.from(
          q.matchAll(/第\s*([一二三四五六七八九十]|\d+)/g),
          (match) =>
            Number(match[1]) || "一二三四五六七八九十".indexOf(match[1]) + 1,
        );
        if (
          !numbers.length &&
          /(?:比较|对比)(?:一下)?(?:前|这)?(?:两|二|2)(?:份|项|个)/.test(q)
        )
          numbers.push(1, 2);
        if (
          !numbers.length &&
          /^(?:比较|对比)(?:一下|这些|候选|资料|已选|当前|数据|。|？)*$/.test(q)
        ) {
          if (s.view === "discover" && s.search.compare.length > 1)
            numbers.push(
              ...s.search.compare.map((id) => batch.ids.indexOf(id) + 1),
            );
          else if (batch.ids.length === 2) numbers.push(1, 2);
          else {
            add("user", q);
            recordAction(
              "当前有 " +
                batch.ids.length +
                " 份候选，可按序号选择，例如“比较第一份和第二份”。",
              "读取候选列表",
              batch.title,
            );
            return;
          }
        }
        if (!numbers.length) {
          const target = q
            .toLowerCase()
            .replace(/^(?:打开|查看|预览|比较|对比)\s*/, "")
            .trim();
          if (target.length >= 3 && target !== q.toLowerCase()) {
            const named = batch.ids.filter((id) =>
              assetById.get(id)?.title.toLowerCase().includes(target),
            );
            if (named.length === 1)
              numbers.push(batch.ids.indexOf(named[0]) + 1);
          }
        }
        if (numbers.length) {
          add("user", q);
          const refs = numbers.map((n) => assetById.get(batch.ids[n - 1]));
          if (refs.some((a) => !a)) {
            add(
              "assistant",
              "这批候选共有 " + batch.ids.length + " 项，请按列表序号选择。",
            );
            return;
          }
          const chosen = [...new Set(refs.filter((a) => !!a))];
          if (/比较|对比/.test(q)) {
            if (chosen.length < 2) {
              add(
                "assistant",
                "请给出两个候选序号，例如“比较第一份和第二份”。",
              );
              return;
            }
            patch({
              inspector: {
                comparison: comparison(chosen, batch.filters, batch.selection),
                comparedBatch: { ...batch, ids: chosen.map((a) => a.id) },
              },
              evidence: null,
            });
            recordAction(
              "已打开对照 · " + chosen.map((a) => a.title).join("、"),
              "生成候选对照表",
              chosen.map((a) => a.id).join("、"),
            );
            return;
          }
          const a = chosen[0];
          inspectAsset(a.id, batch.filters, batch.selection, batch);
          if (/预览/.test(q)) {
            const doc = assetMaterials(a, batch.filters, batch.selection, null);
            const kind = /PDF/i.test(q)
              ? "pdf"
              : /表格/.test(q)
                ? "table"
                : undefined;
            const tab = doc.tabs.find(
              (t) =>
                t.kind !== "web" &&
                (t.kind !== "table" || !!t.rows?.length) &&
                (!kind || t.kind === kind),
            );
            if (tab) {
              patch({
                evidence: { ...doc, tabs: [tab] },
                previewKind: tab.kind,
              });
              recordAction(
                "已打开“" + tab.label + "”。",
                "打开材料",
                a.id + " · " + tab.kind,
              );
            } else
              recordAction(
                "当前候选没有这种本地预览材料。已打开速览，可核对来源入口。",
                "核对可用材料",
                a.id,
              );
          } else {
            recordAction(
              /获取|下载/.test(q)
                ? a.profile?.access ||
                    "可在速览的“材料与获取”核对已接入的内容及发布方入口。"
                : "已打开 " + a.title,
              "打开数据速览",
              a.id + " · " + a.source,
            );
          }
          return;
        }
      }
      if (!s.citation && s.mapResult && s.selection && /这里|此格|选中/.test(q)) {
        const batch = makeMappedCandidates(s.mapResult, {
          ...s.mapResult,
          filters: s.filters,
          selection: s.selection,
          camera: s.camera,
          gridSystem: s.gridSystem,
        });
        add("user", q);
        add(
          "assistant",
          batch.ids.length
            ? batch.ids.map((id) => assetById.get(id)!.title).join("\n")
            : "所选网格内没有这批候选的已核依据。",
          { candidates: batch },
        );
        return;
      }
      await sendDiscovery(batch);
    },
    [add, patch, preview, inspectCandidates, showCandidates, leaveDetail, executeDiscovery, openVisualization],
  );
  const toggleSaved = useCallback(
    (id: string) => {
      const saved = latest.current.saved;
      const selected = !saved.includes(id);
      recordWrite(writeFavorite(id, selected).then(() => failedFavorites.current.delete(id)),
        () => failedFavorites.current.set(id, selected));
      patch({
        saved: saved.includes(id)
          ? saved.filter((x) => x !== id)
          : [...saved, id],
      });
    },
    [patch],
  );
  const resultLink = useResultLink(state, patch);
  return {
    state,
    historyIds,
    switchSession,
    retrySessionSave,
    sessionSummaries,
    resultLink,
    patch,
    add,
    send,
    attachScope,confirmQuestion,
    retry: (attempt: DiscoveryAttempt) => executeDiscovery(attempt, true),
    openCase,
    inspectAsset,
    openData,
    openVisualization,
    mapCandidates,
    activateAnswer,flyToGrid,flyToEvidence,focusAnswerEvidence,flyToResearchRegion,
    showCandidates,
    inspectCandidates,
    openCatalog,
    openMappedCatalog,
    openEarth,
    leaveDetail,
    setFilters,
    preview,
    toggleSaved,
  };
}
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState<State | null>(null);
  useEffect(() => {
    let active = true;
    void loadInitialSession().then(state => { if (active) setReady(state); });
    return () => { active = false; };
  }, []);
  return ready ? <ReadyWorkspace initialState={ready}>{children}</ReadyWorkspace> : <div className="loading-surface">正在恢复工作区…</div>;
}
function ReadyWorkspace({ children, initialState }: { children: ReactNode; initialState: State }) {
  const value = useWorkspaceValue(initialState);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useWorkspace() {
  const value = useContext(Context);
  if (!value) throw Error("WorkspaceProvider missing");
  return value;
}
