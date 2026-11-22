import type { CandidateSet, Filters, GridSpec, Selection } from "./types";
import type { Area } from "./product-distribution";

export type CoverageGeometry = {key:string; area:Area};
export type CoverageRequest = {
  grid:GridSpec;
  cells:string[];
  filters:Filters;
  batch?:CandidateSet | null;
};
export type CoverageScopeSummary = {
  filters: Filters;
  selection: Pick<Selection, "id" | "point" | "grid"> | null;
  caseId: CandidateSet["caseId"];
  layer: CandidateSet["layer"];
  metric: NonNullable<CandidateSet["metric"]>;
  candidateCount: number | null;
  candidateIdentity: string | null;
};
export type CoverageResponse = {
  revision: string;
  cells:[string,number][];
  ready:string[];
  pending:number;
  members?:[string,string[]][];
  references?:[string,[string,string[]][]][];
  sourceIds?:[string,string[]][];
  scope?: CoverageScopeSummary;
};
/** Presentation and answer identity do not change spatial membership. */
export function coverageBatchKey(batch?:CandidateSet|null) {
  return batch ? [batch.caseId,[...batch.ids].sort(),batch.selection,batch.layer,batch.metric,batch.sceneKey,batch.lookups] : null;
}
