import {attachCoverageScope,isBoundCoverageSummary,type CoverageAttachment} from "./coverage-attachment";
import {coverageBatchKey} from "./coverage";
import type {ScopeItem} from "./question-scope";
import {outsideMappedSelection} from "./results";
import type {CandidateSet,Selection} from "./types";

type GridScope = Extract<ScopeItem,{kind:"grid"}>;
export type ResearchRangeScope = GridScope & {coverageScope:CoverageAttachment;conditionRevision:number};
export type ResearchRange = {
  scope:ResearchRangeScope;
  /** Undefined for an archived candidate batch whose original server handle is still required. */
  batch?:CandidateSet|null;
};
export type ResearchRangeInput=Omit<ResearchRange,"scope"> & {scope:Omit<ResearchRangeScope,"conditionRevision">};
export type ResearchRangeSnapshot={revision:number;range:ResearchRange|null};

export class ResearchRangeChanged extends Error {}

export const adoptCurrentSelectionQuestion = "采用当前选格";

export function hasExplicitTurnRange(items:ScopeItem[]) {
  return items.some(item=>item.kind==="grid" || item.kind==="time" || item.kind==="observation");
}

type ResearchRangeView = {
  view:string;overview:string;caseId:unknown;publicLayer:unknown;fieldLayer:unknown;
  visualization:unknown;dataView:unknown;selection:Selection|null;mapResult:CandidateSet|null;
};

export function canAdoptCurrentSelection(view:ResearchRangeView) {
  const {selection,mapResult}=view;
  return view.view==="earth" && view.overview==="catalog" &&
    !view.caseId && !view.publicLayer && !view.fieldLayer && !view.visualization && !view.dataView &&
    !!selection && !selection.simulated && selection.grid.system==="h3" &&
    (!mapResult || !outsideMappedSelection(mapResult,selection));
}

export function researchRangeAdoptionKey(view:ResearchRangeView & {filters:CoverageAttachment["summary"]["filters"]}) {
  const selection=view.selection;
  if(!selection || !canAdoptCurrentSelection(view))return;
  return JSON.stringify([selection.id,selection.grid.key,selection.point,view.filters,coverageBatchKey(view.mapResult)]);
}

export function readResearchRangeScope(value:unknown):ResearchRangeScope|undefined {
  const grid=value as Partial<ResearchRangeScope>|null|undefined;
  const selection=grid?.selection;
  const coverage=grid?.coverageScope;
  if (grid?.kind!=="grid" || !Number.isSafeInteger(grid.conditionRevision) || grid.conditionRevision!<=0 ||
      typeof grid.place!=="string" || !selection || typeof selection.id!=="string" || selection.grid?.system!=="h3" ||
      !Array.isArray(selection.point) || selection.point.length!==2 || !coverage ||
      typeof coverage.id!=="string" || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(coverage.id) ||
      typeof coverage.revision!=="string" || !/^[0-9a-f]{64}$/.test(coverage.revision) ||
      !isBoundCoverageSummary(coverage.summary,selection.id,selection.grid.key) ||
      coverage.summary.selection.point[0]!==selection.point[0] || coverage.summary.selection.point[1]!==selection.point[1]) return;
  return grid as ResearchRangeScope;
}

export async function prepareResearchRange({scope,batch}:ResearchRange,signal:AbortSignal):Promise<ResearchRangeScope> {
  const {id,revision,summary}=scope.coverageScope;
  if (batch!==undefined || summary.candidateCount===null) {
    const bound=await attachCoverageScope(summary.filters,batch??null,scope.selection,revision,signal);
    if (bound.coverageScope.summary.candidateIdentity!==summary.candidateIdentity)
      throw Error("候选范围无法按原条件重新核对。");
    return {...scope,...bound};
  }
  // Historical filtered results keep the old server handle. Rebuilding without the
  // candidate batch would broaden the scope, so validate that exact handle instead.
  const response=await fetch("/api/coverage/cells",{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({id,revision,grid:scope.selection.grid,cells:[scope.selection.id],requireSelection:true}),signal,
  });
  const data=response.ok ? await response.json().catch(()=>null) : null;
  if (data?.revision!==revision || !isBoundCoverageSummary(data.scope,scope.selection.id,scope.selection.grid.key) ||
      data.scope.candidateIdentity!==summary.candidateIdentity)
    throw Error("旧覆盖范围已失效，请在地图上重新采用范围。");
  return scope;
}
