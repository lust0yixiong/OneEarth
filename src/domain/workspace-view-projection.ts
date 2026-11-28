import type {PublishedRasterPresentation} from "./published-raster-observation";
import type {CaseObservationRef} from "./case-observations";
import type {LayerObservationRef} from "./layer-observations";
import {caseById} from "./catalog";
import {initialAccessSection} from "./data-access";
import {assetById} from "./datasets";
import {datasetLayers, globeCases} from "./regional-cases";
import type {State} from "./store";
import type {Camera, CandidateSet, Filters, Selection, View} from "./types";
import type {WorkspaceViewAction, WorkspaceViewChoice, WorkspaceViewContext, WorkspaceViewPublication} from "./workspace-view-context";

export type WorkspacePanelReading = {
  inspector?: "expanded" | "collapsed";
  evidence?: "docked" | "expanded";
  layerMenu?: boolean;
  researchLists?: boolean;
};

export type WorkspaceSurfaceReading = {
  surface: View;
  observation?: CaseObservationRef;
  layerObservation?: LayerObservationRef;
  catalogueRenderer?: "cesium";
  selectedCoverage?: {selection:Selection;filters:Filters;batch?:CandidateSet|null;revision:string};
  camera?: Camera;
  rasterPresentations?: PublishedRasterPresentation[];
  activeLayer?: WorkspaceViewContext["activeLayer"];
  case?: WorkspaceViewContext["case"];
  focus?: WorkspaceViewContext["focus"];
  candidates?: WorkspaceViewContext["candidates"];
  candidateItems?: WorkspaceViewContext["candidateItems"];
  candidateBatch?: CandidateSet;
  candidateListExpanded?: boolean;
  panels?: WorkspacePanelReading;
  display?: WorkspaceViewContext["display"];
  applyControl?: (action: WorkspaceViewAction) => boolean;
  resolvePublishedChoice?: (publication:WorkspaceViewPublication, valueId:string) => WorkspaceViewChoice | undefined;
};

const clean = (value: string | undefined, max: number) =>
  (value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
const label = (value: string | undefined, max: number) => clean(value, max) || undefined;
const id = (value: string | undefined) =>
  value && /^[a-z0-9][a-z0-9:_.-]{0,159}$/i.test(value) ? value : undefined;

function focus(state: State): WorkspaceViewContext["focus"] {
  const {evidence, inspector, mapFocus} = state;
  if (evidence) {
    const tabIndex = state.readerPosition?.tab ?? Math.max(0, evidence.tabs.findIndex(tab => tab.kind === state.previewKind));
    const tab = evidence.tabs[Math.min(tabIndex, evidence.tabs.length - 1)];
    const position = Math.max(0, state.readerPosition?.page ?? 0);
    const storedPage = tab?.kind === "pdf"
      ? tab.pages?.[Math.min(position, tab.pages.length - 1)]?.number ?? tab.sourcePage ?? evidence.locator?.page
      : evidence.locator?.page;
    return {
      kind: "evidence", id: id(evidence.assetId ?? evidence.id),
      title: label(evidence.title, 240) ?? "打开的依据",
      version: label(evidence.version ?? undefined, 180),
      tab: label(tab?.label, 200),
      page: storedPage && storedPage > 0 && storedPage <= 100000 ? storedPage : undefined,
      locator: label(evidence.locator?.material ?? tab?.kind, 200),
    };
  }
  if (inspector && "comparison" in inspector) {
    return {kind: "comparison", title: label(inspector.comparison.title, 240) ?? "资料对照"};
  }
  if (inspector && "batch" in inspector) {
    return {kind: "batch", title: label(inspector.batch.title, 240) ?? "候选资料"};
  }
  const assetId = inspector && "assetId" in inspector ? inspector.assetId : mapFocus?.assetId;
  if (assetId) {
    const asset = assetById.get(assetId);
    return {kind: "dataset", id: id(assetId), title: label(asset?.title, 240) ?? "当前资料",
      version: label(asset?.version ?? undefined, 180)};
  }
}

export function projectWorkspaceView(state: State, reading?: WorkspaceSurfaceReading): WorkspaceViewContext {
  const visible = reading?.surface === state.view ? reading : undefined;
  const view: WorkspaceViewContext = {version: 1, surface: state.view};
  if (state.view === "earth") {
    const {gridSystem, layer, mesh, selection, filters} = state;
    const {center, zoom} = visible?.camera ?? state.camera;
    view.map = {
      mode: state.overview, camera: {center, zoom}, gridSystem, layer, mesh,
      ...(selection && id(selection.id) && id(selection.grid.key) ? {
        selection: {id: selection.id, gridKey: selection.grid.key, point: selection.point, simulated: !!selection.simulated},
      } : {}),
      filters: {
        type: clean(filters.type, 100), source: clean(filters.source, 100), place: clean(filters.place, 100),
        period: filters.period, utcWindow: filters.utcWindow ?? null, depth: filters.depth, maxDem: filters.maxDem,
      },
    };
  }
  if (state.view === "discover") {
    const {search} = state;
    view.catalogue = {
      section: initialAccessSection(search),
      type: label(search.type, 200), source: label(search.source, 200),
      capability: label(search.capability, 200), page: Math.min(100000, (search.page ?? 0) + 1),
      savedOnly: search.savedOnly,
    };
  }
  const currentCase = state.view === "earth" ? caseById(state.caseId) : undefined;
  view.case = visible?.case ?? (currentCase ? {id: currentCase.id, title: label(currentCase.title, 240) ?? currentCase.id} : undefined);
  view.activeLayer = visible?.activeLayer;
  if (!view.activeLayer && state.view === "earth" && state.fieldLayer) {
    const {id} = state.fieldLayer;
    view.activeLayer = {id, title: globeCases[id].title, datasetId: datasetLayers[id], status: "loading", controls: []};
  }
  view.focus = focus(state) ?? visible?.focus;
  view.display = [...(visible?.display || []),
    ...(state.view === "discover" && label(state.search.query, 240)
      ? [{label: "当前筛选词", value: clean(state.search.query, 240)}] : [])].flatMap(fact => {
    const name = label(fact.label, 80), value = label(fact.value, 240);
    return name && value ? [{label: name, value}] : [];
  }).slice(0, 16);
  if (!view.display.length) delete view.display;
  const scoped = state.inspector && ("batch" in state.inspector ? state.inspector.batch :
    "comparedBatch" in state.inspector ? state.inspector.comparedBatch : undefined);
  const batch = scoped || (state.view === "earth" ? state.mapResult : state.view === "discover" ? state.search.result : null);
  view.candidates = visible?.candidates ?? (batch ? {count: batch.ids.length, title: label(batch.title, 200)} :
    state.view === "discover" && state.search.pageIds ? {count: state.search.pageIds.length, title: "当前页候选"} : undefined);
  return view;
}

/** Labels resolved by background feeds do not change the controls or target of an operation. */
export function workspaceActionState(view: WorkspaceViewContext | undefined) {
  if (!view) return undefined;
  const {display: _display, activeLayer, map, ...focus} = view;
  // The store distinguishes settled navigation from a new manual move.
  const {camera: _camera, ...mapScope} = map || {};
  if (!activeLayer) return JSON.stringify({...focus, map:map ? mapScope : undefined});
  const {display: _layerDisplay, ...controls} = activeLayer;
  return JSON.stringify({...focus, map:map ? mapScope : undefined, activeLayer:controls});
}
