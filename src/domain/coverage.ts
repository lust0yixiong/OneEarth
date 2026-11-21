import type { CandidateSet, Filters, GridSpec } from "./types";
import type { Area } from "./product-distribution";

export type CoverageGeometry = {key:string; area:Area};
export type CoverageRequest = {
  grid:GridSpec;
  cells:string[];
  filters:Filters;
  batch?:CandidateSet | null;
};
export type CoverageResponse = {
  cells:[string,number][];
  ready:string[];
  pending:number;
  members?:[string,string[]][];
};
/** Presentation and answer identity do not change spatial membership. */
export function coverageBatchKey(batch?:CandidateSet|null) {
  return batch ? [batch.caseId,[...batch.ids].sort(),batch.selection,batch.layer,batch.metric,batch.sceneKey,batch.lookups] : null;
}
