import {boundedRelatedIdentifiers} from "./related-identifiers";
// Adapted from OpenScience/EarthNano connector-builtins/src/literature-doi.ts,
// commit 47c341466728a8fe2a2486b7665e100c810ae0b2, Apache-2.0.
// Changes: standalone read-only fetch adapter, bounded first page and relationship manifest, OneEarth evidence shape.
// License and provenance: docs/upstream/OpenScience-Apache-2.0.txt and OpenScience-search.md.
import { load } from "cheerio";
import type { WebHit } from "../src/domain/types";

type ObjectValue=Record<string,unknown>;
function object(value:unknown):ObjectValue {
  if(!value || typeof value!=="object" || Array.isArray(value))throw Error("DataCite 返回格式异常");
  return value as ObjectValue;
}
function doi(value:unknown) {
  if(typeof value!=="string")throw Error("DataCite 缺少 DOI");
  const normalized=value.trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i,"").replace(/^doi:\s*/i,"").toLowerCase();
  if(!/^10\.\d{4,9}\/\S+$/u.test(normalized))throw Error("DataCite 返回无效 DOI");
  return normalized;
}
function landingUrl(value:unknown) {
  if(typeof value!=="string")return undefined;
  try{const url=new URL(value);return ["http:","https:"].includes(url.protocol) && !url.username && !url.password ? url.href : undefined;}catch{return undefined;}
}

export function parseDataCitePage(payload:unknown,pageSize=5) {
  const body=object(payload),meta=object(body.meta);
  if(!Array.isArray(body.data) || !Number.isSafeInteger(meta.total) || Number(meta.total)<0 ||
     body.data.length>pageSize || Number(meta.total)<body.data.length || (!body.data.length && Number(meta.total)>0))
    throw Error("DataCite 返回的条目与总数不一致");
  const hits:WebHit[]=body.data.map(value=>{
    const record=object(value),a=object(record.attributes),id=doi(record.id);
    if(record.type!=="dois" || doi(a.doi)!==id)throw Error("DataCite 返回的 DOI 身份不一致");
    if(!Array.isArray(a.titles))throw Error("DataCite 缺少标题");
    const title=a.titles.map(t=>object(t).title).find(t=>typeof t==="string" && t.trim());
    if(typeof title!=="string")throw Error("DataCite 缺少有效标题");
    const description=Array.isArray(a.descriptions)?a.descriptions.map(d=>object(d).description).find(d=>typeof d==="string"):"";
    const publisher=typeof a.publisher==="string"?a.publisher:a.publisher && typeof a.publisher==="object"?object(a.publisher).name:undefined;
    const relatedIdentifiers=Array.isArray(a.relatedIdentifiers)?a.relatedIdentifiers.map(value=>{
      const r=object(value);
      if(typeof r.relatedIdentifier!=="string" || typeof r.relatedIdentifierType!=="string" || typeof r.relationType!=="string")
        throw Error("DataCite 关联标识格式异常");
      return {relatedIdentifier:r.relatedIdentifier,relatedIdentifierType:r.relatedIdentifierType,relationType:r.relationType};
    }):[];
    return {title:title.trim(),url:"https://doi.org/"+encodeURI(id),doi:id,referenceType:"data" as const,
      snippet:load(typeof description==="string"?description:"").text().trim().slice(0,600),
      landingUrl:landingUrl(a.url),version:typeof a.version==="string"?a.version:undefined,
      publisher:typeof publisher==="string"?publisher:undefined,...boundedRelatedIdentifiers(relatedIdentifiers)};
  });
  return {hits,total:Number(meta.total)};
}

export async function searchDataCite(query:string,signal:AbortSignal,fetchImpl:typeof fetch=fetch) {
  const url=new URL("https://api.datacite.org/dois");
  url.search=new URLSearchParams({query,"resource-type-id":"dataset","page[size]":"5","page[number]":"1"}).toString();
  const response=await fetchImpl(url,{signal,headers:{Accept:"application/json"}});
  if(!response.ok)throw Error("DataCite 返回 HTTP "+response.status);
  return {...parseDataCitePage(await response.json()),requestUrl:url.href};
}
