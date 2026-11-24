import {validSourceReadLocatorResult,type SourceReadLocator} from "../src/domain/source-read-locator";
import {randomUUID} from "node:crypto";
import {setTimeout as delay} from "node:timers/promises";
import type {WebHit} from "../src/domain/types";
import {DeepSeekRequestError} from "./deepseek-web";
import {
  parseWebToolCall, webToolGrantPattern, webToolHit, webToolPath, type KeywordSearchProvider, type WebFetchProvider,
  type WebToolOperation, type WebToolReceipt, type WebToolValue,
} from "./web-tool-contract";

type PageReadValue = WebToolValue & {requestUrl:string;warning:string};
export type DiscoveryWebTools = {
  search(engine:KeywordSearchProvider,query:string,signal:AbortSignal):Promise<WebToolValue>;
  nativeSearch?:(queries:string[],signal:AbortSignal)=>Promise<{hits:WebHit[];queries:string[]}>;
  archiveRead(hit:WebHit,signal:AbortSignal,question:string):Promise<WebToolValue>;
  originRead(hit:WebHit,url:string,signal:AbortSignal,locators?:SourceReadLocator[]):Promise<PageReadValue>;
  pdfRead(hit:WebHit,url:string,signal:AbortSignal,focus?:string,question?:string,locators?:SourceReadLocator[]):Promise<PageReadValue>;
  fetchPage(hit:WebHit,url:string,signal:AbortSignal,fresh?:boolean):Promise<WebToolValue>;
};

type Delegation = {taskId:string;messageId:string};
const unavailable = "运行时公开网络工具不可用。";
const invalidReceipt = "运行时没有返回有效的网络工具回执。";

export function discoveryWebTools(runtimeUrl:string|undefined, delegation:Delegation, grant:string|undefined,
  nativeAllowed:boolean, fetchImpl:typeof fetch=fetch):DiscoveryWebTools {
  async function call(operation:WebToolOperation, signal:AbortSignal):Promise<WebToolValue> {
    signal.throwIfAborted();
    if (!runtimeUrl || !grant || !webToolGrantPattern.test(grant)) throw Error(unavailable);
    const envelope = {...delegation,callId:randomUUID(),operation};
    const body = JSON.stringify(envelope);
    if (!parseWebToolCall(JSON.parse(body))) throw Error("公开网络工具的查询词或来源身份无效。");
    const endpoint = new URL(webToolPath,runtimeUrl);
    const requestSignal = AbortSignal.any([signal,AbortSignal.timeout(90_000)]);
    let wait=100;
    while (!requestSignal.aborted) {
      // A lost acknowledgement may already have queued a tool call. Repost the exact envelope.
      let response:Response|undefined;
      try {
        response = await fetchImpl(endpoint,{method:"POST",signal:requestSignal,redirect:"error",
          headers:{Authorization:"Bearer " + grant,"Content-Type":"application/json"},body});
      } catch {
        requestSignal.throwIfAborted();
      }
      if (response?.status === 200) {
        // The status can arrive before a disconnect. Retry only a failed transfer, not malformed data.
        const payload = await response.text().catch(error => {
          requestSignal.throwIfAborted();
          if (!(error instanceof TypeError)) throw Error(invalidReceipt);
          return undefined;
        });
        requestSignal.throwIfAborted();
        if (payload !== undefined) {
          let receipt:WebToolReceipt;
          try {receipt = JSON.parse(payload);}
          catch {throw Error(invalidReceipt);}
          if (receipt?.state === "complete" && Array.isArray(receipt.value?.hits) &&
            receipt.value.hits.every(hit=>hit && typeof hit.url==="string" && typeof hit.title==="string" && typeof hit.snippet==="string"))
            return receipt.value;
          if (receipt?.state === "failed" && typeof receipt.error?.message === "string") {
            if (operation.kind === "fetch" && operation.provider === "DeepSeek Fetch")
              throw new DeepSeekRequestError(receipt.error.message,receipt.error.stopBatch === true,receipt.error.status);
            throw Error(receipt.error.message);
          }
          throw Error(invalidReceipt);
        }
      } else if (response) {
        await response.body?.cancel().catch(()=>{});
        if (response.status !== 202 && response.status !== 425)
          throw Error("运行时公开网络工具不可用（HTTP " + response.status + "）。");
      }
      await delay(wait,undefined,{signal:requestSignal}).catch(()=>requestSignal.throwIfAborted());
      wait=Math.min(wait+100,500);
    }
    requestSignal.throwIfAborted();
    throw Error(unavailable);
  }

  const page = (provider:WebFetchProvider,hit:WebHit,url:string,signal:AbortSignal,fields?:{
    focus?:string;question?:string;fresh?:boolean;locators?:SourceReadLocator[];
  }) => call({kind:"fetch",provider,url,hit:webToolHit(hit),...fields},signal);
  async function excerpt(provider:"原站读取"|"PDF 原文",hit:WebHit,url:string,signal:AbortSignal,fields?:{focus?:string;question?:string;locators?:SourceReadLocator[]}) {
    const value=await page(provider,hit,url,signal,fields);
    if (typeof value.requestUrl !== "string" || typeof value.warning !== "string") throw Error(invalidReceipt);
    if(fields?.locators){
      const results=value.hits[0]?.locatorResults;
      if(value.hits.length!==1||value.hits[0].url!==hit.url||results?.length!==fields.locators.length||
        !fields.locators.every((locator,index)=>validSourceReadLocatorResult(results[index],locator,url)))throw Error(invalidReceipt);
    }else if(!value.hits[0]?.pageExcerpt?.trim()&&!value.hits[0]?.sourceAlternates?.length)throw Error(invalidReceipt);
    return {...value,requestUrl:value.requestUrl,warning:value.warning};
  }
  return {
    search:(provider,query,signal) => call({kind:"search",provider,query},signal),
    ...(nativeAllowed ? {nativeSearch:async (queries:string[],signal:AbortSignal) => {
      const value=await call({kind:"native-search",queries:queries.slice(0,3)},signal);
      if (!Array.isArray(value.queries) || value.queries.some(query=>typeof query!=="string")) throw Error(invalidReceipt);
      return {hits:value.hits,queries:value.queries};
    }} : {}),
    archiveRead:(hit,signal,question) => page("Zenodo 索引",hit,hit.url,signal,{question}),
    originRead:(hit,url,signal,locators) => excerpt("原站读取",hit,url,signal,{locators}),
    pdfRead:(hit,url,signal,focus,question,locators) => excerpt("PDF 原文",hit,url,signal,{focus,question,locators}),
    async fetchPage(hit,url,signal,fresh) {
      const value=await page("DeepSeek Fetch",hit,url,signal,{fresh});
      if (typeof value.hits[0]?.pageExcerpt!=="string" || !value.hits[0].pageExcerpt.trim()) throw Error(invalidReceipt);
      return value;
    },
  };
}
