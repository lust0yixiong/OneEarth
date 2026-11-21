import type {Asset} from "./datasets";
import type {AnswerReference,DiscoveryContext,Filters,Selection} from "./types";
import {emptyFilters} from "./spatial";
import {windowFilters,windowLabel} from "./time-window";

export type ScopeItem =
  | {kind:"reference";reference:AnswerReference;number:number;messageId:string}
  | {kind:"grid"; selection:Pick<Selection,"grid"|"id"|"point">; place:string}
  | {kind:"time"; period:[number,number]; utcWindow:[number,number]|null}
  | {kind:"dataset"; id:string; title:string; version:string|null; source:string};
export function timeScope(filters:Filters):ScopeItem[] {
  const utcWindow=filters.utcWindow,period=utcWindow?windowFilters(utcWindow).period:filters.period;
  return period?[{kind:"time",period:[...period],utcWindow:utcWindow?[...utcWindow]:null}]:[];
}
export function gridScope({grid,id,point}:Selection,place:string):ScopeItem {
  return {kind:"grid",place,selection:{grid:{...grid},id,point:[...point]}};
}
export function datasetScope(a:Asset):ScopeItem {
  return {kind:"dataset",id:a.id,title:a.title,source:a.source,version:a.version || null};
}
export const scopeKey=(item:ScopeItem)=>item.kind==="reference"?"reference:"+(item.reference.kind==="asset"?item.reference.id:item.reference.url):item.kind==="dataset"?"dataset:"+item.id:item.kind;
export function mergeScope(previous:ScopeItem[],added:ScopeItem[]) {
  return [...new Map([...previous,...added].map(item=>[scopeKey(item),item])).values()];
}
export function scopeLabel(item:ScopeItem) {
  if(item.kind==="reference")return "〔"+item.number+"〕"+item.reference.title;
  if(item.kind==="time")return item.utcWindow?windowLabel(item.utcWindow):(item.period[0]===item.period[1]?item.period[0]:item.period.join("–"))+" 年";
  if(item.kind==="dataset")return item.title;
  return [item.place,item.selection.grid.label].filter(Boolean).join(" · ");
}
export function scopeDetail(item:ScopeItem) {
  if(item.kind==="reference")return item.reference.kind==="asset"?item.reference.source+" · "+item.reference.id:item.reference.url;
  if(item.kind==="dataset")return [item.source,item.version,item.id].filter(Boolean).join(" · ");
  if(item.kind==="time")return item.utcWindow?item.utcWindow.map(t=>new Date(t).toISOString()).join(" 至 ")+"（不含结束时刻）":scopeLabel(item);
  const {id,point}=item.selection;
  return id+" · 经度 "+point[0].toFixed(4)+"°，纬度 "+point[1].toFixed(4)+"°";
}
export function scopedQuestionContext(items:ScopeItem[],citation:DiscoveryContext["citation"]):DiscoveryContext {
  const grid=items.find(i=>i.kind==="grid"),time=items.find(i=>i.kind==="time"),datasets=items.filter(i=>i.kind==="dataset");
  const referenceIds=items.flatMap(i=>i.kind==="reference" && i.reference.kind==="asset"?[i.reference.id]:[]);
  return {attachedScope:items,selection:grid?.selection || null,gridSystem:grid?.selection.grid.system || "h3",
    filters:{...emptyFilters(),period:time?.period || null,utcWindow:time?.utcWindow || null},caseId:null,layer:"all",
    camera:{center:grid?.selection.point || [0,0],zoom:1,reason:grid?"提问所选网格":"未引用位置"},citation,
    candidateIds:[...new Set([...datasets.map(d=>d.id),...referenceIds])],candidateVersions:Object.fromEntries(datasets.filter(d=>d.version).map(d=>[d.id,d.version!])),
    inCandidateScope:!!datasets.length || !!referenceIds.length};
}
