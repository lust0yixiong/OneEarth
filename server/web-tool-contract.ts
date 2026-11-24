import {parseSourceReadLocators,type SourceReadLocator} from "../src/domain/source-read-locator";
import type {WebHit} from "../src/domain/types";
import type {ArchiveReadResult} from "./archive-index";
import {publicPage} from "./fetch-pages";

export const webToolPath = "/internal/discovery-web-tool/v1";
export const keywordSearchProviders = ["Bing","DuckDuckGo","DataCite","DeepSeek Search"] as const;
export const fetchProviders = ["DeepSeek Fetch","原站读取","PDF 原文","Zenodo 索引"] as const;
export const webToolGrantPattern = /^[A-Za-z0-9_-]{43}$/;
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

export type KeywordSearchProvider = typeof keywordSearchProviders[number];
export type WebFetchProvider = typeof fetchProviders[number];
export type WebToolOperation =
  | {kind:"search";provider:KeywordSearchProvider;query:string}
  | {kind:"native-search";queries:string[]}
  | {kind:"fetch";provider:WebFetchProvider;url:string;hit:WebHit;focus?:string;question?:string;fresh?:boolean;locators?:SourceReadLocator[]};
export type WebToolCall = {taskId:string;messageId:string;callId:string;operation:WebToolOperation};
export type WebToolValue = {hits:WebHit[];requestUrl?:string;warning?:string;cacheStoredAt?:string;queries?:string[];total?:number} &
  Pick<ArchiveReadResult,"identity"|"manifest"|"attachmentTargets">;
export type WebToolFailure = {message:string;stopBatch?:boolean;status?:number;code?:string};
export type WebToolReceipt =
  | {state:"pending"}
  | {state:"complete";value:WebToolValue}
  | {state:"failed";error:WebToolFailure};

function object(value:unknown):value is Record<string,unknown> {
  return !!value&&typeof value==="object"&&!Array.isArray(value);
}
const only=(value:Record<string,unknown>,keys:readonly string[])=>Object.keys(value).every(key=>keys.includes(key));
const text=(value:unknown,limit:number):value is string=>typeof value==="string"&&value.length<=limit;
const term=(value:unknown):value is string=>text(value,160)&&!!value.trim()&&!/[\u0000-\u001f\u007f]/.test(value);
const url=(value:unknown):value is string=>text(value,2200)&&!!publicPage(value);

const hitLimits={doi:240,version:240,publisher:360} as const;
const hitFields=["title","url","snippet","doi","version","publisher","landingUrl","referenceType","discoveredBy",
  "relatedIdentifiers","relatedIdentifiersTotal","relatedIdentifiersOmitted"] as const;
function parseHit(input:unknown):WebHit|undefined {
  if(!object(input)||!only(input,hitFields)||!url(input.url)||!text(input.title,360)||!input.title.trim()||
    !text(input.snippet,1200)||Object.entries(hitLimits).some(([key,limit])=>input[key]!==undefined&&!text(input[key],limit))||
    (input.landingUrl!==undefined&&!url(input.landingUrl))||
    (input.referenceType!==undefined&&input.referenceType!=="data"&&input.referenceType!=="paper"&&input.referenceType!=="web")||
    (input.discoveredBy!==undefined&&input.discoveredBy!=="user"&&input.discoveredBy!=="assistant"))return;
  if(input.relatedIdentifiers!==undefined&&(!Array.isArray(input.relatedIdentifiers)||input.relatedIdentifiers.length>32||
    !input.relatedIdentifiers.every(link=>object(link)&&only(link,["relatedIdentifier","relatedIdentifierType","relationType"])&&
      text(link.relatedIdentifier,1200)&&text(link.relatedIdentifierType,80)&&text(link.relationType,80))))return;
  for(const count of [input.relatedIdentifiersTotal,input.relatedIdentifiersOmitted]){
    if(count!==undefined&&(typeof count!=="number"||!Number.isSafeInteger(count)||count<0))return;
  }
  return input as unknown as WebHit;
}

/** The reader gets the selected identity and lookup metadata, never prior document excerpts. */
export function webToolHit(hit:WebHit):WebHit {
  return {title:hit.title.slice(0,360),url:hit.url,snippet:hit.snippet.slice(0,1200),
    doi:hit.doi?.slice(0,240),version:hit.version?.slice(0,240),publisher:hit.publisher?.slice(0,360),
    landingUrl:publicPage(hit.landingUrl)?hit.landingUrl:undefined,referenceType:hit.referenceType,discoveredBy:hit.discoveredBy,
    relatedIdentifiers:hit.relatedIdentifiers?.slice(0,32),relatedIdentifiersTotal:hit.relatedIdentifiersTotal,
    relatedIdentifiersOmitted:hit.relatedIdentifiersOmitted};
}

export function parseWebToolOperation(input:unknown):WebToolOperation|undefined {
  if(!object(input))return;
  if(input.kind==="search"){
    const provider=keywordSearchProviders.find(candidate=>candidate===input.provider);
    if(!provider||!only(input,["kind","provider","query"])||!term(input.query))return;
    if(provider==="DataCite"&&(input.query.length>80||input.query.trim().split(/ +/).length>8))return;
    return {kind:"search",provider,query:input.query};
  }
  if(input.kind==="native-search"){
    if(!only(input,["kind","queries"])||!Array.isArray(input.queries)||
      !input.queries.length||input.queries.length>3||!input.queries.every(term))return;
    return {kind:"native-search",queries:input.queries};
  }
  if(input.kind!=="fetch"||!only(input,["kind","provider","url","hit","focus","question","fresh","locators"])||!url(input.url))return;
  const provider=fetchProviders.find(candidate=>candidate===input.provider);
  const hit=parseHit(input.hit);
  const locators=parseSourceReadLocators(input.locators);
  if(input.locators!==undefined&&(!locators||(provider!=="原站读取"&&provider!=="PDF 原文")))return;
  if(!provider||!hit||(input.focus!==undefined&&!text(input.focus,6000))||
    (input.question!==undefined&&!text(input.question,4000))||
    (input.fresh!==undefined&&(provider!=="DeepSeek Fetch"||typeof input.fresh!=="boolean")))return;
  return {kind:"fetch",provider,url:input.url,hit,
    ...(input.focus!==undefined?{focus:input.focus}:{}),
    ...(input.question!==undefined?{question:input.question}:{}),
    ...(input.fresh!==undefined?{fresh:input.fresh}:{}),
    ...(locators?{locators}:{})};
}

export function parseWebToolCall(input:unknown):WebToolCall|undefined {
  if(!object(input)||!only(input,["taskId","messageId","callId","operation"]))return;
  const {taskId,messageId,callId}=input;
  if(typeof taskId!=="string"||!uuid.test(taskId)||typeof messageId!=="string"||!uuid.test(messageId)||
    typeof callId!=="string"||!uuid.test(callId))return;
  const operation=parseWebToolOperation(input.operation);
  if(operation)return {taskId,messageId,callId,operation};
}
