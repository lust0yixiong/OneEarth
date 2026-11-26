import {resolvePublishedFieldLayer,type PublishedFieldCatalogues} from "../components/published-field-layer";
import {publishedWorkspaceLayerRecipes,validWorkspacePublishedLayerAction,workspaceObservationTarget} from "./workspace-published-layer";
import {boundResultBatch, browserPanelKey, browserTurnFrame, browserTurnRelations, previousChatAnswer, readBrowserBatch, resultBatchCandidates} from "./browser-turn-frame";
import { datasetLayerFromView, decodeGlobeLayers, encodeGlobeLayers, focusedDatasetLayer, globeDatasetLayer, setDatasetLayer, type FieldLayerSelection, type GlobeDatasetLayer } from "./globe-dataset-layers";
import {submitsWorkspaceFields, workspaceEffectActivity, workspaceEffectFor, workspaceReceiptDetail} from "./workspace-effect";
import type {BrowserWorkspaceReceipt,WorkspaceReceipt,WorkspaceRejectionReason} from "./turn-context";
import {samePublishedRaster,type PublishedRasterPresentation,type PublishedRasterTarget} from "./published-raster-observation";
import {availableChatOperations, chatCandidateBatch, chatCandidateItems, chatCandidateKey, saveChatResearchList} from "./chat-workspace-operations";
import {validWorkspaceOperationKind, workspaceCandidateOperationAllowed} from "./workspace-operations";
import {projectWorkspaceView, workspaceActionState, type WorkspaceSurfaceReading, type WorkspacePanelReading} from "./workspace-view-projection";
import {authorizesWorkspaceViewAction, workspaceViewActionAllowed, type WorkspaceViewPublication} from "./workspace-view-context";
import { answeredClarificationIds, messageClarificationPrompt, discoveryClarificationResult, loadResearchRecord, openTaskEvents, chatMessagesPath, researchRecordId, cancelChatRequest, readWorkspaceReceipt, reportWorkspaceReceipt, requestWorkspaceRecovery, isClarificationAttempt } from "./runtime-client";
import {clarificationAnswerText,validClarificationPrompt,type ClarificationAnswer} from "./clarification";
import {datasetScope,mergeScope,scopedQuestionContext,scopeDetail,scopeLabel,type ScopeItem} from "./question-scope";
import {previewableTab} from "./web-preview";
import {rememberReadEvidence} from "./read-evidence";
import {conversationReferenceMemory,modelHistoryMessages} from "./reference-memory";
import {researchRegionCamera,validResearchRegion,sameResearchRegion,type ResearchRegion,type ResearchRegionLayer} from "./research-region";
import {answerMapBatch,answerFilters,initialAnswerCamera,gridCamera,evidenceCamera,evidenceSelection} from "./answer-map";
import { globeCases,layerFrameCount,datasetLayers,isForestDate,type RegionalId } from "./regional-cases";
import {validHainaMonth} from "./haina-published-raster";
import {isPublicLayerId,validPublicViewId,type PublicLayerId,type PublicLayerSelection} from "./haina-public-layer";
import {isRainYear} from "./rain-catalog";
import { paperId } from "./paper-record";
import { readPaperCatalogStatus, type PaperCatalogStatus } from "./paper-catalog-client";
import { randomId } from "./id";
import { ChatResponseError, readChatResponse, type ChatPhase } from "./chat-response";
import {mergeTaskLifecycle,readCancelledTaskLifecycle,type TaskLifecycle} from "./task-lifecycle-client";
import {readDeepSeekTools,loadDeepSeekTools} from "./deepseek-tools";
import { readChatModel } from "./chat-model";
import {geoBounds,geoCentroid} from "d3-geo";
import {checkedScenes} from "./product-distribution";
import {validWindow,windowFilters} from "./time-window";
import { observationBatchCamera, observationById, pushId, type PushFeed } from "./push-observations";
import {makeQuestionDecision} from "./question-confirmation";
import type {ClarificationReply, QuestionDecision} from "./types";
import {validAccessSection,initialAccessSection} from "./data-access";
import { registerHaina, registerObservations, registerPapers, loadRemoteAssetIds } from "./datasets";
import {loadHainaCatalog,type HainaCatalogStatus} from "./haina-catalog-client";
import { type ChatDelivery, claimWorkspaceEffect, saveChatDelivery, unfinishedChatDeliveries, removeChatDelivery, legacySession, mergeMessages, readFavorites, readSession, readSessionMessage, sessionMessages, sessionSummaries, writeFavorite, writeSession } from "./session-storage";
import { sampleCamera } from "./earth-search";
import { catalogResults, type SearchState } from "./results";
import { catalogBatch } from "./batch-context";
import { assetById, assetIdentity, assets } from "./datasets";
import { saveReaderCheckpoint, restoreReaderCheckpoint } from "./reader-checkpoint";
import { useResultLink } from "./use-result-link";
import type { SavedEvidence } from "./research-list";
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
import { caseById, sourceLabels } from "./catalog";
import { emptyFilters, fitCamera, gridSpec, cellAt } from "./spatial";
import { assetMaterials, evidenceFor } from "./evidence";
import { resolution } from "../data/evidence/globe-navigation.mjs";
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
  flight?: {id:string;camera:Camera;kind?:"research-region"|"place"|"grid"|"layer-control";label?:string}|null;
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
  publicLayer: PublicLayerSelection | null;
  fieldLayer: FieldLayerSelection | null;
  globeLayers: GlobeDatasetLayer[];
  globeLayerFocus: string | null;
  globeLayerFit: string | null;
  publishedFieldCatalogues?: PublishedFieldCatalogues;
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
  activeChats: ActiveChat[];
  webMode?: "auto" | "on" | "off";
  error: string | null;
  chatOpen: boolean;
  saved: string[];
  previewKind: string | null;
  dataView: DataView | null;
}
type ActiveChat = {
  id:string;
  userMessageId:string;
  scope:Pick<DiscoveryAttempt["context"],"filters"|"selection">;
  stage:string;
  phase:ChatPhase;
  taskLifecycle?:TaskLifecycle;
  accepted?:boolean;
  cancelling?:boolean;
  cancelError?:string;
  trace:import("./types").RunTrace;
  searches:import("./types").SearchRun[];
};
const workspaceFields = [
  "view", "caseId", "filters", "camera", "gridSystem", "layer", "selection", "mesh", "source",
  "inspector", "mapResult", "search", "overview", "origin", "visualization", "fieldLayer", "publicLayer", "dataView",
  "comparisonYear", "listLibraryOpen", "citation", "evidence", "previewKind", "readerPosition",
  "chatOpen", "saved", "clarificationReply",
  "researchRegion", "globeLayers", "globeLayerFocus",
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
  | "publicLayer"
  | "globeLayerFocus"
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
    visualization,fieldLayer,publicLayer,globeLayerFocus,
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
    visualization,fieldLayer,publicLayer,globeLayerFocus,
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
function requestWorkspaceKey(s: State) {
  // A city selection may still be flying when the question is sent. Keep its target stable on settle.
  const camera = s.flight?.kind === "layer-control" ? [s.flight.id, s.flight.camera] : s.camera;
  return JSON.stringify([s.view, s.caseId, s.filters, s.gridSystem, s.layer, s.selection, camera,
    s.dataView, s.visualization, s.fieldLayer, s.publicLayer, s.overview, s.mapResult, s.search, s.inspector,
    s.mapFocus, s.evidence?.id, s.previewKind, s.readerPosition]);
}
function frozenWorkspaceKey(s:State,reading:WorkspaceSurfaceReading|undefined) {
  return JSON.stringify([requestWorkspaceKey(s),browserPanelKey(reading),s.globeLayers,s.globeLayerFocus,s.mesh,s.listLibraryOpen]);
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
  if(fieldLayer?.id==="forest"){
    const date=url.searchParams.get("forestDate") || (restore ? saved.fieldLayer?.date : undefined);
    if(isForestDate(date)) Object.assign(fieldLayer,{date});
  }
  if(fieldLayer?.id==="c40"){
    const city=url.searchParams.get("city") ?? (restore ? saved.fieldLayer?.city : undefined);
    if(typeof city==="string" && /^[a-z0-9][a-z0-9-]{0,79}$/.test(city))Object.assign(fieldLayer,{city});
  }
  if(fieldLayer?.id==="rain"){
    const requested=Number(url.searchParams.get("rainYear"));
    const savedYear=restore?saved.fieldLayer?.year:undefined;
    const year=isRainYear(requested)?requested:isRainYear(savedYear)?savedYear:undefined;
    if(year!==undefined)Object.assign(fieldLayer,{year});
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
  const publicId=Number(url.searchParams.get("hainaLayer"));
  const publicView=url.searchParams.get("hainaView");
  const publicMonth=url.searchParams.get("hainaMonth");
  const publicLayer=view==="earth"&&!caseId&&!fieldLayer&&!visualization&&!dataView&&!openPushGlobe&&isPublicLayerId(publicId)
    ? {id:publicId,...(validPublicViewId(publicView)?{view:publicView}:{}),
      ...(publicId===1846104&&validHainaMonth(publicMonth)?{month:publicMonth}:{})} : null;
  if (dataView) {
    filters.need = dataView.kind === "ctd" ? 4 : 1;
    filters.type = "";
    filters.source = "";
  }
  const linkedLayers=decodeGlobeLayers(url.searchParams.get("globeLayers"));
  const legacyLayer=datasetLayerFromView({publicLayer,fieldLayer,visualization,dataView,caseId,filters,selection:null});
  const focused=linkedLayers?.focus ?? (linkedLayers ? null : legacyLayer);
  const state:State = {
    sessionId,
    globeLayers:linkedLayers?.layers ?? (legacyLayer ? [legacyLayer] : []),
    globeLayerFocus:focused?.id ?? null,
    globeLayerFit:linkedLayers ? null : legacyLayer?.id ?? null,
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
    fieldLayer,visualization,publicLayer,
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
    mesh: visualization || fieldLayer || publicLayer ? false : saved.mesh !== false,
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
    activeChats: [],
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
  if(linkedLayers){
    Object.assign(state,focusProjection(focused));
    if(linkedLayers.camera)state.camera=linkedLayers.camera;
    state.mesh=false;
  }
  return state;
}
function focusProjection(layer:GlobeDatasetLayer|null) {
  return {
    ...focusedDatasetLayer(layer),
    caseId:layer?.kind==="data" ? layer.caseId : layer?.kind==="wind" ? "wind" : null,
    filters:layer?.kind==="data" ? layer.filters : emptyFilters(),
    selection:layer?.kind==="data" ? layer.gridSelection : null,
  };
}
function restoreGlobeState(state:State, workspace:Partial<WorkspaceSnapshot>) {
  if(workspace.globeLayers && Object.hasOwn(workspace,"globeLayerFocus")){
    state.globeLayerFit=null;
    return;
  }
  const layer=datasetLayerFromView(state);
  if(layer){
    state.globeLayers=[layer];
    state.globeLayerFocus=layer.id;
    state.globeLayerFit=null;
  }
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
        restoreGlobeState(state,workspace);
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
    const cachedReceipt=cachedResearch?.workspaceReceipt;
    const needsReceipt=!!cachedResearch?.workspaceEffect && (!cachedReceipt || cachedReceipt.observation?.state==="loading" ||
      cachedReceipt.reason==="publication-unverified" && (!("recovery" in cachedReceipt) || cachedReceipt.recovery?.state==="running"));
    if(researchId&&(!cachedResearch||needsArchivedCatalogue||needsReceipt)){
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
          const clarificationPrompt=validClarificationPrompt(reply.clarificationPrompt) ? reply.clarificationPrompt : undefined;
          const effect=workspaceEffectFor(reply,saved.id);
          const receipt=effect && readWorkspaceReceipt(saved.workspaceReceipt,saved.id,saved.conversationId,saved.turnId);
          const proposed=reply.workspaceLayerOpen ?? reply.workspaceAction ?? reply.workspaceOperation ?? effect;
          const batch=boundResultBatch(reply.resultBatch,saved.id,saved.turnId,saved.conversationId);
          const messages:Message[]=[
            {id:saved.turnId,role:"user",text:saved.question,time:saved.created},
            {id:saved.id,role:"assistant",text:reply.message,time:saved.updated,replyTo:saved.turnId,
              chatMessage:true,...(proposed ? {historicalReply:true,
                activity:workspaceEffectActivity(saved.id,proposed,receipt?.state ?? "proposed",reply.message,workspaceReceiptDetail(receipt?.state),receipt)} : {}),
              workspaceEffect:effect,workspaceReceipt:receipt,taskLifecycle:saved.taskLifecycle,
              ...(batch ? {candidates:{
                resultBatch:batch,answerId:saved.id,title:batch.query,ids:resultBatchCandidates(batch,reply.modelIds??reply.catalogMatch?.ids),
                caseId:reply.caseId ?? null,filters:answerFilters(emptyFilters(),reply.filters),
                selection:reply.catalogMatch?.selection ?? null,layer:reply.layer ?? "all",
                camera:reply.camera ?? defaultCamera,gridSystem:reply.gridSystem ?? "h3",
                originKind:"chat",catalogConditions:batch.conditions,
                researchRecord:{sessionId:saved.conversationId,messageId:saved.id,question:saved.question,
                  intent:reply.researchIntent,notes:reply.answerNotes?.researchNotes ?? []},
              },historicalReply:true} : {}),
              workspacePending:reply.workspacePending,researchIntent:reply.researchIntent,conversationContext:reply.conversationContext,
              conversationEvidence:reply.conversationEvidence,conversationAssertionEvidence:reply.conversationAssertionEvidence,
              answerNotes:reply.answerNotes,runTrace:reply.runTrace,researchRegion:reply.researchRegion,
              gridCoverage:reply.gridCoverage,
              ...(reply.clarification || clarificationPrompt ? {clarification:true} : {}),
              clarificationPrompt,
              ...(discoveryClarificationResult(reply)?{discoveryClarification:true}:{})},
          ];
          state.sessionId=saved.conversationId;
          state.messages=mergeMessages(stored?.messages||[],messages);
          await writeSession(state.sessionId,saved.question,captureWorkspace(state),state.messages);
        }else if(needsReceipt && saved.conversationId===state.sessionId && saved.turnId===cachedResearch.replyTo){
          const receipt=readWorkspaceReceipt(saved.workspaceReceipt,saved.id,saved.conversationId,saved.turnId);
          if(receipt && receipt.effectId===cachedResearch.workspaceEffect?.effectId){
            const updated={...cachedResearch,workspaceReceipt:receipt};
            state.messages=mergeMessages(state.messages,[updated]);
            await writeSession(state.sessionId,saved.question,undefined,[updated]);
          }
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
  if (a.type === "patch") {
    const next={...s,...a.value};
    const explicit=Object.hasOwn(a.value,"globeLayers")||Object.hasOwn(a.value,"globeLayerFocus");
    const selectionChanged=(["publicLayer","fieldLayer","visualization","dataView"] as const).some(key=>next[key]!==s[key]);
    const scoped=next.dataView && (next.filters!==s.filters || next.selection!==s.selection);
    if(!explicit && (selectionChanged || scoped)){
      const layer=datasetLayerFromView(next);
      if(layer && next.view==="earth"){
        const old=s.globeLayers.find(item=>item.id===layer.id);
        next.globeLayers=setDatasetLayer(s.globeLayers,old?.visible===false ? {...layer,visible:false} : layer);
        next.globeLayerFocus=old?.visible===false ? null : layer.id;
        if(s.globeLayerFocus!==layer.id && !Object.hasOwn(a.value,"globeLayerFit"))
          next.globeLayerFit=old?.visible===false ? null : layer.id;
      }else{
        next.globeLayerFocus=null;
        next.globeLayerFit=null;
      }
    }
    return normalizeInspector(next);
  }
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
  const surfaceReading = useRef<(() => WorkspaceSurfaceReading) | null>(null);
  const registerWorkspaceSurface = useCallback((read: () => WorkspaceSurfaceReading) => {
    surfaceReading.current = read;
    return () => { if (surfaceReading.current === read) surfaceReading.current = null; };
  }, []);
  const panelReading = useRef(new Map<keyof WorkspacePanelReading, WorkspacePanelReading>());
  const registerWorkspacePanel = useCallback((key:keyof WorkspacePanelReading,reading:WorkspacePanelReading) => {
    panelReading.current.set(key,reading);
    return () => { if(panelReading.current.get(key)===reading)panelReading.current.delete(key); };
  },[]);
  const readWorkspaceSurface = useCallback(():WorkspaceSurfaceReading|undefined=>{
    const reading=surfaceReading.current?.();
    const panels:WorkspacePanelReading=Object.assign({},reading?.panels,...panelReading.current.values());
    return {...reading,surface:reading?.surface??latest.current.view,panels};
  },[]);
  const workspaceViewAt = useCallback((s:State,batch:CandidateSet|null,operations:ReturnType<typeof availableChatOperations>,reading:WorkspaceSurfaceReading|undefined)=>{
    const items=chatCandidateItems(s,batch,reading?.surface===s.view ? reading.candidateItems : undefined);
    return {...projectWorkspaceView(s,reading),operations:[...operations.keys()],
      ...(items.length ? {candidateItems:items} : {})};
  },[]);
  const requests = useRef(new Map<string,{controller:AbortController;progress:ActiveChat;finishCancellation:()=>Promise<void>}>());
  const localBatchIds=useRef(new Map<string,string>());
  const chatRequestSnapshot=useCallback((s:State,batch:CandidateSet|null,parentId?:string)=>{
    const reading=readWorkspaceSurface();
    const operations=availableChatOperations(s,batch);
    const workspaceView=workspaceViewAt(s,batch,operations,reading);
    const {batch:presented,expanded}=readBrowserBatch(s,reading);
    let localBatchId:string|undefined;
    if(presented && !presented.resultBatch){
      const key=JSON.stringify([s.sessionId,presented.answerId,presented.title,presented.originKind,
        presented.caseId,presented.filters,presented.selection,presented.catalogConditions,presented.ids]);
      const cache=localBatchIds.current;
      localBatchId=cache.get(key);
      if(!localBatchId){
        localBatchId=randomId();
        if(cache.size>=128)cache.delete(cache.keys().next().value!);
        cache.set(key,localBatchId);
      }
    }
    const browserFrame=browserTurnFrame(s,reading,presented,expanded,localBatchId);
    const related=browserTurnRelations(s,presented,parentId,[...requests.current.values()].map(({progress})=>progress));
    const browserTurn={...browserFrame,...(related.length ? {related} : {})};
    return {workspaceView:{...workspaceView,publishedLayerActions:true as const},browserTurnFrame:browserTurn,workspaceKey:frozenWorkspaceKey(s,reading),
      workspaceCandidateKey:workspaceView.candidateItems?.length ? chatCandidateKey(batch) : undefined,
      workspaceOperationKeys:Object.fromEntries([...operations].map(([kind,target])=>[kind,target.key]))};
  },[readWorkspaceSurface,workspaceViewAt]);
  const serial = useRef(0);
  const patch = useCallback((value: Partial<State>) => {
    const scopeChange=["caseId","view","mapResult","filters","selection","gridSystem"].some(key=>Object.hasOwn(value,key));
    if(scopeChange && !Object.hasOwn(value,"flight"))value={...value,flight:null};
    if(["caseId","mapResult","filters"].some(key=>Object.hasOwn(value,key)) && !Object.hasOwn(value,"mapFocus"))value={...value,mapFocus:null};
    const controlChange = (["fieldLayer", "visualization", "dataView", "globeLayers", "globeLayerFocus", "inspector", "evidence", "readerPosition", "mapFocus"] as const)
      .some(key => Object.hasOwn(value, key) && value[key] !== latest.current[key]);
    if (scopeChange || controlChange) serial.current++;
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
    if(!Object.hasOwn(value,"publicLayer") && (Object.hasOwn(value,"caseId") || Object.hasOwn(value,"fieldLayer") || value.dataView || value.visualization))
      value={...value,publicLayer:null};
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
  const selectGlobeLayer = useCallback((layer:GlobeDatasetLayer|null, globeLayers:GlobeDatasetLayer[]) => {
    const current=latest.current;
    const focus=layer?.id ?? null;
    if(focus===current.globeLayerFocus){
      patch({globeLayers});
      return;
    }
    patch({...focusProjection(layer),globeLayers,globeLayerFocus:focus,globeLayerFit:null,
      origin:current.origin, overview:"catalog",mesh:false,flight:null,mapResult:null,inspector:null,evidence:null});
  },[patch]);
  const focusGlobeLayer = useCallback((id:string) => {
    const current=latest.current;
    const layer=current.globeLayers.find(item=>item.id===id&&item.visible);
    if(layer&&current.globeLayerFocus!==id)selectGlobeLayer(layer,current.globeLayers);
  },[selectGlobeLayer]);
  const setGlobeLayerVisible = useCallback((id:string,visible:boolean) => {
    const current=latest.current;
    const old=current.globeLayers.find(item=>item.id===id);
    if(!old||old.visible===visible)return;
    const layers=setDatasetLayer(current.globeLayers,{...old,visible});
    const focus=layers.find(item=>item.visible&&item.id===current.globeLayerFocus)
      ?? (visible ? layers.find(item=>item.id===id) : layers.find(item=>item.visible));
    selectGlobeLayer(focus??null,layers);
  },[selectGlobeLayer]);
  const noteManualNavigation = useCallback(() => {
    serial.current++;
    const current=latest.current;
    if(current.flight?.kind==="layer-control" || current.globeLayerFit)
      patch({globeLayerFit:null,...(current.flight?.kind==="layer-control" ? {flight:null} : {})});
  }, [patch]);
  useEffect(()=>{
    const controller=new AbortController();
    let checking=false;
    async function check(){
      if(checking || document.visibilityState==="hidden")return;
      checking=true;
      try{
        const status=await readPaperCatalogStatus(AbortSignal.any([controller.signal,AbortSignal.timeout(15_000)]));
        if(!controller.signal.aborted && JSON.stringify(status)!==JSON.stringify(latest.current.paperFeed))
          patch({paperFeed:status});
      }catch(error){
        if(!controller.signal.aborted){
          const last=latest.current.paperFeed;
          const message=error instanceof Error?error.message:"未能读取文献资料目录状态。";
          if(last?.error!==message)patch({paperFeed:{...(last??{loaded:0,total:0,loading:false,complete:false,
            sourceTotal:null,filteredOut:0,updatedAt:null}),error:message}});
        }
      }finally{checking=false;}
    }
    void check();
    const timer=setInterval(check,60_000);
    document.addEventListener("visibilitychange",check);
    return ()=>{controller.abort();clearInterval(timer);document.removeEventListener("visibilitychange",check);};
  },[patch]);
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
  const recentSubmission=useRef<{session:string;message:Message}|null>(null);
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
    if(role==="user")recentSubmission.current={session:s.sessionId,message};
    if(role==="assistant" && message.candidates)automaticAnswerIds.current.add(message.id);
    dispatch({ type: "messages", sessionId: s.sessionId, messages: [message] });
    return recordWrite(writeSession(s.sessionId, sessionTitle(s), undefined, [message]).then(() => {
      failedMessages.current.delete(message.id);
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
        restoreGlobeState(next,workspace);
      }
      next.chatOpen = true;
      next.pushFeed = latest.current.pushFeed;
      next.paperFeed = latest.current.paperFeed;
      next.hainaFeed = latest.current.hainaFeed;
      next.saved = await readFavorites();
      if (!id) await writeSession(next.sessionId, sessionTitle(next), { ...captureWorkspace(next), resultId: null });
      if (switchVersion.current !== switchId || s.sessionId !== latest.current.sessionId) return false;
      for (const entry of requests.current.values()) entry.controller.abort();
      requests.current.clear();
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
    // The linked snapshot determines the view. Keep incoming overrides through loading and retries.
    if (state.linkStatus) return;
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
    if(state.view==="earth" && state.fieldLayer?.id==="c40" && state.fieldLayer.city)
      url.searchParams.set("city",state.fieldLayer.city);
    else url.searchParams.delete("city");
    if(state.view==="earth" && state.fieldLayer?.id==="forest" && state.fieldLayer.date)
      url.searchParams.set("forestDate",state.fieldLayer.date);
    else url.searchParams.delete("forestDate");
    if(state.fieldLayer?.id==="rain"){
      if(state.fieldLayer.year!==undefined)url.searchParams.set("rainYear",String(state.fieldLayer.year));
      else url.searchParams.delete("rainYear");
      url.searchParams.set("rainMonth",String(state.fieldLayer.frame+1));
    }else{url.searchParams.delete("rainYear");url.searchParams.delete("rainMonth");}
    if(state.view==="earth" && state.publicLayer){
      url.searchParams.set("hainaLayer",String(state.publicLayer.id));
      if(state.publicLayer.view)url.searchParams.set("hainaView",state.publicLayer.view);
      else url.searchParams.delete("hainaView");
      if(state.publicLayer.month)url.searchParams.set("hainaMonth",state.publicLayer.month);
      else url.searchParams.delete("hainaMonth");
    }else{
      url.searchParams.delete("hainaLayer");
      url.searchParams.delete("hainaView");
      url.searchParams.delete("hainaMonth");
    }
    if(state.globeLayers.length>1 || state.globeLayers.some(item=>!item.visible) || (state.globeLayers.length && !state.globeLayerFocus))
      url.searchParams.set("globeLayers",encodeGlobeLayers(state.globeLayers,state.globeLayerFocus,state.camera));
    else url.searchParams.delete("globeLayers");
    history.replaceState({ ...history.state, oneearthSession: state.sessionId, oneearthPath: url.pathname + url.search }, "", url);
  }, [state.globeLayers,state.globeLayerFocus,state.globeLayers.length>1 ? state.camera : null,state.linkStatus, state.sessionId, state.caseId, state.view, state.search.source,state.search.section,state.search.page,state.search.query,state.search.type,state.search.capability,state.search.savedOnly, state.filters.source, state.mapResult, state.dataView, state.visualization,state.fieldLayer?.id,state.fieldLayer?.year,state.fieldLayer?.frame,state.fieldLayer?.city,state.fieldLayer?.date,state.publicLayer?.id,state.publicLayer?.view,state.publicLayer?.month]);
  useEffect(() => () => {
    for (const entry of requests.current.values()) entry.controller.abort();
    requests.current.clear();
  }, []);
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
    const s=latest.current,origin=s.origin;
    if(!origin){
      patch({...focusedDatasetLayer(null),globeLayerFocus:null,globeLayerFit:null,selection:null});
      return;
    }
    const oldFocus=origin.globeLayerFocus ?? datasetLayerFromView(origin)?.id;
    const focused=s.globeLayers.find(item=>item.visible&&item.id===oldFocus);
    patch({...origin,...(oldFocus ? focusProjection(focused??null) : {}),
      globeLayerFocus:focused?.id??null,globeLayerFit:null,evidence:null,error:null});

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
    if(state.view!=="earth" || state.visualization || state.fieldLayer || state.publicLayer || state.dataView || state.evidence)return;
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
  const inspectAsset = useCallback((
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
  },[patch]);
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
      const existing=s.globeLayers.find(layer=>layer.kind==="data"&&layer.caseId===caseId&&layer.needIndex===index);
      const dataView = scopedDataView(caseId,index,filters,selected,existing?.kind==="data" ? existing.selection : s.dataView);
      if (!dataView) {
        patch({ error: "当前条件下尚无可视化的数据内容，可先查看已核材料。" });
        return;
      }
      const layer=globeDatasetLayer({kind:"data",selection:dataView,caseId,needIndex:index,filters,gridSelection:selected});
      patch({...focusProjection(layer),view:"earth",globeLayers:setDatasetLayer(s.globeLayers,layer),
        globeLayerFocus:layer.id,globeLayerFit:null,origin:s.inspector ? remember(s) : s.origin || remember(s),
        mesh:false,inspector:null,evidence:null,layer:"all",camera:dataCamera(dataView),
      });
    },
    [patch],
  );
  const openFieldLayer=useCallback((field:FieldLayerSelection,verified?:{
    catalogues:PublishedFieldCatalogues;flight?:NonNullable<State["flight"]>
  })=>{
    const current=latest.current,info=globeCases[field.id];
    const layer=globeDatasetLayer({kind:"field",selection:field});
    const alreadyFocused=current.view==="earth" && current.globeLayerFocus===layer.id;
    const asset=assetById.get(layer.id);
    patch({...focusProjection(layer),view:"earth",globeLayers:setDatasetLayer(current.globeLayers,layer),
      globeLayerFocus:layer.id,globeLayerFit:verified?null:layer.id,overview:"catalog",layer:"all",mesh:false,
      origin:current.inspector ? remember(current) : current.origin || remember(current),
      ...(verified?.flight ? {flight:verified.flight}
        : !verified || !alreadyFocused ? {camera:{center:info.center,zoom:info.zoom,reason:info.title}} : {}),
      inspector:null,evidence:null,error:null,
      ...(verified ? {publishedFieldCatalogues:{...current.publishedFieldCatalogues,...verified.catalogues}}
        : (field.id==="forest"||field.id==="c40") && asset
          ? {draftScope:mergeScope(current.draftScope || [],[datasetScope(asset)])} : {}),
    });
  },[patch]);
  const publishChatProgress = useCallback(()=>{
    patch({activeChats:[...requests.current.values()].map(entry=>entry.progress)});
  },[patch]);
  const cancelChat = useCallback(async (id:string)=>{
    const entry=requests.current.get(id);
    if (!entry?.progress.accepted || entry.progress.cancelling) return;
    const update = (change:Partial<ActiveChat>)=>{
      if (requests.current.get(id)!==entry) return;
      entry.progress={...entry.progress,...change};
      publishChatProgress();
    };
    update({cancelling:true,cancelError:undefined});
    try {
      const cancelled=await cancelChatRequest(id,AbortSignal.any([entry.controller.signal,AbortSignal.timeout(8000)]));
      if (cancelled) await entry.finishCancellation();
      else update({stage:"正在核对本轮终态"});
    } catch (error) {
      update({cancelling:false,cancelError:error instanceof Error ? error.message : "暂时无法取消本轮。"});
    }
  },[publishChatProgress]);
  const stopWatchIds=state.chatOpen ? state.messages.filter(message=>{
    const lifecycle=message.taskLifecycle;
    return message.role==="assistant" && lifecycle?.runtimePhase?.phase==="cancelled"
      && (lifecycle.remoteStops?.some(stop=>stop.state!=="confirmed")
        || !lifecycle.remoteStops?.length && Date.now()-message.time<60_000);
  }).map(message=>message.id).join(",") : "";
  useEffect(()=>{
    if(!stopWatchIds)return;
    const session=state.sessionId,controller=new AbortController();
    const timers=new Map<string,ReturnType<typeof setTimeout>>();
    async function check(id:string,attempt=0){
      let shouldCheckAgain=attempt<2;
      try{
        const facts=await readCancelledTaskLifecycle(id,AbortSignal.any([controller.signal,AbortSignal.timeout(5_000)]));
        if(controller.signal.aborted || latest.current.sessionId!==session)return;
        const message=latest.current.messages.find(item=>item.id===id);
        if(!message || message.taskLifecycle?.runtimePhase?.phase!=="cancelled")return;
        const merged=facts ? mergeTaskLifecycle(message.taskLifecycle,facts) : message.taskLifecycle;
        if(merged!==message.taskLifecycle){
          const updated={...message,taskLifecycle:merged};
          dispatch({type:"messages",sessionId:session,messages:[updated]});
          await recordWrite(writeSession(session,"",undefined,[updated]).then(()=>{
            channel.current?.postMessage({sessionId:session,id});
          }),()=>{if(latest.current.sessionId===session)failedMessages.current.set(id,updated);});
        }
        if(merged.remoteStops?.length)shouldCheckAgain=merged.remoteStops.some(stop=>stop.state==="pending");
      }catch{
        // A failed read cannot establish that the remote work stopped.
        shouldCheckAgain=true;
      }
      if(!controller.signal.aborted && shouldCheckAgain && attempt<11){
        timers.set(id,setTimeout(()=>void check(id,attempt+1),attempt<2?1_000:5_000));
      }
    }
    for(const id of stopWatchIds.split(","))void check(id);
    return ()=>{
      controller.abort();
      for(const timer of timers.values())clearTimeout(timer);
    };
  },[state.sessionId,stopWatchIds,recordWrite]);
  const persistReceiptUpdate=useCallback(async(id:string,receipt:BrowserWorkspaceReceipt|WorkspaceReceipt)=>{
    const session=receipt.conversationId;
    const message=await readSessionMessage(session,id).catch(()=>null)
      ?? (latest.current.sessionId===session ? latest.current.messages.find(m=>m.id===id) : undefined);
    if(!message?.workspaceEffect || message.workspaceEffect.effectId!==receipt.effectId || message.replyTo!==receipt.turnId)return;
    const updated={...message,workspaceReceipt:receipt};
    dispatch({type:"messages",sessionId:session,messages:[updated]});
    await recordWrite(writeSession(session,"",undefined,[updated]).then(()=>{
      channel.current?.postMessage({sessionId:session,id});
    }),()=>{
      if(latest.current.sessionId===session)failedMessages.current.set(id,updated);
    });
  },[recordWrite]);
  const receiptUploads=useRef(new Map<string,{key:string;done:Promise<WorkspaceReceipt|undefined>}>());
  const uploadReceipt=useCallback((id:string,receipt:BrowserWorkspaceReceipt)=>{
    const key=JSON.stringify(receipt),prior=receiptUploads.current.get(id);
    if(prior?.key===key)return prior.done;
    const done=Promise.resolve(prior?.done).then(()=>reportWorkspaceReceipt(id,receipt))
      .catch(()=>undefined).then(async response=>{
        if(!response?.settled && receiptUploads.current.get(id)?.key===key)receiptUploads.current.delete(id);
        if(response?.receipt)await persistReceiptUpdate(id,response.receipt);
        return response?.receipt;
      });
    receiptUploads.current.set(id,{key,done});
    return done;
  },[persistReceiptUpdate]);
  const watchingRasters=useRef(new Map<string,{receipt:BrowserWorkspaceReceipt;version:number;ready:Promise<void>}>());
  const observePublishedRasters=useCallback((presentations:PublishedRasterPresentation[])=>{
    for(const [id,watch] of watchingRasters.current){
      const start=watch.receipt.observation!;
      const now=latest.current;
      const superseded=now.sessionId!==watch.receipt.conversationId || serial.current!==watch.version || now.view!=="earth";
      const observation=presentations.find(item=>samePublishedRaster(item,start));
      const state=superseded ? "superseded" : observation?.state;
      if(!state || state==="loading" || state==="rendered" && observation!.observedAt<start.observedAt)continue;
      watchingRasters.current.delete(id);
      const observedAt=state==="superseded" ? Date.now() : observation!.observedAt;
      const receipt:BrowserWorkspaceReceipt={...watch.receipt,observation:{...start,state,observedAt}};
      void watch.ready.then(async()=>{
        void uploadReceipt(id,watch.receipt);
        await persistReceiptUpdate(id,receipt);
        await uploadReceipt(id,receipt);
      }).catch(()=>{});
    }
  },[persistReceiptUpdate,uploadReceipt]);
  useEffect(()=>{ observePublishedRasters([]); },[state.view,state.sessionId,observePublishedRasters]);
  useEffect(()=>{
    const session=state.sessionId;
    const resend=()=>{
      void sessionMessages(session).then(messages=>{
        for(const m of messages){
          const receipt=m.workspaceReceipt;
          if(receipt && !("taskId" in receipt))uploadReceipt(m.id,receipt);
        }
      }).catch(()=>{});
    };
    resend();
    window.addEventListener("online",resend);
    return ()=>window.removeEventListener("online",resend);
  },[state.sessionId,uploadReceipt]);
  const [recoverableClarifications,setRecoverableClarifications]=useState<ReadonlySet<string>>(()=>new Set());
  const clarificationDeliveries=useRef(new Map<string,ChatDelivery>());
  const rememberClarificationDelivery=useCallback((id:string,delivery?:ChatDelivery)=>{
    const map=clarificationDeliveries.current;
    if(delivery)map.set(id,delivery);
    else map.delete(id);
    setRecoverableClarifications(previous=>{
      if(previous.has(id)===!!delivery)return previous;
      const next=new Set(previous);
      if(delivery)next.add(id);
      else next.delete(id);
      return next;
    });
  },[]);
  const executeDiscovery = useCallback(
    async (attempt: DiscoveryAttempt, retrying: boolean, saved?: ChatDelivery, restoring=false) => {
      if ([...requests.current.values()].some(({progress})=>progress.userMessageId===attempt.userMessageId)) return;
      const q = attempt.query;
      const current = latest.current;
      const until = current.messages.findIndex(m => m.id === attempt.userMessageId);
      const preceding = until < 0 ? current.messages : current.messages.slice(0,until);
      const promptMessages=modelHistoryMessages(preceding);
      const assistantHistory=promptMessages.filter(m=>m.role==="assistant");
      let conversationEvidence:import("./types").ReadEvidence[]=[];
      for(const message of assistantHistory)
        conversationEvidence=message.conversationEvidence ?? rememberReadEvidence(conversationEvidence,message.answerNotes?.searches);
      const latestAssistant=assistantHistory.at(-1)?.id;
      const conversationAssertionEvidence=assistantHistory.filter(m=>m.conversationAssertionEvidence!==undefined).at(-1)?.conversationAssertionEvidence;
      const conversationReferences=conversationReferenceMemory(promptMessages);
      const previousTaskId=attempt.context.browserTurnFrame
        ? attempt.context.browserTurnFrame.related?.find(entry=>entry.relation==="reply")?.taskId
        : previousChatAnswer(preceding)?.id;
      const payload = {query:q, context:attempt.context, config:readChatModel(), deepseekTools:readDeepSeekTools(),
        conversationId:current.sessionId, turnId:attempt.userMessageId,
        previousTaskId:attempt.clarificationReply ? undefined : attempt.clarificationAnswer?.parentTaskId ?? previousTaskId,
        ...(attempt.clarificationAnswer?{clarificationAnswer:attempt.clarificationAnswer}:{}),
        ...(attempt.questionDecision?{questionDecision:attempt.questionDecision}:{}),
        ...(attempt.clarificationReply?{clarificationReply:attempt.clarificationReply}:{}),
        history:promptMessages.slice(-8).map(m=>{
          const notes=m.answerNotes;
          const text=notes?.references
            ? m.text.replace(/〔(\d+)〕/g,(marker,n)=>notes.references?.[Number(n)-1] ? marker+"（"+notes.references[Number(n)-1].title+"）" : marker)
            : [m.text,...(notes?.sources || []).map(source=>(assetById.get(source.id)?.title || source.id)+" "+source.reason),...(notes?.webSources || []).map(h=>h.title+" "+h.url),notes?.limitation,notes?.followUp].filter(Boolean).join("\n");
          const attached=m.attachedScope?.filter(i=>i.kind!=="observation").map(i=>scopeLabel(i)+"（"+scopeDetail(i)+"）").join("；");
          return {role:m.role,text:(attached?text.slice(0,950)+"\n当轮用户引用："+attached:text).slice(0,1600),
            ...(m.role==="assistant" && m.conversationContext!==undefined?{conversationContext:m.conversationContext}:{}),
            ...(m.role==="assistant" && m.researchIntent?{researchIntent:m.researchIntent}:{}),
            ...(m.id===latestAssistant && (conversationEvidence.length || m.conversationEvidence!==undefined)?{conversationEvidence}:{}),
            ...(m.id===latestAssistant && conversationAssertionEvidence!==undefined?{conversationAssertionEvidence}:{}),
            ...(m.id===latestAssistant && conversationReferences.length?{conversationReferences}:{}),
            ...(m.role==="assistant" ? {assetIds:[...new Set(notes?.sources.map(source=>source.id) || [])].slice(0,100)} : {})};
        })};
      const workspaceKey=(state:State)=>attempt.context.browserTurnFrame
        ? frozenWorkspaceKey(state,readWorkspaceSurface()) : requestWorkspaceKey(state);
      const detached = retrying && workspaceKey(current) !== attempt.workspaceKey;
      const s: State = {
        ...current, ...attempt.context, view: attempt.view ?? current.view,
        origin: detached ? null : current.origin,
        dataView: attempt.context.dataView ?? null, visualization: attempt.context.visualization ?? null,
      };
      const controller = new AbortController();
      const delivery: ChatDelivery = saved || {id: randomId(), attempt, body: JSON.stringify(payload), route:"chat"};
      const session = current.sessionId;
      const priorReasoning=saved && current.messages.find(message=>message.id===saved.id)?.runTrace?.providerReasoning;
      const retiredReasoning=new Set<string>(); // Preserve evictions on a stream reconnect for this task.
      const legacy = delivery.route !== "chat";
      const clarificationAttempt=isClarificationAttempt(attempt);
      const entry = {controller,finishCancellation,progress:{id:delivery.id,userMessageId:attempt.userMessageId,
        scope:{filters:attempt.context.filters,selection:attempt.context.selection},
        stage:saved ? "正在接回本轮回答" : "正在提交问题",phase:legacy ? "research" as const : "foreground" as const,
        trace:{started:Date.now(),stages:[],calls:[],...(priorReasoning?{providerReasoning:priorReasoning}:{})},
        searches:[]} as ActiveChat};
      requests.current.set(delivery.id,entry);
      const isCurrent = () => !controller.signal.aborted && latest.current.sessionId === session
        && requests.current.get(delivery.id) === entry;
      const updateProgress = (progress:Partial<ActiveChat>) => {
        entry.progress={...entry.progress,...progress};
        publishChatProgress();
      };
      const closeProgress = () => {
        if (!isCurrent()) return;
        requests.current.delete(delivery.id);
        publishChatProgress();
      };
      const complete = (message:string, extra:Partial<Message>) =>
        add("assistant",message,{taskLifecycle:entry.progress.taskLifecycle,...extra,chatMessage:!legacy});
      async function finishCancellation(trace?:Message["runTrace"]){
        if(!isCurrent())return;
        const taskLifecycle=mergeTaskLifecycle(entry.progress.taskLifecycle,{runtimePhase:{phase:"cancelled"}});
        const written=complete("本地任务已取消。",{id:delivery.id,replyTo:attempt.userMessageId,runTrace:trace??entry.progress.trace,taskLifecycle});
        closeProgress();
        controller.abort();
        await written;
        if(clarificationAttempt)rememberClarificationDelivery(delivery.id);
        if(!failedMessages.current.has(delivery.id))
          await removeChatDelivery(session,delivery.id).catch(()=>{
            if(latest.current.sessionId===session)patch({sessionError:sessionFailure});
          });
      }
      const latestQuestion = () => {
        const rendered=latest.current.messages.slice().reverse().find(message=>message.role==="user");
        const submitted=recentSubmission.current;
        return submitted?.session===session && submitted.message.time>(rendered?.time ?? -1) ? submitted.message : rendered;
      };
      const version = serial.current;
      let effect:ReturnType<typeof workspaceEffectFor>;
      let completedTrace:DiscoveryResponse["runTrace"];
      const effectReceipt=(state:BrowserWorkspaceReceipt["state"],reason?:WorkspaceRejectionReason,target?:PublishedRasterTarget):BrowserWorkspaceReceipt|undefined =>
        effect ? {effectId:effect.effectId,conversationId:session,turnId:attempt.userMessageId,state,
          ...(state==="stale" ? {reason:"workspace-changed" as const} : reason ? {reason} : {}),
          ...(state==="applied" && target ? {observation:{...target,state:"loading" as const,observedAt:Date.now()}} : {})} : undefined;
      const completeWorkspace=async (message:string,extra:Partial<Message>,receipt?:BrowserWorkspaceReceipt)=>{
        const ready=complete(message,{...extra,workspaceEffect:effect,workspaceReceipt:receipt});
        if(receipt?.observation?.state==="loading")
          watchingRasters.current.set(delivery.id,{receipt,version:serial.current,ready});
        await ready;
        if(receipt)void uploadReceipt(delivery.id,receipt);
      };
      let keepDelivery=false;
      let regionFlight:{id:string;camera:Camera;kind:"research-region"}|undefined;
      let regionReceived=false;
      // Only our own automatic camera move is exempt from the late-reply guard.
      // A drag/zoom/new flight or any scope edit still detaches this reply.
      const workspaceCurrent=()=>{
        const now=latest.current;
        const ownCamera=regionFlight && now.flight?.id===regionFlight.id &&
          (now.camera===current.camera || JSON.stringify(now.camera)===JSON.stringify(regionFlight.camera));
        const question = latestQuestion();
        return version===serial.current && (!question || question.id===attempt.userMessageId)
          && workspaceKey(ownCamera?{...now,camera:current.camera}:now)===attempt.workspaceKey;
      };
      const recoverUnverifiedPublication=async(receipt:BrowserWorkspaceReceipt|undefined)=>{
        if(receipt?.reason!=="publication-unverified")return;
        const saved=await uploadReceipt(delivery.id,receipt);
        if(saved?.state!=="failed" || saved.reason!=="publication-unverified" || saved.recovery ||
          latest.current.sessionId!==session || !workspaceCurrent())return;
        const now=latest.current;
        const {workspaceView,browserTurnFrame}=chatRequestSnapshot(now,chatCandidateBatch(now));
        if(browserTurnFrame.capturedAt===undefined)return;
        const result=await requestWorkspaceRecovery(delivery.id,{
          effectId:receipt.effectId,conversationId:session,turnId:attempt.userMessageId,workspaceView,
          browserTurnFrame:{...browserTurnFrame,capturedAt:browserTurnFrame.capturedAt},
        },AbortSignal.timeout(125000)).catch(()=>undefined);
        if(result?.recovery)await persistReceiptUpdate(delivery.id,result);
      };
      const receiveRegion=(region:ResearchRegion|null)=>{
        if(regionReceived || !isCurrent() || restoring)return;
        regionReceived=true;
        if(!workspaceCurrent())return;
        const now=latest.current,previous=now.researchRegion;
        const changed=!sameResearchRegion(previous?.region,region);
        const layer=region?{messageId:attempt.userMessageId,region,visible:changed?true:previous?.visible??true}:null;
        const target=region && changed && now.view==="earth" && !now.visualization && !now.fieldLayer && !now.publicLayer && !now.dataView && !now.evidence
          ? researchRegionCamera(region):null;
        if(target)regionFlight={id:randomId(),camera:target,kind:"research-region"};
        patch({researchRegion:layer,...(regionFlight?{flight:regionFlight}:{})});
      };
      const c = caseById(s.caseId);
      const context =
        [c?.title, s.filters.place, s.selection?.grid.label]
          .filter(Boolean)
          .join(" · ") || "全球视图";
      publishChatProgress();
      if (!saved) patch({error:null,chatOpen:true});
      let lifecycleSequence=0;
      try {
        if (!saved) {
          payload.deepseekTools = await loadDeepSeekTools(controller.signal);
          delivery.body = JSON.stringify(payload);
        }
        if (!saved) await saveChatDelivery(session, delivery).catch(() => patch({sessionError:sessionFailure}));
        const receive = async () => {
          const response = await openTaskEvents(delivery.id, delivery.body, controller.signal, legacy, ()=>{
            if (isCurrent()) updateProgress({accepted:true});
          });
          return readChatResponse(response, (stage, searches, trace, phase) => {
            if (isCurrent()) updateProgress({...(stage ? {stage} : phase==="research" ? {stage:"研究已进入队列"} : {}),
              ...(searches ? {searches} : {}),...(trace ? {trace} : {}),...(phase ? {phase} : {})});
          },receiveRegion,entry.progress.trace.providerReasoning,retiredReasoning,(facts,seq)=>{
            if(!isCurrent() || seq!==undefined && seq<=lifecycleSequence)return;
            if(seq!==undefined)lifecycleSequence=seq;
            const merged=mergeTaskLifecycle(entry.progress.taskLifecycle,facts);
            if(merged!==entry.progress.taskLifecycle)updateProgress({taskLifecycle:merged});
          });
        };
        let r: DiscoveryResponse;
        try { r = await receive(); }
        catch (error) {
          if (!isCurrent() || error instanceof ChatResponseError) throw error;
          updateProgress({stage:"正在重新连接本轮回答"});
          r = await receive();
        }
        if (!isCurrent()) return;
        if(entry.progress.taskLifecycle?.runtimePhase?.phase==="cancelled"){
          await finishCancellation(r.runTrace);
          return;
        }
        if(entry.progress.taskLifecycle)entry.progress.taskLifecycle=mergeTaskLifecycle(
          entry.progress.taskLifecycle,{runtimePhase:{phase:"complete"}});
        completedTrace=r.runTrace;
        const clarificationPrompt=validClarificationPrompt(r.clarificationPrompt) ? r.clarificationPrompt : undefined;
        if (r.questionCheck || clarificationPrompt || r.clarification) {
          if(r.researchRegion===null || validResearchRegion(r.researchRegion))receiveRegion(r.researchRegion);
          if (r.questionCheck) {
            await complete(r.message,{id:delivery.id,replyTo:attempt.userMessageId,runTrace:r.runTrace,
              questionCheck:{...r.questionCheck,attempt},researchRegion:r.researchRegion,researchIntent:r.researchIntent,
              conversationContext:r.conversationContext,conversationEvidence:r.conversationEvidence,conversationAssertionEvidence:r.conversationAssertionEvidence});
          } else {
            await complete(r.message,{id:delivery.id,replyTo:attempt.userMessageId,runTrace:r.runTrace,workspacePending:r.workspacePending,
              clarification:true,clarificationPrompt,...(clarificationPrompt && !workspaceCurrent() ? {historicalReply:true} : {}),...(discoveryClarificationResult(r)?{discoveryClarification:true}:{}),
              researchRegion:r.researchRegion,researchIntent:r.researchIntent,conversationContext:r.conversationContext,
              conversationEvidence:r.conversationEvidence,conversationAssertionEvidence:r.conversationAssertionEvidence});
          }
          return;
        }
        effect=workspaceEffectFor(r,delivery.id);
        const proposed=r.workspaceLayerOpen ?? r.workspaceAction ?? r.workspaceOperation ?? effect;
        if(proposed && restoring){
          const local=await readSessionMessage(session,delivery.id).catch(()=>null);
          if(local && !local.failed){
            if(local.workspaceReceipt && !("taskId" in local.workspaceReceipt))uploadReceipt(delivery.id,local.workspaceReceipt);
            return;
          }
          const archive=effect ? await loadResearchRecord(delivery.id).catch(()=>undefined) : undefined;
          if(!isCurrent())return;
          const receipt=readWorkspaceReceipt(archive?.workspaceReceipt,delivery.id,session,attempt.userMessageId);
          await complete(r.message,{id:delivery.id,replyTo:attempt.userMessageId,runTrace:r.runTrace,historicalReply:true,
            workspaceEffect:effect,workspaceReceipt:receipt,
            activity:workspaceEffectActivity(delivery.id,proposed,receipt?.state ?? "proposed",r.message,
              workspaceReceiptDetail(receipt?.state),receipt)});
          return;
        }
        if(effect){
          const claimed=await claimWorkspaceEffect(session,delivery.id).catch(()=>null);
          if(!isCurrent() || claimed===false)return;
          if(claimed===null){
            const receipt=effectReceipt("failed","local-storage-unavailable");
            await completeWorkspace("浏览器无法保存本轮操作。",{id:delivery.id,replyTo:attempt.userMessageId,runTrace:r.runTrace,
              activity:workspaceEffectActivity(delivery.id,effect,"failed",r.message,"本地会话存储不可用，操作未提交。",receipt)},receipt);
            return;
          }
        }
        if(r.workspaceLayerOpen!==undefined){
          const action=r.workspaceLayerOpen;
          const authorized=attempt.context.workspaceView?.publishedLayerActions===true &&
            effect?.fields.includes("workspaceLayerOpen") &&
            r.workspaceAction===undefined && r.workspaceOperation===undefined && validWorkspacePublishedLayerAction(action);
          const selection=authorized && workspaceCurrent()
            ? await resolvePublishedFieldLayer(action,AbortSignal.any([controller.signal,AbortSignal.timeout(10000)])).catch(()=>undefined)
            : undefined;
          if(!isCurrent())return;
          const stale=!workspaceCurrent();
          const receipt=effectReceipt(stale?"stale":selection?"applied":"failed",
            !selection && !stale ? (authorized?"publication-unverified":"unsupported-action") : undefined,
            workspaceObservationTarget(r));
          if(selection && !stale)openFieldLayer(selection.field,selection);
          const message=stale ? "工作台已变化，本轮操作未应用。"
            : selection ? "已在数据地球选择「"+publishedWorkspaceLayerRecipes[action.datasetId].title+"」 · "+selection.label+"。"
            : "当前发布目录无法验证该图层或选项，本轮未打开图层。";
          await completeWorkspace(message,{id:delivery.id,replyTo:attempt.userMessageId,runTrace:r.runTrace,
            workspacePending:r.workspacePending,conversationContext:r.conversationContext,
            researchIntent:r.researchIntent,conversationEvidence:r.conversationEvidence,
            conversationAssertionEvidence:r.conversationAssertionEvidence,
            activity:workspaceEffectActivity(delivery.id,action,receipt?.state ?? "not-applied",r.message,
              selection&&!stale ? message+" 图层载入状态见球面。" : message,receipt),
            ...(stale ? {historicalReply:true} : {}),
          },receipt);
          if(receipt?.reason==="publication-unverified")void recoverUnverifiedPublication(receipt);
          return;
        }
        if (r.workspaceOperation !== undefined) {
          const now=latest.current;
          const question=now.messages.find(message=>message.id===attempt.userMessageId);
          const batch=chatCandidateBatch(now);
          const operations=availableChatOperations(now,batch,question?.citation || null);
          const operation=r.workspaceOperation,kind=operation?.kind;
          const original=attempt.context.workspaceView;
          const originalViewport=original ? {...original,operations:undefined,candidateItems:undefined,publishedLayerActions:undefined} : undefined;
          const target=validWorkspaceOperationKind(kind) && original?.operations?.includes(kind) ? operations.get(kind) : undefined;
          const staleWorkspace=()=>!workspaceCurrent() ||
            workspaceActionState(originalViewport)!==workspaceActionState(projectWorkspaceView(latest.current,surfaceReading.current?.()));
          const staleTarget=!!target && validWorkspaceOperationKind(kind) && attempt.workspaceOperationKeys?.[kind]!==target.key;
          let stale=staleWorkspace() || staleTarget,applied=false;
          let message="当前工作台无法应用这项操作。";
          if (!stale && !legacy && operation && "ids" in operation) {
            const {ids,kind}=operation;
            const candidateKey=attempt.workspaceCandidateKey;
            stale=!!candidateKey && candidateKey!==chatCandidateKey(batch);
            if (batch && !stale && candidateKey && workspaceCandidateOperationAllowed(original?.candidateItems,kind,ids)) {
              try {
                if (ids.some(id=>!assetById.has(id))) await loadRemoteAssetIds(ids);
                if (!isCurrent()) return;
                const current=latest.current,nextBatch=chatCandidateBatch(current),reading=surfaceReading.current?.();
                const currentItems=chatCandidateItems(current,nextBatch,reading?.surface===current.view ? reading.candidateItems : undefined);
                const chosen=ids.flatMap(id=>assetById.get(id) || []);
                stale=staleWorkspace() || candidateKey!==chatCandidateKey(nextBatch) ||
                  !workspaceCandidateOperationAllowed(currentItems,kind,ids);
                if (!stale && chosen.length===ids.length) {
                  if (kind==="open-candidate") {
                    inspectAsset(chosen[0].id,batch.filters,batch.selection,batch);
                    message="已打开「"+chosen[0].title+"」的数据速览。";
                  } else {
                    patch({inspector:{comparison:comparison(chosen,batch.filters,batch.selection),comparedBatch:{...batch,ids}},evidence:null});
                    message="已打开对照 · "+chosen.map(asset=>asset.title).join("、");
                  }
                  applied=true;
                }
              } catch {
                if (!isCurrent()) return;
                message="当前候选资料暂时无法读取。";
              }
            }
          } else if (!stale && target && !legacy) {
            try {
              if (kind==="open-saved") {
                patch({view:"discover",search:{...emptySearch,savedOnly:true},listLibraryOpen:false,inspector:null,evidence:null});
                applied=true;
                message="已打开收藏。";
              } else if (kind==="open-research-lists") {
                patch({view:"discover",listLibraryOpen:true,inspector:null,evidence:null,
                  origin:now.view==="earth" ? remember(now) : now.origin});
                applied=true;
                message="已打开本浏览器保存的研究清单。";
              } else if (kind==="return-to-results") {
                leaveDetail();
                applied=true;
                message="已返回进入前的视图并恢复原筛选。";
              } else if (target.save) {
                message=saveChatResearchList(delivery.id,target.save,localStorage);
                applied=true;
                window.dispatchEvent(new Event("oneearth-list-changed"));
              }
            } catch (error) {
              message=error instanceof Error ? error.message : "暂时无法完成本轮操作。";
            }
          }
          if (stale) message="工作台已变化，本轮操作未应用。";
          const receipt=effectReceipt(stale?"stale":applied?"applied":"failed");
          await completeWorkspace(message,{id:delivery.id,replyTo:attempt.userMessageId,runTrace:r.runTrace,
            workspacePending:r.workspacePending,conversationContext:r.conversationContext,
            activity:workspaceEffectActivity(delivery.id,r.workspaceOperation,receipt?.state ?? (applied?"applied":"not-applied"),r.message,
              applied && kind==="open-saved" ? "已提交收藏视图与仅收藏筛选。目录读取状态在资料页显示。" : message,receipt),
            ...(stale ? {historicalReply:true} : {})},receipt);
          return;
        }
        if (r.workspaceAction !== undefined) {
          const action = r.workspaceAction;
          const original = attempt.context.workspaceView;
          const latestState = latest.current;
          const surface = surfaceReading.current?.();
          const currentView = projectWorkspaceView(latestState,surface);
          const stale = !workspaceCurrent() || workspaceActionState(original ? {...original,operations:undefined,candidateItems:undefined,publishedLayerActions:undefined} : undefined)
            !== workspaceActionState(currentView);
          const isPublishedChoice = (publication:WorkspaceViewPublication, valueId:string) =>
            !!surface?.resolvePublishedChoice?.(publication, valueId);
          const allowed = (!legacy || authorizesWorkspaceViewAction(q)) && workspaceViewActionAllowed(original, action, isPublishedChoice)
            && workspaceViewActionAllowed(currentView, action, isPublishedChoice);
          const control = !stale && allowed && surface?.surface === latestState.view
            ? currentView.activeLayer?.controls.find(item => item.id === action.controlId) : undefined;
          const choice = control?.options.find(item => item.id === action.valueId)
            ?? (control?.publication ? surface?.resolvePublishedChoice?.(control.publication, action.valueId) : undefined);
          let target:typeof choice;
          try { if(choice && surface?.applyControl?.(action))target=choice; } catch { /* No accepted control value. */ }
          const message = control && target ? "已将" + control.label + "切换到「" + target.label + "」。"
            : stale ? "工作台已变化，本轮操作未应用。"
            : "当前视图无法应用这项操作。";
          const raster=action?.layerId==="forest" || action?.layerId==="c40";
          const receipt=effectReceipt(stale?"stale":target?"applied":"failed",undefined,workspaceObservationTarget(r));
          await completeWorkspace(target && raster ? message+" 图层载入状态见球面。" : message, {id:delivery.id, replyTo:attempt.userMessageId,
            activity:workspaceEffectActivity(delivery.id,action,receipt?.state ?? (target?"applied":"not-applied"),r.message,
              target ? "已向浏览器控件提交「"+target.label+"」。"+(raster?"图层载入结果独立显示。":"") : message,receipt),
            runTrace:r.runTrace, workspacePending:r.workspacePending, ...(stale ? {historicalReply:true} : {}),
            researchIntent:r.researchIntent, conversationContext:r.conversationContext,
            conversationEvidence:r.conversationEvidence, conversationAssertionEvidence:r.conversationAssertionEvidence},receipt);
          return;
        }
        if(r.researchRegion===null || validResearchRegion(r.researchRegion))receiveRegion(r.researchRegion);
        if(r.hainaRecords&&r.hainaCatalog)registerHaina(r.hainaRecords,r.hainaCatalog.synced,r.hainaCatalog.endpoint,false);
        const next: Partial<State> = {};
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
            if(id==="wind")await loadWindData().catch(error=>{if(!effect)throw error;next.error="暂时无法载入风场预览。";});
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
        const resultBatch=boundResultBatch(r.resultBatch,delivery.id,attempt.userMessageId,session);
        const viewOnly=!!effect && !resultBatch;
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
        if (catalogBatchResult && !viewOnly) Object.assign(next, {
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
        const historicalReply = restoring || !workspaceCurrent();
        const effective = { ...s, ...next };
        const modelBatch: CandidateSet | undefined = r.modelIds?.length ? {
          title:q, ids:r.modelIds, caseId:r.caseId || s.caseId, filters:answerFilters(s.filters,r.filters),
          camera:r.camera || s.camera, selection:r.clearSelection ? null : s.selection, gridSystem:s.gridSystem,
          layer:r.layer || s.layer, originKind:"chat"
        } : undefined;
        const recommendations = viewOnly ? undefined : (match ? catalogBatchResult : undefined) || modelBatch || catalogBatchResult || (
          resultBatch ? {
            title:resultBatch.query,ids:resultBatchCandidates(resultBatch),caseId:r.caseId ?? s.caseId,
            filters:answerFilters(s.filters,r.filters),camera:r.camera ?? s.camera,
            selection:r.clearSelection ? null : s.selection,gridSystem:r.gridSystem ?? s.gridSystem,
            layer:r.layer ?? s.layer,originKind:"chat" as const,catalogConditions:resultBatch.conditions,
          } :
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
        if (recommendations && !resultBatch && !modelBatch && r.research)
          recommendations.ids = [
            ...new Set(r.research.rows.flatMap((row) => row.ids)),
          ];
        if(recommendations && resultBatch){
          recommendations.resultBatch=resultBatch;
          recommendations.ids=resultBatchCandidates(resultBatch,recommendations.ids);
          if(catalogBatchResult && !viewOnly){
            next.mapResult=recommendations;
            if(next.search)next.search={...next.search,result:recommendations};
          }
        }
        if (recommendations && !catalogBatchResult && r.catalogQuery === undefined)
          next.search = {...emptySearch, result:recommendations};
        if (recommendations && r.research) {
          next.inspector = null;
          if (r.previewNeed === undefined) next.evidence = null;
          next.origin = null;
          if (!recommendations.ids.length && !resultBatch?.itemIds.length) {
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
        // A view mutation must not relabel the previous research result as a fresh batch.
        if(viewOnly && Object.hasOwn(next,"caseId") && !Object.hasOwn(next,"mapResult"))next.mapResult=s.mapResult;
        const receipt=effectReceipt(historicalReply?"stale":effect && !submitsWorkspaceFields(r,effect,next,s)?"failed":"applied");
        if (!historicalReply && receipt?.state!=="failed") patch(next);
        if (next.search && r.catalogQuery !== undefined)
          r.message +=
            " 当前匹配 " +
            catalogResults(next.search, effective.saved).length +
            " 份资料。";
        if (next.error && r.visualizeNeed !== undefined) r.message = next.error;
        const message=receipt?.state==="failed" ? "当前工作台无法应用这项操作。"
          : receipt?.state==="stale" ? "工作台已变化，本轮操作未应用。" : r.message;
        await completeWorkspace(message, {
          id: delivery.id,
          researchRegion:r.researchRegion,
          researchIntent:r.researchIntent,conversationContext:r.conversationContext,
          conversationEvidence:r.conversationEvidence,
          conversationAssertionEvidence:r.conversationAssertionEvidence,
          runTrace:r.runTrace, answerNotes:r.answerNotes, gridCoverage:r.gridCoverage, workspacePending:r.workspacePending,
          replyTo: attempt.userMessageId,
          ...(historicalReply ? { historicalReply: true, context: "原问题 · " + q + " · " + context } : {}),
          ...(r.gap ? {dataSupport:r.gap.dataSupport} : {}),
          ...(match ? {catalogMatch: match} : {}),
          ...(r.research ? { research: r.research } : {}),
          ...(recommendations ? { candidates: recommendations } : {}),
          activity: effect ? workspaceEffectActivity(delivery.id,effect,receipt?.state ?? "proposed",r.message,
            workspaceReceiptDetail(receipt?.state),receipt) : {
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
                      "POST " + (legacy ? "/api/tasks" : chatMessagesPath) +
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
        },receipt);
      } catch (error) {
        if (!isCurrent()) return;
        if(effect){
          const receipt=effectReceipt(workspaceCurrent()?"failed":"stale");
          await completeWorkspace("本轮工作台操作未提交。",{id:delivery.id,replyTo:attempt.userMessageId,runTrace:completedTrace ?? entry.progress.trace,
            activity:workspaceEffectActivity(delivery.id,effect,receipt?.state ?? "failed","工作台操作",workspaceReceiptDetail(receipt?.state),receipt)},receipt);
          return;
        }
        if (error instanceof ChatResponseError && error.code==="cancelled") {
          await finishCancellation(error.runTrace || entry.progress.trace);
          return;
        }
        keepDelivery = !(error instanceof ChatResponseError);
        if(!keepDelivery && entry.progress.taskLifecycle)entry.progress.taskLifecycle=mergeTaskLifecycle(
          entry.progress.taskLifecycle,{runtimePhase:{phase:"failed"}});
        if(clarificationAttempt && keepDelivery)rememberClarificationDelivery(delivery.id,delivery);
        const mayRetry=!clarificationAttempt || keepDelivery;
        const message=clarificationAttempt
          ? (keepDelivery ? "与原追问的回复暂时断开，可以重新连接。" : "这次追问的回复未能完成。")
          : error instanceof ChatResponseError && error.code==="invalid_answer_references"
            ? "这次回答的资料引用未通过核对，可按原条件重试。"
            : "这次请求没有完成，可按此轮原始条件重试。";
        await complete(message, {
          runTrace:error instanceof ChatResponseError ? error.runTrace || entry.progress.trace : entry.progress.trace,
          id:delivery.id,failed:true,...(mayRetry?{retry:attempt}:{}),replyTo:attempt.userMessageId,
        });
      } finally {
        if (isCurrent()) {
          closeProgress();
          if(clarificationAttempt && !keepDelivery)rememberClarificationDelivery(delivery.id);
          if (!keepDelivery && !failedMessages.current.has(delivery.id))
            await removeChatDelivery(session, delivery.id).catch(() => {
              if (latest.current.sessionId===session) patch({sessionError:sessionFailure});
            });
        }
      }
    },
    [add, inspectAsset, leaveDetail, patch, publishChatProgress,readWorkspaceSurface,uploadReceipt,rememberClarificationDelivery,openFieldLayer,chatRequestSnapshot,persistReceiptUpdate],
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
    if(!message || !check || confirmingQuestions.current.has(messageId) ||
      current.messages.some(m=>m.role==="user" && m.time>message.time))return;
    let decision:QuestionDecision;
    try{decision=makeQuestionDecision(check,messageId,choice,edited);}
    catch(error){patch({error:error instanceof Error?error.message:"请核对问题内容。"});return;}
    const {clarificationReply: _clarificationReply,clarificationAnswer: _clarificationAnswer,...checkedAttempt}=check.attempt;
    const {workspaceView,browserTurnFrame,...snapshot}=chatRequestSnapshot(current,chatCandidateBatch(current),messageId);
    const attempt={...checkedAttempt,...snapshot,query:check.originalQuestion,userMessageId:randomId(),questionDecision:decision,
      view:current.view,context:structuredClone({...checkedAttempt.context,workspaceView,browserTurnFrame})};
    confirmingQuestions.current.add(messageId);
    try{
      await add("user",(choice==="original"?"按原问题继续：":"按确认的问题继续：")+decision.dataQuestion,
        {id:attempt.userMessageId,questionDecision:decision,attachedScope:attempt.context.attachedScope,browserTurnFrame});
      if(latest.current.sessionId===current.sessionId)await executeDiscovery(attempt,true);
    }finally{confirmingQuestions.current.delete(messageId);}
  },[add,patch,executeDiscovery,chatRequestSnapshot]);
  useEffect(() => {
    let active = true;
    const session = state.sessionId;
    async function restore() {
      const last = latest.current.messages.at(-1);
      const deliveries = await unfinishedChatDeliveries(session);
      if (active && latest.current.sessionId === session && !deliveries.length && last?.role === "user" && !requests.current.size) {
        patch({unansweredQuestionId:last.id});
      }
      for (const delivery of deliveries) {
        if (!active || latest.current.sessionId !== session) return;
        const answer = latest.current.messages.find(m => m.id === delivery.id);
        if (answer && !answer.failed) {
          await removeChatDelivery(session, delivery.id);
        } else if (!answer) {
          void executeDiscovery(delivery.attempt, true, delivery, true);
        } else if(isClarificationAttempt(delivery.attempt)){
          rememberClarificationDelivery(delivery.id,delivery);
        }
      }
    }
    void restore().catch(() => { if (active) patch({sessionError:sessionFailure}); });
    return () => { active = false; };
  }, [state.sessionId, executeDiscovery, patch,rememberClarificationDelivery]);
  const openPublicLayer = useCallback((id:PublicLayerId) => {
    const current=latest.current;
    const existing=current.globeLayers.find(layer=>layer.kind==="public"&&layer.selection.id===id);
    if(current.view==="earth" && current.globeLayerFocus===existing?.id){
      patch({inspector:null,evidence:null});
      return;
    }
    const layer=globeDatasetLayer({kind:"public",selection:existing?.kind==="public" ? existing.selection : {id}});
    patch({...focusProjection(layer),view:"earth",globeLayers:setDatasetLayer(current.globeLayers,layer),globeLayerFocus:layer.id,
      globeLayerFit:id===1835833&&current.globeLayers.some(item=>item.visible) ? null : layer.id,
      overview:"catalog",mapResult:null,mesh:false,layer:"all",
      origin:current.inspector ? remember(current) : current.origin || remember(current),
      inspector:null,evidence:null,error:null});
  },[patch]);
  const openVisualization = useCallback(
    (id: "gfs-wind" | RegionalId | "catalog", selection?: Selection | null) => {
      const current=latest.current;
      if(id==="catalog"){
        const globeLayers=current.globeLayers.map(layer=>layer.visible ? {...layer,visible:false} : layer);
        patch({...focusProjection(null),view:"earth",globeLayers,globeLayerFocus:null,globeLayerFit:null,overview:"catalog",
          mesh:true,layer:"all",origin:current.origin || remember(current),camera:defaultCamera,inspector:null,evidence:null,error:null});
        return;
      }
      const existing=current.globeLayers.find(layer=>layer.kind==="field" ? layer.selection.id===id : layer.kind==="wind" && id==="gfs-wind");
      if(current.view==="earth" && current.globeLayerFocus===existing?.id){
        patch({inspector:null,evidence:null,...(selection && id==="gfs-wind" ? {selection,camera:{...current.camera,center:selection.point}} : {})});
        return;
      }
      if(id!=="gfs-wind"){
        openFieldLayer(existing?.kind==="field" ? existing.selection : {id,frame:globeCases[id].month});
        return;
      }
      if(!visualizationCatalog.some(recipe=>recipe.id===id))return;
      const selected=selection!==undefined ? selection : (current.view==="discover"
        ? current.search.result?.selection : current.selection) || null;
      const visualization=existing?.kind==="wind" ? existing.selection : defaultWindState();
      const layer=globeDatasetLayer({kind:"wind",selection:matchMedia("(prefers-reduced-motion: reduce)").matches
        ? {...visualization,playing:false} : visualization});
      patch({...focusProjection(layer),view:"earth",globeLayers:setDatasetLayer(current.globeLayers,layer),
        globeLayerFocus:layer.id,globeLayerFit:null,origin:current.inspector ? remember(current) : current.origin || remember(current),
        selection:selected,evidence:null,citation:null,mesh:false,layer:"all",error:null,
        camera:selected ? {...current.camera,center:selected.point} : {center:[105,20],zoom:1,reason:"全球 GFS 风场"},
      });
    },
    [patch,openFieldLayer],
  );
  const answeringClarifications=useRef(new Set<string>());
  const answerClarification=useCallback((reply:ClarificationAnswer)=>{
    const s=latest.current;
    const {parentTaskId}=reply;
    const pendingKey=s.sessionId+"/"+parentTaskId;
    if (answeringClarifications.current.has(pendingKey) || answeredClarificationIds(s.messages,s.unansweredQuestionId).has(parentTaskId))
      return false;
    const parent=s.messages.find(message=>message.id===parentTaskId);
    const prompt=messageClarificationPrompt(parent);
    const query=prompt && clarificationAnswerText(prompt,reply);
    if (!prompt || !query) return false;
    const clarificationReply=prompt.kind==="research" ? {parentTaskId} : undefined;
    const clarificationAnswer=validClarificationPrompt(parent?.clarificationPrompt) ? reply : undefined;
    const {workspaceView,browserTurnFrame,...snapshot}=chatRequestSnapshot(s,chatCandidateBatch(s),parentTaskId);
    const unsent=s.messages.find(message=>message.role==="user" && message.id===s.unansweredQuestionId);
    const unsentParent=unsent?.clarificationAnswer?.parentTaskId ?? unsent?.clarificationReply?.parentTaskId;
    const originalTurnId=unsentParent===parentTaskId && unsent?.text===query
      && unsent.clarificationAnswer?.optionId===reply.optionId ? unsent.id : undefined;
    const attempt:DiscoveryAttempt={query,userMessageId:originalTurnId ?? randomId(),view:s.view,
      context:structuredClone({...scopedQuestionContext([],null),workspaceView,browserTurnFrame:unsent?.browserTurnFrame && originalTurnId
        ? unsent.browserTurnFrame : browserTurnFrame}),...snapshot,clarificationReply,clarificationAnswer};
    answeringClarifications.current.add(pendingKey);
    if (!originalTurnId) void add("user",query,{id:attempt.userMessageId,clarificationReply,clarificationAnswer:reply,browserTurnFrame});
    patch({unansweredQuestionId:null,...(s.clarificationReply?.parentTaskId===parentTaskId ? {clarificationReply:null} : {})});
    void executeDiscovery(attempt,false).finally(()=>answeringClarifications.current.delete(pendingKey));
    return true;
  },[add,chatRequestSnapshot,executeDiscovery,patch]);

  const send = useCallback(async (query:string, clarificationReply?:ClarificationReply) => {
    const q = query.trim(), s = latest.current;
    if (!q || s.attachingMapScope) return;
    if (clarificationReply) {
      answerClarification({parentTaskId:clarificationReply.parentTaskId,text:q});
      return;
    }
    const batch=chatCandidateBatch(s);
    const {workspaceView,browserTurnFrame,...snapshot}=chatRequestSnapshot(s,batch);
    const turnId = randomId();
    const items = s.draftScope ?? [];
    const citation = s.citation ? (({excerpt,...reference})=>reference)(s.citation) : null;
    const activeObservations = s.view==="discover" ? initialAccessSection(s.search)==="timely"
      : s.view==="earth" && (s.filters.source==="constellation" || batch?.filters.source==="constellation");
    const observationBatch = activeObservations && batch && (batch.filters.source==="constellation" || s.view==="discover")
      && batch.ids.every(id=>/^constellation:[a-f0-9]{64}$/.test(id)) ? batch : null;
    const ids = batch?.ids || [];
    const filters = s.view==="discover" && batch ? {...s.filters,source:batch.filters.source,type:batch.filters.type} : s.filters;
    const context = items.length ? scopedQuestionContext(items,citation)
      : {caseId:s.caseId,filters:activeObservations ? {...filters,source:"constellation"} : filters,
        gridSystem:s.gridSystem,layer:s.layer,selection:s.selection,camera:s.camera,citation,
        dataView:s.view==="earth"?s.dataView:null,visualization:s.view==="earth"?s.visualization:null,
        candidateIds:ids,inCandidateScope:!!batch,
        candidateVersions:Object.fromEntries(ids.flatMap(id=>{
          const version=assetById.get(id)?.version;
          return version ? [[id,version]] : [];
        })),
        ...(observationBatch?{observationBatch:{catalogConditions:observationBatch.catalogConditions,
          selection:observationBatch.selection,period:observationBatch.filters.period,utcWindow:observationBatch.filters.utcWindow}}:{})};
    const attempt:DiscoveryAttempt = {query:q,userMessageId:turnId,
      view:s.view,context:structuredClone({...context,workspaceView,browserTurnFrame}),...snapshot};
    void add("user",q,{id:turnId,attachedScope:items,browserTurnFrame,
      context:[caseById(s.caseId)?.title,s.filters.place,s.selection?.grid.label].filter(Boolean).join(" · ") || "全球视图",
      ...(s.citation?{citation:s.citation}:{})});
    patch({draftScope:null,citation:null,unansweredQuestionId:null});
    await executeDiscovery(attempt,false);
  },[add,answerClarification,chatRequestSnapshot,executeDiscovery,patch]);
  const retry = useCallback(async (attempt:DiscoveryAttempt, id:string) => {
    const session=latest.current.sessionId;
    try {
      const saved=clarificationDeliveries.current.get(id) ?? (await unfinishedChatDeliveries(session)).find(item=>item.id===id);
      const current=latest.current;
      if(current.sessionId!==session || current.messages.some(message=>message.id===id && !message.failed))return;
      // A new task ID would compete with the original parent's one recorded reply.
      if(isClarificationAttempt(attempt) && !saved)return;
      await executeDiscovery(attempt,true,saved);
    } catch {
      if (latest.current.sessionId===session) patch({sessionError:sessionFailure});
    }
  },[executeDiscovery,patch]);
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
    attachScope,confirmQuestion,answerClarification,cancelChat,
    registerWorkspaceSurface, registerWorkspacePanel, noteManualNavigation, observePublishedRasters,
    retry,recoverableClarifications,
    openCase,
    inspectAsset,
    openData,
    openVisualization,
    openPublicLayer,focusGlobeLayer,setGlobeLayerVisible,
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
