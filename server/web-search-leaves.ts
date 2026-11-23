import {load} from "cheerio";
import type {WebHit} from "../src/domain/types";
export {searchDataCite} from "./datacite-search";

function safeLink(raw:string,unwrap=false) {
  if(!raw.trim())return "";
  try {
    let url=new URL(raw,"https://duckduckgo.com");
    if(unwrap && (url.hostname==="duckduckgo.com" || url.hostname.endsWith(".duckduckgo.com")) && url.searchParams.has("uddg"))
      url=new URL(url.searchParams.get("uddg")!);
    return ["http:","https:"].includes(url.protocol) && !url.username && !url.password ? url.href : "";
  }catch{return "";}
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
export async function searchBing(query:string,signal:AbortSignal,fetchImpl:typeof fetch=fetch) {
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
