import type {WebHit} from "../src/domain/types";
import {deepSeekKey} from "./model-service";
import {publicPage, usefulPageText} from "./fetch-pages";
import {createHash} from 'node:crypto';
import {sourceSnapshotCache} from './search-cache';
const snapshots=sourceSnapshotCache();

export class DeepSeekRequestError extends Error {
  constructor(message:string,readonly stopBatch:boolean,readonly status?:number) { super(message); }
}

async function request(tool: "search" | "fetch", body: object, signal: AbortSignal, fetchImpl: typeof fetch) {
  const key = deepSeekKey();
  if (!key) throw new DeepSeekRequestError("请在设置中配置 DeepSeek API Key。",true);
  signal.throwIfAborted();
  const cacheKey=createHash('sha256').update(key).digest('hex')+':'+tool+':'+JSON.stringify(body);
  const cached=fetchImpl===fetch?snapshots.get(cacheKey,tool==='search'?300000:600000):undefined;
  if(cached)return {...cached,cacheKey};
  const response = await fetchImpl("https://api.deepseek.com/v1/tools/" + tool, {
    method: "POST", redirect: "error", signal,
    headers: {Authorization: "Bearer " + key, "Content-Type": "application/json"},
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new DeepSeekRequestError("DeepSeek " + tool + " 请求失败（HTTP " + response.status + "）。",[401,402,403,429].includes(response.status),response.status);
  const data=await response.json();signal.throwIfAborted();
  if(fetchImpl===fetch && tool==='search' && Array.isArray(data?.results))snapshots.put(cacheKey,data);
  return {data,cacheStoredAt:undefined,cacheKey};
}

export async function deepSeekSearch(query: string, signal: AbortSignal, fetchImpl: typeof fetch) {
  const {data,cacheStoredAt} = await request("search", {query, count: 6}, signal, fetchImpl);
  if (!Array.isArray(data?.results)) throw Error("DeepSeek Search 未返回有效结果列表。");
  const hits = new Map<string, WebHit>();
  for (const result of data.results) {
    const url = publicPage(result?.url);
    if (!url || typeof result.title !== "string" || !result.title.trim() || hits.has(url)) continue;
    const snippet = typeof result.snippet === "string" && result.snippet.trim() ? result.snippet : result.summary;
    hits.set(url, {url, title: result.title.trim().slice(0,360), snippet: typeof snippet === "string" ? snippet.slice(0,1200) : ""});
  }
  return {hits: [...hits.values()],...(cacheStoredAt?{cacheStoredAt}:{})};
}

export async function deepSeekFetch(hit: WebHit, address: string, signal: AbortSignal, fetchImpl: typeof fetch) {
  const url = publicPage(address);
  if (!url) throw Error("没有可公开读取的网页地址。");
  const {data,cacheStoredAt,cacheKey} = await request("fetch", {url}, signal, fetchImpl);
  if (typeof data?.content !== "string" || !usefulPageText(data.content,hit)) throw Error("DeepSeek Fetch 未取得网页正文。");
  if(!cacheStoredAt && fetchImpl===fetch)snapshots.put(cacheKey,data);
  const content: string = data.content.trim();
  const sections = content.split(/(?=^#{1,4}\s)/m);
  const details = sections.filter(section => /^#{1,4}\s+[^\n]*(?:version|variable|download|access|版本|变量|下载|获取)/i.test(section));
  const head = content.slice(0,3200);
  const evidence = [head,...details.filter(section => !head.includes(section.slice(0,200))).map(section => section.slice(0,900))];
  return {hits: [{...hit, pageExcerpt: evidence.join("\n…\n").slice(0,5200)}],...(cacheStoredAt?{cacheStoredAt}:{})};
}
