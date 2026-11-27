import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {gunzipSync} from "node:zlib";
import {isLayerObservationRevision,layerObservationSources,readLayerObservationRef,validRainObservationSource,
  type LayerObservation,type LayerObservationRef} from "../src/domain/layer-observations";
import {rainFactors,rainGrid,rainTileSize,type RainManifest} from "../src/domain/rainfall";
import {rainTileRoot} from "../src/domain/rain-catalog";
import {ctdRows,ctdStations,frontShapes} from "../src/domain/visualization";
import type {Coordinate} from "../src/domain/types";

type RainRef=Extract<LayerObservationRef,{kind:"imerg-cell"}>;
type CtdRef=Extract<LayerObservationRef,{kind:"ctd"}>;
type FrontRef=Extract<LayerObservationRef,{kind:"glacier-front"}>;

const imergSource=layerObservationSources["imerg-cell"];
const ctdSource=layerObservationSources.ctd;
const frontSource=layerObservationSources["glacier-front"];
const tileBytes=rainTileSize*rainTileSize*2;
const manifestLimit=512*1024;
const tileLimit=96*1024;
const maxTime=4_000;
const digest=(data:Uint8Array)=>createHash("sha256").update(data).digest("hex");

// The browser embeds these editions at build time; independently hash the
// server's packaged records so deployment skew fails closed on a selected row.
function sourceEdition(...files:string[]) {
  const hash=createHash("sha256");
  for(const file of files)hash.update(readFileSync(new URL("../src/data/evidence/"+file,import.meta.url))).update("\0");
  return hash.digest("hex");
}
const ctdEdition=sourceEdition("research-polar.mjs","research-tables.json");
const frontEdition=sourceEdition("research-shapes.json");

function verifiedCtd(ref:CtdRef):LayerObservation|undefined {
  if(ref.revision!==ctdEdition)return;
  const station=ctdStations.find(item=>item.id===ref.stationId&&item.date===ref.sampledAt&&item.url===ctdSource);
  if(!station)return;
  const exact=ctdRows[station.name]?.filter(row=>row[0]===ref.depthM);
  if(exact?.length!==1)return;
  const temperature=ref.variable==="temperature";
  const value=exact[0][temperature?1:2];
  if(value!==null&&!Number.isFinite(value))return;
  return {...ref,sourceUrl:ctdSource,point:[station.center[0],station.center[1]],
    value,unit:temperature?"°C":"无量纲"};
}

function verifiedFront(ref:FrontRef):LayerObservation|undefined {
  if(ref.revision!==frontEdition)return;
  const shape=frontShapes.find(item=>item.key===ref.objectId);
  if(!shape||shape.geometry.type!=="MultiLineString"||!shape.geometry.coordinates.length||
    !shape.label.endsWith(" · "+ref.observedOn)||shape.center.length!==2)return;
  const point=[shape.center[0],shape.center[1]] as Coordinate;
  return {...ref,sourceUrl:frontSource,point,label:shape.label};
}

function fixedOrigin(configured:string|undefined) {
  try {
    const url=new URL(configured||"http://127.0.0.1:5276");
    if(["http:","https:"].includes(url.protocol)&&!url.username&&!url.password&&url.pathname==="/"&&!url.search&&!url.hash)return url;
  }catch{}
}

async function readTrustedObject(
  endpoint:URL, media:string, limit:number, fetcher:typeof fetch, signal:AbortSignal, expectedDigest?:string,
) {
  const response=await fetcher(endpoint,{redirect:"error",signal,headers:{accept:media,"accept-encoding":"identity"}});
  const etag=response.headers.get("etag"),encoding=response.headers.get("content-encoding");
  const declaredLength=response.headers.get("content-length");
  if(response.status!==200||response.redirected||!(response.headers.get("content-type")?.split(";")[0].trim()===media)||
    (encoding&&encoding!=="identity")||!etag||!/^"[a-f0-9]{64}"$/u.test(etag)||
    (expectedDigest&&etag!=='"'+expectedDigest+'"')||
    (declaredLength!==null&&(!/^\d+$/u.test(declaredLength)||Number(declaredLength)>limit))) {
    await response.body?.cancel().catch(()=>{});
    return;
  }
  const reader=response.body?.getReader();
  if(!reader)return;
  const parts:Uint8Array[]=[];
  let size=0;
  try{
    for(;;){
      const part=await reader.read();
      if(part.done)break;
      size+=part.value.byteLength;
      if(size>limit){await reader.cancel().catch(()=>{});return;}
      parts.push(part.value);
    }
  }catch(error){
    await reader.cancel().catch(()=>{});
    throw error;
  }finally{
    reader.releaseLock();
  }
  const bytes=Buffer.concat(parts,size);
  if(etag!=='"'+digest(bytes)+'"')return;
  return bytes;
}

function imergMonth(value:unknown,ref:RainRef,year:number,month:number) {
  const manifest=value as Partial<RainManifest>|null;
  if(!manifest||manifest.product!=="GPM IMERG"||manifest.source!==imergSource||manifest.year!==year||
    typeof manifest.id!=="string"||!new RegExp("^imerg-"+year+"-[a-f0-9]{12}$","u").test(manifest.id)||
    manifest.step!==rainGrid.step||manifest.rows!==rainGrid.rows||manifest.columns!==rainGrid.columns||
    manifest.tileSize!==rainTileSize||!Array.isArray(manifest.factors)||manifest.factors.length!==rainFactors.length||
    !manifest.factors.every((factor,index)=>factor===rainFactors[index])||
    manifest.unit!=="mm/day"||manifest.scale!==.01||manifest.missing!==65535||
    !Array.isArray(manifest.months)||manifest.months.length!==12)return;
  const entry=manifest.months[month-1],source=entry?.source;
  if(!entry||entry.month!==month||!source||!isLayerObservationRevision(source.sha256)||
    source.sha256!==ref.revision||
    !(source.run==="Final"&&source.version==="V07B"||source.run==="Late"&&source.version==="V07"||
      source.run==="Derived"&&source.version==="POWER v10"&&source.provider==="NASA POWER")||
    !validRainObservationSource(source.url,source.run,ref.month))return;
  const path=year+"/"+ref.month.slice(5)+"-"+source.run.toLowerCase()+"-"+source.sha256.slice(0,12);
  if(entry.path!==path||typeof entry.complete!=="boolean"||typeof entry.through!=="string"||
    !entry.through.startsWith(ref.month+"-")||!/^\d{4}-\d{2}-\d{2}$/u.test(entry.through)||
    !Number.isFinite(Date.parse(entry.through))||new Date(entry.through).toISOString().slice(0,10)!==entry.through)return;
  const monthEnd=new Date(Date.UTC(year,month,0)).toISOString().slice(0,10);
  if(entry.complete?entry.through!==monthEnd:source.run!=="Late"||entry.through>=monthEnd)return;
  return {entry,source,path};
}

async function verifiedRain(ref:RainRef,origin:URL,fetcher:typeof fetch,signal:AbortSignal):Promise<LayerObservation|undefined> {
  const year=Number(ref.month.slice(0,4)),month=Number(ref.month.slice(5));
  const manifest=await readTrustedObject(new URL(rainTileRoot+"/"+year+"/manifest.json",origin),
    "application/json",manifestLimit,fetcher,signal);
  if(!manifest)return;
  const publication=imergMonth(JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(manifest)),ref,year,month);
  if(!publication)return;
  signal.throwIfAborted();
  const tileX=Math.floor(ref.column/rainTileSize),tileY=Math.floor(ref.row/rainTileSize);
  const tile=await readTrustedObject(new URL(rainTileRoot+"/"+publication.path+"/2/"+tileX+"-"+tileY+".bin.gz",origin),
    "application/octet-stream",tileLimit,fetcher,signal,ref.tileRevision);
  if(!tile||tile[0]!==31||tile[1]!==139)return;
  signal.throwIfAborted();
  const raw=gunzipSync(tile,{maxOutputLength:tileBytes});
  if(raw.length!==tileBytes)return;
  const offset=((ref.row%rainTileSize)*rainTileSize+ref.column%rainTileSize)*2;
  const encoded=raw.readUInt16LE(offset);
  const point:[number,number]=[
    Number((-180+(ref.column+.5)*rainGrid.step).toFixed(2)),
    Number((90-(ref.row+.5)*rainGrid.step).toFixed(2)),
  ];
  return {...ref,sourceUrl:publication.source.url,point,value:encoded===65535?null:encoded/100,unit:"mm/day",
    productVersion:publication.source.version,run:publication.source.run,
    complete:publication.entry.complete,through:publication.entry.through};
}

export function createLayerObservationResolver({origin,fetchImpl}: {origin?:string;fetchImpl?:typeof fetch}={}) {
  return async function resolve(value:unknown,signal?:AbortSignal):Promise<LayerObservation|undefined> {
    const ref=readLayerObservationRef(value);
    if(!ref||signal?.aborted)return;
    if(ref.kind==="ctd")return verifiedCtd(ref);
    if(ref.kind==="glacier-front")return verifiedFront(ref);
    const spatial=fixedOrigin(origin??process.env.ONEEARTH_SPATIAL_URL);
    if(!spatial)return;
    const timeout=AbortSignal.timeout(maxTime),bound=signal?AbortSignal.any([signal,timeout]):timeout;
    try{return await verifiedRain(ref,spatial,fetchImpl||fetch,bound);}
    catch{return;}
  };
}
export const resolveLayerObservation=createLayerObservationResolver();
