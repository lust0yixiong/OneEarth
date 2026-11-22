import type {GridCoverageEvidence,GridCoverageScope,GridCoverageSnapshot} from "../src/domain/grid-coverage";
import type {Selection} from "../src/domain/types";
import {isBoundCoverageSummary} from "../src/domain/coverage-attachment";

type CoverageQuery = {
  cell: Pick<Selection,"id"|"grid">;
  scope: GridCoverageScope;
};
type CellResponse = {
  revision?: string;
  ready?: string[];
  cells?: [string,number][];
  members?: [string,string[]][];
  sourceIds?: [string,string[]][];
  scope?: Partial<GridCoverageSnapshot>;
};

export function spatialCoverageClient(origin = process.env.ONEEARTH_SPATIAL_URL || "http://127.0.0.1:5276") {
  return async ({cell,scope}: CoverageQuery,signal: AbortSignal): Promise<GridCoverageEvidence> => {
    const cellEvidence = {cellId:cell.id,gridKey:cell.grid.key};
    const deadline = AbortSignal.any([signal,AbortSignal.timeout(2500)]);
    const unknown = (reason: "unavailable" | "pending" | "expired",summary?:GridCoverageSnapshot): GridCoverageEvidence =>
      ({...cellEvidence,status:"unknown",reason,revision:scope.revision,...(summary?{summary}:{})});
    try {
      const response = await fetch(new URL("/api/coverage/cells",origin),{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({id:scope.id,revision:scope.revision,grid:cell.grid,cells:[cell.id],
          includeProducts:true,includeReferences:true,requireSelection:true}),
        signal:deadline,redirect:"error",
      });
      if ([404,409,410].includes(response.status)) return unknown("expired");
      if (!response.ok) return unknown("unavailable");
      const result = await response.json() as CellResponse;
      if (result.revision!==scope.revision) return unknown("expired");
      const summary=result.scope;
      if (!isBoundCoverageSummary(summary,cell.id,cell.grid.key) || !Array.isArray(result.ready)) return unknown("unavailable");
      if (!result.ready.includes(cell.id)) return unknown("pending",summary);
      if (!Array.isArray(result.members) || !Array.isArray(result.cells)) return unknown("unavailable");
      const members = result.members.find(([id])=>id===cell.id)?.[1];
      const sourceIds = result.sourceIds?.find(([id])=>id===cell.id)?.[1] ?? [];
      const count = result.cells.find(([id])=>id===cell.id)?.[1] ?? 0;
      if (!Array.isArray(members) || members.length!==count || new Set(members).size!==count ||
          !members.every(key=>typeof key==="string") || !Array.isArray(sourceIds) || !sourceIds.every(key=>typeof key==="string"))
        return unknown("unavailable");
      return {...cellEvidence,status:"ready",scopeId:scope.id,revision:scope.revision,count,members,sourceIds,summary};
    } catch {
      signal.throwIfAborted();
      return unknown("unavailable");
    }
  };
}
