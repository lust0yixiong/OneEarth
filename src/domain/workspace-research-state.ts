import {isBoundCoverageSummary,type CoverageAttachment,type CoverageSelection} from "./coverage-attachment";
import {readResearchRangeScope,type ResearchRange,type ResearchRangeInput} from "./research-range";
import {cellAt} from "./spatial";
import type {Filters} from "./types";

export const workspaceIdPattern=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u;
export type WorkspaceResearchState={conversationId:string;revision:number;actionId:string|null;range:ResearchRange|null};
export type WorkspaceResearchReference={revision:number;actionId:string};
export type WorkspaceResearchObservation={actionId:string;expectedRevision:number;range?:ResearchRangeInput};
export type WorkspaceResearchAction=
  | {actionId:string;expectedRevision:number;kind:"adopt-research-range";range:ResearchRangeInput}
  | {actionId:string;expectedRevision:number;kind:"clear-research-range"};
export type WorkspaceResearchErrorCode="WORKSPACE_REVISION_CONFLICT"|"WORKSPACE_ACTION_ID_CONFLICT"|
  "WORKSPACE_COVERAGE_STALE"|"WORKSPACE_COVERAGE_UNAVAILABLE"|"WORKSPACE_ACTION_NOT_AUTHORIZED"|"WORKSPACE_STATE_UNAVAILABLE";
export const workspaceResearchPath=(conversationId:string)=>"/api/workspaces/"+encodeURIComponent(conversationId);

type Json=Record<string,unknown>;
function object(value:unknown):value is Json {
  return value!==null && typeof value==="object" && !Array.isArray(value);
}
function only(value:Json,allowed:string[]){
  return Object.keys(value).every(key=>allowed.includes(key));
}
function revision(value:unknown):value is number {
  return typeof value==="number" && Number.isSafeInteger(value) && value>=0;
}
function id(value:unknown):value is string {
  return typeof value==="string" && workspaceIdPattern.test(value);
}
export function readWorkspaceResearchReference(value:unknown):WorkspaceResearchReference|undefined {
  if(!object(value)||!only(value,["revision","actionId"])||!revision(value.revision)||!value.revision||!id(value.actionId))return;
  return {revision:value.revision,actionId:value.actionId};
}
function normalizeSelection({id,point,grid}:CoverageSelection):CoverageSelection {
  return {id,point:[...point],grid:{system:grid.system,n:grid.n,key:grid.key,label:grid.label}};
}
function normalizeFilters(filters:Filters):Filters{
  return {need:filters.need,type:filters.type,source:filters.source,place:filters.place,period:filters.period,
    utcWindow:filters.utcWindow??null,depth:filters.depth,maxDem:filters.maxDem};
}
export function sameResearchFilters(a:Filters,b:Filters) {
  return JSON.stringify(normalizeFilters(a))===JSON.stringify(normalizeFilters(b));
}
export function normalizeResearchCoverage(summary:CoverageAttachment["summary"]):CoverageAttachment["summary"] {
  return {selection:normalizeSelection(summary.selection),filters:normalizeFilters(summary.filters),
    caseId:summary.caseId,layer:summary.layer,metric:summary.metric,candidateCount:summary.candidateCount,
    candidateIdentity:summary.candidateIdentity};
}
function readRange(value:unknown):ResearchRangeInput|undefined {
  if(!object(value)||!only(value,["scope"])||!object(value.scope))return;
  const scope=value.scope;
  if(!only(scope,["kind","selection","place","coverageScope"])||scope.kind!=="grid"||!object(scope.selection)||
    !only(scope.selection,["id","grid","point"])||!object(scope.selection.grid)||
    !only(scope.selection.grid,["system","n","key","label"])||!object(scope.coverageScope)||
    !only(scope.coverageScope,["id","revision","summary"])||!object(scope.coverageScope.summary)||
    !only(scope.coverageScope.summary,["selection","filters","caseId","layer","metric","candidateCount","candidateIdentity"])||
    typeof scope.place!=="string"||scope.place.length>180||/[\u0000-\u001f\u007f]/u.test(scope.place))return;
  const {selection,filters}=scope.coverageScope.summary;
  if(!object(selection)||!only(selection,["id","point","grid"])||!object(selection.grid)||
    !only(selection.grid,["system","n","key","label"])||!object(filters)||
    !only(filters,["need","type","source","place","period","utcWindow","depth","maxDem"]))return;
  const range=readResearchRangeScope({...scope,conditionRevision:1});
  if(!range||!isBoundCoverageSummary(range.coverageScope.summary,range.selection.id,range.selection.grid.key))return;
  const summary=normalizeResearchCoverage(range.coverageScope.summary);
  if(summary.selection.grid.n!==range.selection.grid.n||summary.selection.grid.system!=="h3"||
    summary.selection.grid.label!==range.selection.grid.label||
    cellAt(summary.selection.point,summary.selection.grid)!==summary.selection.id)return;
  return {scope:{kind:"grid",selection:summary.selection,place:range.place.trim(),
    coverageScope:{id:range.coverageScope.id,revision:range.coverageScope.revision,summary}}};
}
export function readWorkspaceResearchObservation(value:unknown):WorkspaceResearchObservation|undefined {
  if(!object(value)||!only(value,["actionId","expectedRevision","range"])||!id(value.actionId)||
    !revision(value.expectedRevision)||value.expectedRevision===Number.MAX_SAFE_INTEGER)return;
  const range=value.range===undefined?undefined:readRange(value.range);
  if(value.range!==undefined&&!range)return;
  return {actionId:value.actionId,expectedRevision:value.expectedRevision,...(range?{range}:{})};
}
export function readWorkspaceResearchAction(value:unknown):WorkspaceResearchAction|undefined {
  if(!object(value))return;
  const {kind,...rest}=value;
  const observation=readWorkspaceResearchObservation(rest);
  if(!observation)return;
  const {range,...identity}=observation;
  if(kind==="adopt-research-range" && range)return {...identity,kind,range};
  if(kind==="clear-research-range" && !range)return {...identity,kind};
}
export function readWorkspaceResearchState(value:unknown,conversationId:string):WorkspaceResearchState|undefined {
  if(!object(value)||!id(conversationId)||value.conversationId!==conversationId||!revision(value.revision))return;
  if(value.revision===0)return value.range===null&&value.actionId===null?{conversationId,revision:0,actionId:null,range:null}:undefined;
  if(!id(value.actionId))return;
  if(value.range===null)return {conversationId,revision:value.revision,actionId:value.actionId,range:null};
  const candidate=value.range;
  if(!object(candidate)||!only(candidate,["scope"])||!object(candidate.scope))return;
  const {conditionRevision,...scope}=candidate.scope;
  if(conditionRevision!==value.revision)return;
  const range=readRange({scope});
  if(range)return {conversationId,revision:value.revision,actionId:value.actionId,
    range:{scope:{...range.scope,conditionRevision:value.revision}}};
}
