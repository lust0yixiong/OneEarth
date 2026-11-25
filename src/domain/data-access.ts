import type {Asset} from "./datasets";
import type {Observation} from "./push-observations";
import type {Filters} from "./types";
export const accessSections={entities:"实体数据",clues:"数据线索",timely:"及时数据"} as const;
export type AccessSection=keyof typeof accessSections;
export function validAccessSection(v:unknown):v is AccessSection{return typeof v==="string"&&Object.hasOwn(accessSections,v);}
export function accessMembership(a:Pick<Asset,"holding"|"origins">){
  const timely=a.origins.includes("constellation"),entities=!!a.holding;
  return {entities,clues:!timely&&!entities,timely};
}
/** Source identifiers establish links; similar titles never establish identity. */
export function accessDatasetKey(a:Pick<Asset,"canonicalId"|"datasetId"|"productId"|"version"|"id"|"origins"|"url">){
  if(a.origins.includes("constellation"))return a.id;
  const doi=a.canonicalId?.match(/^doi:(10\.\S+)$/i)?.[1]||a.datasetId.match(/^doi:(10\.\S+)$/i)?.[1]||a.url?.match(/^https?:\/\/(?:dx\.)?doi\.org\/(10\.\S+)$/i)?.[1];
  if(doi){try{return "doi:"+decodeURIComponent(doi).toLowerCase();}catch{return "doi:"+doi.toLowerCase();}}
  return JSON.stringify([a.canonicalId||a.productId||a.datasetId,a.version||null]);
}
export type AccessAsset=Omit<Asset,"tabs">;
export interface AccessRow {
  mappable:boolean;
  key:string; asset:AccessAsset; ids:string[]; relatedIds:string[];
  evidenceKinds:string[];papers:number;entityId?:string;observation?:Observation;
}
export interface AccessQuery {
  section:AccessSection;query:string;type:string;source:string;page:number;limit:number;
  capability?:"local"|"map"|"request"|"";ids?:string[];savedIds?:string[];scope?:Filters;
  savedIdentities?:string[];
}
export interface CatalogueProjectionStatus {
  state:"ready"|"refreshing"|"stale"|"unavailable";
  revision?:string;total?:number;checkedAt?:string;warning?:string;
}
export type AccessCatalogues={paper:CatalogueProjectionStatus;haina:CatalogueProjectionStatus};
export interface AccessPage {
  catalogues?:AccessCatalogues;
  channels:{id:string;name:string;count:number;latest:string}[];
  stream?:{configured:number;sources:{id:string;name:string}[]};
  rows:AccessRow[];total:number;page:number;pages:number;limit:number;
  counts:Record<AccessSection,number>;types:string[];sources:{id:string;label:string}[];
  revision:number;checkedAt:string;
}
export function initialAccessSection(search:{section?:AccessSection;source:string;result:unknown}):AccessSection {
  return search.section||(search.source==="haina"?"entities":search.source==="constellation"?"timely":search.source||search.result?"clues":"entities");
}
export function receivedOrder(a:Observation,b:Observation){return b.receivedAt.localeCompare(a.receivedAt)||b.key.localeCompare(a.key);}
export function observationContent(r:Observation){return r.file?"原文件已接收":r.measurements.length?"观测值已接收":"产品链接已接收";}
