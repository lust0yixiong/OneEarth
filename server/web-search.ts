import type {DeepSeekTools} from "../src/domain/deepseek-tools";
import {deepSeekSearch, deepSeekFetch, DeepSeekRequestError} from "./deepseek-web";
import {pagesToRead} from "./fetch-pages";
import { load } from "cheerio";
import type { SearchQuery, SearchRun, WebHit } from "../src/domain/types";
import { searchDataCite } from "./datacite-search";
import {readPdfPage} from "./read-pdf-page";
import {readOriginPage} from "./origin-page";
import {readArchiveIndex,zenodoRecordId,explicitArchiveTarget,priorArchiveTarget,type PriorArchiveTarget} from "./archive-index";
import type {WebComplementPlan} from "./web-complement";

function safeLink(raw:string,unwrap=false) {
  if(!raw.trim())return "";
  try {
    let url=new URL(raw,"https://duckduckgo.com");
    if(unwrap && (url.hostname==="duckduckgo.com" || url.hostname.endsWith(".duckduckgo.com")) && url.searchParams.has("uddg"))
      url=new URL(url.searchParams.get("uddg")!);
    return ["http:","https:"].includes(url.protocol) && !url.username && !url.password ? url.href : "";
  }catch{return "";}
}
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

export function parseBingResults(body:string) {
  const $=load(body,{xmlMode:true});
  if(!$("rss > channel").length)throw Error("Bing 未返回搜索结果页，可能需要验证");
  const hits:WebHit[]=[];
  $("channel > item").each((_,el)=>{
    const title=$(el).find("title").first().text().trim(),url=safeLink($(el).find("link").first().text().trim());
    if(title && url && !hits.some(h=>h.url===url))hits.push({title,url,snippet:load($(el).find("description").text()).text().trim().slice(0,600)});
  });
  return hits.slice(0,6);
}
export function relevantWebHits(hits:WebHit[],query:string) {
  const identifiers=[...new Set((query.match(/\b(?:[A-Z]{2,}[A-Z0-9.-]*|[A-Za-z]+[0-9][A-Za-z0-9.-]*)\b/g)||[]).filter(t=>!/^V\d/i.test(t)))];
  const products=identifiers.filter(t=>!["NOAA","NASA","ESA","USGS"].includes(t));
  const anchors=products.length?products:identifiers;
  const generic=new Set(["data","dataset","datasets","product","products","find","retrieve","from","with","and","the","for","official","download","资料","数据","研究","查找","需要","产品"]);
  const terms=[...new Set([...new Intl.Segmenter("zh",{granularity:"word"}).segment(query.toLowerCase())]
    .filter(t=>t.isWordLike && t.segment.length>=2 && !generic.has(t.segment)).map(t=>t.segment))];
  const contains=(text:string,term:string)=>/^[a-z0-9.-]+$/i.test(term)
    ?new RegExp("(?:^|[^a-z0-9])"+term.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")+"(?=$|[^a-z0-9])","i").test(text)
    :text.includes(term);
  const filtered=hits.filter(h=>{
    const text=(h.title+" "+h.snippet).toLowerCase();
    return anchors.length?anchors.some(t=>contains(text,t.toLowerCase()))
      :terms.length>0 && terms.filter(t=>contains(text,t)).length>=Math.min(6,Math.max(2,Math.ceil(terms.length*.55)),terms.length);
  });
  return {hits:filtered,warning:filtered.length<hits.length?"已排除 "+(hits.length-filtered.length)+" 条不含检索关键词的网页结果。":undefined};
}
async function searchBing(query:string,signal:AbortSignal,fetchImpl:typeof fetch) {
  const url=new URL("https://www.bing.com/search");
  url.search=new URLSearchParams({q:query,format:"rss",setlang:"en-US"}).toString();
  const res=await fetchImpl(url,{signal});
  if(!res.ok)throw Error("Bing 返回 HTTP "+res.status);
  return {...relevantWebHits(parseBingResults(await res.text()),query),requestUrl:url.href};
}
export function parseDuckDuckGoResults(body:string) {
  const $=load(body);
  if($(".anomaly-modal, #challenge-form").length)throw Error("DuckDuckGo 要求验证码验证");
  const hits:WebHit[]=[];
  function add(title:string,raw:string,snippet:string) {
    if (!/^(?:https?:\/\/|\/)/i.test(raw)) return;
    const url=safeLink(raw,true);
    if (!title || !url || /(?:^|\.)duckduckgo\.com$/i.test(new URL(url).hostname) || hits.some(h=>h.url===url)) return;
    hits.push({title,url,snippet:snippet.trim().slice(0,600)});
  }
  if ($(".results, .no-results").length) {
    $(".result").not(".result--ad").each((_,el)=>{
      const a=$(el).find(".result__a");
      add(a.text().trim(),a.attr("href")||"",$(el).find(".result__snippet").text());
    });
  } else if ($("a.result-link").length) {
    $("a.result-link").each((_,el)=>{
      const a=$(el),row=a.closest("tr");
      if (!row.find(".badge--ad,.result-sponsored").length) {
        add(a.text().trim(),a.attr("href")||"",row.next("tr").find(".result-snippet").text());
      }
    });
  } else if (!$("form[action*='/lite/']").length || !/no (?:more )?results found/i.test($("body").text())) {
    throw Error("DuckDuckGo 未返回可识别的结果页");
  }
  return hits.slice(0,6);
}
export async function searchDuckDuckGo(query:string,signal:AbortSignal,fetchImpl:typeof fetch=fetch) {
  // Allow time for the Lite endpoint if the HTML connection resets or stalls.
  const endpoints=["https://html.duckduckgo.com/html/","https://lite.duckduckgo.com/lite/"];
  for (const [index,endpoint] of endpoints.entries()) {
    signal.throwIfAborted();
    const url=new URL(endpoint);url.searchParams.set("q",query);
    let res:Response,body:string;
    try {
      const attempt=index===0?AbortSignal.any([signal,AbortSignal.timeout(4500)]):signal;
      res=await fetchImpl(url,{signal:attempt,headers:{Accept:"text/html"}});
      if (index===0 && [502,503,504].includes(res.status)) {await res.body?.cancel();continue;}
      if (!res.ok) {await res.body?.cancel();throw Error("DuckDuckGo 返回 HTTP "+res.status);}
      body=await res.text();
    } catch (error) {
      signal.throwIfAborted();
      if(index===0 && (error instanceof TypeError || (error instanceof Error && error.name==="TimeoutError"))) continue;
      throw error;
    }
    return {...relevantWebHits(parseDuckDuckGoResults(body),query),requestUrl:url.href};
  }
  throw Error("DuckDuckGo 连接失败");
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
  archiveQuestion?:string;priorArchiveTargets?:PriorArchiveTarget[];
  nativeSearch?:(queries:string[],signal:AbortSignal)=>Promise<{hits:WebHit[];queries:string[]}>};
export async function searchSources(queries:SearchQuery[],signal:AbortSignal,update:(runs:SearchRun[])=>void,options:SearchOptions={}) {
  const runs:SearchRun[]=(options.initialRuns||[]).map(r=>({...r,hits:[...r.hits]})),fetchImpl=options.fetchImpl || fetch;
  const activeQueries=[...new Map([...queries.slice(0,3),...(options.focus?.queries||[]).slice(0,2)]
    .map(q=>[q.web+"\n"+q.dataset,q])).values()];
  const pending=new Map<string,Promise<number>>();
  const publish=()=>update(runs.map(r=>({...r,hits:[...r.hits]})));
  type SearchEngine = "Bing" | "DuckDuckGo" | "DataCite" | "DeepSeek Search";
  const providers = {Bing:searchBing, DuckDuckGo:searchDuckDuckGo, DataCite:searchDataCite, "DeepSeek Search":deepSeekSearch};
  for(const r of runs)if(r.status!=="running"&&r.engine in providers)
    pending.set(r.engine+":"+r.query,Promise.resolve(r.hits.length));
  function search(query:string,engine:SearchEngine) {
    const key=engine+":"+query,existing=pending.get(key);
    if(existing)return existing;
    const promise=performSearch(query,engine,requestSignal=>providers[engine](query,requestSignal,fetchImpl));pending.set(key,promise);return promise;
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
  if(options.readPages!==false && options.nativeSearch && missing.length && !options.focus?.strict){
    signal.throwIfAborted();
    const row:SearchRun={engine:"Codex Web",query:missing.join("；"),status:"running",hits:[],startedAt:new Date().toISOString()};
    runs.push(row);publish();const start=Date.now();
    try{
      const result=await options.nativeSearch(missing,signal);
      signal.throwIfAborted();row.hits=result.hits;row.query=result.queries.join("；") || row.query;row.status="done";
    }catch(error){signal.throwIfAborted();row.status="failed";row.error=failure(error);}
    row.elapsedMs=Date.now()-start;publish();
  }
  if(options.readPages===false)return runs;
  if (options.deepseekTools?.fetch) {
    const attachmentTargets:WebHit[]=[];
    // A named public archive's small index can answer an actual-record follow-up before more broad page reads.
    const archiveRead=options.archiveRead===false?undefined:options.archiveRead||(!options.fetchImpl?readArchiveIndex:undefined);
    const explicitArchive=explicitArchiveTarget([{web:options.archiveQuestion||"",dataset:""}])||explicitArchiveTarget(activeQueries)
      ||priorArchiveTarget(options.archiveQuestion||"",options.priorArchiveTargets);
    if(archiveRead&&(explicitArchive||/(?:metadata|index|manifest|csv|sample|specimen|raw|scale|原图|索引|元数据|样品|标本|原始|记录|字段|文件|标尺)/i.test(activeQueries.map(q=>q.web+" "+q.dataset).join(" ")))){
      const archive=explicitArchive||pagesToRead(runs,activeQueries,options.focus).slice(0,3).find(p=>zenodoRecordId(p.hit))?.hit;
      if(archive)await performSearch("https://zenodo.org/api/records/"+zenodoRecordId(archive),"原站读取",async requestSignal=>{
        const result=await archiveRead(archive,requestSignal,undefined,{question:options.archiveQuestion||activeQueries.map(q=>q.web).join(" ")});
        attachmentTargets.push(...(result.attachmentTargets||[]));
        return result;
      });
    }
    const attachedUrls=new Set(attachmentTargets.map(hit=>hit.url));
    const queue=[...attachmentTargets.map(hit=>({hit,urls:[hit.url],attempt:0,forcePdf:true})),
      ...pagesToRead(runs,activeQueries,options.focus).filter(page=>!page.hit.pageExcerpt&&!attachedUrls.has(page.hit.url)).map(page=>({...page,attempt:0,forcePdf:false}))];
    const seenText=new Set(runs.flatMap(r=>r.hits.flatMap(h=>h.pageExcerpt?[h.pageExcerpt.replace(/\s+/g," ").trim()]:[]))),originUrls=new Set<string>();
    const originRead=options.originRead===false?undefined:options.originRead || readOriginPage;
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
        if(pdf){
          const count=await performSearch(url,"PDF 原文",async requestSignal=>{
            const result=await readPdfPage(page.hit,url,requestSignal,undefined,[options.archiveQuestion,...activeQueries.map(q=>q.web)].filter(Boolean).join(" "),options.archiveQuestion);
            const fingerprint=result.hits[0].pageExcerpt.replace(/\s+/g," ").trim();
            if(seenText.has(fingerprint))return {hits:[],warning:"正文与已读 PDF 重复。"};
            seenText.add(fingerprint);
            return result;
          });
          if(count || seenText.size>=3)return;
        }
        let alternate=false,originEligible=false;
        await performSearch(url,"DeepSeek Fetch",async requestSignal=>{
          try {
            const result=await deepSeekFetch(page.hit,url,pdf?AbortSignal.any([requestSignal,AbortSignal.timeout(Math.max(1,18000-(Date.now()-readStarted)))]):requestSignal,fetchImpl);
            const fingerprint=result.hits[0].pageExcerpt.replace(/\s+/g," ").trim();
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
            const fingerprint=result.hits[0].pageExcerpt.replace(/\s+/g," ").trim();
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
