import {resolvePublishedFieldLayer,type PublishedFieldCatalogues} from "../components/published-field-layer";
import {publishedWorkspaceLayerRecipes,validWorkspacePublishedLayerAction,workspaceObservationTarget} from "./workspace-published-layer";
import {boundResultBatch, browserPanelKey, browserTurnFrame, browserTurnRelations, previousChatAnswer, readBrowserBatch, resultBatchCandidates} from "./browser-turn-frame";
import { datasetLayerFromView, decodeGlobeLayers, encodeGlobeLayers, focusedDatasetLayer, globeDatasetLayer, setDatasetLayer, type FieldLayerSelection, type GlobeDatasetLayer } from "./globe-dataset-layers";
import {submitsWorkspaceFields, workspaceEffectActivity, workspaceEffectFor, workspaceReceiptDetail} from "./workspace-effect";
import type {BrowserWorkspaceReceipt,WorkspaceReceipt,WorkspaceRejectionReason} from "./turn-context";
import {samePublishedRaster,type PublishedRasterPresentation,type PublishedRasterTarget} from "./published-raster-observation";
import {availableChatOperations, chatCandidateBatch, chatCandidateItems, chatCandidateKey, saveChatResearchList} from "./chat-workspace-operations";
import {authorizesResearchRangeAdoption, authorizesResearchRangeClear, validWorkspaceOperationKind, workspaceCandidateOperationAllowed} from "./workspace-operations";
import {projectWorkspaceView, workspaceActionState, type WorkspaceSurfaceReading, type WorkspacePanelReading} from "./workspace-view-projection";
import {workspaceViewActionAllowed, type WorkspaceViewPublication} from "./workspace-view-context";
import { loadWorkspaceResearchState, submitWorkspaceResearchAction, WorkspaceResearchActionError, discoveryClarificationResult, loadResearchRecord, researchRecordId, cancelChatRequest, readArchivedChatTrace, readRecordWorkspaceReceipt, reportWorkspaceReceipt, isClarificationAttempt, type ResearchRecord } from "./runtime-client";
import {clarificationAnswerText,validClarificationPrompt,type ClarificationAnswer} from "./clarification";
import {datasetScope,mergeScope,scopedQuestionContext,type ScopeItem} from "./question-scope";
import {attachCoverageScope,waitForBoundCoverage} from "./coverage-attachment";
import {boundCatalogueMapBatch,cataloguePresentationTarget,readCataloguePresentation,type CatalogueFrameObservation,
  type CataloguePresentation,type CataloguePresentationTarget} from "./catalogue-presentation";
import {createCataloguePresentationObserver} from "./catalogue-presentation-client";
import {readWorkspaceActionEffect,type WorkspaceActionEffect,type WorkspaceEffectReceipt} from "./workspace-action-effect";
import {advancesWorkspaceActionEffect,createWorkspacePageToken,reportWorkspaceActionEffect} from "./workspace-action-effect-client";

import {caseObservationCase, readCaseObservation, readCaseObservationRef, readCaseObservationStatus} from "./case-observations";
import {layerObservationMatchesView, readLayerObservation, readLayerObservationRef, readLayerObservationStatus} from "./layer-observations";
import {flightCatalogueFollowUp,type FlightMapReceipt} from "./flight-catalogue";
import {canAdoptCurrentSelection,hasExplicitTurnRange,prepareResearchRange,readResearchRangeScope,
  type ResearchRange,type ResearchRangeInput} from "./research-range";
import {readWorkspaceResearchState,type WorkspaceResearchObservation,type WorkspaceResearchState} from "./workspace-research-state";
import {newWorkspaceDiscoveryHandle,type WorkspaceDiscoveryAdmission} from "./workspace-discovery-client";
import {workspaceDiscoveryIntent,type WorkspaceDiscoveryReference} from "./workspace-discovery";
import {previewableTab} from "./web-preview";
import {archivedAnswerDelivery,retainedWebReadings} from "./research-delivery";
import {researchRegionCamera,validResearchRegion,sameResearchRegion,type ResearchRegion,type ResearchRegionLayer} from "./research-region";
import {answerMapBatch,answerFilters,initialAnswerCamera,gridCamera,evidenceCamera,evidenceSelection} from "./answer-map";
import { globeCases,layerFrameCount,datasetLayers,isForestDate,type RegionalId } from "./regional-cases";
import {validHainaMonth} from "./haina-published-raster";
import {isPublicLayerId,validPublicViewId,type PublicLayerId,type PublicLayerSelection} from "./haina-public-layer";
import {isRainYear} from "./rain-catalog";
import { paperId } from "./paper-record";
import { readPaperCatalogStatus, type PaperCatalogStatus } from "./paper-catalog-client";
import { randomId } from "./id";
import type {ResumeEntry} from "@ag-ui/core";
import { ChatResponseError, type ChatPhase } from "./chat-response";
import {mergeNativeRunProcess,needsArchivedRunProcess,savedNativeSummaries} from "./native-summary-client";
import {readResearchProgress,type ResearchProgress} from "./native-agui-research-progress";
import {loadNativeWorkspaceMessages,readClaimedNativeTurn,readNativeInterrupt,recoverNativeChat,submitNativeChat,type ChatRun} from "./native-chat-client";
import {readWorkspaceToolRecord,workspaceActionFields} from "./native-workspace-tool";
import {nativeAgUiPath,readOneEarthAgUiInterruptRecord,type OneEarthAgUiInterruptRecord,type OneEarthAgUiResumePayload,type OneEarthQuestionCheckResumePayload} from "./native-ag-ui";
import {mergeTaskLifecycle,readCancelledTaskLifecycle,type TaskLifecycle} from "./task-lifecycle-client";
import {loadDeepSeekTools} from "./deepseek-tools";
import { readChatModel } from "./chat-model";
import {geoBounds,geoCentroid} from "d3-geo";
import {checkedScenes} from "./product-distribution";
import {validWindow,windowFilters} from "./time-window";
import { observationBatchCamera, observationById, pushId, type PushFeed } from "./push-observations";
import {makeQuestionDecision} from "./question-confirmation";
import type {ClarificationReply, ProviderReasoningSnapshot, QuestionDecision} from "./types";
import {validAccessSection,initialAccessSection} from "./data-access";
import { registerHaina, registerObservations, registerPapers, loadRemoteAssetIds } from "./datasets";
import {loadHainaCatalog,type HainaCatalogStatus} from "./haina-catalog-client";
import { type ChatDelivery, attachArchivedRunTrace, claimWorkspaceEffect, readChatArchiveAccessKey, saveChatDelivery, unfinishedChatDeliveries, removeChatDelivery, legacySession, mergeMessages, readFavorites, readSession, readSessionMessage, sessionMessages, sessionSummaries, writeFavorite, writeSession } from "./session-storage";
import { sampleCamera } from "./earth-search";
import { catalogResults, type SearchState } from "./results";
import { catalogBatch } from "./batch-context";
import { activeHainaRecordVersion, assetById, assetIdentity, assets } from "./datasets";
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
  researchRange:ResearchRange|null;
  researchRangeRevision:number;
  researchRangeActionId?:string|null;
  legacyResearchRange:ResearchRange|null;
  draftScope: ScopeItem[] | null;
  clarificationReply?: ClarificationReply | null;
  attachingMapScope?: boolean;
  flight?: {id:string;camera:Camera;kind?:"research-region"|"place"|"grid"|"layer-control"|"catalogue";label?:string}|null;
  mapFocus?: {answerId:string;assetId:string;locked:boolean}|null;
  pendingMapPresentation:Message|null;
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
type ChatDiscoveryInput = {discoveryAction:WorkspaceDiscoveryAdmission} | {discoveryReference:WorkspaceDiscoveryReference};
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
  draftText?:string;
  researchProgress?:ResearchProgress;
  waitingForOriginalPage?:boolean;
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
  | { type: "research-range"; sessionId:string; snapshot:WorkspaceResearchState }
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
    flight:null,mapFocus:null,pendingMapPresentation:null,researchRegion:null,researchRange:null,researchRangeRevision:0,researchRangeActionId:undefined,legacyResearchRange:null,attachingMapScope:false,
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
function observationFields(response:DiscoveryResponse|undefined):Partial<Message> {
  const caseObservation=readCaseObservation(response?.caseObservation);
  if(caseObservation)return {caseObservation};
  const caseObservationStatus=readCaseObservationStatus(response?.caseObservationStatus);
  if(caseObservationStatus)return {caseObservationStatus};
  const layerObservation=readLayerObservation(response?.layerObservation);
  if(layerObservation)return {layerObservation};
  const layerObservationStatus=readLayerObservationStatus(response?.layerObservationStatus);
  return layerObservationStatus ? {layerObservationStatus} : {};
}
function archivedChatMessages(saved:ResearchRecord,runTrace?:Message["runTrace"]):Message[] {
  const reply=saved.result;
  const researchProgress=readResearchProgress(saved.researchProgress,saved.id);
  const answerDelivery=archivedAnswerDelivery(reply,researchProgress);
  const retainedReadings=retainedWebReadings(reply,answerDelivery);
  const answerNotes=reply.answerNotes && retainedReadings.length ? {...reply.answerNotes,webSources:retainedReadings} : reply.answerNotes;
  const nativeInterrupt=readOneEarthAgUiInterruptRecord(saved.interrupt,saved.id);
  const questionCheck=nativeInterrupt?.kind==="question-check" ? nativeInterrupt.questionCheck : reply.questionCheck;
  const clarificationPrompt=validClarificationPrompt(reply.clarificationPrompt) ? reply.clarificationPrompt : undefined;
  const effect=workspaceEffectFor(reply,saved.id);
  const workspaceTool=readWorkspaceToolRecord(saved.workspaceTool,saved.id,reply);
  const receipt=effect && (saved.workspaceTool===undefined || workspaceTool) ? readRecordWorkspaceReceipt(saved) : undefined;
  const proposed=reply.workspaceLayerOpen ?? reply.workspaceAction ?? reply.workspaceOperation ?? effect;
  const batch=boundResultBatch(reply.resultBatch,saved.id,saved.turnId,saved.conversationId);
  const grid=reply.gridCoverage?.status==="ready" ? reply.gridCoverage.summary : undefined;
  const researchRange=readResearchRangeScope(saved.researchRange);
  const catalogueTarget=cataloguePresentationTarget(reply,{runId:saved.id,conversationId:saved.conversationId,turnId:saved.turnId});
  const cataloguePresentation=catalogueTarget&&readCataloguePresentation(saved.cataloguePresentation,catalogueTarget);
  return [
    {id:saved.turnId,role:"user",text:saved.question,time:saved.created,...(researchRange ? {attachedScope:[researchRange]} : {})},
    {id:saved.id,role:"assistant",text:reply.message,time:saved.updated,replyTo:saved.turnId,
      chatMessage:true,...(proposed ? {historicalReply:true,
        activity:workspaceEffectActivity(saved.id,proposed,receipt?.state ?? "proposed",reply.message,workspaceReceiptDetail(receipt?.state),receipt)} : {}),
      workspaceEffect:effect,workspaceReceipt:receipt,verifiedWorkspaceCall:workspaceTool?.call,taskLifecycle:saved.taskLifecycle,
      ...(batch ? {candidates:{
        resultBatch:batch,answerId:saved.id,title:batch.query,ids:resultBatchCandidates(batch,reply.modelIds??reply.catalogMatch?.ids),
        caseId:grid ? grid.caseId : reply.caseId ?? null,filters:answerFilters(grid?.filters ?? emptyFilters(),reply.filters),
        selection:grid?.selection ?? reply.catalogMatch?.selection ?? null,layer:grid?.layer ?? reply.layer ?? "all",
        camera:reply.camera ?? (grid?.selection ? gridCamera(grid.selection) : defaultCamera),
        gridSystem:grid?.selection?.grid.system ?? reply.gridSystem ?? "h3",
        originKind:"chat",catalogConditions:batch.conditions,
        researchRecord:{sessionId:saved.conversationId,messageId:saved.id,question:saved.question,
          intent:reply.researchIntent,notes:reply.answerNotes?.researchNotes ?? []},
      },historicalReply:true} : {}),
      workspacePending:reply.workspacePending,researchIntent:reply.researchIntent,conversationContext:reply.conversationContext,
      conversationEvidence:reply.conversationEvidence,conversationAssertionEvidence:reply.conversationAssertionEvidence,
      answerNotes,answerDelivery,runTrace,researchProgress,researchRegion:reply.researchRegion,
      gridCoverage:reply.gridCoverage,cataloguePresentationTarget:catalogueTarget,cataloguePresentation,
      ...observationFields(reply),
      ...(reply.clarification || clarificationPrompt ? {clarification:true} : {}),
      clarificationPrompt,
      nativeInterrupt,questionCheck,
      ...(discoveryClarificationResult(reply)?{discoveryClarification:true}:{})},
  ];
}

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
      state.legacyResearchRange=record.legacyResearchRange;
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
    const needsReceipt=!!cachedResearch?.workspaceEffect && (!cachedReceipt || cachedReceipt.observation?.state==="loading");
    const needsDelivery=!!cachedResearch&&!cachedResearch.answerDelivery&&cachedResearch.text.startsWith("回答整理未能完成。");
    const needsCataloguePresentation=cachedResearch?.candidates?.resultBatch?.kind==="catalogue";
    if(researchId&&(!cachedResearch||needsArchivedCatalogue||needsReceipt||needsDelivery||needsCataloguePresentation)){
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
          state.legacyResearchRange=stored?.legacyResearchRange ?? null;
          const providerReasoning=readArchivedChatTrace(saved,saved,reply.message)?.providerReasoning;
          const runTrace=reply.runTrace && {...reply.runTrace,providerReasoning};
          const messages=archivedChatMessages(saved,runTrace);
          state.sessionId=saved.conversationId;
          state.messages=mergeMessages(stored?.messages||[],messages);
          await writeSession(state.sessionId,saved.question,captureWorkspace(state),state.messages);
        }else if(saved.conversationId===state.sessionId && saved.turnId===cachedResearch.replyTo && saved.id===cachedResearch.id){
          let updated=cachedResearch;
          if(needsDelivery && cachedResearch.text===reply.message){
            const [,message]=archivedChatMessages(saved);
            if(message.answerDelivery)updated={...updated,answerDelivery:message.answerDelivery,
              answerNotes:message.answerNotes,researchProgress:message.researchProgress??cachedResearch.researchProgress};
          }
          if(needsReceipt){
            const workspaceTool=readWorkspaceToolRecord(saved.workspaceTool,saved.id,reply);
            const receipt=saved.workspaceTool===undefined || workspaceTool ? readRecordWorkspaceReceipt(saved) : undefined;
            if(receipt && receipt.effectId===cachedResearch.workspaceEffect?.effectId)
              updated={...updated,workspaceReceipt:receipt,verifiedWorkspaceCall:workspaceTool?.call};
          }
          if(needsCataloguePresentation){
            const target=cataloguePresentationTarget(reply,{runId:saved.id,conversationId:saved.conversationId,turnId:saved.turnId});
            const receipt=target&&readCataloguePresentation(saved.cataloguePresentation,target);
            if(receipt)updated={...updated,cataloguePresentationTarget:target,cataloguePresentation:receipt};
          }
          if(updated!==cachedResearch){
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

function withWorkspaceResearchState(state:State,snapshot:WorkspaceResearchState):State {
  if(snapshot.conversationId!==state.sessionId ||
    (state.researchRangeActionId!==undefined && snapshot.revision<=state.researchRangeRevision))return state;
  return {...state,researchRange:snapshot.range,researchRangeRevision:snapshot.revision,researchRangeActionId:snapshot.actionId};
}

function selectedCoverageRevision(state:State,reading:WorkspaceSurfaceReading|undefined) {
  const visible=reading?.surface==="earth" ? reading.selectedCoverage : undefined;
  if(visible && visible.selection===state.selection && visible.filters===state.filters && (visible.batch??null)===state.mapResult)
    return visible.revision;
}

async function currentResearchRangeInput(state:State,signal:AbortSignal,visibleRevision?:string):Promise<ResearchRangeInput> {
  if(!canAdoptCurrentSelection(state) || !state.selection)
    throw Error("请先在地图的数据目录中选择一个 H3 网格。");
  const {selection,mapResult,filters}=structuredClone({selection:state.selection,mapResult:state.mapResult,filters:state.filters});
  let revision=visibleRevision;
  if(!revision){
    const response=await fetch("/api/coverage/revision",{cache:"no-store",signal});
    const payload=response.ok ? await response.json().catch(()=>null) : null;
    revision=payload?.revision;
  }
  if(typeof revision!=="string" || !/^[0-9a-f]{64}$/.test(revision))
    throw Error("覆盖未知，暂时无法采用当前选格。");
  const place=await import("../data/evidence/geo-orientation.mjs")
    .then(atlas=>atlas.geoOrientation(selection.point).split("（")[0]).catch(()=>"");
  const bound=await attachCoverageScope(filters,mapResult,selection,revision,signal);
  return {scope:{kind:"grid",place,...bound}};
}

async function readoptResearchRange(range:ResearchRange,signal:AbortSignal):Promise<ResearchRangeInput> {
  const {kind,selection,place,coverageScope}=await prepareResearchRange(range,signal);
  return {scope:{kind,selection,place,coverageScope}};
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
  if (a.type === "research-range") return withWorkspaceResearchState(s,a.snapshot);
  const messages = mergeMessages(s.messages, a.messages);
  return messages === s.messages ? s : { ...s, messages };
}
const mapNavigationFields = ["view","caseId","selection","gridSystem","globeLayerFit","flight","camera"] as const satisfies readonly (keyof State)[];
const mapPresentationFields = [
  "overview","filters","source","mapResult","dataView","visualization","fieldLayer","publicLayer","globeLayerFocus",
] as const satisfies readonly (keyof State)[];

type MapEffectRevisions={navigation:number;presentation:number};
type MapEffectSubmission=MapEffectRevisions&{sessionId:string};
type ActiveMapEffect={id:string;kind:WorkspaceActionEffect["kind"];supersede:()=>void;observe?:(frame:CatalogueFrameObservation)=>void};
type MapEffectPage={
  token:string;
  submission:MapEffectSubmission;
  latest?:WorkspaceActionEffect;
  started:Set<string>;
};

const Context = createContext<ReturnType<typeof useWorkspaceValue> | null>(
  null,
);
function useWorkspaceValue(initialState: State) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const historyIds=useMemo(()=>new Set(state.messages.map(m=>m.id)),[state.sessionId]);
  const latest = useRef(state);
  latest.current = state;
  const mapEffectRevisions=useRef<MapEffectRevisions>({navigation:0,presentation:0});
  const activeMapEffect=useRef<ActiveMapEffect|undefined>(undefined);
  const mapEffectPages=useRef(new Map<string,MapEffectPage>());
  const invalidateMapEffect=useCallback((scope:"navigation"|"presentation"="navigation")=>{
    mapEffectRevisions.current[scope]++;
    const active=activeMapEffect.current;
    if(scope==="navigation" || active?.kind==="catalogue-presentation")active?.supersede();
  },[]);
  const publishResearchRange=useCallback((sessionId:string,snapshot:WorkspaceResearchState)=>{
    const current=latest.current,next=withWorkspaceResearchState(current,snapshot);
    if(sessionId!==snapshot.conversationId || next===current)return;
    // The initial read establishes the range without changing an existing browser target.
    if(current.researchRangeActionId!==undefined && current.researchRangeRevision!==next.researchRangeRevision)
      invalidateMapEffect("presentation");
    latest.current=withWorkspaceResearchState(latest.current,snapshot);
    dispatch({type:"research-range",sessionId,snapshot});
  },[invalidateMapEffect]);
  const refreshWorkspaceResearchRevision=useCallback(async (sessionId:string)=>{
    const snapshot=await loadWorkspaceResearchState(sessionId);
    publishResearchRange(sessionId,snapshot);
    return snapshot.revision;
  },[publishResearchRange]);
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
  const requests = useRef(new Map<string,{controller:AbortController;transport:AbortController;progress:ActiveChat;finishCancellation:()=>Promise<void>}>());
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
    return {workspaceView:{...workspaceView,publishedLayerActions:true as const},browserTurnFrame:browserTurn,
      workspaceKey:frozenWorkspaceKey(s,reading),researchRangeRevision:s.researchRangeRevision,
      workspaceCandidateKey:workspaceView.candidateItems?.length ? chatCandidateKey(batch) : undefined,
      workspaceOperationKeys:Object.fromEntries([...operations].map(([kind,target])=>[kind,target.key]))};
  },[readWorkspaceSurface,workspaceViewAt]);
  const serial = useRef(0);
  const catalogueFlights=useRef(new Map<string,(receipt:FlightMapReceipt)=>void>());
  const settleCatalogueFlight=useCallback((id:string,receipt:FlightMapReceipt)=>{
    catalogueFlights.current.get(id)?.(receipt);
  },[]);
  const patch = useCallback((value: Partial<State>,mapEffectOwner?:string) => {
    const scopeChange=["caseId","view","mapResult","filters","selection","gridSystem"].some(key=>Object.hasOwn(value,key));
    if(scopeChange && !Object.hasOwn(value,"flight") && (latest.current.flight?.kind!=="catalogue" ||
      mapNavigationFields.some(key=>Object.hasOwn(value,key) && !Object.is(value[key],latest.current[key]))))
      value={...value,flight:null};
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
    if(mapEffectOwner!=="renderer-camera" && (!mapEffectOwner || mapEffectOwner!==activeMapEffect.current?.id)){
      const changed=(key:keyof State)=>Object.hasOwn(value,key) && !Object.is(value[key],latest.current[key]);
      if(mapNavigationFields.some(changed))invalidateMapEffect();
      else if(mapPresentationFields.some(changed))invalidateMapEffect("presentation");
    }
    if (Object.hasOwn(value, "readerPosition")) {
      const doc = Object.hasOwn(value, "evidence") ? value.evidence : latest.current.evidence;
      try { saveReaderCheckpoint(latest.current.sessionId, doc || null, value.readerPosition || null); }
      catch { value = { ...value, sessionError: sessionFailure }; }
    }
    dispatch({ type: "patch", value });
  },[invalidateMapEffect]);
  const reportGlobeCamera=useCallback((camera:Camera)=>patch({camera},"renderer-camera"),[patch]);
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
    invalidateMapEffect();
    const current=latest.current;
    if(current.flight?.kind==="catalogue"){
      settleCatalogueFlight(current.flight.id,{state:"superseded",observedAt:Date.now()});
      patch({flight:null,globeLayerFit:null});
      return;
    }
    if(current.flight?.kind==="layer-control" || current.globeLayerFit)
      patch({globeLayerFit:null,...(current.flight?.kind==="layer-control" ? {flight:null} : {})});
  }, [invalidateMapEffect,patch,settleCatalogueFlight]);
  const cancelCatalogueFlight=useCallback(()=>{
    const flight=latest.current.flight;
    if(flight?.kind!=="catalogue")return;
    settleCatalogueFlight(flight.id,{state:"cancelled",observedAt:Date.now()});
    patch({flight:null});
  },[patch,settleCatalogueFlight]);
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
  const persistCataloguePresentation=useCallback(async(receipt:CataloguePresentation,target:CataloguePresentationTarget)=>{
    const session=target.conversationId,id=target.runId;
    const message=await readSessionMessage(session,id).catch(()=>null) ??
      (latest.current.sessionId===session?latest.current.messages.find(item=>item.id===id):undefined);
    if(message?.replyTo!==target.turnId||message.candidates?.resultBatch?.batchId!==target.batchId)return;
    const updated={...message,cataloguePresentation:receipt};
    dispatch({type:"messages",sessionId:session,messages:[updated]});
    await recordWrite(writeSession(session,"",undefined,[updated]).then(()=>channel.current?.postMessage({sessionId:session,id})),()=>{
      if(latest.current.sessionId===session)failedMessages.current.set(id,updated);
    });
  },[recordWrite]);
  const catalogueObserver=useMemo(()=>createCataloguePresentationObserver(persistCataloguePresentation),[persistCataloguePresentation]);
  useEffect(()=>()=>catalogueObserver.dispose(),[catalogueObserver]);
  useEffect(()=>{
    const batch=state.view==="earth"?state.mapResult?.resultBatch:undefined;
    catalogueObserver.invalidateUnless(batch?.taskId,batch?.batchId,state.researchRangeRevision);
  },[catalogueObserver,state.view,state.mapResult,state.researchRangeRevision,state.sessionId]);
  const observeCatalogueFrame=useCallback((frame:CatalogueFrameObservation)=>{
    const now=latest.current,batch=now.view==="earth"?now.mapResult?.resultBatch:undefined;
    if(batch?.conversationId!==now.sessionId||batch.taskId!==frame.runId||batch.batchId!==frame.batchId)return;
    activeMapEffect.current?.observe?.(frame);
    catalogueObserver.observe(frame,now.researchRangeRevision,activeHainaRecordVersion);
  },[catalogueObserver]);
  const automaticAnswerIds=useRef(new Map<string,number>());
  const add = useCallback((role: Message["role"], text: string, extra: Partial<Message> = {}) => {
    const s = latest.current;
    // Local actions can add both the question and answer in the same millisecond.
    lastMessageTime.current = Math.max(Date.now(), lastMessageTime.current + 1, (s.messages.at(-1)?.time || 0) + 1);
    const message = { id: randomId(), role, text, time: lastMessageTime.current, ...extra };
    if(role==="user")recentSubmission.current={session:s.sessionId,message};
    if(role==="assistant" && message.candidates && message.candidates.resultBatch?.kind!=="catalogue" && !message.historicalReply)
      automaticAnswerIds.current.set(message.id,s.researchRangeRevision);
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
    const syncResearchRange = (sessionId:string) => {
      void loadWorkspaceResearchState(sessionId).then(snapshot=>publishResearchRange(sessionId,snapshot)).catch(()=>{});
    };
    const sync = () => {
      const sessionId = latest.current.sessionId;
      syncResearchRange(sessionId);
      void sessionMessages(sessionId).then(messages => dispatch({ type: "messages", sessionId, messages })).catch(() => {});
    };
    if (typeof BroadcastChannel !== "undefined") {
      channel.current = new BroadcastChannel("oneearth.session-messages.v1");
      channel.current.onmessage = event => {
        const {sessionId, id, researchRange} = event.data || {};
        if (sessionId !== latest.current.sessionId) return;
        if (researchRange===true) {syncResearchRange(sessionId);return;}
        if (!id) { sync(); return; }
        void readSessionMessage(sessionId, id).then(message => {
          if (message) dispatch({ type: "messages", sessionId, messages: [message] });
        }).catch(() => {});
      };
    }
    sync();
    window.addEventListener("focus", sync);
    return () => { channel.current?.close(); channel.current = null; window.removeEventListener("focus", sync); };
  }, [state.sessionId,publishResearchRange]);
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
        Object.assign(next, workspace, {messages:record.messages,legacyResearchRange:record.legacyResearchRange});
        restoreGlobeState(next,workspace);
      }
      next.chatOpen = true;
      next.pushFeed = latest.current.pushFeed;
      next.paperFeed = latest.current.paperFeed;
      next.hainaFeed = latest.current.hainaFeed;
      next.saved = await readFavorites();
      if (!id) await writeSession(next.sessionId, sessionTitle(next), { ...captureWorkspace(next), resultId: null });
      if (switchVersion.current !== switchId || s.sessionId !== latest.current.sessionId) return false;
      invalidateMapEffect();
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
  const activateAnswer = useCallback((message:Message,fit=true,reveal=false,mapEffectOwner?:string) => {
    const s=latest.current,batch=answerMapBatch(message);
    if(!batch)return;
    const region=message.researchRegion;
    const target=fit?(region?researchRegionCamera(region):initialAnswerCamera(batch)):null;
    patch({view:"earth",caseId:null,overview:"catalog",mapResult:batch,
      filters:batch.filters,selection:batch.selection,gridSystem:batch.gridSystem,layer:batch.layer,
      dataView:null,visualization:null,fieldLayer:null,mapFocus:null,
      pendingMapPresentation:mapEffectOwner ? message : null,
      ...(reveal && matchMedia("(max-width: 600px)").matches?{chatOpen:false}:{}),
      camera:s.camera,flight:target?{id:randomId(),camera:target}:region && s.researchRegion?.messageId===message.replyTo?s.flight:null,
      ...(region!==undefined?{researchRegion:region?{messageId:message.replyTo || message.id,region,
        visible:sameResearchRegion(s.researchRegion?.region,region)?s.researchRegion?.visible??true:true}:null}:{}),
      search:{...s.search,result:batch},origin:s.origin || remember(s)},mapEffectOwner);
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
    if(previous.session!==state.sessionId || previous.id===last?.id || !last || last.role!=="assistant")return;
    const rangeRevision=automaticAnswerIds.current.get(last.id);
    automaticAnswerIds.current.delete(last.id);
    if(rangeRevision!==latest.current.researchRangeRevision || !last.candidates || last.historicalReply || last.failed)return;
    // Explicit content visualizations keep control of the globe. Late replies never move it.
    if(state.view!=="earth" || state.visualization || state.fieldLayer || state.publicLayer || state.dataView || state.evidence)return;
    const fit=!state.researchRegion && !state.mapResult?.answerId,key=requestWorkspaceKey(state);
    const ids=last.candidates.ids.filter(id=>!assetById.has(id));
      void (ids.length ? loadRemoteAssetIds(ids) : Promise.resolve()).then(async()=>{
      publishResearchRange(state.sessionId,await loadWorkspaceResearchState(state.sessionId));
      const current=latest.current;
      if(current.sessionId===state.sessionId && current.messages.at(-1)?.id===last.id &&
        current.researchRangeRevision===rangeRevision && requestWorkspaceKey(current)===key){
        activateAnswer(last,fit);
      }
    }).catch(()=>{});
  },[state.messages,state.sessionId,activateAnswer,publishResearchRange]);
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
    update({cancelling:true,cancelError:undefined,stage:"正在取消本地任务",
      taskLifecycle:mergeTaskLifecycle(entry.progress.taskLifecycle,{runtimePhase:{phase:"cancel-pending"}})});
    try {
      const cancelled=await cancelChatRequest(id,AbortSignal.any([entry.controller.signal,AbortSignal.timeout(8000)]));
      if (cancelled) {
        await entry.finishCancellation();
        return;
      }
      update({stage:"正在核对本轮终态"});
    } catch {
      update({stage:"正在核对本轮终态",cancelError:"取消结果待确认，正在读取原任务状态。"});
    }
    entry.transport.abort();
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
      const turnId=latest.current.messages.find(message=>message.id===id)?.replyTo;
      if(!turnId)return;
      let shouldCheckAgain=attempt<2;
      try{
        const facts=await readCancelledTaskLifecycle({id,conversationId:session,turnId},
          AbortSignal.any([controller.signal,AbortSignal.timeout(5_000)]),await readChatArchiveAccessKey(id));
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
  const watchingRasters=useRef(new Map<string,{receipt:BrowserWorkspaceReceipt;version:number;rangeRevision:number;ready:Promise<void>}>());
  const observePublishedRasters=useCallback((presentations:PublishedRasterPresentation[])=>{
    for(const [id,watch] of watchingRasters.current){
      const start=watch.receipt.observation!;
      const now=latest.current;
      const superseded=now.sessionId!==watch.receipt.conversationId || serial.current!==watch.version ||
        now.researchRangeRevision!==watch.rangeRevision || now.view!=="earth";
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
  useEffect(()=>{ observePublishedRasters([]); },[state.view,state.sessionId,state.researchRangeRevision,observePublishedRasters]);
  useEffect(()=>{
    const session=state.sessionId;
    const resend=()=>{
      void sessionMessages(session).then(messages=>{
        for(const m of messages){
          const receipt=m.workspaceReceipt;
          if(m.verifiedWorkspaceCall && receipt && !("taskId" in receipt))uploadReceipt(m.id,receipt);
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
  const [verifiedInterrupts,setVerifiedInterrupts]=useState<ReadonlySet<string>>(()=>new Set());
  const markInterrupt=useCallback((threadId:string,id:string,pending:boolean)=>{
    const key=threadId+"/"+id;
    setVerifiedInterrupts(previous=>{
      if(previous.has(key)===pending)return previous;
      const next=new Set(previous);
      if(pending)next.add(key);
      else next.delete(key);
      return next;
    });
  },[]);
  const publishInterrupt=useCallback(async (parent:ChatRun,claim:OneEarthAgUiInterruptRecord)=>{
    if(latest.current.sessionId!==parent.threadId)return;
    markInterrupt(parent.threadId,parent.runId,claim.status==="pending");
    const message=latest.current.messages.find(m=>m.id===parent.runId && m.replyTo===parent.turnId);
    if(message && (message.nativeInterrupt?.status!==claim.status || message.nativeInterrupt?.resumedBy!==claim.resumedBy))
      await add("assistant",message.text,{...message,nativeInterrupt:claim,
        ...(claim.kind==="question-check" ? {} : {clarificationPrompt:claim.prompt})});
  },[add,markInterrupt]);
  const [claimedReplyTerminals,setClaimedReplyTerminals]=useState<ReadonlyMap<string,"failed"|"cancelled">>(()=>new Map());
  const recoverClaimed=useCallback(async (parent:ChatRun,claim:OneEarthAgUiInterruptRecord,signal:AbortSignal,
    attempted?:ChatRun,locationId?:string)=>{
    const child=await readClaimedNativeTurn(parent,claim,signal,attempted,locationId);
    if(!child || signal.aborted || latest.current.sessionId!==parent.threadId)return false;
    const existing=latest.current.messages.find(m=>m.id===child.runId && m.replyTo===child.turnId && !m.failed);
    if(existing)return true;
    let recovered;
    let taskLifecycle:TaskLifecycle|undefined;
    try{
      recovered=await recoverNativeChat(child,signal,{onAccepted:()=>{},onLifecycle:facts=>{taskLifecycle=facts;}});
    }catch(error){
      if(!(error instanceof ChatResponseError) || (error.code!=="run_failed" && error.code!=="cancelled"))throw error;
      if(signal.aborted || latest.current.sessionId!==parent.threadId)return false;
      const phase=error.code==="cancelled" ? "cancelled" : "failed";
      setClaimedReplyTerminals(previous=>previous.has(child.runId) ? previous : new Map(previous).set(child.runId,phase));
      return true;
    }
    if(!recovered.record || latest.current.sessionId!==parent.threadId || signal.aborted)return false;
    const {record,response}=recovered;
    if(response.paperRecords)registerPapers(response.paperRecords,false);
    if(response.hainaRecords?.length&&response.hainaCatalog)
      registerHaina(response.hainaRecords,response.hainaCatalog.synced,response.hainaCatalog.endpoint,false);
    if(recovered.interrupt)markInterrupt(child.threadId,child.runId,recovered.interrupt.status==="pending");
    const trace=readArchivedChatTrace(record,{id:child.runId,conversationId:child.threadId,turnId:child.turnId},response.message);
    const messages=archivedChatMessages({...record,taskLifecycle:taskLifecycle??record.taskLifecycle},trace);
    for(const message of messages){
      if(signal.aborted || latest.current.sessionId!==parent.threadId)return false;
      await add(message.role,message.text,message);
    }
    return true;
  },[add,markInterrupt]);
  const processReads=useRef(new Set<string>());
  const hydrateRunProcess=useCallback(async ({runId,threadId,turnId}:ChatRun,text:string,saved?:ResearchRecord)=>{
    const key=threadId+"/"+runId;
    if(processReads.current.has(key))return;
    processReads.current.add(key);
    const record=saved ?? await loadResearchRecord(runId).catch(()=>undefined);
    const trace=record && readArchivedChatTrace(record,{id:runId,conversationId:threadId,turnId},text);
    if(!trace || !record)return;
    const archivedDelivery=record.result.answerDelivery;
    const retainedReadings=retainedWebReadings(record.result,archivedDelivery);
    const updated=await attachArchivedRunTrace(threadId,runId,turnId,text,trace,retainedReadings).catch(()=>undefined);
    if(!updated)return;
    dispatch({type:"messages",sessionId:threadId,messages:[updated]});
    channel.current?.postMessage({sessionId:threadId,id:runId});
  },[]);
  const changingResearchRange=useRef(new Set<string>());
  const changeResearchRange=useCallback(async (
    resolve:(state:State,signal:AbortSignal)=>Promise<ResearchRangeInput|null>,
  )=>{
    const source=latest.current,session=source.sessionId,version=switchVersion.current;
    if(changingResearchRange.current.has(session) || source.attachingMapScope)return;
    changingResearchRange.current.add(session);
    const stillCurrent=()=>latest.current.sessionId===session && switchVersion.current===version;
    patch({attachingMapScope:true,error:null});
    const actionId=randomId();
    try {
      // Start freezing the observed conditions immediately, before any readback.
      const expected=source.researchRangeActionId===undefined
        ? loadWorkspaceResearchState(session).then(snapshot=>{
          publishResearchRange(session,snapshot);
          return snapshot.revision;
        }) : Promise.resolve(source.researchRangeRevision);
      const [range,expectedRevision]=await Promise.all([resolve(source,AbortSignal.timeout(10000)),expected]);
      const snapshot=await submitWorkspaceResearchAction(session,range
        ? {actionId,expectedRevision,kind:"adopt-research-range",range}
        : {actionId,expectedRevision,kind:"clear-research-range"});
      publishResearchRange(session,snapshot);
      channel.current?.postMessage({sessionId:session,researchRange:true});
      if(range && stillCurrent())patch({chatOpen:true});
    } catch(error) {
      const conflict=error instanceof WorkspaceResearchActionError ? error.state : undefined;
      const snapshot=conflict ?? await loadWorkspaceResearchState(session).catch(()=>undefined);
      if(snapshot)publishResearchRange(session,snapshot);
      if(snapshot?.actionId===actionId) {
        channel.current?.postMessage({sessionId:session,researchRange:true});
        if(snapshot.range && stillCurrent())patch({chatOpen:true});
      } else if(stillCurrent())patch({
        error:error instanceof Error && !["TimeoutError","TypeError"].includes(error.name)
          ? error.message : "暂时无法确认研究范围是否已修改，请核对当前范围。",
      });
    } finally {
      changingResearchRange.current.delete(session);
      if(latest.current.sessionId===session)patch({attachingMapScope:false});
    }
  },[patch,publishResearchRange]);
  const adoptCurrentResearchRange=useCallback(()=>changeResearchRange((state,signal)=>
    currentResearchRangeInput(state,signal,selectedCoverageRevision(state,readWorkspaceSurface()))),
    [changeResearchRange,readWorkspaceSurface]);
  const clearResearchRange=useCallback((visibleRevision:number)=>{
    const current=latest.current;
    if(!current.researchRange || current.researchRangeRevision!==visibleRevision){
      patch({error:"当前研究范围已变化，请核对后再清除。"});
      return;
    }
    return changeResearchRange(async()=>null);
  },[changeResearchRange,patch]);
  const adoptLegacyResearchRange=useCallback(()=>changeResearchRange(async(state,signal)=>{
    if(state.researchRangeActionId!==null || !state.legacyResearchRange)
      throw Error("当前会话已采用或清除了其他研究范围。");
    const scope=readResearchRangeScope(state.legacyResearchRange.scope);
    if(!scope)throw Error("找不到可核对的旧浏览器研究范围。");
    return readoptResearchRange({...state.legacyResearchRange,scope},signal);
  }),[changeResearchRange]);
  const adoptArchivedResearchRange=useCallback((messageId:string)=>changeResearchRange(async (s,signal)=>{
    const message=s.messages.find(item=>item.id===messageId && item.role==="assistant");
    if (!message?.replyTo || message.failed) throw Error("找不到该答复的原研究范围。");
    const record=await loadResearchRecord(messageId,signal);
    const scope=readResearchRangeScope(record.researchRange);
    if (!scope || record.conversationId!==s.sessionId || record.turnId!==message.replyTo || record.result.message!==message.text)
      throw Error("该答复缺少可核对的原研究范围。");
    return readoptResearchRange({scope,...(scope.coverageScope.summary.candidateCount===null ? {batch:null} : {})},signal);
  }),[changeResearchRange]);
  const executePageMapEffect=useCallback(async(
    task:WorkspaceActionEffect,token:string,submission:MapEffectSubmission,signal:AbortSignal,
  )=>{
    const command=task.command;
    if(!command)return;
    const id=task.effectId;
    const submit=(receipt:WorkspaceEffectReceipt)=>reportWorkspaceActionEffect(task,token,receipt);
    const isCurrent=()=>!signal.aborted && latest.current.sessionId===submission.sessionId &&
      latest.current.view==="earth" && mapEffectRevisions.current.navigation===submission.navigation &&
      (command.kind==="flight" || mapEffectRevisions.current.presentation===submission.presentation);
    const claimViewport=()=>{
      invalidateMapEffect();
      submission.navigation=mapEffectRevisions.current.navigation;
    };
    const supersededFlight=():FlightMapReceipt=>({state:"superseded",observedAt:Date.now()});
    const canRender=()=>surfaceReading.current?.()?.catalogueRenderer==="cesium";
    const deadline=()=>AbortSignal.timeout(Math.max(1,Math.min(8000,task.expiresAt-Date.now())));
    if(command.kind==="flight"){
      let flight:FlightMapReceipt;
      if(!isCurrent())flight=supersededFlight();
      else if(!canRender() || Date.now()>=task.expiresAt)flight={state:"ground-unavailable",observedAt:Date.now()};
      else flight=await new Promise<FlightMapReceipt>(resolve=>{
        const timer=deadline();
        const finish=(receipt:FlightMapReceipt)=>{
          if(activeMapEffect.current?.id!==id)return;
          // Clear this exact flight while it is still owned by the effect.
          if(latest.current.flight?.id===id)patch({flight:null},id);
          activeMapEffect.current=undefined;
          catalogueFlights.current.delete(id);
          timer.removeEventListener("abort",unavailable);
          signal.removeEventListener("abort",cancelled);
          resolve(receipt);
        };
        const unavailable=()=>finish({state:"ground-unavailable",observedAt:Date.now()});
        const cancelled=()=>finish({state:"cancelled",observedAt:Date.now()});
        claimViewport();
        activeMapEffect.current={id,kind:command.kind,supersede:()=>finish(supersededFlight())};
        catalogueFlights.current.set(id,receipt=>
          finish(receipt.state==="arrived" && !isCurrent() ? supersededFlight() : receipt));
        timer.addEventListener("abort",unavailable,{once:true});
        signal.addEventListener("abort",cancelled,{once:true});
        patch({flight:{id,kind:"catalogue",camera:command.camera,label:command.placeLabel}},id);
      });
      return submit({kind:"flight",flight});
    }
    const {target,result}=command;
    const batch=boundCatalogueMapBatch(result,target);
    const facts=new Map<string,number>();
    const report=(state:"failed"|"superseded")=>{
      const {runId:_run,items,...identity}=target;
      const observedAt=Date.now();
      return submit({kind:"catalogue-presentation",presentation:{...identity,items:items.map(item=>{
        const rendered=facts.get(item.datasetId);
        return {...item,state:rendered===undefined?state:"rendered",observedAt:rendered??observedAt};
      })}});
    };
    if(!isCurrent())return report("superseded");
    if(!batch || !canRender() || Date.now()>=task.expiresAt)return report("failed");
    if(result.hainaRecords?.length && result.hainaCatalog)
      registerHaina(result.hainaRecords,result.hainaCatalog.synced,result.hainaCatalog.endpoint,false);
    const record={id:task.runId,conversationId:task.conversationId,turnId:task.turnId,
      question:batch.query,created:Date.now(),updated:Date.now(),result};
    const [,message]=archivedChatMessages(record,result.runTrace);
    if(!message.candidates?.ids.length)return report("failed");
    const end=await new Promise<"observed"|"failed"|"superseded">(resolve=>{
      const timer=deadline();
      const finish=(reason:"observed"|"failed"|"superseded")=>{
        if(activeMapEffect.current?.id!==id)return;
        activeMapEffect.current=undefined;
        timer.removeEventListener("abort",unavailable);
        signal.removeEventListener("abort",superseded);
        resolve(reason);
      };
      const unavailable=()=>finish("failed");
      const superseded=()=>finish("superseded");
      claimViewport();
      activeMapEffect.current={id,kind:command.kind,supersede:superseded,observe(frame){
        if(!isCurrent()){superseded();return;}
        if(frame.runId!==target.runId || frame.batchId!==target.batchId)return;
        if(Date.now()>=task.expiresAt){unavailable();return;}
        for(const {datasetId,version} of target.items){
          if(!facts.has(datasetId) && frame.datasetIds.includes(datasetId) && activeHainaRecordVersion(datasetId)===version)
            facts.set(datasetId,frame.observedAt);
        }
        if(facts.size===target.items.length)finish("observed");
      }};
      timer.addEventListener("abort",unavailable,{once:true});
      signal.addEventListener("abort",superseded,{once:true});
      activateAnswer(message,true,false,id);
    });
    return report(end==="superseded"?"superseded":"failed");
  },[activateAnswer,invalidateMapEffect,patch]);
  const workspaceAnchors=useRef(new Map<string,string>());
  const executeDiscovery = useCallback(
    async function runDiscovery(attempt: DiscoveryAttempt, retrying: boolean, saved?: ChatDelivery,
      restoring=false, onResumeAccepted?:()=>void, mapEffectSubmission?:MapEffectSubmission,
      parentClaim?:OneEarthAgUiInterruptRecord,discoveryInput?:ChatDiscoveryInput):Promise<void> {
      if ([...requests.current.values()].some(({progress})=>progress.userMessageId===attempt.userMessageId)) return;
      const q = attempt.query;
      const current = latest.current;
      const until = current.messages.findIndex(m => m.id === attempt.userMessageId);
      const preceding = until < 0 ? current.messages : current.messages.slice(0,until);
      const previousTaskId=attempt.context.flightParentRunId??(attempt.context.browserTurnFrame
        ? attempt.context.browserTurnFrame.related?.find(entry=>entry.relation==="reply")?.taskId
        : previousChatAnswer(preceding)?.id);
      const reply=attempt.nativeResume ? attempt.clarificationAnswer : undefined;
      const decision=attempt.nativeResume ? attempt.questionDecision : undefined;
      const abandon=attempt.nativeResume && attempt.abandonedQuestionCheckId;
      const parentId=reply?.parentTaskId ?? decision?.checkMessageId ?? (abandon || undefined);
      const parentMessage=current.messages.find(m=>m.id===parentId);
      const parentInterrupt=parentClaim?.id===parentId ? parentClaim : parentMessage?.nativeInterrupt;
      const parentRun=parentMessage?.replyTo && parentInterrupt
        ? {threadId:current.sessionId,runId:parentMessage.id,turnId:parentMessage.replyTo} : undefined;
      let resume:ResumeEntry|undefined;
      if(parentRun && parentInterrupt?.kind==="question-check"){
        if(abandon)resume={interruptId:parentRun.runId,status:"cancelled"};
        else if(decision){
          const payload:OneEarthQuestionCheckResumePayload=decision.choice==="edited"
            ? {choice:"edited",dataQuestion:decision.dataQuestion} : {choice:decision.choice};
          resume={interruptId:parentRun.runId,status:"resolved",payload};
        }
      }else if(parentRun && reply){
        const payload:OneEarthAgUiResumePayload={...(reply.optionId?{optionId:reply.optionId}:{}),...(reply.text?{text:reply.text}:{})};
        resume={interruptId:parentRun.runId,status:"resolved",payload};
      }
      if(!saved && (attempt.nativeResume ? !resume : isClarificationAttempt(attempt) || !!attempt.questionDecision))return;
      if(!saved && !attempt.nativeResume && !attempt.workspaceResearch && attempt.context.attachedScope?.some(readResearchRangeScope)){
        patch({error:"此轮使用旧浏览器研究范围，请采用或重新选择范围后再发问。"});
        return;
      }
      const submission = {context:attempt.context,config:readChatModel(),previousTaskId:parentRun?.runId ?? previousTaskId,
        workspaceResearch:attempt.workspaceResearch,workspaceResearchAction:attempt.workspaceResearchAction,
        ...(resume && parentInterrupt?.operation ? {operationReply:parentInterrupt.operation} : {})};
      const workspaceKey=(state:State)=>attempt.context.browserTurnFrame
        ? frozenWorkspaceKey(state,readWorkspaceSurface()) : requestWorkspaceKey(state);
      const originalRangeRevision=attempt.researchRangeRevision ?? 0;
      const sameResearchRange=()=>latest.current.researchRangeRevision===originalRangeRevision;
      const detached = retrying && (workspaceKey(current) !== attempt.workspaceKey || !sameResearchRange());
      const s: State = {
        ...current, ...attempt.context, view: attempt.view ?? current.view,
        origin: detached ? null : current.origin,
        dataView: attempt.context.dataView ?? null, visualization: attempt.context.visualization ?? null,
      };
      const controller = new AbortController();
      const transport = new AbortController();
      controller.signal.addEventListener("abort",()=>transport.abort(),{once:true});
      const discoveryAccessKey=discoveryInput && ("discoveryAction" in discoveryInput
        ? discoveryInput.discoveryAction.accessKey : discoveryInput.discoveryReference.accessKey);
      const delivery:ChatDelivery=saved ?? {id:randomId(),attempt};
      const session = current.sessionId;
      const run = {threadId:session,runId:delivery.id,turnId:attempt.userMessageId};
      if(mapEffectSubmission && !saved && !restoring && !resume && mapEffectSubmission.sessionId===session){
        mapEffectPages.current.set(run.runId,{token:createWorkspacePageToken(),submission:mapEffectSubmission,started:new Set()});
      }
      const mapPage=mapEffectPages.current.get(run.runId);
      const pageToken=mapPage?.token;
      let originalMapEffect=mapPage?.latest;

      const priorReasoning=saved ? savedNativeSummaries(run.runId,current.messages.find(message=>
        message.id===run.runId && message.replyTo===run.turnId)?.runTrace) : [];
      const clarificationAttempt=isClarificationAttempt(attempt);
      const entry = {controller,transport,finishCancellation,progress:{id:delivery.id,userMessageId:attempt.userMessageId,
        scope:{filters:attempt.context.filters,selection:attempt.context.selection},accepted:false,
        stage:saved ? "正在读取原任务状态" : "正在提交问题",phase:"foreground" as const,
        trace:{started:Date.now(),stages:[],calls:[],...(priorReasoning.length?{providerReasoning:priorReasoning}:{})},
        searches:[]} as ActiveChat};
      requests.current.set(delivery.id,entry);
      const isCurrent = () => !controller.signal.aborted && latest.current.sessionId === session
        && requests.current.get(delivery.id) === entry;
      let researchRevisionReadable=true;
      const refreshResearchRange=async()=>{
        const snapshot=await loadWorkspaceResearchState(session).catch(()=>undefined);
        researchRevisionReadable=!!snapshot;
        if(snapshot && isCurrent())publishResearchRange(session,snapshot);
      };
      const updateProgress = (progress:Partial<ActiveChat>) => {
        entry.progress={...entry.progress,...progress};
        publishChatProgress();
      };
      const closeProgress = () => {
        if (!isCurrent()) return;
        requests.current.delete(delivery.id);
        publishChatProgress();
      };
      let hydrateCompletedProcess=false;
      const complete = (message:string, extra:Partial<Message>) =>{
        const lifecycle=extra.taskLifecycle??entry.progress.taskLifecycle;
        const written=add("assistant",message,{taskLifecycle:entry.progress.taskLifecycle,
          researchProgress:entry.progress.researchProgress,...extra,chatMessage:true,
          ...(!extra.failed && lifecycle?.runtimePhase?.phase!=="cancelled" ? observationFields(canonicalResponse) : {})});
        if(hydrateCompletedProcess && !extra.failed && lifecycle?.runtimePhase?.phase==="complete" && message===canonicalResponse?.message)
          void written.then(()=>hydrateRunProcess(run,message));
        return written;
      };
      async function finishCancellation(trace?:Message["runTrace"]){
        if(!isCurrent())return;
        const taskLifecycle=mergeTaskLifecycle(entry.progress.taskLifecycle,{runtimePhase:{phase:"cancelled"}});
        const written=abandon ? undefined :
          complete("本地任务已取消。",{id:delivery.id,replyTo:attempt.userMessageId,runTrace:trace??entry.progress.trace,taskLifecycle});
        closeProgress();
        mapEffectPages.current.delete(run.runId);
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
      let verifiedWorkspaceCall:Message["verifiedWorkspaceCall"];
      let canonicalResponse:DiscoveryResponse|undefined;
      let completedTrace:DiscoveryResponse["runTrace"];
      const effectReceipt=(state:BrowserWorkspaceReceipt["state"],reason?:WorkspaceRejectionReason,target?:PublishedRasterTarget):BrowserWorkspaceReceipt|undefined =>
        effect ? {effectId:effect.effectId,conversationId:session,turnId:attempt.userMessageId,state,
          ...(state==="stale" ? {reason:"workspace-changed" as const} : reason ? {reason} : {}),
          ...(state==="applied" && target ? {observation:{...target,state:"loading" as const,observedAt:Date.now()}} : {})} : undefined;
      const completeWorkspace=async (message:string,extra:Partial<Message>,receipt?:BrowserWorkspaceReceipt)=>{
        const ready=complete(canonicalResponse?.message??message,{answerNotes:canonicalResponse?.answerNotes,answerDelivery:canonicalResponse?.answerDelivery,...extra,
          workspaceEffect:effect,workspaceReceipt:receipt,verifiedWorkspaceCall});
        if(receipt?.observation?.state==="loading")
          watchingRasters.current.set(delivery.id,{receipt,version:serial.current,
            rangeRevision:originalRangeRevision,ready});
        await ready;
        if(receipt)void uploadReceipt(delivery.id,receipt);
      };
      const completeUnavailableWorkspace=()=>{
        const receipt=effectReceipt("failed","local-storage-unavailable");
        return completeWorkspace("浏览器无法核对本轮工作台状态。",{id:delivery.id,replyTo:attempt.userMessageId,
          runTrace:completedTrace??entry.progress.trace,historicalReply:true,
          ...(effect ? {activity:workspaceEffectActivity(delivery.id,effect,"failed",
            canonicalResponse?.message??"本轮工作台操作","本地会话存储不可用，操作未提交。",receipt)} : {}),
        },receipt);
      };
      let keepDelivery=false;
      // A drag, navigation or scope edit invalidates the submitted workspace.
      const workspaceCurrent=()=>{
        const now=latest.current;
        const question = latestQuestion();
        return version===serial.current && (!question || question.id===attempt.userMessageId)
          && researchRevisionReadable && sameResearchRange() && workspaceKey(now)===attempt.workspaceKey;
      };
      const c = caseById(s.caseId);
      const context =
        [c?.title, s.filters.place, s.selection?.grid.label]
          .filter(Boolean)
          .join(" · ") || "全球视图";
      publishChatProgress();
      if (!saved) patch({error:null,chatOpen:true});
      try {
        let acceptedReplyWrite:Promise<void>|undefined;
        const progress = {
          onAccepted:()=>{
            if(!isCurrent() || entry.progress.accepted)return;
            updateProgress({accepted:true,stage:"正在生成回答"});
            workspaceAnchors.current.set(session,run.runId);
            if(!parentRun || !parentInterrupt || !resume)return;
            if(resume.status==="resolved" && !latest.current.messages.some(m=>m.id===run.turnId)){
              const text=decision ? (decision.choice==="original"?"按原问题继续：":"按确认的问题继续：")+decision.dataQuestion : q;
              acceptedReplyWrite=add("user",text,{id:run.turnId,clarificationAnswer:reply,questionDecision:decision,
                attachedScope:decision ? attempt.context.attachedScope : undefined,browserTurnFrame:attempt.context.browserTurnFrame});
            }
            void publishInterrupt(parentRun,{...parentInterrupt,status:resume.status,resumedBy:run.runId});
            onResumeAccepted?.();
          },
          onDraft:(draftText:string)=>{
            if(isCurrent())updateProgress({draftText});
          },
          onSummary:(snapshot:ProviderReasoningSnapshot)=>{
            if(!isCurrent() || entry.progress.cancelling)return;
            const trace=entry.progress.trace;
            updateProgress({trace:{...trace,providerReasoning:[...(trace.providerReasoning ?? []),snapshot]}});
          },
          onWorkspaceEffect:(effect:WorkspaceActionEffect)=>{
            if(!isCurrent() || !advancesWorkspaceActionEffect(originalMapEffect,effect))return;
            originalMapEffect=effect;
            if(mapPage)mapPage.latest=effect;
            const missingPage=effect.status==="waiting" && !mapPage;
            if(!!entry.progress.waitingForOriginalPage!==missingPage)updateProgress({waitingForOriginalPage:missingPage});
            if(!mapPage || !effect.command || effect.status!=="waiting" ||
              mapPage.started.has(effect.effectId) || entry.progress.cancelling)return;
            mapPage.started.add(effect.effectId);
            updateProgress({stage:effect.kind==="flight"?"等待实际飞行到达":"等待目录标注实际绘制"});
            void refreshResearchRange().then(()=>isCurrent() && !entry.progress.cancelling &&
              originalMapEffect?.effectId===effect.effectId && originalMapEffect.status==="waiting"
              ? executePageMapEffect(effect,mapPage.token,researchRevisionReadable || effect.kind==="flight"
                ? mapPage.submission : {...mapPage.submission,presentation:-1},controller.signal) : undefined).then(saved=>{
              if(!saved || !isCurrent() || originalMapEffect?.effectId!==saved.effectId ||
                !advancesWorkspaceActionEffect(originalMapEffect,saved))return;
              originalMapEffect=mapPage.latest=saved;
            }).catch(()=>{});
          },
          onResearchProgress:(researchProgress:ResearchProgress)=>{
            const phase=entry.progress.taskLifecycle?.runtimePhase?.phase;
            if(!isCurrent() || entry.progress.cancelling || phase==="cancel-pending" ||
              phase==="complete" || phase==="failed" || phase==="cancelled" ||
              researchProgress.revision<=(entry.progress.researchProgress?.revision ?? 0))return;
            updateProgress({researchProgress});
          },
          onStep:({stage,phase,runtimePhase}:{stage:string;phase:ChatPhase;runtimePhase:NonNullable<TaskLifecycle["runtimePhase"]>})=>{
            const prior=entry.progress.taskLifecycle?.runtimePhase?.phase;
            if(!isCurrent() || entry.progress.cancelling || prior==="cancel-pending" ||
              prior==="complete" || prior==="failed" || prior==="cancelled")return;
            const taskLifecycle=mergeTaskLifecycle(entry.progress.taskLifecycle,{runtimePhase});
            if(entry.progress.stage!==stage || entry.progress.phase!==phase || taskLifecycle!==entry.progress.taskLifecycle)
              updateProgress({stage,phase,taskLifecycle});
          },
          onLifecycle:(facts:TaskLifecycle)=>{
            if(!isCurrent())return;
            const phase=facts.runtimePhase?.phase;
            const update=entry.progress.cancelling && phase!=="complete" && phase!=="failed" && phase!=="cancelled"
              ? {remoteStops:facts.remoteStops} : facts;
            const merged=mergeTaskLifecycle(entry.progress.taskLifecycle,update);
            if(merged!==entry.progress.taskLifecycle)updateProgress({taskLifecycle:merged});
          },
        };
        const readWorkspaceInputs=async (pendingRuns:string[]=[])=>{
          const anchors=[parentRun?.runId,previousTaskId,workspaceAnchors.current.get(session),
            previousChatAnswer(current.messages)?.id,...pendingRuns];
          const prepared=await loadNativeWorkspaceMessages(session,anchors,controller.signal);
          if(prepared.anchor && isCurrent()){
            workspaceAnchors.current.set(session,prepared.anchor);
            for(const {id,receipt} of prepared.receipts)await persistReceiptUpdate(id,receipt);
          }
          return prepared.messages;
        };
        let liveResult: Awaited<ReturnType<typeof submitNativeChat>>;
        if(!saved){
          const toolMessages=await readWorkspaceInputs().catch(()=>{
            throw new ChatResponseError("暂时无法核对原工作台回执，请重新提交。","workspace_receipt_read_failed");
          });
          const deepseekTools=await loadDeepSeekTools(controller.signal);
          await saveChatDelivery(session,delivery,discoveryAccessKey).catch(()=>{
            patch({sessionError:sessionFailure});
            throw new ChatResponseError("浏览器无法保存本轮编号。","local_storage_unavailable");
          });
          if(!isCurrent())return;
          try {
            liveResult=await submitNativeChat(run,q,{...submission,deepseekTools,...discoveryInput},transport,progress,resume,toolMessages,pageToken);
          } catch(error) {
            if(!transport.signal.aborted || !isCurrent())throw error;
          }
        }
        if(liveResult && "workspaceConflict" in liveResult){
          await readWorkspaceInputs(liveResult.pendingRuns).catch(()=>undefined);
          throw new ChatResponseError("工作台工具回执已变化，本轮未受理。请重新提交。","workspace_tool_results_required");
        }
        const conflict=liveResult && "conflict" in liveResult ? liveResult : undefined;
        if(parentRun && (!liveResult || conflict) && isCurrent() && !entry.progress.cancelling){
          updateProgress({stage:"正在核对原追问的回复"});
          const claim=await readNativeInterrupt(parentRun,controller.signal,parentInterrupt?.kind).catch(error=>{
            if(conflict)throw error;
            return undefined;
          });
          if(!isCurrent())return;
          if(claim){
            await publishInterrupt(parentRun,claim);
            const claimed=claim.status==="resolved" || (claim.kind==="question-check" && claim.status==="cancelled" && claim.resumedBy);
            if(claimed && (conflict || claim.resumedBy!==run.runId)){
              if(await recoverClaimed(parentRun,claim,controller.signal,run,conflict?.locationId))onResumeAccepted?.();
              return;
            }
          }
          if(conflict)return;
        }
        if(!liveResult && isCurrent() && !entry.progress.cancelling)updateProgress({stage:"正在读取原任务状态"});
        const result=liveResult && "response" in liveResult ? liveResult : await recoverNativeChat(run,controller.signal,progress,pageToken);
        await acceptedReplyWrite;
        if (!isCurrent()) return;
        const {response,interrupt,record}=result;
        const archivedProgress=readResearchProgress(record?.researchProgress,run.runId);
        if(archivedProgress && archivedProgress.revision>(entry.progress.researchProgress?.revision ?? 0))
          entry.progress={...entry.progress,researchProgress:archivedProgress};
        const archivedTrace=record && readArchivedChatTrace(record,{id:run.runId,conversationId:run.threadId,turnId:run.turnId},response.message);
        const liveTrace=entry.progress.trace.providerReasoning?.length ? entry.progress.trace : undefined;
        const runTrace=mergeNativeRunProcess(run.runId,liveTrace,archivedTrace);
        const answerDelivery=record ? archivedAnswerDelivery(record.result,archivedProgress) : response.answerDelivery;
        const archivedReadings=record ? retainedWebReadings(record.result,answerDelivery) : [];
        const answerNotes=response.answerNotes && archivedReadings.length
          ? {...response.answerNotes,webSources:archivedReadings} : response.answerNotes;
        const r={...response,answerDelivery,answerNotes,runTrace};
        canonicalResponse=r;
        hydrateCompletedProcess=!!liveResult && "response" in liveResult && !record;
        if(entry.progress.taskLifecycle?.runtimePhase?.phase==="cancelled"){
          await finishCancellation(r.runTrace);
          return;
        }
        if(entry.progress.taskLifecycle)entry.progress.taskLifecycle=mergeTaskLifecycle(
          entry.progress.taskLifecycle,{runtimePhase:{phase:"complete"}});
        completedTrace=r.runTrace;
        if(r.paperRecords)registerPapers(r.paperRecords,false);
        if(r.hainaRecords?.length && r.hainaCatalog)registerHaina(r.hainaRecords,r.hainaCatalog.synced,r.hainaCatalog.endpoint,false);
        if(r.workspaceResearchError!==undefined){
          await refreshResearchRange();
          if(isCurrent())await complete(r.message,{id:delivery.id,replyTo:attempt.userMessageId,runTrace:r.runTrace,
            conversationContext:r.conversationContext});
          return;
        }
        if(r.workspaceResearchState!==undefined){
          const observed=attempt.workspaceResearchAction;
          const applied=readWorkspaceResearchState(r.workspaceResearchState,session);
          if(observed && applied?.actionId===observed.actionId && applied.revision===observed.expectedRevision+1){
            publishResearchRange(session,applied);
            channel.current?.postMessage({sessionId:session,researchRange:true});
          }else{
            await refreshResearchRange();
            if(!isCurrent())return;
          }
          await complete(r.message,{id:delivery.id,replyTo:attempt.userMessageId,runTrace:r.runTrace,
            conversationContext:r.conversationContext});
          return;
        }
        if(r.workspaceOperation || r.workspaceAction || r.workspaceLayerOpen)await refreshResearchRange();
        if (!isCurrent())return;
        const questionCheck=interrupt?.kind==="question-check" ? interrupt.questionCheck : r.questionCheck;
        const clarificationPrompt=(interrupt?.kind!=="question-check" ? interrupt?.prompt : undefined) ??
          (validClarificationPrompt(r.clarificationPrompt) ? r.clarificationPrompt : undefined);
        if(interrupt?.kind==="question-check" && interrupt.questionCheck.originalQuestion!==q)
          throw Error("归档问题确认与原提问不符。");
        if(interrupt)markInterrupt(session,delivery.id,interrupt.status==="pending");
        if (questionCheck || clarificationPrompt || r.clarification || interrupt) {
          if (questionCheck) {
            await complete(r.message,{id:delivery.id,replyTo:attempt.userMessageId,runTrace:r.runTrace,
              nativeInterrupt:interrupt,questionCheck:{...questionCheck,attempt},researchRegion:r.researchRegion,researchIntent:r.researchIntent,
              conversationContext:r.conversationContext,conversationEvidence:r.conversationEvidence,conversationAssertionEvidence:r.conversationAssertionEvidence});
          } else {
            await complete(r.message,{id:delivery.id,replyTo:attempt.userMessageId,runTrace:r.runTrace,workspacePending:r.workspacePending,
              clarification:true,clarificationPrompt,nativeInterrupt:interrupt,...(clarificationPrompt && !workspaceCurrent() ? {historicalReply:true} : {}),...(discoveryClarificationResult(r)?{discoveryClarification:true}:{}),
              researchRegion:r.researchRegion,researchIntent:r.researchIntent,conversationContext:r.conversationContext,
              conversationEvidence:r.conversationEvidence,conversationAssertionEvidence:r.conversationAssertionEvidence});
          }
          return;
        }
        const savedMapEffect=readWorkspaceActionEffect(record?.workspaceEffect,run.runId);
        const pageMapEffect=savedMapEffect?.conversationId===session && savedMapEffect.turnId===run.turnId
          ? savedMapEffect : originalMapEffect;
        if(pageMapEffect){
          const presentation=pageMapEffect.receipt?.kind==="catalogue-presentation"
            ? {runId:run.runId,...pageMapEffect.receipt.presentation} : record?.cataloguePresentation;
          const [,{time:_time,...archived}]=archivedChatMessages({
            id:run.runId,conversationId:session,turnId:run.turnId,question:q,created:Date.now(),updated:Date.now(),
            ...record,result:r,cataloguePresentation:presentation,
          },r.runTrace);
          await complete(r.message,{...archived,...(restoring?{historicalReply:true}:{}),taskLifecycle:entry.progress.taskLifecycle});
          if(isCurrent() && latest.current.pendingMapPresentation?.id===run.runId)patch({pendingMapPresentation:null});
          return;
        }
        verifiedWorkspaceCall=restoring ? undefined : result.workspaceCall;
        if(verifiedWorkspaceCall)effect=workspaceEffectFor(r,delivery.id);
        const hasWorkspaceProposal=!!r.workspaceEffect || workspaceActionFields.some(field=>r[field]!==undefined);
        if(hasWorkspaceProposal && !effect){
          const local=await readSessionMessage(session,delivery.id).catch(()=>null);
          if(!isCurrent() || (local && !local.failed))return;
          const saved:ResearchRecord=record ? {...record,result:r} : {id:run.runId,conversationId:session,turnId:run.turnId,
            question:q,created:Date.now(),updated:Date.now(),result:r};
          const [,{time:_time,...archived}]=archivedChatMessages(saved,r.runTrace);
          const archivedTool=record && readWorkspaceToolRecord(record.workspaceTool,delivery.id,r);
          if(archivedTool && !archivedTool.consumedBy && !record!.workspaceReceipt && !local?.workspaceReceipt && !sameResearchRange()){
            const claimed=await claimWorkspaceEffect(session,delivery.id).catch(()=>false);
            if (!isCurrent())return;
            if (claimed) {
              verifiedWorkspaceCall=archivedTool.call;
              effect=workspaceEffectFor(r,delivery.id);
              const receipt=effectReceipt("stale");
              await completeWorkspace(r.message,{...archived,historicalReply:true,
                ...(effect ? {activity:workspaceEffectActivity(delivery.id,effect,"stale",r.message,workspaceReceiptDetail("stale"),receipt)} : {}),
              },receipt);
              return;
            }
          }
          await complete(r.message,{...archived,historicalReply:true,taskLifecycle:entry.progress.taskLifecycle});
          return;
        }
        if(effect){
          const claimed=await claimWorkspaceEffect(session,delivery.id).catch(()=>null);
          if(!isCurrent() || claimed===false)return;
          if(claimed===null){
            await completeUnavailableWorkspace();
            return;
          }
          await refreshResearchRange();
          if(!isCurrent())return;
          if(!researchRevisionReadable){await completeUnavailableWorkspace();return;}
        }
        if(r.workspaceOperation?.kind==="present-catalogue"){
          const owner={runId:delivery.id,conversationId:session,turnId:attempt.userMessageId};
          const batch=boundCatalogueMapBatch(r,owner);
          const [,{time:_time,...archived}]=archivedChatMessages({
            id:owner.runId,conversationId:session,turnId:owner.turnId,question:q,created:Date.now(),updated:Date.now(),result:r,
          },r.runTrace);
          const now=latest.current;
          const stale=!workspaceCurrent();
          const targetKey=availableChatOperations(now,null).get("present-catalogue")?.key;
          const offered=!!targetKey && attempt.context.workspaceView?.operations?.includes("present-catalogue") &&
            attempt.workspaceOperationKeys?.["present-catalogue"]===targetKey;
          const candidates=archived.candidates;
          const applied=!stale && !!offered && !!batch && !!candidates?.ids.length && effect?.fields.includes("workspaceOperation")===true;
          if(applied){
            const target=archived.cataloguePresentationTarget;
            if(target && surfaceReading.current?.()?.catalogueRenderer==="cesium")
              catalogueObserver.start(target,originalRangeRevision);
            activateAnswer({...archived,time:Date.now()},true);
          }
          const receipt=effectReceipt(stale?"stale":applied?"applied":"failed",applied||stale?undefined:"unsupported-action");
          await completeWorkspace(r.message,{...archived,historicalReply:!applied,taskLifecycle:entry.progress.taskLifecycle,
            activity:workspaceEffectActivity(delivery.id,r.workspaceOperation,receipt?.state??"not-applied",r.message,
              applied?"已选中本轮目录批次，实际标注绘制见目录回执。":workspaceReceiptDetail(receipt?.state),receipt),
          },receipt);
          return;
        }
        if(r.workspaceLayerOpen!==undefined){
          const action=r.workspaceLayerOpen;
          const authorized=attempt.context.workspaceView?.publishedLayerActions===true &&
            effect?.fields.includes("workspaceLayerOpen") &&
            r.workspaceAction===undefined && r.workspaceOperation===undefined && validWorkspacePublishedLayerAction(action);
          const selection=authorized && workspaceCurrent()
            ? await resolvePublishedFieldLayer(action,AbortSignal.any([controller.signal,AbortSignal.timeout(10000)])).catch(()=>undefined)
            : undefined;
          if(selection)await refreshResearchRange();
          if(!isCurrent())return;
          if(!researchRevisionReadable){await completeUnavailableWorkspace();return;}
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
          if (!stale && operation && "ids" in operation) {
            const {ids,kind}=operation;
            const candidateKey=attempt.workspaceCandidateKey;
            stale=!!candidateKey && candidateKey!==chatCandidateKey(batch);
            if (batch && !stale && candidateKey && workspaceCandidateOperationAllowed(original?.candidateItems,kind,ids)) {
              try {
                if (ids.some(id=>!assetById.has(id))) await loadRemoteAssetIds(ids);
                await refreshResearchRange();
                if (!isCurrent()) return;
                if(!researchRevisionReadable){await completeUnavailableWorkspace();return;}
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
          } else if (!stale && target) {
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
          const allowed = workspaceViewActionAllowed(original, action, isPublishedChoice)
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
        if(r.flightCatalogue&&r.fly&&r.camera&&effect){
          const flightId=delivery.id,flight={id:flightId,camera:r.camera,kind:"catalogue" as const,label:r.placeLabel};
          const hasAuthority=()=>isCurrent()&&serial.current===version&&sameResearchRange()&&
            latestQuestion()?.id===attempt.userMessageId&&latest.current.view==="earth";
          const waitForFlight=()=>new Promise<FlightMapReceipt>(resolve=>{
            const timeout=AbortSignal.any([controller.signal,AbortSignal.timeout(8000)]);
            const done=(receipt:FlightMapReceipt)=>{
              catalogueFlights.current.delete(flightId);
              timeout.removeEventListener("abort",lost);
              resolve(receipt);
            };
            const lost=()=>done({state:controller.signal.aborted?"cancelled":"ground-unavailable",observedAt:Date.now()});
            if(timeout.aborted){lost();return;}
            timeout.addEventListener("abort",lost,{once:true});
            catalogueFlights.current.set(flightId,done);
            patch({flight});
          });
          const stale=()=>({state:"superseded" as const,observedAt:Date.now()});
          let arrival:FlightMapReceipt=workspaceCurrent()?await waitForFlight():stale();
          let scope:ScopeItem|undefined;
          if(arrival.state==="arrived"){
            if(!hasAuthority())arrival=stale();
            else try{
              const ground=arrival.ground;
              const timeout=AbortSignal.any([controller.signal,AbortSignal.timeout(5000)]);
              const response=await fetch("/api/coverage/revision",{signal:timeout,cache:"no-store"});
              const revision=response.ok?(await response.json()).revision:undefined;
              if(typeof revision!=="string"||!/^[a-f0-9]{64}$/.test(revision))throw Error("覆盖版本暂不可查。");
              if(!hasAuthority())arrival=stale();
              else{
                const selection={id:ground.id,point:ground.point,grid:gridSpec("h3",ground.level)};
                const {filters}=latest.current;
                const bound=await attachCoverageScope(filters,null,selection,revision,timeout);
                if(hasAuthority())await waitForBoundCoverage(bound.coverageScope,bound.selection,timeout);
                if(hasAuthority())scope={kind:"grid",place:r.placeLabel||"飞行到达后的中心地面网格",...bound};
                else arrival=stale();
              }
            }catch{arrival=hasAuthority()?{state:"coverage-unavailable",observedAt:Date.now()}:stale();}
          }
          if(latest.current.flight?.id===flightId)patch({flight:null});
          const state=arrival.state==="arrived"?"applied":arrival.state==="superseded"?"stale":"failed";
          const receipt={...effectReceipt(state)!,flight:arrival};
          const detail=arrival.state==="arrived"?"飞行已完成，已读取实际中心地面网格。"
            :arrival.state==="cancelled"?"飞行已取消，未查目录。"
            :arrival.state==="superseded"?"工作台或视图已变化，未查目录。"
            :arrival.state==="coverage-unavailable"?"飞行已完成，覆盖修订未能核对，未查目录。"
            :"无法核对到达后的实际地面范围，未查目录。";
          await completeWorkspace(detail,{id:delivery.id,replyTo:attempt.userMessageId,
            activity:workspaceEffectActivity(delivery.id,effect,state,r.message,detail,receipt),
            runTrace:r.runTrace,...(state==="stale"?{historicalReply:true}:{})},receipt);
          if(!scope||arrival.state!=="arrived"||!hasAuthority())return;
          const stored=await uploadReceipt(delivery.id,receipt);
          if(stored?.flight?.state!=="arrived"||!hasAuthority()){
            if(isCurrent())patch({error:"原飞行回执未能核对或视图已变化，未查目录。"});
            return;
          }
          const now=latest.current,turnId=randomId();
          const {workspaceView,browserTurnFrame,...snapshot}=chatRequestSnapshot(now,null,delivery.id);
          const next:DiscoveryAttempt={...snapshot,view:now.view,userMessageId:turnId,query:flightCatalogueFollowUp,
            context:structuredClone({...scopedQuestionContext([scope],null),workspaceView,browserTurnFrame,flightParentRunId:delivery.id})};
          void add("user",next.query,{id:turnId,attachedScope:[scope],browserTurnFrame});
          await runDiscovery(next,false);
          return;
        }
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
              next.error="当前条件下没有可预览的对应材料，可查看资料速览中的获取入口。";
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
        if (catalogBatchResult && effect?.fields.includes("catalogQuery") && !viewOnly) Object.assign(next, {
          view: "earth", overview: "catalog", caseId: null, dataView: null, visualization: null,
          selection: catalogBatchResult.selection, layer: "all", camera: catalogBatchResult.camera, filters: catalogBatchResult.filters,
          mapResult: catalogBatchResult, search: {...emptySearch, result: catalogBatchResult}, inspector: null, evidence: null,
          listLibraryOpen: false, citation: null, origin: null,
        });
        if(effect || r.resultBatch || r.catalogMatch || r.modelIds?.length || r.gap?.dataSupport)await refreshResearchRange();
        if (!isCurrent()) return;
        if(effect && !researchRevisionReadable){await completeUnavailableWorkspace();return;}
        if (next.visualization || next.dataView)
          next.origin = s.origin || remember(s);
        if (s.visualization && r.visualization === null && s.origin)
          Object.assign(next, s.origin, { origin: null, evidence: null });
        const historicalReply = restoring || !workspaceCurrent();
        const effective = { ...s, ...next };
        const authoritativeGrid=r.gridCoverage?.status==="ready" ? r.gridCoverage.summary : undefined;
        const modelBatch: CandidateSet | undefined = r.modelIds?.length ? {
          title:q, ids:r.modelIds, caseId:authoritativeGrid ? authoritativeGrid.caseId : r.caseId ?? s.caseId,
          filters:answerFilters(authoritativeGrid?.filters ?? s.filters,r.filters),
          camera:r.camera ?? s.camera, selection:r.clearSelection ? null : authoritativeGrid?.selection ?? s.selection,
          gridSystem:authoritativeGrid?.selection?.grid.system ?? s.gridSystem,
          layer:authoritativeGrid?.layer ?? r.layer ?? s.layer, originKind:"chat"
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
          if(catalogBatchResult && effect?.fields.includes("catalogQuery") && !viewOnly){
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
        // A view mutation must not relabel the previous research result as a fresh batch.
        if(viewOnly && Object.hasOwn(next,"caseId") && !Object.hasOwn(next,"mapResult"))next.mapResult=s.mapResult;
        const receipt=effectReceipt(historicalReply?"stale":effect && !submitsWorkspaceFields(r,effect,next,s)?"failed":"applied");
        if (effect && !historicalReply && receipt?.state!=="failed") patch(next);
        const message=receipt?.state==="failed" ? next.error || "当前工作台无法应用这项操作。"
          : receipt?.state==="stale" ? "工作台已变化，本轮操作未应用。" : r.message;
        await completeWorkspace(message, {
          id: delivery.id,
          cataloguePresentationTarget:recommendations&&!effect?
            cataloguePresentationTarget(r,{runId:delivery.id,conversationId:session,turnId:attempt.userMessageId}):undefined,
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
                      (liveResult ? "POST " + nativeAgUiPath : "读取原任务 " + delivery.id) +
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
                    request: {...run,message:q,...(liveResult ? {submission} : {})},
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
        const rangeSubmissionError=error instanceof ChatResponseError && error.code?.startsWith("WORKSPACE_");
        if(rangeSubmissionError)await refreshResearchRange();
        if(!isCurrent())return;
        const workspaceSubmissionError=error instanceof ChatResponseError &&
          (rangeSubmissionError || error.code==="workspace_tool_results_required" || error.code==="workspace_receipt_read_failed");
        if(attempt.nativeResume && !entry.progress.accepted){
          keepDelivery=!(error instanceof ChatResponseError);
          patch({error:workspaceSubmissionError ? error.message : "暂时无法确认这次追问回复。请查看原追问状态。"});
          return;
        }
        if(effect){
          if(!researchRevisionReadable){await completeUnavailableWorkspace();return;}
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
        const mayRetry=!rangeSubmissionError && (!clarificationAttempt || keepDelivery) && (!discoveryInput || keepDelivery);
        const message=workspaceSubmissionError ? error.message : discoveryInput && !keepDelivery
          ? error instanceof ChatResponseError && (error.code?.startsWith("DISCOVERY_") || error.code==="RUN_ID_CONFLICT")
            ? error.message : "这次资料请求没有完成。可以核对资料和研究状态后再提交。"
          : clarificationAttempt
          ? (keepDelivery ? "与原追问的回复暂时断开，可以重新连接。" : "这次追问的回复未能完成。")
          : error instanceof ChatResponseError && error.code==="invalid_answer_references"
            ? "这次回答的资料引用未通过核对，可按原条件重试。"
            : error instanceof ChatResponseError && error.code==="answer_prefix_mismatch"
              ? "终稿与已收到的正文不一致，本轮未提交回答。"
              : keepDelivery
              ? "暂时无法读取原任务，可按本轮编号重新查询。"
              : "这次请求没有完成，可按此轮原始条件重试。";
        await complete(message, {
          runTrace:error instanceof ChatResponseError ? error.runTrace || entry.progress.trace : entry.progress.trace,
          id:delivery.id,failed:true,...(mayRetry?{retry:attempt}:{}),replyTo:attempt.userMessageId,
        });
      } finally {
        if (isCurrent()) {
          closeProgress();
          if(!keepDelivery)mapEffectPages.current.delete(run.runId);
          if(clarificationAttempt && !keepDelivery)rememberClarificationDelivery(delivery.id);
          if (!keepDelivery && !failedMessages.current.has(delivery.id))
            await removeChatDelivery(session, delivery.id).catch(() => {
              if (latest.current.sessionId===session) patch({sessionError:sessionFailure});
            });
        }
      }
    },
    [add, activateAnswer, catalogueObserver, executePageMapEffect, inspectAsset, leaveDetail, patch, publishChatProgress,publishResearchRange,readWorkspaceSurface,uploadReceipt,rememberClarificationDelivery,openFieldLayer,chatRequestSnapshot,persistReceiptUpdate,publishInterrupt,recoverClaimed,markInterrupt,hydrateRunProcess],
  );
  const attachScope=(...items:ScopeItem[])=>{
    const current=latest.current;
    const previous=current.draftScope || [];
    if (items.some(item=>item.kind==="time") && !items.some(item=>item.kind==="grid") &&
        previous.some(item=>item.kind==="grid" && item.coverageScope?.summary)) {
      patch({error:"已附加范围包含原时段。要改用其他时段，请重新附加地图范围。"});
      return;
    }
    const merged=mergeScope(previous,items);
    if(merged.length+(current.researchRange && !hasExplicitTurnRange(merged) ? 1 : 0)>10){patch({error:"一次最多引用 10 个对象，请先移除一项。"});return;}
    patch({draftScope:merged,chatOpen:true,inspector:null,evidence:null});
  };
  const confirmingQuestions=useRef(new Set<string>());
  const confirmQuestion=useCallback(async (messageId:string,choice:QuestionDecision["choice"]|"abandon",edited?:string)=>{
    const current=latest.current;
    const message=current.messages.find(m=>m.id===messageId);
    const interrupt=message?.nativeInterrupt;
    const key=current.sessionId+"/"+messageId;
    if(interrupt?.kind!=="question-check" || interrupt.status!=="pending" || !message?.replyTo ||
      !verifiedInterrupts.has(key) || confirmingQuestions.current.has(key))return false;
    confirmingQuestions.current.add(key);
    const parent={threadId:current.sessionId,runId:messageId,turnId:message.replyTo};
    const signal=AbortSignal.timeout(15000);
    try{
      const claim=await readNativeInterrupt(parent,signal,"question-check");
      if(latest.current.sessionId!==parent.threadId || claim.kind!=="question-check")return false;
      await publishInterrupt(parent,claim);
      if(claim.status!=="pending")return await recoverClaimed(parent,claim,signal);
      const check=claim.questionCheck;
      if(check.originalQuestion!==interrupt.questionCheck.originalQuestion ||
        check.proposedQuestion!==interrupt.questionCheck.proposedQuestion)return false;
      if(choice==="edited" && edited?.includes("\0"))return false;
      const decision=choice==="abandon" ? undefined : makeQuestionDecision(check,messageId,choice,edited);
      const now=latest.current;
      if(now.sessionId!==parent.threadId)return false;
      const original=message.questionCheck?.attempt?.context ?? scopedQuestionContext([],null);
      const {workspaceView,browserTurnFrame,...snapshot}=chatRequestSnapshot(now,chatCandidateBatch(now),messageId);
      const attempt:DiscoveryAttempt={...snapshot,query:check.originalQuestion,userMessageId:randomId(),view:now.view,
        context:structuredClone({...original,workspaceView,browserTurnFrame}),nativeResume:true,
        ...(decision ? {questionDecision:decision} : {abandonedQuestionCheckId:messageId})};
      return await new Promise<boolean>(resolve=>{
        void executeDiscovery(attempt,false,undefined,false,()=>resolve(true),undefined,claim).then(()=>resolve(false),()=>resolve(false));
      });
    }catch{
      return false;
    }finally{
      confirmingQuestions.current.delete(key);
    }
  },[chatRequestSnapshot,executeDiscovery,publishInterrupt,recoverClaimed,verifiedInterrupts]);
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
        if(delivery.discoveryAccessKey)await saveChatDelivery(session,delivery);
        const answer = latest.current.messages.find(m => m.id === delivery.id);
        if (answer && !answer.failed) {
          await removeChatDelivery(session, delivery.id);
        } else {
          void executeDiscovery(delivery.attempt, true, delivery, true);
        }
      }
    }
    void restore().catch(() => { if (active) patch({sessionError:sessionFailure}); });
    return () => { active = false; };
  }, [state.sessionId, executeDiscovery, patch]);
  useEffect(()=>{
    const controller=new AbortController();
    const threadId=state.sessionId;
    const refreshInterrupts=()=>{
      const refreshing=new Set<string>();
      for(const message of latest.current.messages){
        const interrupt=message.nativeInterrupt;
        if(!interrupt || !message.replyTo)continue;
        const missingReply=interrupt.status==="resolved" &&
          !latest.current.messages.some(m=>m.id===interrupt.resumedBy && !m.failed);
        if(interrupt.status!=="pending" && !missingReply)continue;
        const parent={threadId,runId:message.id,turnId:message.replyTo};
        refreshing.add(message.id);
        void readNativeInterrupt(parent,controller.signal,interrupt.kind,record=>{
          if(needsArchivedRunProcess(message.id,message.runTrace) && message.taskLifecycle?.runtimePhase?.phase==="complete")
            void hydrateRunProcess(parent,message.text,record);
        }).then(async claim=>{
          if(controller.signal.aborted || latest.current.sessionId!==threadId)return;
          await publishInterrupt(parent,claim);
          if(claim.status==="resolved")await recoverClaimed(parent,claim,controller.signal);
        }).catch(()=>{/* The next reconnect can recheck the archived card. */});
      }
      return refreshing;
    };
    const refreshing=refreshInterrupts();
    // Pending cards already read their archives to revalidate the reply action.
    const last=latest.current.messages.filter(message=>message.role==="assistant" && message.chatMessage &&
      !message.failed && message.taskLifecycle?.runtimePhase?.phase==="complete").at(-1);
    if(last?.replyTo && needsArchivedRunProcess(last.id,last.runTrace) && researchRecordId.test(last.id) && !refreshing.has(last.id))
      void hydrateRunProcess({runId:last.id,threadId,turnId:last.replyTo},last.text);
    window.addEventListener("online",refreshInterrupts);
    return ()=>{
      window.removeEventListener("online",refreshInterrupts);
      controller.abort();
    };
  },[state.sessionId,publishInterrupt,recoverClaimed,hydrateRunProcess]);
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
  const answerClarification=useCallback(async (draft:ClarificationAnswer)=>{
    const s=latest.current;
    const key=s.sessionId+"/"+draft.parentTaskId;
    const parent=s.messages.find(m=>m.id===draft.parentTaskId);
    if(answeringClarifications.current.has(key) || !verifiedInterrupts.has(key) ||
      parent?.nativeInterrupt?.status!=="pending" || parent.nativeInterrupt.kind==="question-check" || !parent.replyTo)return false;
    answeringClarifications.current.add(key);
    const run={threadId:s.sessionId,runId:parent.id,turnId:parent.replyTo};
    const signal=AbortSignal.timeout(15000);
    try{
      const claim=await readNativeInterrupt(run,signal);
      if(latest.current.sessionId!==run.threadId || claim.kind==="question-check")return false;
      await publishInterrupt(run,claim);
      if(claim.status!=="pending")return await recoverClaimed(run,claim,signal);
      const reply={...draft,...(draft.text?{text:draft.text.trim()}:{})};
      const query=clarificationAnswerText(claim.prompt,reply);
      if(!query)return false;
      const now=latest.current;
      if(now.sessionId!==run.threadId)return false;
      const {workspaceView,browserTurnFrame,...snapshot}=chatRequestSnapshot(now,chatCandidateBatch(now),parent.id);
      const attempt:DiscoveryAttempt={query,userMessageId:randomId(),view:now.view,
        context:structuredClone({...scopedQuestionContext([],null),workspaceView,browserTurnFrame}),
        ...snapshot,clarificationAnswer:reply,nativeResume:true};
      return await new Promise<boolean>(resolve=>{
        void executeDiscovery(attempt,false,undefined,false,()=>resolve(true),undefined,claim).then(()=>resolve(false),()=>resolve(false));
      });
    }catch{
      return false;
    }finally{
      answeringClarifications.current.delete(key);
    }
  },[chatRequestSnapshot,executeDiscovery,publishInterrupt,recoverClaimed,verifiedInterrupts]);

  const preparingResearchTurn=useRef(new Set<string>());
  const send = useCallback(async (query:string,onPrepared?:()=>void,discoveryReference?:WorkspaceDiscoveryReference) => {
    const q = query.trim(), s = latest.current;
    if (!q || s.attachingMapScope || preparingResearchTurn.current.has(s.sessionId)) return;
    const discoveryIntent=workspaceDiscoveryIntent(q);
    if(discoveryIntent && discoveryReference){patch({error:"发起新查找前，请移除已选资料引用。"});return;}
    const discoveryTurn=!!(discoveryIntent || discoveryReference);
    const switchId=switchVersion.current;
    const mapEffectSubmission=s.view==="earth" && !discoveryTurn ? {sessionId:s.sessionId,...mapEffectRevisions.current} : undefined;
    const batch=chatCandidateBatch(s);
    const {workspaceView,browserTurnFrame,...snapshot}=chatRequestSnapshot(s,batch);
    const visibleCase=workspaceView.surface==="cases" && workspaceView.case &&
      ["earthquakes","live-lightning"].includes(workspaceView.case.id) ? workspaceView.case : undefined;
    const observationReading=readWorkspaceSurface();
    const observed=observationReading?.surface==="cases"
      ? readCaseObservationRef(observationReading.observation) : undefined;
    const caseObservationRef=observed && visibleCase?.id===caseObservationCase(observed.kind) ? observed : undefined;
    const pickedLayer=observationReading?.surface==="earth"
      ? readLayerObservationRef(observationReading.layerObservation) : undefined;
    const layerObservationRef=pickedLayer && layerObservationMatchesView(pickedLayer,workspaceView)
      ? pickedLayer : undefined;
    const draft=discoveryTurn ? [] : s.draftScope ?? [];
    const focus=s.mapFocus;
    const pinnedCatalogue=focus?.locked && draft.some(item=>item.kind==="reference" &&
      item.messageId===focus.answerId && item.reference.kind==="asset" &&
      item.reference.id===focus.assetId && item.reference.evidenceLevel==="catalogue-record");
    const adopt=!discoveryTurn && authorizesResearchRangeAdoption(q),clear=!discoveryTurn && authorizesResearchRangeClear(q);
    let authority=s;
    let workspaceResearchAction:WorkspaceResearchObservation|undefined;
    if(adopt || clear || (!discoveryReference && s.researchRangeActionId===undefined)){
      preparingResearchTurn.current.add(s.sessionId);
      try {
        const [confirmed,range]=await Promise.all([
          s.researchRangeActionId===undefined ? loadWorkspaceResearchState(s.sessionId).catch(()=>undefined) : undefined,
          adopt ? currentResearchRangeInput(s,AbortSignal.timeout(10000),selectedCoverageRevision(s,observationReading)) : undefined,
        ]);
        if(confirmed){
          publishResearchRange(s.sessionId,confirmed);
          authority=withWorkspaceResearchState(s,confirmed);
        }
        if(latest.current.sessionId!==s.sessionId || switchVersion.current!==switchId)return;
        if(adopt || clear){
          if(authority.researchRangeActionId===undefined)throw Error("暂时无法核对会话研究范围，请重试。");
          if(clear && !authority.researchRange)throw Error("当前会话没有已采用的研究范围。");
          workspaceResearchAction={actionId:randomId(),expectedRevision:authority.researchRangeRevision,...(range?{range}:{})};
        }
        if(discoveryIntent && authority.researchRangeActionId===undefined)
          throw Error("暂时无法核对会话研究状态，请重试。");
      } catch(error) {
        if(latest.current.sessionId===s.sessionId && switchVersion.current===switchId)
          patch({error:error instanceof Error && !["TimeoutError","TypeError"].includes(error.name)
            ? error.message : "暂时无法核对研究范围，请重试。"});
        return;
      } finally {
        preparingResearchTurn.current.delete(s.sessionId);
      }
    }
    const boundRange=!discoveryTurn && !workspaceResearchAction && !hasExplicitTurnRange(draft) && !pinnedCatalogue &&
      authority.researchRangeActionId ? authority.researchRange : null;
    const items=boundRange ? mergeScope(draft,[boundRange.scope]) : draft;
    if(items.length>10){patch({error:"一次最多引用 10 个对象，请先移除一项。"});return;}
    const turnId = randomId();
    const citation = !discoveryTurn && s.citation ? (({excerpt,...reference})=>reference)(s.citation) : null;
    const activeObservations = s.view==="discover" ? initialAccessSection(s.search)==="timely"
      : s.view==="earth" && (s.filters.source==="constellation" || batch?.filters.source==="constellation");
    const observationBatch = activeObservations && batch && (batch.filters.source==="constellation" || s.view==="discover")
      && batch.ids.every(id=>/^constellation:[a-f0-9]{64}$/.test(id)) ? batch : null;
    const ids = batch?.ids || [];
    const filters = s.view==="discover" && batch ? {...s.filters,source:batch.filters.source,type:batch.filters.type} : s.filters;
    const context = draft.length ? scopedQuestionContext(draft,citation)
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
      view:s.view,context:structuredClone({...context,workspaceView,browserTurnFrame,
        ...(caseObservationRef ? {caseObservationRef} : {}),
        ...(layerObservationRef ? {layerObservationRef} : {})}),...snapshot,
      researchRangeRevision:authority.researchRangeRevision,workspaceResearchAction,
      ...(boundRange && authority.researchRangeActionId ? {workspaceResearch:{
        revision:authority.researchRangeRevision,actionId:authority.researchRangeActionId,
      }} : {})};
    const range=items.map(readResearchRangeScope).find(Boolean);
    void add("user",q,{id:turnId,attachedScope:items,browserTurnFrame,
      context:(visibleCase ? [visibleCase.title,caseObservationRef?.id] : range ? [range.place,range.selection.grid.label] :
        [caseById(s.caseId)?.title,s.filters.place,s.selection?.grid.label]).filter(Boolean).join(" · ") || "全球视图",
      ...(!discoveryTurn && s.citation?{citation:s.citation}:{})});
    const now=latest.current;
    patch({...(!discoveryTurn && now.draftScope===s.draftScope ? {draftScope:null} : {}),
      ...(!discoveryTurn && now.citation===s.citation ? {citation:null} : {}),unansweredQuestionId:null,error:null});
    const discoveryInput:ChatDiscoveryInput|undefined=discoveryIntent
      ? {discoveryAction:{...newWorkspaceDiscoveryHandle(),expectedRevision:authority.researchRangeRevision}}
      : discoveryReference ? {discoveryReference} : undefined;
    onPrepared?.();
    await executeDiscovery(attempt,false,undefined,false,undefined,mapEffectSubmission,undefined,discoveryInput);
  },[add,chatRequestSnapshot,executeDiscovery,patch,publishResearchRange,readWorkspaceSurface]);
  const retry = useCallback(async (attempt:DiscoveryAttempt, id:string) => {
    const initial=latest.current,session=initial.sessionId;
    const key=attempt.context.browserTurnFrame
      ? frozenWorkspaceKey(initial,readWorkspaceSurface()) : requestWorkspaceKey(initial);
    const canApply=initial.view==="earth" && key===attempt.workspaceKey &&
      initial.researchRangeRevision===(attempt.researchRangeRevision??0);
    const target=attempt.context.workspaceView?.surface==="earth"
      ? {sessionId:session,...(canApply ? mapEffectRevisions.current : {navigation:-1,presentation:-1})} : undefined;
    try {
      const saved=clarificationDeliveries.current.get(id) ?? (await unfinishedChatDeliveries(session)).find(item=>item.id===id);
      const current=latest.current;
      if(current.sessionId!==session || current.messages.some(message=>message.id===id && !message.failed))return;
      // A new task ID would compete with the original parent's one recorded reply.
      if(isClarificationAttempt(attempt) && !saved)return;
      await executeDiscovery(attempt,true,saved,false,undefined,target);
    } catch {
      if (latest.current.sessionId===session) patch({sessionError:sessionFailure});
    }
  },[executeDiscovery,patch,readWorkspaceSurface]);
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
    refreshWorkspaceResearchRevision,
    sessionSummaries,
    resultLink,
    patch,
    add,
    send,
    attachScope,adoptCurrentResearchRange,clearResearchRange,adoptLegacyResearchRange,adoptArchivedResearchRange,confirmQuestion,answerClarification,cancelChat,
    registerWorkspaceSurface, registerWorkspacePanel, noteManualNavigation, reportGlobeCamera, observePublishedRasters, observeCatalogueFrame, settleCatalogueFlight,cancelCatalogueFlight,
    retry,recoverableClarifications,verifiedInterrupts,claimedReplyTerminals,
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
