import {fetchPublicLayerManifest,inPublicBounds,validPublicBounds,validPublicCoordinate,
  type PublicBounds,type PublicLayerId,type PublicLayerManifest} from "./haina-public-layer";
import type {Coordinate} from "./types";

const viirsPath="/visualizations/haina/1835833/global-v1";
const coveragePath="/visualizations/haina/1846104/coverage-v1";
type Publication={version:1;revision:string;title:string;period:string;description:string;source:string};
export type ViirsPublication=Publication & {mode:"viirs";datasetId:1835833;sourceBounds:PublicBounds;
  tileSize:256;maxZoom:8;defaultView:{center:Coordinate;zoom:number}};
export type HainaPatch={id:string;bounds:PublicBounds;center:Coordinate;footprint:Coordinate[];months:string[]};
export type CoveragePublication=Publication & {mode:"coverage";datasetId:1846104;defaultPatch:string;defaultMonth:string;
  months:string[];patches:HainaPatch[];colors:{kind:"shared-pca"|"per-frame-pca";labels:[string,string,string]}};
export type HainaPublication=(PublicLayerManifest & {mode:"legacy"})|ViirsPublication|CoveragePublication;
export type ViirsSample={status:"value";value:number;center?:Coordinate;row?:number;column?:number}
  | {status:"no-data"|"out-of-coverage";value:null;center?:Coordinate;row?:number;column?:number};

const text=(value:unknown,max:number):value is string=>typeof value==="string"&&!!value.trim()&&value.length<=max;
const finite=(value:unknown):value is number=>typeof value==="number"&&Number.isFinite(value);
export const validHainaMonth=(value:unknown):value is string=>typeof value==="string"&&/^\d{4}-(0[1-9]|1[0-2])$/.test(value);
const validMonths=(value:unknown):value is string[]=>Array.isArray(value)&&value.length>0&&value.length<=2400
  &&value.every(validHainaMonth)&&new Set(value).size===value.length;
const validPatchId=(value:unknown):value is string=>typeof value==="string"&&/^patch_\d{6}$/.test(value);
const validZoom=(value:unknown)=>finite(value)&&value>=1&&value<=2200;

export const hainaPatchView=(id:string)=>id.replace("_","-");
export const patchForHainaView=(view:string)=>view.replace("-","_");
export const viirsTilePath=(revision:string,z:number,x:number,y:number)=>viirsPath+"/tile/"+revision+"/"+z+"/"+x+"/"+y+".png";
export const coverageFramePath=(revision:string,patch:string,month:string)=>coveragePath+"/frame/"+revision+"/"+patch+"/"+month+".png";

export function viirsCamera(publication:ViirsPublication,view:string|undefined) {
  if(view==="nyc")return {id:view,label:"纽约",center:[-73.9875,40.75] as Coordinate,zoom:200};
  if(view==="tokyo")return {id:view,label:"东京",center:[139.7667,35.6792] as Coordinate,zoom:200};
  return {id:"global",label:"全球夜间灯光",...publication.defaultView};
}

export function coverageCamera({patches,title}:CoveragePublication) {
  const [west,south,east,north]=patches.reduce<PublicBounds>(([w,s,e,n],patch)=>
    [Math.min(w,patch.bounds[0]),Math.min(s,patch.bounds[1]),Math.max(e,patch.bounds[2]),Math.max(n,patch.bounds[3])],
    [180,90,-180,-90]);
  const span=Math.max(east-west,north-south);
  return {center:[(west+east)/2,(south+north)/2] as Coordinate,zoom:Math.max(1,Math.min(2200,90/span)),
    reason:title+" · 已发布图斑分布"};
}

async function readJSON(path:string,signal:AbortSignal):Promise<unknown> {
  const res=await fetch(path,{signal,cache:"no-cache",redirect:"error"});
  if(!res.ok)throw Error("图层发布资料暂不可用");
  return res.json();
}

function commonPublication(m:Publication) {
  return m?.version===1&&typeof m.revision==="string"&&/^[a-f0-9]{64}$/.test(m.revision)
    &&text(m.title,240)&&text(m.period,160)&&text(m.description,6000)&&text(m.source,1000);
}

function validViirsSourceBounds(value:unknown):value is PublicBounds {
  if(!Array.isArray(value)||value.length!==4||!value.every(finite))return false;
  const [west,south,east,north]=value;
  // Native seam pixels can straddle ±180 even though display tiles use canonical longitude.
  return west>=-181&&east<=181&&west<east&&east-west<=361&&south>=-90&&north<=90&&south<north;
}

export function readViirsPublication(raw:unknown):ViirsPublication {
  const m=raw as ViirsPublication;
  if(!commonPublication(m)||m.datasetId!==1835833||m.tileSize!==256||m.maxZoom!==8
    ||!validViirsSourceBounds(m.sourceBounds)||!validPublicCoordinate(m.defaultView?.center)||!validZoom(m.defaultView?.zoom))
    throw Error("夜光图层发布清单格式不正确");
  return {...m,mode:"viirs"};
}

export function pointInHainaFootprint([longitude,latitude]:Coordinate,ring:Coordinate[]) {
  let inside=false;
  for(let i=1;i<ring.length;i++){
    const [west,south]=ring[i-1], [east,north]=ring[i];
    if((south>latitude)!==(north>latitude) &&
      longitude<(east-west)*(latitude-south)/(north-south)+west) inside=!inside;
  }
  return inside;
}

export function validHainaFootprint(value:unknown,bounds:PublicBounds):value is Coordinate[] {
  if(!Array.isArray(value)||value.length!==17||!value.every(point=>validPublicCoordinate(point)&&inPublicBounds(point,bounds)))return false;
  return value[0][0]===value[16][0]&&value[0][1]===value[16][1];
}

export function readCoveragePublication(raw:unknown):CoveragePublication {
  const m=raw as CoveragePublication;
  if(!commonPublication(m)||m.datasetId!==1846104||!validPatchId(m.defaultPatch)||!validHainaMonth(m.defaultMonth)
    ||!validMonths(m.months)||!Array.isArray(m.patches)||!m.patches.length||m.patches.length>20000
    ||!(m.colors?.kind==="shared-pca"||m.colors?.kind==="per-frame-pca")
    ||!Array.isArray(m.colors.labels)||m.colors.labels.length!==3||!m.colors.labels.every(label=>text(label,80)))
    throw Error("图斑发布清单格式不正确");

  const months=new Set(m.months),ids=new Set<string>();
  for(const patch of m.patches){
    if(!patch||!validPatchId(patch.id)||ids.has(patch.id)||!validPublicBounds(patch.bounds)
      ||!validPublicCoordinate(patch.center)||!inPublicBounds(patch.center,patch.bounds)
      ||!validHainaFootprint(patch.footprint,patch.bounds)||!pointInHainaFootprint(patch.center,patch.footprint)
      ||!validMonths(patch.months)||!patch.months.every(month=>months.has(month)))
      throw Error("图斑发布范围或月份格式不正确");
    ids.add(patch.id);
  }
  if(!m.patches.find(patch=>patch.id===m.defaultPatch)?.months.includes(m.defaultMonth))
    throw Error("默认图斑尚无发布切片");
  return {...m,mode:"coverage"};
}

export async function fetchHainaPublication(id:PublicLayerId,signal:AbortSignal):Promise<HainaPublication> {
  if(id===1835833)return readViirsPublication(await readJSON(viirsPath+"/manifest.json",signal));
  if(id===1846104)return readCoveragePublication(await readJSON(coveragePath+"/manifest.json",signal));
  return {...await fetchPublicLayerManifest(id,signal),mode:"legacy"};
}

export async function fetchViirsSample(publication:ViirsPublication,[lon,lat]:Coordinate,signal:AbortSignal) {
  const canonicalLon=((lon+180)%360+360)%360-180;
  const query=new URLSearchParams({lon:String(canonicalLon),lat:String(lat)});
  const raw=await readJSON(viirsPath+"/sample/"+publication.revision+"?"+query,signal) as ViirsSample;
  if(!raw||(raw.status==="value"?!finite(raw.value):
    !(raw.status==="no-data"||raw.status==="out-of-coverage")||raw.value!==null)
    ||raw.center!==undefined&&!validPublicCoordinate(raw.center)
    ||[raw.row,raw.column].some(index=>index!==undefined&&(!Number.isSafeInteger(index)||index<0)))
    throw Error("夜光取样回执格式不正确");
  return raw;
}
