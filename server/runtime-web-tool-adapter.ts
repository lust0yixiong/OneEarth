import {exactSourceSnapshot} from "./exact-source-snapshot";
import {excerptLocatorIndex} from "./locator-labels.mjs";
import {parseSourceReadLocator} from "../src/domain/source-read-locator";
import type {ChatModel} from "../src/domain/chat-model";
import {deepSeekFetch,deepSeekSearch,DeepSeekRequestError} from "./deepseek-web";
import {searchBing,searchDuckDuckGo} from "./web-search-leaves";
import {searchDataCite} from "./datacite-search";
import {nativeWebSearch} from "./native-web-search";
import {readOriginPage} from "./origin-page";
import {readPdfPage} from "./read-pdf-page";
import {readArchiveIndex,zenodoRecordId} from "./archive-index";
import {SourceReadError} from "./source-read-error";
import type {SourceRequest} from "./source-fetch";
import {publicPage} from "./fetch-pages";
import type {WebToolFailure,WebToolOperation,WebToolValue} from "./web-tool-contract";

const searchProviders = {Bing:searchBing,DuckDuckGo:searchDuckDuckGo,DataCite:searchDataCite,"DeepSeek Search":deepSeekSearch};
type WebToolOptions={nativeModel?:ChatModel;fetchImpl?:typeof fetch;sourceRequest?:SourceRequest;sourceSnapshotScope?:string};

function deadline(operation:WebToolOperation){
  if(operation.kind==="native-search")return 30_000;
  if(operation.kind==="search")return 10_000;
  if(operation.provider==="DeepSeek Fetch")return operation.fresh?8_000:18_000;
  if(operation.provider==="PDF 原文")return 15_000;
  return operation.provider==="原站读取"?6_500:10_000;
}

/** One bounded adapter call. The caller owns provider selection, fallback and evidence adoption. */
export async function runWebTool(operation:WebToolOperation,parent:AbortSignal,options:WebToolOptions={}):Promise<WebToolValue>{
  const signal=AbortSignal.any([parent,AbortSignal.timeout(deadline(operation))]);
  const request=options.fetchImpl??fetch;
  signal.throwIfAborted();
  if(operation.kind==="search")
    return searchProviders[operation.provider](operation.query,signal,request);
  if(operation.kind==="native-search"){
    const model=options.nativeModel;
    if(model?.executor!=="codex"||(model.provider&&model.provider!=="native"))
      throw new SourceReadError("本轮运行时没有获准的原生搜索执行器。","WEB_NATIVE_NOT_AUTHORIZED");
    return nativeWebSearch(model,operation.queries,signal);
  }
  const {hit,url,focus,question,locators}=operation;
  switch(operation.provider){
    case "DeepSeek Fetch": {
      const value=await deepSeekFetch(hit,url,signal,request,operation.fresh);
      if(!operation.fresh)return {...value,requestUrl:url};
      const hits=value.hits.map(hit=>{
        const availableLocators=excerptLocatorIndex(hit.pageExcerpt).flatMap(({kind,value,label})=>{
          const locator=parseSourceReadLocator({kind,value});
          return locator?[{...locator,label}]:[];
        });
        return {...hit,...(availableLocators.length?{availableLocators}:{})};
      });
      return {...value,hits,requestUrl:url};
    }
    case "原站读取":
      return readOriginPage(hit,url,signal,options.sourceRequest,locators,exactSourceSnapshot(options.sourceSnapshotScope,url,"origin"));
    case "PDF 原文":
      return readPdfPage(hit,url,signal,options.sourceRequest,focus,question,locators,exactSourceSnapshot(options.sourceSnapshotScope,url,"pdf"));
    case "Zenodo 索引": {
      const id=zenodoRecordId(hit);
      if(!id||(publicPage(url)!==publicPage(hit.url)&&publicPage(url)!=="https://zenodo.org/api/records/"+id))
        throw new SourceReadError("目录地址与所选公开归档身份不一致。","WEB_ARCHIVE_ID_MISMATCH");
      return readArchiveIndex(hit,signal,options.sourceRequest,{question});
    }
  }
}

export function webToolFailure(error:unknown):WebToolFailure{
  if(error instanceof DeepSeekRequestError)return {message:error.message,stopBatch:error.stopBatch,status:error.status};
  if(error instanceof SourceReadError)return {message:error.message,code:error.code};
  if(error instanceof Error){
    if(error.name==="TimeoutError")return {message:"请求超时",code:"WEB_TOOL_TIMEOUT"};
    if(error.name==="AbortError")return {message:"工具请求已取消",code:"WEB_TOOL_ABORTED"};
    const cause=(error as Error & {cause?:{code?:string}}).cause?.code;
    if(cause==="ECONNRESET")return {message:"连接被搜索服务或网络重置"};
    if(cause==="ENOTFOUND")return {message:"搜索服务域名解析失败"};
    return {message:error.message==="fetch failed"?"无法连接搜索服务":error.message.slice(0,500)};
  }
  return {message:"公共网页工具请求失败。"};
}
