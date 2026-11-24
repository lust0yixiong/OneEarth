import {validWorkspaceViewContext,type WorkspaceViewContext} from "./workspace-view-context";

// Browser observations are separate from server-owned execution evidence.
export type TurnRelation = {
  taskId: string;
  turnId?: string;
  relation: "reply" | "reference" | "visible-batch" | "in-flight" | "workspace-action" | "recent-outcome";
};

export type BrowserBatchRef = {
  /** Local browse identity, separate from a stored execution batch. */
  localBatchId?: string;
  batchId?: string;
  answerId?: string;
  title: string;
  visibleIds: string[];
  origin: "research" | "catalogue" | "workspace" | "unknown";
  expanded?: boolean;
};

export type BrowserTurnFrame = {
  version: 1;
  capturedAt?: number;
  batch?: BrowserBatchRef;
  related?: TurnRelation[];
  globe?: {
    layers: {id: string; label: string; visible: boolean; selection?: string; presentation?: BrowserLayerPresentation}[];
    focusId: string | null;
  };
  panels?: ("chat" | "inspector" | "evidence" | "research-lists" | "layer-menu")[];
};

export type BatchChannel = {
  source: string;
  status: "done" | "partial" | "failed" | "not_requested" | "unavailable";
  count?: number;
};

export type ResultBatch = {
  batchId: string;
  conversationId: string;
  turnId: string;
  taskId: string;
  kind: "research" | "catalogue";
  status: "complete" | "partial" | "failed";
  query: string;
  conditions?: string[];
  channels: BatchChannel[];
  itemIds: string[];
};

export type WorkspaceEffect = {
  effectId: string;
  state: "proposed";
  fields: string[];
};

export type BrowserLayerPresentation = {
  valueId: string;
  publicationRevision: string;
  state: "loading" | "rendered" | "load-failed";
  observedAt: number;
};

export type WorkspaceObservation = Omit<BrowserLayerPresentation,"state"> & {
  datasetId: string;
  state: BrowserLayerPresentation["state"] | "superseded";
};

export type WorkspaceRejectionReason = "workspace-changed" | "publication-unverified" | "unsupported-action" | "local-storage-unavailable";
export type BrowserWorkspaceReceipt = {
  effectId: string;
  conversationId: string;
  turnId: string;
  state: "applied" | "stale" | "failed";
  reason?: WorkspaceRejectionReason;
  observation?: WorkspaceObservation;
};

export type WorkspaceRecoveryAdvice = {message:string;nextStep:"explain"|"ask-confirmation"|"unavailable"};

export type WorkspaceReceipt = BrowserWorkspaceReceipt & {
  taskId: string;
  reportedAt: number;
  observationReportedAt?: number;
  recovery?: {state:"running"|"complete"|"failed";observedAt:number} & Partial<WorkspaceRecoveryAdvice>;
};

export type WorkspaceRecoveryInput = Pick<BrowserWorkspaceReceipt,"effectId"|"conversationId"|"turnId"> & {
  workspaceView: WorkspaceViewContext;
  browserTurnFrame: BrowserTurnFrame & {capturedAt:number};
};

function effectIdentity(value: Record<string,unknown>) {
  return typeof value.effectId==="string" && value.effectId.startsWith("workspace:") &&
    uuid(value.effectId.slice("workspace:".length)) && uuid(value.conversationId) && uuid(value.turnId);
}

export function validBrowserWorkspaceReceipt(value: unknown): value is BrowserWorkspaceReceipt {
  if(!object(value)||!keys(value,["effectId","conversationId","turnId","state","reason","observation"])||!effectIdentity(value))return false;
  const {state,reason,observation}=value;
  if(state==="applied")return reason===undefined&&(observation===undefined||validWorkspaceObservation(observation));
  if(observation!==undefined)return false;
  if(state==="stale")return reason===undefined||reason==="workspace-changed";
  return state==="failed"&&(reason===undefined||reason==="publication-unverified"||reason==="unsupported-action"||reason==="local-storage-unavailable");
}

export function validWorkspaceRecoveryInput(value: unknown): value is WorkspaceRecoveryInput {
  return object(value)&&keys(value,["effectId","conversationId","turnId","workspaceView","browserTurnFrame"])&&
    effectIdentity(value)&&validWorkspaceViewContext(value.workspaceView)&&validBrowserTurnFrame(value.browserTurnFrame)&&
    timestamp(value.browserTurnFrame.capturedAt);
}

const uuid = (value: unknown): value is string => typeof value==="string" &&
  /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const described = (value: unknown,max: number): value is string =>
  typeof value==="string" && value.length>0 && value.length<=max && !/[\u0000-\u001f\u007f]/.test(value);
const identity = (value: unknown): value is string => typeof value==="string" &&
  /^[a-z0-9][a-z0-9:_.-]{0,159}$/i.test(value);
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value==="object" && !Array.isArray(value);
const keys = (value: Record<string, unknown>, expected: string[]) =>
  Object.keys(value).every(key=>expected.includes(key));

const timestamp=(value:unknown):value is number=>typeof value==="number"&&Number.isSafeInteger(value)&&value>0;
const revision=(value:unknown)=>typeof value==="string"&&/^[a-f0-9]{64}$/.test(value);
const presentationState=(value:unknown)=>value==="loading"||value==="rendered"||value==="load-failed";

function validPresentation(value:unknown) {
  return object(value)&&keys(value,["valueId","publicationRevision","state","observedAt"])&&identity(value.valueId)&&
    revision(value.publicationRevision)&&presentationState(value.state)&&timestamp(value.observedAt);
}

export function validWorkspaceObservation(value:unknown): value is WorkspaceObservation {
  return object(value)&&keys(value,["datasetId","valueId","publicationRevision","state","observedAt"])&&
    identity(value.datasetId)&&identity(value.valueId)&&revision(value.publicationRevision)&&
    (presentationState(value.state)||value.state==="superseded")&&timestamp(value.observedAt);
}

export function validBrowserTurnFrame(value: unknown): value is BrowserTurnFrame {
  if(!object(value)||value.version!==1||!keys(value,["version","capturedAt","batch","related","globe","panels"])||
    value.capturedAt!==undefined&&!timestamp(value.capturedAt))return false;
  const {batch,related,globe,panels}=value;
  if(batch!==undefined&&(!object(batch)||!keys(batch,["batchId","localBatchId","answerId","title","visibleIds","origin","expanded"])||
    batch.batchId!==undefined&&!uuid(batch.batchId)||batch.answerId!==undefined&&!uuid(batch.answerId)||
    batch.localBatchId!==undefined&&!uuid(batch.localBatchId)||
    batch.localBatchId!==undefined&&batch.batchId!==undefined||
    batch.expanded!==undefined&&typeof batch.expanded!=="boolean"||
    !described(batch.title,240)||!Array.isArray(batch.visibleIds)||batch.visibleIds.length>32||
    batch.expanded===false&&batch.visibleIds.length!==0||
    !batch.visibleIds.every(identity)||new Set(batch.visibleIds).size!==batch.visibleIds.length||
    typeof batch.origin!=="string"||!["research","catalogue","workspace","unknown"].includes(batch.origin)))return false;
  if(related!==undefined&&(!Array.isArray(related)||related.length>8||related.some(v=>
    !object(v)||!keys(v,["taskId","turnId","relation"])||!uuid(v.taskId)||v.turnId!==undefined&&!uuid(v.turnId)||
    typeof v.relation!=="string"||!["reply","reference","visible-batch","in-flight","workspace-action","recent-outcome"].includes(v.relation))))return false;
  if(globe!==undefined&&(!object(globe)||!keys(globe,["layers","focusId"])||
    globe.focusId!==null&&!identity(globe.focusId)||!Array.isArray(globe.layers)||globe.layers.length>16||
    globe.layers.some(layer=>!object(layer)||!keys(layer,["id","label","visible","selection","presentation"])||
      !identity(layer.id)||!described(layer.label,200)||typeof layer.visible!=="boolean"||
      layer.selection!==undefined&&!described(layer.selection,160)||
      layer.presentation!==undefined&&(!layer.visible||!validPresentation(layer.presentation)))))return false;
  if(panels!==undefined&&(!Array.isArray(panels)||panels.length>5||panels.some(v=>
    typeof v!=="string"||!["chat","inspector","evidence","research-lists","layer-menu"].includes(v))))return false;
  return true;
}
