import type { PushFeed } from "./push-observations";
import type { SceneLookup } from "./earth-search";
import type { Geometry } from "geojson";
export type Coordinate = [number, number];
export type GridSystem = "h3" | "s2";
export type View = "earth" | "discover" | "cases";
export type MapLayer = "all" | "verified" | "joint" | "paired";
export interface GridSpec {
  system: GridSystem;
  n: number;
  label: string;
  key: string;
}
export interface Selection {
  id: string;
  grid: GridSpec;
  point: Coordinate;
  simulated?: boolean;
  counts?: number[];
  sampleIds?: number[];
}
export interface Camera {
  center: Coordinate;
  zoom: number;
  reason: string;
}
export interface Filters {
  utcWindow?: [number, number] | null;
  need: number;
  type: string;
  source: string;
  place: string;
  period: [number, number] | null;
  depth: [number, number] | null;
  maxDem: number | null;
}
export interface EvidenceTab {
  kind: "table" | "web" | "pdf" | "text" | "code" | "trace";
  language?: string;
  steps?: { title: string; detail: string }[];
  label: string;
  columns?: string[];
  rows?: unknown[][];
  rowNumbers?: number[];
  version?: string;
  body?: string;
  quote?: string;
  savedWebExcerpt?: {publisherUrl?: string};
  /** Text extracted from this page of a remotely read PDF. */
  sourcePage?: number;
  before?: string;
  after?: string;
  url?: string;
  pages?: { number: number; label: string; image: string; box?: number[] }[];
}
/** Source-level coverage and access for a curated candidate, independent of local observations. */
export interface SourceProfile {
  utcWindow?: [number,number];
  extent?: "world";
  area?: import("geojson").Polygon | import("geojson").MultiPolygon;
  areaBasis?: "bounding-box" | "geometry";
  years?: readonly [number, number | null];
  catalogYears?: readonly [number, number | null];
  role: "data" | "index" | "method" | "request" | "derived";
  spatial: "coverage" | "nonspatial" | "restricted";
  coverage: string;
  access: string;
  limitation: string;
}
export interface CatalogCardInfo {
  thumbnailUrl?: string;
  tags: string[];
  size?: string;
  favorites?: number;
}
export interface DataEntity {label:string;url:string;format:"GeoTIFF"|"Shapefile"}
export interface DataHolding {channelId:string;channelName:string;access:"public"|"restricted"|"workspace"|"unknown"}
export interface PaperSource {
  title:string;
  tabs?:EvidenceTab[];
  url?:string;
  abstract?:string;
}
export interface Need {
  holding?:DataHolding;
  canonicalId?:string;
  paperSource?:PaperSource;
  paperSources?:PaperSource[];
  dataEntities?: DataEntity[];
  card?: CatalogCardInfo;
  profile?: SourceProfile;
  datasetId?: string;
  name: string;
  type: string;
  product: string;
  status: string;
  detail: string;
  url?: string;
  source: string;
  tabs: EvidenceTab[];
}
export interface CaseStudy {
  id: string;
  title: string;
  question: string;
  paper: string;
  region: string;
  needs: Need[];
  gap: string;
  verified: boolean;
  spatial: string;
  clues: string[];
}
export interface SpatialEntry {
  key?: string;
  label: string;
  center: Coordinate;
  need: number;
  origin: string;
  geometry?: Geometry;
  cells?: Record<string, string[]>;
  year?: number;
  date?: string;
  depthRangeM?: number[];
  studyOnly?: boolean;
  object?: string;
  url?: string;
  track?: boolean;
  validatedGroup?: string;
}
export interface SpatialModel {
  pairedEntries?: SpatialEntry[];
  entries: SpatialEntry[];
  area?: Geometry;
  areaNeed?: number;
  areaTitle?: string;
  areaPoints?: Coordinate[];
  track?: Geometry;
  places?: string[][];
  caption: string;
  labels?: SpatialEntry[];
}
export interface EvidenceDocument {
  sourceBatch?: CandidateSet;
  assetId?: string;
  sourceTitle?: string;
  version?: string | null;
  fullSource?: EvidenceDocument;
  locator?: EvidenceLocator;
  attachments?: { label: string; url: string }[];
  id: string;
  title: string;
  scope: string;
  source: string;
  url?: string;
  tabs: EvidenceTab[];
}
export interface Resource {
  holding?:DataHolding;
  canonicalId?:string;
  paperSource?:PaperSource;
  paperSources?:PaperSource[];
  card?: CatalogCardInfo;
  profile?: SourceProfile;
  datasetId: string;
  id: string;
  caseId: string;
  needIndex: number;
  title: string;
  type: string;
  categories: string[];
  status: string;
  fit: string;
  why: string;
  source: string;
  origins: string[];
  url?: string;
  description: string;
}
export interface EvidenceLocator {
  documentId: string;
  documentTitle: string;
  source: string;
  version: string | null;
  material: string;
  kind: EvidenceTab["kind"];
  rows?: number[];
  page?: number;
  lines?: [number, number];
}
export interface Citation {
  locator?: EvidenceLocator;
  excerpt?: EvidenceDocument;
  title: string;
  scope: string;
  url?: string;
  body: string;
}
export interface CandidateSet {
  resultBatch?: import("./turn-context").ResultBatch;
  researchRecord?:import("./research-list").ResearchRecord;
  /** Answer whose evidence is shown on the globe. */
  answerId?: string;
  clusterOverlay?: boolean;
  metric?: "products" | "scenes";
  sceneKey?: string;
  lookups?: SceneLookup[];
  originKind?: "chat" | "research" | "grid" | "catalog";
  catalogConditions?: string[];
  restoredFrom?: string;
  title: string;
  ids: string[];
  caseId: string | null;
  filters: Filters;
  selection: Selection | null;
  layer: MapLayer;
  camera: Camera;
  gridSystem: GridSystem;
}
export interface ResearchAnswer {
  caseId: string;
  intent: "overview" | "coverage" | "access" | "gap" | "role" | "fit";
  rows: { index: number; name: string; detail: string; ids: string[]; references?: string[] }[];
  steps: { title: string; detail: string }[];
}
export type CitationType="data"|"paper"|"web";
/** Acquisition channel is separate from the kind of document returned. */
export type ReferenceChannel="local"|"assertion"|"web";
export type EvidenceStage="search-snippet"|"abstract"|"page-excerpt"|"pdf-excerpt";
/** A name index is not file content. Completeness refers only to the saved names. */
export interface ManifestIndex {names:string[];sourceTotal:number;namesComplete:boolean;contentsRead:false}
export interface WebHit {
  manifestIndex?:ManifestIndex;
  evidenceNotice?:string;
  previousExcerptTruncated?:boolean;
  previousSourceExcerptLength?:number;
  stage?:EvidenceStage;
  sourceTurn?:number;
  discoveredBy?:"assistant"|"user";
  readBy?:"platform"|"user";
  priorEvidence?:ReadEvidence[];
  pageExcerpt?:string;
  previousRead?:boolean;
  readAt?:string;
  referenceType?:CitationType;
  title:string;url:string;snippet:string;
  doi?:string;version?:string;publisher?:string;landingUrl?:string;
  relatedIdentifiers?:Array<{relatedIdentifier:string;relatedIdentifierType:string;relationType:string}>;
  relatedIdentifiersTotal?:number;relatedIdentifiersOmitted?:number;
}
export interface ReadEvidence {
  manifestIndex?:ManifestIndex;
  excerptTruncated?:boolean;
  sourceExcerptLength?:number;
  url:string;title:string;excerpt:string;readAt:string;referenceType?:CitationType;
  stage?:EvidenceStage;sourceTurn?:number;discoveredBy?:"assistant"|"user";readBy?:"platform"|"user";
}
export interface SearchQuery {web:string;dataset:string}
export interface SearchRun {
  engine:"Bing"|"DuckDuckGo"|"DataCite"|"Codex Web"|"DeepSeek Search"|"DeepSeek Fetch"|"原站读取"|"PDF 原文";query:string;status:"running"|"done"|"failed";hits:WebHit[];
  error?:string;warning?:string;requestUrl?:string;total?:number;startedAt?:string;elapsedMs?:number;cacheStoredAt?:string;
}
export type AnswerReference =
  | {kind:"asset"; id:string; title:string; source:string;referenceType?:CitationType;sourceChannel?:ReferenceChannel; evidenceLevel?:"catalogue-record"|"observation-file";
      observationEvidence?:import("./observation-evidence").ObservationEvidence}
  | {kind:"web"; title:string; url:string;referenceType?:CitationType;sourceChannel?:ReferenceChannel};
export interface ToolCall {
  id:string; kind:"Skill"|"MCP"|"tool"; name:string; input:string; output?:string;
  status:"running"|"done"|"partial"|"failed"; error?:string;
}
export interface SearchFinding {
  id:string; source:string; summary:string;
  items:{title:string; detail?:string; assetId?:string; url?:string}[];
}
export interface RunTrace {timings?:{kind:'model-executor';model:string;executor:string;startedAt:number;activeAtStart:number;localQueueMs:number;spawnMs?:number;firstStdoutMs?:number;elapsedMs:number;promptBytes:number;outputBytes:number}[]; findings?:SearchFinding[]; started:number; stages:string[]; calls:ToolCall[]; searches?:SearchRun[]}
export interface AnswerNotes {
  researchNotes?:{id:string;note:string}[];
  references?: AnswerReference[];
  paperTrace?: string;
  searches?:SearchRun[];
  webSources?:WebHit[];
  basis?:string;
  sources: {id:string; reason:string}[];
  limitation: string;
  followUp: string;
  reviewed: number;
  elapsedMs: number;
  executor: string;
}
export type ClarificationReply = {parentTaskId:string};
export interface Message {
  browserTurnFrame?: import("./turn-context").BrowserTurnFrame;
  workspaceEffect?: import("./turn-context").WorkspaceEffect;
  workspaceReceipt?: import("./turn-context").WorkspaceReceipt | import("./turn-context").BrowserWorkspaceReceipt;
  clarificationReply?: ClarificationReply;
  clarificationAnswer?: import("./clarification").ClarificationAnswer;
  clarificationPrompt?: import("./clarification").ClarificationPrompt;
  discoveryClarification?: boolean;
  gridCoverage?: import("./grid-coverage").GridCoverageEvidence;
  researchRegion?:import("./research-region").ResearchRegion|null;
  conversationAssertionEvidence?:import("./assertion-evidence-memory").AssertionEvidenceMemory[];
  researchIntent?:import("./research-intent").ResearchIntent;
  attachedScope?:import("./question-scope").ScopeItem[];
  conversationEvidence?:ReadEvidence[];
  clarification?:boolean;
  conversationContext?:string;
  questionCheck?: QuestionCheck & {attempt:DiscoveryAttempt};
  questionDecision?: QuestionDecision;
  runTrace?:RunTrace;
  answerNotes?: AnswerNotes;
  catalogMatch?: DiscoveryResponse["catalogMatch"];
  dataSupport?: DataSupport;
  research?: ResearchAnswer;
  candidates?: CandidateSet;
  id: string;
  role: "user" | "assistant";
  text: string;
  time: number;
  context?: string;
  citation?: Citation;
  failed?: boolean;
  retry?: DiscoveryAttempt;
  historicalReply?: boolean;
  chatMessage?: boolean;
  workspacePending?: DiscoveryResponse["workspacePending"];
  replyTo?: string;
  activity?: EvidenceDocument;
}
export interface VisualizationState {
  id: "gfs-wind";
  level: "10m" | "250hPa";
  forecastHour: 0 | 6 | 12;
  playing: boolean;
  color: boolean;
}
export interface DiscoveryAttempt {
  clarificationReply?: ClarificationReply;
  clarificationAnswer?: import("./clarification").ClarificationAnswer;
  questionDecision?:QuestionDecision;
  localOnly?:boolean;
  webSearch?:boolean;
  query: string;
  context: DiscoveryContext;
  workspaceKey: string;
  userMessageId: string;
  workspaceOperationKeys?: Partial<Record<import("./workspace-operations").WorkspaceOperationKind,string>>;
  workspaceCandidateKey?: string;
  view?: View;
}
export interface DiscoveryContext {
  browserTurnFrame?: import("./turn-context").BrowserTurnFrame;
  workspaceView?: import("./workspace-view-context").WorkspaceViewContext;
  attachedScope?:import("./question-scope").ScopeItem[];
  inCandidateScope?: boolean;
  observationSource?: boolean;
  observationBatch?: Pick<CandidateSet, "catalogConditions" | "selection"> & Pick<Filters, "period" | "utcWindow">;
  candidateIds?: string[];
  candidateVersions?: Record<string, string>;
  visualization?: VisualizationState | null;
  caseId: string | null;
  filters: Filters;
  gridSystem: GridSystem;
  layer: MapLayer;
  selection: Selection | null;
  camera: Camera;
  citation: Citation | null;
  dataView?: DataView | null;
}
export interface DataSupport {
  candidates: { assetId: string; input: string; title: string; source: string; url: string }[];
  unmatchedInputs: string[];
}
export interface CapabilityGap {
  dataSupport: DataSupport;
  operation: "extraction" | "fulfillment" | "inference" | "computation" | "development" | "workflow";
  status: "insufficient_evidence" | "needs_data" | "cannot_perform_yet";
  referencedInputs: string[];
  missing: string;
  next: string;
  verification: string;
}
export interface DiscoveryResponse {
  resultBatch?: import("./turn-context").ResultBatch;
  workspaceEffect?: import("./turn-context").WorkspaceEffect;
  workspaceAction?: import("./workspace-view-context").WorkspaceViewAction;
  workspaceOperation?: import("./workspace-operations").WorkspaceOperation;
  workspacePending?: {question:string;originalQuestion?:string;proposedAction?:import("./workspace-view-context").WorkspaceViewAction;
    proposalOrigin?:{layerId:string;controlId:string;valueId:string}};
  clarificationPrompt?:import("./clarification").ClarificationPrompt;
  discoveryClarification?: boolean;
  gridCoverage?: import("./grid-coverage").GridCoverageEvidence;
  researchRegion?:import("./research-region").ResearchRegion|null;
  conversationAssertionEvidence?:import("./assertion-evidence-memory").AssertionEvidenceMemory[];
  researchIntent?:import("./research-intent").ResearchIntent;
  conversationEvidence?:ReadEvidence[];
  clarification?:boolean;
  conversationContext?:string;
  questionCheck?:QuestionCheck;
  hainaRecords?:import("./haina-record").HainaRecord[];
  hainaCatalog?:import("./haina-catalog-client").HainaCatalogStatus;
  runTrace?:RunTrace;
  paperRecords?: import("./paper-record").PaperRecord[];
  paperOnly?: boolean;
  answerNotes?: AnswerNotes;
  modelIds?: string[];
  modelExecutor?: "codex" | "claude";
  pushFeed?: PushFeed;
  catalogMatch?: { utcWindow?: [number, number]; selection?: Selection | null; lookups?: SceneLookup[]; ids: string[]; conditions: string[]; rejected: {title: string; url: string}[]; sampleWindow: boolean; period: [number,number] | null };
  gap?: CapabilityGap;
  research?: ResearchAnswer;
  view?: View;
  catalogQuery?: string;
  inspectId?: string;
  visualization?: VisualizationState | null;
  mesh?: boolean;
  message: string;
  caseId?: string | null;
  filters?: Filters;
  gridSystem?: GridSystem;
  layer?: MapLayer;
  camera?: Camera;
  /** Ask the globe to animate to `camera` instead of jumping there. */
  fly?: boolean;
  /** Short place name shown on the globe marker while the flight is visible. */
  placeLabel?: string;
  clearSelection?: boolean;
  previewNeed?: number;
  previewCaseId?: string;
  visualizeNeed?: number;
  dataView?: DataView | null;
  previewKind?: string;
  selectCenter?: boolean;
}
export interface QuestionCheck {
  originalQuestion:string;
  proposedQuestion:string;
}
export interface QuestionDecision {
  checkMessageId:string;
  originalQuestion:string;
  dataQuestion:string;
  choice:"proposed"|"original"|"edited";
}
export type DataView =
  | {
      kind: "ctd";
      stationId: string;
      variable: "temperature" | "salinity";
      depth: number;
    }
  | {
      kind: "front";
      glacier: "Mendenhall" | "Alsek";
      epoch: "first" | "last" | "compare";
    };
