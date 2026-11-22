import {assetById,assets,registerHaina,type Asset} from "../src/domain/datasets";
import {mkdirSync,readFileSync,renameSync,writeFileSync} from "node:fs";
import path from "node:path";
import {randomUUID} from "node:crypto";
import bundled from "../src/data/evidence/haina.json";
import {hainaRecord,validHainaCatalog,type HainaCatalog,type HainaRecord} from "../src/domain/haina-record";
import {cachedHainaThumbnail,fetchHainaCatalog,hainaConfig} from "./haina-api";
import type {HainaCatalogPage} from "./discovery-materials-contract";

const generic=new Set(["数据","数据集","资料","查找","获取","研究","分析","data","dataset","datasets","find","the","and","for","of","如何","怎么","哪些","问题","需要","相关","什么","是否","支持","回答","验证","数据需求","提供","have","with","what","why","how"]);
const segmenter=new Intl.Segmenter("zh",{granularity:"word"});
export function searchHaina(queries:string[],source:readonly Asset[]=assets):Asset[] {
  const terms=[...new Set(queries.flatMap(q=>[...segmenter.segment(q.toLowerCase().normalize("NFKC"))]
    .filter(s=>s.isWordLike && s.segment.length>1 && !generic.has(s.segment)).map(s=>s.segment)))];
  return source.filter(a=>a.origins.includes("haina")).map(asset=>{
    const title=asset.title.toLowerCase(),description=asset.description.toLowerCase();
    const matches=terms.filter(t=>title.includes(t)||description.includes(t));
    return {asset,score:matches.reduce((n,t)=>n+(title.includes(t)?3:1),0)};
  }).filter(row=>row.score>0).sort((a,b)=>b.score-a.score).slice(0,15).map(row=>row.asset);
}
export type HainaCatalogStatus = Omit<HainaCatalogPage,"records"|"nextCursor"|"complete">;
export interface HainaSearchResult {
  assets:Asset[];total:number;synced:string;endpoint:string;warning:string;
  records?:HainaRecord[];
  catalog?:HainaCatalogStatus;
}
type Options={fetcher?:typeof fetch;now?:()=>number;intervalMs?:number;publicDir?:string;config?:ReturnType<typeof hainaConfig>};
export function hainaService(file:string,options:Options={}){
  const config=options.config||hainaConfig(),now=options.now||Date.now,interval=options.intervalMs??300000;
  type Published = {catalog:HainaCatalog;assets:Asset[];byAsset:Map<string,HainaRecord>};
  let published:Published|undefined,lastError="",lastAttempt=0,pending:Promise<Published>|undefined;
  function publish(value:HainaCatalog) {
    const catalog = {...value,records:[...value.records].sort((a,b)=>a.id-b.id)};
    registerHaina(catalog.records,catalog.synced,catalog.endpoint);
    const byAsset = new Map(catalog.records.map(record=>["haina:"+record.id,record]));
    const assets = [...byAsset.keys()].flatMap(id=>assetById.get(id) || []);
    published = {catalog,assets,byAsset};
    return published;
  }
  for(const value of [()=>JSON.parse(readFileSync(file,"utf8")),()=>bundled]){
    try{const c=value();if(validHainaCatalog(c)&&c.endpoint===config.endpoint&&c.areaId===config.areaId){publish(c);break;}}catch{/* A partial or obsolete cache never becomes a complete catalogue. */}
  }
  function status(catalog=published?.catalog):HainaCatalogStatus {
    return {synced:catalog?.synced||"",total:catalog?.total||0,endpoint:config.endpoint,areaId:config.areaId,
      warning:lastError,refreshing:!!pending};
  }
  function refresh(){
    if(pending)return pending;
    lastAttempt=now();
    pending=(async()=>{
      try{
        const result=await fetchHainaCatalog({fetcher:options.fetcher,config});
        const next:HainaCatalog={synced:new Date(now()).toISOString(),endpoint:result.endpoint,areaId:result.areaId,total:result.total,
          records:result.rows.map(row=>hainaRecord(row,cachedHainaThumbnail(row.browseGraph,options.publicDir||path.resolve("public"))))};
        mkdirSync(path.dirname(file),{recursive:true});
        const temporary=file+"."+randomUUID();
        writeFileSync(temporary,JSON.stringify(next));renameSync(temporary,file);
        const snapshot=publish(next);
        lastError="";return snapshot;
      }catch(error){lastError=error instanceof Error?error.message:"海纳目录同步失败";throw error;}
      finally{pending=undefined;}
    })();
    return pending;
  }
  async function readyForDiscovery(signal:AbortSignal) {
    signal.throwIfAborted();
    const mayRetry = !lastError || now()-lastAttempt>=60000;
    if (published) {
      if (!pending && mayRetry && now()-Date.parse(published.catalog.synced)>=interval) void refresh().catch(()=>{});
      return published;
    }
    const task = pending ?? (mayRetry ? refresh() : undefined);
    if (!task) throw Error(lastError || "海纳目录尚未完成同步。");
    let abort = () => {};
    try {
      return await Promise.race([task,new Promise<never>((_resolve,reject)=>{
        abort=()=>reject(signal.reason);
        signal.addEventListener("abort",abort,{once:true});
      })]);
    } finally {signal.removeEventListener("abort",abort);}
  }
  return {
    async refresh(){return (await refresh()).catalog;},
    records:()=>published?.catalog.records||[],
    status:()=>status(),
    async search(queries:string[],signal:AbortSignal):Promise<HainaSearchResult>{
      const snapshot=await readyForDiscovery(signal),c=snapshot.catalog;
      signal.throwIfAborted();
      const assets=searchHaina(queries,snapshot.assets);
      return {assets,total:c.total,synced:c.synced,endpoint:c.endpoint,
        records:assets.flatMap(asset=>snapshot.byAsset.get(asset.id)||[]),catalog:status(c),
        warning:lastError?"海纳接口同步失败，检索使用上次完整目录（"+c.synced+"）："+lastError:""};
    },
    async page(cursor:number,limit:number,signal?:AbortSignal):Promise<HainaCatalogPage>{
      signal?.throwIfAborted();
      const c=published?.catalog;
      if (!c) throw Error(lastError || "海纳目录尚未完成同步。");
      const rows=c.records.filter(r=>r.id>cursor),records=rows.slice(0,limit);
      return {...status(c),records,nextCursor:rows.length>limit?records.at(-1)!.id:null,complete:true};
    },
    start(){
      void refresh().catch(()=>{});
      const timer=setInterval(()=>void refresh().catch(()=>{}),interval);timer.unref();return ()=>clearInterval(timer);
    },
  };
}
