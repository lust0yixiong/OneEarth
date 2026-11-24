import type {PublishedWorkspaceLayerId} from "./workspace-published-layer";

export type PublishedRasterTarget = {
  datasetId:PublishedWorkspaceLayerId;
  valueId:string;
  publicationRevision:string;
};

export function samePublishedRaster(a:Pick<PublishedRasterTarget,"valueId"|"publicationRevision"> & {datasetId:string} | undefined,
  b:Pick<PublishedRasterTarget,"valueId"|"publicationRevision"> & {datasetId:string} | undefined) {
  return !!a && !!b && a.datasetId===b.datasetId && a.valueId===b.valueId && a.publicationRevision===b.publicationRevision;
}

export type PublishedRasterPresentation=PublishedRasterTarget & {
  state:"loading"|"rendered"|"load-failed";
  observedAt:number;
};

export function workspaceReceiptAdvances(
  previous:import("./turn-context").BrowserWorkspaceReceipt,
  incoming:import("./turn-context").BrowserWorkspaceReceipt,
) {
  if(previous.conversationId!==incoming.conversationId || previous.turnId!==incoming.turnId ||
    previous.effectId!==incoming.effectId || previous.state!==incoming.state || previous.reason!==incoming.reason)return false;
  const a=previous.observation,b=incoming.observation;
  if(a && b && samePublishedRaster(a,b) && a.state==="loading" && b.state!=="loading" && b.observedAt>=a.observedAt)return true;
  if("taskId" in incoming && !("taskId" in previous) &&
    (!a && !b || a && b && samePublishedRaster(a,b) && a.state===b.state && a.observedAt===b.observedAt))return true;
  const old="recovery" in previous ? (previous as import("./turn-context").WorkspaceReceipt).recovery : undefined;
  const next="recovery" in incoming ? (incoming as import("./turn-context").WorkspaceReceipt).recovery : undefined;
  return incoming.reason==="publication-unverified" && !!next &&
    (!old || old.state==="running" && next.state!=="running" && next.observedAt>=old.observedAt);
}
