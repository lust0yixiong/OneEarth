import {Router} from "express";
import {mkdir,readFile,writeFile,rename,stat} from "node:fs/promises";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {geoArea,geoBounds,geoContains} from "d3-geo";
import {feature as topologyFeature} from "topojson-client";
import type {FeatureCollection,Polygon,MultiPolygon} from "geojson";
import countryCodes from "../src/data/evidence/country-iso3.json";
import type {AdminArea,AdminLocation} from "../src/domain/admin-orientation";

type Metadata={boundaryID:string;boundaryISO:string;boundaryType:string;boundaryYearRepresented:string;boundaryCanonical?:string;boundarySource:string;boundaryLicense:string;simplifiedGeometryGeoJSON:string;tjDownloadURL?:string};
type AreaFeature={name:string|null;id:string;geometry:Polygon|MultiPolygon;bounds:[[number,number],[number,number]]};
type AdminIndex={at:ReturnType<typeof administrativeIndex>;url:string};
const MAX_BYTES=64*1024*1024;
function inBounds(bounds:AreaFeature["bounds"],[lon,lat]:[number,number]) {
  const [[west,south],[east,north]]=bounds;
  return lat>=south && lat<=north && (west<=east?lon>=west && lon<=east:lon>=west || lon<=east);
}
/** Index once on the server. The browser receives names, never national polygon files. */
export function administrativeIndex(data:FeatureCollection,expected?:{iso:string;level:string}) {
  if(!data || data.type!=="FeatureCollection" || !Array.isArray(data.features) || !data.features.length || data.features.length>200000)throw Error("行政边界格式异常");
  const bands:AreaFeature[][]=Array.from({length:180},()=>[]);
  const band=(lat:number)=>Math.max(0,Math.min(179,Math.floor(lat+90)));
  for(const feature of data.features){
    if(expected && (feature.properties?.shapeGroup!==expected.iso || feature.properties?.shapeType!==expected.level))throw Error("行政边界文件身份不一致");
    const name=feature.properties?.shapeName,id=feature.properties?.shapeID,geometry=feature.geometry;
    if((name!==null && typeof name!=="string") || typeof id!=="string" || !geometry || !["Polygon","MultiPolygon"].includes(geometry.type))
      throw Error("行政边界缺少名称、标识或面几何");
    const area=structuredClone(geometry) as Polygon|MultiPolygon;
    const polygons=area.type==="Polygon"?[area.coordinates]:area.coordinates;
    for(const rings of polygons){
      if(!rings.length || rings.some(ring=>ring.length<4 || ring.some(p=>!Number.isFinite(p[0]) || !Number.isFinite(p[1]) || Math.abs(p[0])>180 || Math.abs(p[1])>90)))
        throw Error("行政边界坐标异常");
      if(geoArea({type:"Polygon",coordinates:[rings[0]]})>2*Math.PI)rings.forEach(ring=>ring.reverse());
    }
    const entry={name:typeof name==="string"?name.trim() || null:null,id,geometry:area,bounds:geoBounds(area)};
    for(let b=band(entry.bounds[0][1]);b<=band(entry.bounds[1][1]);b++)bands[b].push(entry);
  }
  return (point:[number,number])=>bands[band(point[1])].filter(row=>inBounds(row.bounds,point) && geoContains(row.geometry,point));
}
function metadataRows(value:unknown,iso:string):Metadata[] {
  if(!Array.isArray(value))throw Error("行政边界目录格式异常");
  const rows=value.filter(row=>row && /^ADM[1-5]$/.test(row.boundaryType));
  if(new Set(rows.map(row=>row.boundaryType)).size!==rows.length)throw Error("行政边界目录层级重复");
  for(const row of rows)if(row.boundaryISO!==iso || !new RegExp('^'+iso+'-ADM[1-5]-[a-zA-Z0-9-]+$').test(row.boundaryID) ||
    !row.boundaryID.startsWith(iso+"-"+row.boundaryType+"-") ||
    typeof row.boundaryYearRepresented!=="string" || typeof row.simplifiedGeometryGeoJSON!=="string" || typeof row.boundarySource!=="string" || typeof row.boundaryLicense!=="string")
    throw Error("行政边界目录身份不一致");
  return rows as Metadata[];
}
async function responseJson(response:Response) {
  if(!response.ok)throw Error("行政边界服务返回 HTTP "+response.status);
  if(!response.body)throw Error("行政边界响应为空");
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  try{
    for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_BYTES)throw Error("该行政边界文件过大，暂未载入");chunks.push(value);}
  }catch(error){await reader.cancel().catch(()=>{});throw error;}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  return JSON.parse(new TextDecoder().decode(bytes));
}
export function administrativeLocations(directory:string,{fetchImpl=fetch,baseUrl="https://www.geoboundaries.org/api/current/gbOpen/"}:{fetchImpl?:typeof fetch;baseUrl?:string}={}) {
  const base=new URL(baseUrl.endsWith("/")?baseUrl:baseUrl+"/");
  const pending=new Map<string,Promise<unknown>>(),indexes=new Map<string,AdminIndex>();
  let active=0;const queue:Array<()=>void>=[];
  const hosts=new Set([base.hostname,"github.com","raw.githubusercontent.com","media.githubusercontent.com","www.geoboundaries.org","geoboundaries.org","geoboundaries-dev.org"]);
  async function download(url:string) {
    const target=new URL(url);
    if(!hosts.has(target.hostname) || target.username || target.password || !(target.protocol==="https:" || (target.protocol==="http:" && ["localhost","127.0.0.1"].includes(target.hostname))))
      throw Error("行政边界下载地址未获支持");
    if(active>=2)await new Promise<void>(resolve=>queue.push(resolve));
    active++;
    try{return await responseJson(await fetchImpl(target,{signal:AbortSignal.timeout(90000),headers:{"User-Agent":"OneEarth/0.1 administrative-orientation","Accept":"application/json"}}));}
    finally{active--;queue.shift()?.();}
  }
  async function cached(file:string,url:string,maxAge=Infinity,validate:(value:any)=>unknown=()=>{}) {
    const existing=pending.get(file);if(existing)return existing;
    const task=(async()=>{
      const target=path.join(directory,file);let previous:unknown;
      try{previous=JSON.parse(await readFile(target,"utf8"));validate(previous);if(Date.now()-(await stat(target)).mtimeMs<maxAge)return previous;}catch{previous=undefined;}
      let data;
      try{data=await download(url);validate(data);}catch(error){if(previous!==undefined){validate(previous);return previous;}throw error;}
      await mkdir(directory,{recursive:true});const temporary=target+"."+randomUUID()+".tmp";
      await writeFile(temporary,JSON.stringify(data));await rename(temporary,target);return data;
    })();pending.set(file,task);try{return await task;}finally{pending.delete(file);}
  }
  async function index(meta:Metadata) {
    const current=indexes.get(meta.boundaryID);
    if(current){indexes.delete(meta.boundaryID);indexes.set(meta.boundaryID,current);return current;}
    const key="index:"+meta.boundaryID,existing=pending.get(key);if(existing)return existing as Promise<AdminIndex>;
    const task=(async()=>{
      const hasGeometry=await stat(path.join(directory,meta.boundaryID+".geojson")).then(()=>true,()=>false);
      const useTopology=!!meta.tjDownloadURL && !hasGeometry,url=useTopology?meta.tjDownloadURL!:meta.simplifiedGeometryGeoJSON;
      let at:ReturnType<typeof administrativeIndex>|undefined;
      await cached(meta.boundaryID+(useTopology?".topojson":".geojson"),url,Infinity,data=>{
        let collection=data;
        if(useTopology){
          if(data.type!=="Topology" || !data.objects || Object.keys(data.objects).length!==1)throw Error("行政边界拓扑格式异常");
          collection=topologyFeature(data,Object.values(data.objects)[0] as any);
        }
        at=administrativeIndex(collection,{iso:meta.boundaryISO,level:meta.boundaryType});
      });
      if(!at)throw Error("行政边界索引暂不可用");const result={at,url};
      if(indexes.size>=12)indexes.delete(indexes.keys().next().value!);indexes.set(meta.boundaryID,result);return result;
    })();pending.set(key,task);try{return await task;}finally{pending.delete(key);}
  }
  return {async locate(country:string,point:[number,number],requestedLevel:number,signal:AbortSignal):Promise<AdminLocation> {
    const iso=countryCodes.numericToAlpha3[country as keyof typeof countryCodes.numericToAlpha3];
    if(!iso)throw Error("当前图集单元没有可匹配的行政边界目录");
    signal.throwIfAborted();
    const raw=await cached(iso+"-metadata.json",new URL(iso+"/ALL/",base).href,30*86400000,value=>metadataRows(value,iso));
    const metadata=metadataRows(raw,iso),eligible=metadata.filter(meta=>Number(meta.boundaryType.slice(3))<=requestedLevel);
    signal.throwIfAborted();
    const loaded=await Promise.allSettled(eligible.map(async meta=>{
      const indexed=await index(meta);signal.throwIfAborted();const matches=indexed.at(point);
      // A shared or conflicting edge cannot justify choosing a random administration.
      if(matches.length!==1)return null;
      const match=matches[0];
      if(!match.name)return null;
      return {level:Number(meta.boundaryType.slice(3)),name:match.name,id:match.id,year:meta.boundaryYearRepresented,
        kind:meta.boundaryCanonical || meta.boundaryType,source:meta.boundarySource,url:indexed.url,license:meta.boundaryLicense} satisfies AdminArea;
    }));
    signal.throwIfAborted();
    return {country,point,requestedLevel,availableLevels:metadata.map(row=>Number(row.boundaryType.slice(3))).sort((a,b)=>a-b),
      areas:loaded.flatMap(r=>r.status==="fulfilled" && r.value?[r.value]:[]).sort((a,b)=>a.level-b.level),partial:loaded.some(r=>r.status==="rejected")};
  }};
}
export function administrativeOrientation(directory:string,options?:Parameters<typeof administrativeLocations>[1]) {
  const router=Router(),service=administrativeLocations(directory,options);
  router.get("/",async(req,res)=>{
    const country=String(req.query.country || "").padStart(3,"0"),lon=Number(req.query.lon),lat=Number(req.query.lat),level=Number(req.query.level);
    if(!countryCodes.numericToAlpha3[country as keyof typeof countryCodes.numericToAlpha3] || typeof req.query.lon!=="string" || typeof req.query.lat!=="string" ||
      !Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lon)>180 || Math.abs(lat)>90 || !Number.isInteger(level) || level<1 || level>5){
      res.status(400).json({error:"请提供有效的中心坐标与行政层级。"});return;
    }
    const controller=new AbortController();res.once("close",()=>{if(!res.writableEnded)controller.abort();});
    try{const result=await service.locate(country,[lon,lat],level,controller.signal);res.set("Cache-Control",result.partial?"no-store":"private, max-age=86400").json(result);}
    catch{if(!controller.signal.aborted)res.status(503).set("Cache-Control","no-store").json({error:"细分行政区暂不可用，仍显示已核对的图集位置。"});}
  });
  return router;
}
