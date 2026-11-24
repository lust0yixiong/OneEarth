import {createHash} from "node:crypto";
import {forestFrameManifestPath,workspacePublicationRevision,type WorkspaceViewChoice,type WorkspaceViewContext,type WorkspaceViewPublication} from "../src/domain/workspace-view-context";
import {isForestDate} from "../src/domain/regional-cases";

export type PublishedDateSelection={kind:"resolve-published-date";layerId:"forest";controlId:"time";mode:"exact"|"next"|"previous";date:string|null};
/** Runtime-only proof: publication members are never supplied by the caller. */
export type ForestPublicationProof={revision:string;ids:string[];summary:{checkedTotal:number;first:string;last:string;current:string;sequence:"published"}};
type Publication={revision:string;dates:string[]};
type Resolution={view:WorkspaceViewContext|undefined;proof?:ForestPublicationProof;issue?:string;read?:{status:number;bytes:number};
  lookup?:(selection:Pick<PublishedDateSelection,"mode"|"date">)=>{choice?:WorkspaceViewChoice;issue?:string};
  revalidate?:(signal:AbortSignal)=>Promise<boolean>};
const maxBytes=4*1024*1024,maxFrames=10000;

export function publishedForestDates(value:any):string[]{
  if(!value||value.version!==1||value.datasetId!=="haina:1846764"||!Array.isArray(value.frames)||!value.frames.length||value.frames.length>maxFrames)
    throw Error("森林日期目录格式或规模不可用");
  return value.frames.map((frame:any,index:number)=>{
    if(!frame||!isForestDate(frame.date)||index>0&&value.frames[index-1].date>=frame.date)throw Error("森林日期目录须为不重复的已发布日期序列");
    return frame.date;
  });
}

/** Only the deployment's fixed spatial manifest is read. No image or source read. */
export function workspaceForestPublications(options:{origin?:string;fetchImpl?:typeof fetch}={}){
  const cache=new Map<string,Publication>();
  async function load(expected:WorkspaceViewPublication,signal:AbortSignal){
    const origin=new URL(options.origin||process.env.ONEEARTH_SPATIAL_URL||"http://127.0.0.1:5276");
    if(!["http:","https:"].includes(origin.protocol)||origin.username||origin.password)throw Error("内部时空服务不可用");
    const url=new URL(forestFrameManifestPath,origin),key=url.href+"#"+expected.revision,cached=cache.get(key);
    const response=await (options.fetchImpl||fetch)(url,{signal:AbortSignal.any([signal,AbortSignal.timeout(2500)]),redirect:"error",
      headers:{accept:"application/json",...(cached?{"if-none-match":'"'+expected.revision+'"'}:{})}});
    const etag=response.headers.get("etag");let publication:Publication,readBytes=0;
    if(response.status===304){
      if(!cached||workspacePublicationRevision(etag)!==expected.revision)throw Error("森林日期目录修订不可核对");
      publication=cached;
    }else{
      if(!response.ok){await response.body?.cancel();throw Error("当前森林日期目录不可用");}
      if(Number(response.headers.get("content-length"))>maxBytes){await response.body?.cancel();throw Error("森林日期目录超过读取上限");}
      const reader=response.body?.getReader();if(!reader)throw Error("森林日期目录没有内容");
      const chunks:Uint8Array[]=[];let size=0;
      try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>maxBytes)throw Error("森林日期目录超过读取上限");chunks.push(part.value);}}
      catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
      const bytes=Buffer.concat(chunks),revision=createHash("sha256").update(bytes).digest("hex");readBytes=bytes.length;
      if(etag!==null&&workspacePublicationRevision(etag)!==revision)throw Error("森林日期目录内容与发布修订不符");
      let value:unknown;try{value=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));}catch{throw Error("森林日期目录内容格式无效");}
      publication={revision,dates:publishedForestDates(value)};
      const actualKey=url.href+"#"+revision;cache.delete(actualKey);cache.set(actualKey,publication);
      while(cache.size>8)cache.delete(cache.keys().next().value!);
    }
    if(publication.revision!==expected.revision||publication.dates.length!==expected.total)throw Error("森林日期目录已更新，请刷新后再选择");
    cache.delete(key);cache.set(key,publication);return {...publication,read:{status:response.status,bytes:readBytes}};
  }
  return async function resolve(view:WorkspaceViewContext|undefined,signal:AbortSignal):Promise<Resolution>{
    const layer=view?.activeLayer,control=layer?.controls.find(control=>control.id==="time"&&control.publication?.kind==="forest-frames");
    if(layer?.id!=="forest"||!control?.publication)return {view};
    const expected=control.publication;
    try{
      if(layer.status!=="ready")throw Error("当前森林图层尚未就绪");
      const publication=await load(expected,signal),entries=publication.dates,index=entries.indexOf(control.current.id);
      if(index<0)throw Error("当前森林日期已不在发布目录中，请刷新后再选择");
      const choices=entries.slice(Math.max(0,index-2),index+3).map(date=>({id:date,label:date}));
      const resolved:WorkspaceViewContext={...view!,activeLayer:{...layer,controls:layer.controls.map(item=>item!==control?item:{...control,
        ordered:true,current:{id:entries[index],label:entries[index]},options:choices})}};
      return {view:resolved,proof:{revision:expected.revision,ids:choices.map(choice=>choice.id),summary:{checkedTotal:entries.length,
        first:entries[0],last:entries.at(-1)!,current:entries[index],sequence:"published"}},read:publication.read,
        lookup:selection=>{
          let date:string|undefined;
          if(selection.mode==="exact"){
            if(!isForestDate(selection.date))return {issue:"请明确有效的森林日期，尚未切换。"};
            date=entries.includes(selection.date)?selection.date:undefined;
            if(!date)return {issue:"当前发布目录没有该日期，未选择相邻日，也未切换。"};
          }else if((selection.mode==="next"||selection.mode==="previous")&&selection.date===null){
            date=entries[index+(selection.mode==="next"?1:-1)];
            if(!date)return {issue:selection.mode==="next"?"当前已是最后一个已发布日期，未切换。":"当前已是第一个已发布日期，未切换。"};
          }else return {issue:"森林日期选择方式无效，未切换。"};
          return {choice:{id:date,label:date}};
        },
        revalidate:async nextSignal=>{try{await load(expected,nextSignal);return true;}catch{nextSignal.throwIfAborted();return false;}}};
    }catch(error){
      signal.throwIfAborted();const issue=(error instanceof Error?error.message:"当前森林日期目录不可用").replace(/[\u0000-\u001f\u007f]/gu," ").slice(0,220);
      return {view:{...view!,activeLayer:{...layer,status:"unavailable",controls:[],display:[{label:"森林日期选择暂不可用",value:issue},...(layer.display||[])].slice(0,16)}},issue};
    }
  };
}

export const resolveWorkspaceForestPublication=workspaceForestPublications();
