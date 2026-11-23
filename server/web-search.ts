import type {DeepSeekTools} from "../src/domain/deepseek-tools";
import {deepSeekSearch, deepSeekFetch, DeepSeekRequestError} from "./deepseek-web";
import {pagesToRead} from "./fetch-pages";
import type { SearchQuery, SearchRun, WebHit } from "../src/domain/types";
import {searchBing, searchDataCite, searchDuckDuckGo} from "./web-search-leaves";
import type {DiscoveryWebTools} from "./discovery-web-tools";
import type {KeywordSearchProvider} from "./web-tool-contract";
import type {readOriginPage} from "./origin-page";
import {zenodoRecordId,explicitArchiveTarget,priorArchiveTarget,type readArchiveIndex,type PriorArchiveTarget} from "./archive-index";
import type {WebComplementPlan} from "./web-complement";

export {parseBingResults, parseDuckDuckGoResults, relevantWebHits, searchDuckDuckGo} from "./web-search-leaves";

function compact(value:string,max:number) {
  const text=value.replace(/\s+/g," ").trim();
  if(text.length<=max)return text;
  const head=text.slice(0,max),boundary=head.lastIndexOf(" ");
  return boundary>max/2?head.slice(0,boundary):head;
}
/** Web keywords and DOI metadata queries have different scopes. Never send a paragraph to both. */
export function parseSearchPlan(raw:string):SearchQuery[] {
  const list:unknown=JSON.parse(raw.trim().replace(/^```(?:json)?\s*|\s*```$/gi,""));
  if(!Array.isArray(list))throw Error("检索计划格式无效");
  const queries:SearchQuery[]=[];
  for(const value of list){
    if(!value || typeof value!=="object" || typeof value.web!=="string" || typeof value.dataset!=="string")continue;
    const web=compact(value.web,120),dataset=value.dataset.replace(/\s+/g," ").trim();
    if(!web || !dataset || dataset.length>80 || dataset.split(" ").length>8)continue;
    if(!queries.some(q=>q.web===web && q.dataset===dataset))queries.push({web,dataset});
    if(queries.length===3)break;
  }
  if(!queries.length)throw Error("未生成有效检索词");
  return queries;
}

function failure(error:unknown) {
  if(error instanceof Error){
    if(error.name==="TimeoutError")return "请求超时";
    const cause=(error as Error & {cause?:{code?:string}}).cause?.code;
    if(cause==="ECONNRESET")return "连接被搜索服务或网络重置";
    if(cause==="ENOTFOUND")return "搜索服务域名解析失败";
    return error.message==="fetch failed"?"无法连接搜索服务" : error.message;
  }
  return "检索请求失败";
}
type SearchOptions={deepseekTools?: DeepSeekTools;fetchImpl?:typeof fetch;timeoutMs?:number;
  initialRuns?:SearchRun[];readPages?:boolean;focus?:WebComplementPlan;
  originRead?:typeof readOriginPage|false;
  archiveRead?:typeof readArchiveIndex|false;
  pdfRead?:DiscoveryWebTools["pdfRead"];
  archiveQuestion?:string;priorArchiveTargets?:PriorArchiveTarget[];tools?:DiscoveryWebTools;
  nativeSearch?:(queries:string[],signal:AbortSignal)=>Promise<{hits:WebHit[];queries:string[]}>};
export async function searchSources(queries:SearchQuery[],signal:AbortSignal,update:(runs:SearchRun[])=>void,options:SearchOptions={}) {
  signal.throwIfAborted();
  const {tools,fetchImpl}=options;
  const providers={Bing:searchBing,DuckDuckGo:searchDuckDuckGo,DataCite:searchDataCite,"DeepSeek Search":deepSeekSearch};
  const lookup=tools?.search ?? (fetchImpl && ((engine:KeywordSearchProvider,query:string,requestSignal:AbortSignal) =>
    providers[engine](query,requestSignal,fetchImpl)));
  if(!lookup)throw Error("未配置公开网络检索工具。");
  const keywordSearch=lookup;
  const runs:SearchRun[]=(options.initialRuns||[]).map(r=>({...r,hits:[...r.hits]}));
  const activeQueries=[...new Map([...queries.slice(0,3),...(options.focus?.queries||[]).slice(0,2)]
    .map(q=>[q.web+"\n"+q.dataset,q])).values()];
  const pending=new Map<string,Promise<number>>();
  const publish=()=>update(runs.map(r=>({...r,hits:[...r.hits]})));
  for(const r of runs)if(r.status!=="running"&&r.engine in providers)
    pending.set(r.engine+":"+r.query,Promise.resolve(r.hits.length));
  function search(query:string,engine:KeywordSearchProvider) {
    const key=engine+":"+query,existing=pending.get(key);
    if(existing)return existing;
    const promise=performSearch(query,engine,requestSignal=>keywordSearch(engine,query,requestSignal));
    pending.set(key,promise);
    return promise;
  }
  async function performSearch(query:string,engine:SearchRun["engine"],work:(requestSignal:AbortSignal)=>Promise<{hits:WebHit[]}>) {
    signal.throwIfAborted();
    const start=Date.now(),row:SearchRun={engine,query,status:"running",hits:[],startedAt:new Date(start).toISOString()};
    runs.push(row);publish();
    try {
      const timeout=engine==="PDF 原文"?Math.min(options.timeoutMs??15000,15000):engine==="原站读取"?Math.min(options.timeoutMs??6500,6500):options.timeoutMs??(engine==="DeepSeek Fetch"?18000:10000);
      const requestSignal=AbortSignal.any([signal,AbortSignal.timeout(timeout)]);
      Object.assign(row,await work(requestSignal));
      row.status="done";
    }catch(error){signal.throwIfAborted();row.status="failed";row.error=failure(error);}
    row.elapsedMs=Date.now()-start;publish();return row.hits.length;
  }
  // Independent keyword groups run together; each group's fallback remains sequential.
  await Promise.all(activeQueries.map(async query=>{
    await Promise.all([
      (async()=>{
        const [publicCount,toolCount]=await Promise.all([search(query.web,"Bing"),
          options.deepseekTools?.search?search(query.web,"DeepSeek Search"):Promise.resolve(0)]);
        if(!publicCount && !toolCount)await search(query.web,"DuckDuckGo");
      })(),
      search(query.dataset,"DataCite"),
    ]);
  }));
  const missing=[...new Set(activeQueries.filter(query=>!runs.some(r=>
    ((r.engine==="Bing" || r.engine==="DuckDuckGo" || r.engine==="DeepSeek Search") && r.query===query.web ||
      r.engine==="Codex Web" && r.query.split("；").includes(query.web)) && r.hits.length)).map(q=>q.web))];
  const nativeSearch=tools ? tools.nativeSearch : options.nativeSearch;
  if(options.readPages!==false && nativeSearch && missing.length && !options.focus?.strict){
    signal.throwIfAborted();
    const row:SearchRun={engine:"Codex Web",query:missing.join("；"),status:"running",hits:[],startedAt:new Date().toISOString()};
    runs.push(row);publish();const start=Date.now();
    try{
      const result=await nativeSearch(missing,signal);
      signal.throwIfAborted();row.hits=result.hits;row.query=result.queries.join("；") || row.query;row.status="done";
    }catch(error){signal.throwIfAborted();row.status="failed";row.error=failure(error);}
    row.elapsedMs=Date.now()-start;publish();
  }
  if(options.readPages===false)return runs;
  if (options.deepseekTools?.fetch) {
    const attachmentTargets:WebHit[]=[];
    // A named public archive's small index can answer an actual-record follow-up before more broad page reads.
    const localArchiveRead=options.archiveRead;
    const archiveRead=tools ? tools.archiveRead : localArchiveRead && (
      (hit:WebHit, signal:AbortSignal, question:string) => localArchiveRead(hit,signal,undefined,{question}));
    const explicitArchive=explicitArchiveTarget([{web:options.archiveQuestion||"",dataset:""}])||explicitArchiveTarget(activeQueries)
      ||priorArchiveTarget(options.archiveQuestion||"",options.priorArchiveTargets);
    if(archiveRead&&(explicitArchive||/(?:metadata|index|manifest|csv|sample|specimen|raw|scale|原图|索引|元数据|样品|标本|原始|记录|字段|文件|标尺)/i.test(activeQueries.map(q=>q.web+" "+q.dataset).join(" ")))){
      const archive=explicitArchive||pagesToRead(runs,activeQueries,options.focus).slice(0,3).find(p=>zenodoRecordId(p.hit))?.hit;
      if(archive)await performSearch("https://zenodo.org/api/records/"+zenodoRecordId(archive),"原站读取",async requestSignal=>{
        const result=await archiveRead(archive,requestSignal,options.archiveQuestion||activeQueries.map(q=>q.web).join(" "));
        attachmentTargets.push(...(result.attachmentTargets||[]));
        return result;
      });
    }
    const attachedUrls=new Set(attachmentTargets.map(hit=>hit.url));
    const queue=[...attachmentTargets.map(hit=>({hit,urls:[hit.url],attempt:0,forcePdf:true})),
      ...pagesToRead(runs,activeQueries,options.focus).filter(page=>!page.hit.pageExcerpt&&!attachedUrls.has(page.hit.url)).map(page=>({...page,attempt:0,forcePdf:false}))];
    const seenText=new Set(runs.flatMap(r=>r.hits.flatMap(h=>h.pageExcerpt?[h.pageExcerpt.replace(/\s+/g," ").trim()]:[]))),originUrls=new Set<string>();
    const originRead=tools ? tools.originRead : options.originRead;
    const pdfRead=tools ? tools.pdfRead : options.pdfRead;
    const fetchPage=tools ? tools.fetchPage
      : fetchImpl && ((hit:WebHit,url:string,signal:AbortSignal) => deepSeekFetch(hit,url,signal,fetchImpl));
    if(!fetchPage)throw Error("未配置公开网络读取工具。");
    let attempts=0,stopBatch=false;
    while(queue.length && seenText.size<3 && attempts<6 && !stopBatch){
      signal.throwIfAborted();
      const batch=queue.splice(0,Math.min(3-seenText.size,6-attempts));
      attempts+=batch.length;
      const alternates=await Promise.all(batch.map(async page=>{
        const url=page.urls[page.attempt];
        const address=new URL(url);
        let pathname=address.pathname;try{pathname=decodeURIComponent(pathname);}catch{/* Keep the validated URL path when its percent encoding is malformed. */}
        const pdf=page.forcePdf||/\.pdf(?:\/content)?$/i.test(pathname)||[...address.searchParams.values()].includes("embedded_pdf");
        const readStarted=Date.now();
        if(pdf && pdfRead){
          const count=await performSearch(url,"PDF 原文",async requestSignal=>{
            const result=await pdfRead(page.hit,url,requestSignal,[options.archiveQuestion,...activeQueries.map(q=>q.web)].filter(Boolean).join(" "),options.archiveQuestion);
            const fingerprint=result.hits[0]?.pageExcerpt?.replace(/\s+/g," ").trim();
            if(!fingerprint)throw Error("读取回执没有正文。");
            if(seenText.has(fingerprint))return {hits:[],warning:"正文与已读 PDF 重复。"};
            seenText.add(fingerprint);
            return result;
          });
          if(count || seenText.size>=3)return;
        }
        let alternate=false,originEligible=false;
        await performSearch(url,"DeepSeek Fetch",async requestSignal=>{
          try {
            const result=await fetchPage(page.hit,url,pdf?AbortSignal.any([requestSignal,AbortSignal.timeout(Math.max(1,18000-(Date.now()-readStarted)))]):requestSignal);
            const fingerprint=result.hits[0]?.pageExcerpt?.replace(/\s+/g," ").trim();
            if(!fingerprint)throw Error("读取回执没有正文。");
            if(seenText.has(fingerprint)) return {hits:[],warning:"正文与本轮已读取的页面重复。"};
            seenText.add(fingerprint);
            return result;
          } catch(error) {
            if(error instanceof DeepSeekRequestError && error.stopBatch) stopBatch=true;
            originEligible=error instanceof DeepSeekRequestError
              ?!error.stopBatch && [404,410].includes(error.status||0)
              :error instanceof Error && error.message==="DeepSeek Fetch 未取得网页正文。";
            // Try one alternative for a source-specific error, then move on to other records.
            alternate=page.attempt===0 && page.urls.length>1;
            throw error;
          }
        });
        // One bounded public text attempt, retaining the provider failure as its own real step.
        // Do not turn provider timeouts, account failures, or user cancellation into extra work.
        if(!pdf && originRead && originEligible && !stopBatch && originUrls.size<3 && !originUrls.has(url)){
          originUrls.add(url);
          const count=await performSearch(url,"原站读取",async requestSignal=>{
            const result=await originRead(page.hit,url,requestSignal);
            const fingerprint=result.hits[0]?.pageExcerpt?.replace(/\s+/g," ").trim();
            if(!fingerprint)throw Error("读取回执没有正文。");
            if(seenText.has(fingerprint))return {hits:[],warning:"原站正文与本轮已读取的页面重复。"};
            seenText.add(fingerprint);return result;
          });
          if(count)alternate=false;
        }
        return alternate?{...page,attempt:1}:undefined;
      }));
      queue.unshift(...alternates.filter(p=>p!==undefined));
    }
  }
  return runs;
}
