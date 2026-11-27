import type {GridCoverageScope} from "./grid-coverage";
import type {CoverageScopeSummary} from "./coverage";
import type {CandidateSet, Filters, Selection} from "./types";
import {validContext} from "./context-validation";

export type CoverageSelection = Pick<Selection, "grid" | "id" | "point">;

type BoundCoverageSummary = CoverageScopeSummary & {selection: CoverageSelection};
export type CoverageAttachment = GridCoverageScope & {summary: BoundCoverageSummary};

export class CoverageScopeChanged extends Error {}

export function isBoundCoverageSummary(
  value: unknown, cellId: string, gridKey: string,
): value is BoundCoverageSummary {
  const summary = value as Partial<CoverageScopeSummary> | null | undefined;
  const selection = summary?.selection;
  if (!summary || !selection || selection.id !== cellId || selection.grid?.key !== gridKey) return false;
  const {candidateCount, candidateIdentity} = summary;
  if (candidateCount === null) {
    if (candidateIdentity !== null) return false;
  } else if (typeof candidateCount !== "number" || !Number.isSafeInteger(candidateCount) || candidateCount < 0 ||
             typeof candidateIdentity !== "string" || !/^[0-9a-f]{64}$/.test(candidateIdentity)) {
    return false;
  }
  return (summary.metric === "products" || summary.metric === "scenes") && validContext({
    filters: summary.filters, caseId: summary.caseId, layer: summary.layer,
    selection, gridSystem: selection.grid.system,
    camera: {center: selection.point, zoom: 1, reason: "提问所选网格"}, citation: null,
  });
}

export async function attachCoverageScope(
  filters: Filters, batch: CandidateSet | null, selection: CoverageSelection, revision: string, signal: AbortSignal,
): Promise<{coverageScope: CoverageAttachment; selection: CoverageSelection}> {
  const response = await fetch("/api/coverage/scopes", {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({filters, batch, selection, revision}),
    signal,
  });
  if ([409, 410].includes(response.status)) {
    throw new CoverageScopeChanged("覆盖数据已更新。地图正在重新读取，请再次选择是否附加此范围。");
  }
  if (!response.ok) throw Error("覆盖未知，暂时无法附加范围。请稍后重试。");
  const payload = await response.json().catch(() => null);
  const {id, revision: actual, scope} = payload ?? {};
  if (typeof actual!=="string" || !/^[0-9a-f]{64}$/.test(actual)) {
    throw Error("覆盖未知，时空服务未确认此范围。");
  }
  if (actual !== revision) {
    throw new CoverageScopeChanged("覆盖数据已更新。地图正在重新读取，请再次选择是否附加此范围。");
  }
  const expectedCount = batch ? new Set(batch.ids).size : null;
  if (typeof id !== "string" || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(id) ||
      !isBoundCoverageSummary(scope, selection.id, selection.grid.key) ||
      scope.selection.point[0] !== selection.point[0] || scope.selection.point[1] !== selection.point[1] ||
      scope.candidateCount !== expectedCount) {
    throw Error("覆盖未知，时空服务未确认此范围。");
  }
  return {
    selection: structuredClone(scope.selection),
    coverageScope: {id, revision, summary: structuredClone(scope)},
  };
}

/** Wait only for the already registered cell at its exact coverage revision. */
export async function waitForBoundCoverage(scope:CoverageAttachment,selection:CoverageSelection,signal:AbortSignal) {
  const body=JSON.stringify({id:scope.id,revision:scope.revision,grid:selection.grid,
    cells:[selection.id],requireSelection:true});
  for(;;){
    signal.throwIfAborted();
    const response=await fetch("/api/coverage/cells",{method:"POST",headers:{"Content-Type":"application/json"},signal,body});
    if(!response.ok)throw Error("原地面范围的覆盖修订已不可查。");
    const result=await response.json();
    if(result.revision!==scope.revision || !isBoundCoverageSummary(result.scope,selection.id,selection.grid.key) ||
      !Array.isArray(result.ready))throw Error("时空服务未确认原地面范围。");
    if(result.ready.includes(selection.id))return;
    if(!result.pending)throw Error("时空服务未返回原地面网格的覆盖。");
    await new Promise<void>(resolve=>setTimeout(resolve,150));
  }
}
