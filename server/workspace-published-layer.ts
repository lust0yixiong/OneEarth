import {createHash} from "node:crypto";
import {publishedWorkspaceLayerRecipes,isPublishedWorkspaceLayerId,validWorkspacePublishedLayerAction,type PublishedWorkspaceLayerId,type WorkspacePublishedLayerAction} from "../src/domain/workspace-published-layer";
import {c40CityManifestPath,forestFrameManifestPath,workspacePublicationRevision} from "../src/domain/workspace-view-context";
import {isForestDate} from "../src/domain/regional-cases";
import {publishedC40Cities,uniquePublishedCity} from "./workspace-c40-publication";
import {publishedForestDates} from "./workspace-forest-publication";

type Publication={revision:string;choices:{id:string;label:string}[];cities?:ReturnType<typeof publishedC40Cities>};
type Resolution={action?:WorkspacePublishedLayerAction;label?:string;title?:string;issue?:string;read?:{status:number;bytes:number};revalidate?:(signal:AbortSignal)=>Promise<boolean>};

/** Only registered viewer publications are fetched, after one model selects a dataset and a precise value. */
export function workspacePublishedLayers(options:{origin?:string;fetchImpl?:typeof fetch}={}){
  const cache=new Map<string,Publication>();
  async function load(datasetId:PublishedWorkspaceLayerId,signal:AbortSignal,expected?:string){
    const recipe=publishedWorkspaceLayerRecipes[datasetId],city=recipe.controlId==="city";
    const origin=new URL(options.origin||process.env.ONEEARTH_SPATIAL_URL||"http://127.0.0.1:5276");
    if(!["http:","https:"].includes(origin.protocol)||origin.username||origin.password)throw Error("内部时空发布目录不可用。");
    const url=new URL(city?c40CityManifestPath:forestFrameManifestPath,origin),cached=cache.get(url.href);
    const response=await (options.fetchImpl||fetch)(url,{redirect:"error",signal:AbortSignal.any([signal,AbortSignal.timeout(2500)]),
      headers:{accept:"application/json",...(cached?{"if-none-match":'"'+cached.revision+'"'}:{})}});
    const etag=response.headers.get("etag");let publication:Publication,readBytes=0;
    if(response.status===304){
      if(!cached||workspacePublicationRevision(etag)!==cached.revision)throw Error("发布目录修订不可核对。");
      publication=cached;
    }else{
      if(!response.ok){await response.body?.cancel();throw Error("所选数据集的发布目录暂不可用。");}
      const maxBytes=(city?2:4)*1024*1024;
      if(Number(response.headers.get("content-length"))>maxBytes){await response.body?.cancel();throw Error("发布目录超过读取上限。");}
      const reader=response.body?.getReader();if(!reader)throw Error("发布目录没有内容。");
      const chunks:Uint8Array[]=[];let size=0;
      try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>maxBytes)throw Error("发布目录超过读取上限。");chunks.push(part.value);}}
      catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
      const bytes=Buffer.concat(chunks),revision=createHash("sha256").update(bytes).digest("hex");readBytes=bytes.length;
      if(etag!==null&&workspacePublicationRevision(etag)!==revision)throw Error("发布目录内容与修订不符。");
      let value:unknown;try{value=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));}catch{throw Error("发布目录格式无效。");}
      const cities=city?publishedC40Cities(value):undefined;
      publication={revision,choices:cities?cities.map(({id,label})=>({id,label})):publishedForestDates(value).map(date=>({id:date,label:date})),...(cities?{cities}:{})};
      cache.delete(url.href);cache.set(url.href,publication);while(cache.size>8)cache.delete(cache.keys().next().value!);
    }
    if(expected&&publication.revision!==expected)throw Error("发布目录已变化，请按当前目录重新选择。");
    return {publication,read:{status:response.status,bytes:readBytes}};
  }
  return async function resolve(datasetId:unknown,selection:unknown,signal:AbortSignal):Promise<Resolution>{
    signal.throwIfAborted();
    if(!isPublishedWorkspaceLayerId(datasetId))return {issue:"该资料没有已登记的发布图层，本轮未加载。"};
    const recipe=publishedWorkspaceLayerRecipes[datasetId];
    if(typeof selection!=="string"||!selection.trim()||selection.length>200||/[\u0000-\u001f\u007f]/u.test(selection)||
      recipe.controlId==="time"&&!isForestDate(selection))return {issue:"请明确已发布的城市名称、稳定编号或完整日期，本轮未加载。"};
    try{
      const {publication,read}=await load(datasetId,signal);
      const choice=publication.cities?uniquePublishedCity(publication.cities,selection):publication.choices.find(choice=>choice.id===selection);
      if(!choice)return {issue:"该选择不能唯一对应当前已发布条目，本轮未加载，也未选择相近名称或日期。",read};
      const action={kind:"open-published-layer" as const,datasetId,valueId:choice.id,publicationRevision:publication.revision};
      if(!validWorkspacePublishedLayerAction(action))return {issue:"发布条目的身份不符合当前查看器要求，本轮未加载。",read};
      return {action,label:choice.label,title:recipe.title,read,
        revalidate:async nextSignal=>{try{await load(datasetId,nextSignal,publication.revision);return true;}catch{nextSignal.throwIfAborted();return false;}}};
    }catch(error){signal.throwIfAborted();return {issue:error instanceof Error?error.message:"发布目录暂不可用，本轮未加载。"};}
  };
}

export const resolveWorkspacePublishedLayer=workspacePublishedLayers();
