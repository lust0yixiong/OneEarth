import {createHash} from "node:crypto";
import {c40CityManifestPath,c40CityPublicationRevision,type WorkspaceViewContext,type WorkspaceViewPublication} from "../src/domain/workspace-view-context";

type City={id:string;label:string;aliases:string[]};
type Publication={revision:string;cities:City[]};
/** Server-only proof. Never accepted from a browser task body. */
export type WorkspacePublicationProof={revision:string;ids:string[];directory?:{checkedTotal:number;namesComplete:boolean;names:string[]}};
type Resolution={view:WorkspaceViewContext|undefined;proof?:WorkspacePublicationProof;issue?:string;matches?:string[];
  read?:{status:number;bytes:number};
  lookup?:(query:string)=>{choice?:{id:string;label:string};issue?:string};
  revalidate?:(signal:AbortSignal)=>Promise<boolean>};
const maxBytes=2*1024*1024,maxCities=10000;
const identifier=(v:unknown):v is string=>typeof v==="string"&&/^[a-z0-9][a-z0-9:_.-]{0,159}$/i.test(v);
const text=(v:unknown):v is string=>typeof v==="string"&&!!v.trim()&&v.length<=200&&!/[\u0000-\u001f\u007f]/u.test(v);
const normalize=(v:string)=>v.normalize("NFKD").replace(/\p{M}/gu,"").toLowerCase().replace(/\s+/gu," ").trim();

function cities(value:any):City[]{
  if(!value||value.version!==1||value.datasetId!=="haina:1846639"||!Array.isArray(value.cities)||
    !value.cities.length||value.cities.length>maxCities)throw Error("城市目录格式或规模不可用");
  const result:City[]=value.cities.map((city:any)=>{
    if(!city||!identifier(city.id)||!text(city.name)||city.aliases!==undefined&&
      (!Array.isArray(city.aliases)||city.aliases.length>8||!city.aliases.every(text)))throw Error("城市目录条目无效");
    return {id:city.id,label:city.name,aliases:[city.id,city.name,...(city.aliases||[])]};
  });
  if(new Set(result.map(city=>city.id)).size!==result.length)throw Error("城市目录身份重复");
  return result;
}

function namedCities(question:string,entries:City[]){
  const q=normalize(question),hits:Array<{id:string;start:number;end:number}>=[];
  for(const city of entries)for(const alias of new Set(city.aliases.map(normalize).filter(Boolean))){
    let from=0,at:number;
    while((at=q.indexOf(alias,from))!==-1){
      from=at+alias.length;
      // Latin names are words: York must not match Yorkshire. Han display names
      // can be embedded naturally in a Chinese sentence without spaces.
      if(/^[a-z0-9]/u.test(alias)&&/[a-z0-9]/u.test(q[at-1]||"")||
        /[a-z0-9]$/u.test(alias)&&/[a-z0-9]/u.test(q[from]||""))continue;
      hits.push({id:city.id,start:at,end:from});
      if(hits.length>128)return {ids:[],ambiguous:true};
    }
  }
  const exact=hits.filter(hit=>!hits.some(other=>other.start<=hit.start&&other.end>=hit.end&&other.end-other.start>hit.end-hit.start));
  const ids=[...new Set(exact.map(hit=>hit.id))];
  const ambiguous=exact.some(hit=>exact.some(other=>hit.id!==other.id&&hit.start===other.start&&hit.end===other.end));
  return {ids,ambiguous:ambiguous||ids.length>8};
}

/** Fixed internal spatial object only. Browser-supplied URLs never enter fetch. */
export function workspaceC40Publications(options:{origin?:string;fetchImpl?:typeof fetch}={}){
  const cache=new Map<string,Publication>();
  async function load(expected:WorkspaceViewPublication,signal:AbortSignal){
    const origin=new URL(options.origin||process.env.ONEEARTH_SPATIAL_URL||"http://127.0.0.1:5276");
    if(!["http:","https:"].includes(origin.protocol)||origin.username||origin.password)throw Error("内部时空服务不可用");
    const url=new URL(c40CityManifestPath,origin),key=url.href+"#"+expected.revision,cached=cache.get(key);
    const response=await (options.fetchImpl||fetch)(url,{signal:AbortSignal.any([signal,AbortSignal.timeout(2500)]),redirect:"error",
      headers:{accept:"application/json",...(cached?{"if-none-match":'"'+expected.revision+'"'}:{})}});
    const etag=response.headers.get("etag");
    let publication:Publication,readBytes=0;
    if(response.status===304){
      if(!cached||c40CityPublicationRevision(etag)!==expected.revision)throw Error("城市目录修订不可核对");
      publication=cached;
    }else{
      if(!response.ok){await response.body?.cancel();throw Error("当前城市目录不可用");}
      const length=Number(response.headers.get("content-length"));
      if(length>maxBytes){await response.body?.cancel();throw Error("城市目录超过读取上限");}
      const reader=response.body?.getReader();if(!reader)throw Error("城市目录没有内容");
      const chunks:Uint8Array[]=[];let size=0;
      try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;
        if(size>maxBytes)throw Error("城市目录超过读取上限");chunks.push(part.value);}}
      catch(error){await reader.cancel().catch(()=>{});throw error;}
      finally{reader.releaseLock();}
      const bytes=Buffer.concat(chunks),revision=createHash("sha256").update(bytes).digest("hex");readBytes=bytes.length;
      if(etag!==null&&c40CityPublicationRevision(etag)!==revision)throw Error("城市目录内容与发布修订不符");
      let value:unknown;
      try{value=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));}catch{throw Error("城市目录内容格式无效");}
      publication={revision,cities:cities(value)};
      const actualKey=url.href+"#"+revision;cache.delete(actualKey);cache.set(actualKey,publication);
      while(cache.size>8)cache.delete(cache.keys().next().value!);
    }
    if(publication.revision!==expected.revision||publication.cities.length!==expected.total)throw Error("城市目录已更新，请刷新后再选择");
    cache.delete(key);cache.set(key,publication);
    return {...publication,read:{status:response.status,bytes:readBytes}};
  }
  return async function resolve(view:WorkspaceViewContext|undefined,question:string,signal:AbortSignal,options:{semanticDecision?:boolean}={}):Promise<Resolution>{
    const layer=view?.activeLayer,control=layer?.controls.find(control=>control.id==="city"&&control.publication?.kind==="c40-cities");
    if(layer?.id!=="c40"||!control?.publication)return {view};
    const expected=control.publication;
    try{
      if(layer.status!=="ready")throw Error("当前城市图层尚未就绪");
      const publication=await load(expected,signal),entries=publication.cities;
      const current=entries.findIndex(city=>city.id===control.current.id);
      if(current<0)throw Error("当前城市已不在发布目录中，请刷新后再选择");
      const matched=namedCities(question,entries);
      if(matched.ambiguous&&!options.semanticDecision)throw Error("城市名称对应多个发布条目，请明确城市名称或稳定编号");
      const wanted=new Set([...entries.slice(Math.max(0,current-2),current+3).map(city=>city.id),...(matched.ambiguous?[]:matched.ids)]);
      const choices=entries.filter(city=>wanted.has(city.id)).map(({id,label})=>({id,label}));
      const names=entries.map(city=>city.label);
      const namesComplete=names.length<=128&&Buffer.byteLength(JSON.stringify(names))<=4096;
      const resolved:WorkspaceViewContext={...view!,activeLayer:{...layer,controls:layer.controls.map(item=>item!==control?item:{...control,
        current:{id:entries[current].id,label:entries[current].label},options:choices}),
        display:[{label:"城市选项来源",value:"已核对同一发布修订；窗口含当前邻项及本轮原话精确命中项"},
          ...(layer.display||[])].slice(0,16)}};
      return {view:resolved,proof:{revision:expected.revision,ids:choices.map(choice=>choice.id),
        ...(options.semanticDecision?{directory:{checkedTotal:entries.length,namesComplete,names:namesComplete?names:[]}}:{})},matches:matched.ids,read:publication.read,
        lookup:query=>{
          if(!text(query))return {issue:"城市名称无效，本轮未切换城市。"};
          const normalized=normalize(query),matches=entries.filter(city=>city.aliases.some(alias=>{
            const name=normalize(alias);return name===normalized||name.startsWith(normalized+" ");
          }));
          return matches.length===1?{choice:{id:matches[0].id,label:matches[0].label}}:
            {issue:matches.length?"该名称对应多个已发布城市，请明确城市名称或稳定编号。":"当前发布目录没有与该名称唯一对应的城市，本轮未切换城市。"};
        },
        revalidate:async nextSignal=>{try{await load(expected,nextSignal);return true;}catch{nextSignal.throwIfAborted();return false;}}};
    }catch(error){
      signal.throwIfAborted();const issue=(error instanceof Error?error.message:"当前城市目录不可用").replace(/[\u0000-\u001f\u007f]/gu," ").slice(0,220);
      return {view:{...view!,activeLayer:{...layer,status:"unavailable",controls:[],
        display:[{label:"城市选择暂不可用",value:issue},...(layer.display||[])].slice(0,16)}},issue};
    }
  };
}

export const resolveWorkspaceC40Publication=workspaceC40Publications();
