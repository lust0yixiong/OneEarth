import type {CoverageScopeSummary} from "./coverage";

export type GridCoverageScope = {id: string; revision: string};
export type GridCoverageSnapshot = CoverageScopeSummary & {selection:NonNullable<CoverageScopeSummary["selection"]>};

export type GridCoverageEvidence = {
  cellId: string;
  gridKey: string;
  summary?: GridCoverageSnapshot;
} & ({
  status: "ready";
  scopeId: string;
  revision: string;
  count: number;
  members: string[];
  sourceIds: string[];
} | {
  status: "unknown";
  reason: "unavailable" | "pending" | "expired";
  revision?: string;
});
