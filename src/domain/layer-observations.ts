import {rainGrid} from "./rainfall";
import type {Coordinate} from "./types";
import type {WorkspaceViewContext} from "./workspace-view-context";

// SHA-256 of each published input followed by a NUL, concatenated in source order.
export const localLayerObservationRevisions = {
  // research-polar.mjs and research-tables.json
  ctd: "ef2ce6fd539fbd1f649b8f2ec20b8fc1579c300d69fa52b61de7ebad0688126b",
  // research-shapes.json
  front: "a2f4dfc569fc8691e0f22f52b78db8d86ffff49682d443fe2c064403f20bfeba",
} as const;

type RainRef = {
  kind:"imerg-cell"; datasetId:"nasa:imerg-monthly"; revision:string;
  month:string; row:number; column:number; tileRevision:string;
};
type CtdRef = {
  kind:"ctd"; datasetId:"pangaea:891386"; revision:string;
  stationId:string; sampledAt:string; variable:"temperature"|"salinity"; depthM:number;
};
type FrontRef = {
  kind:"glacier-front"; datasetId:"zenodo:15241675:fronts"; revision:string; objectId:string; observedOn:string;
};
export type LayerObservationRef = RainRef | CtdRef | FrontRef;
export type LayerObservationKind = LayerObservationRef["kind"];
export type LayerObservationStatus = "not-selected" | "unavailable";
type RainRun = "Final" | "Late" | "Derived";
type Provenance = {point:Coordinate;sourceUrl:string};
export type LayerObservation = Provenance & (
  | (RainRef & {value:number|null;unit:"mm/day";productVersion:string;run:RainRun;complete:boolean;through?:string})
  | (CtdRef & {value:number|null;unit:"°C"|"无量纲"})
  | (FrontRef & {label:string})
);

export const layerObservationSources = {
  "imerg-cell":"https://gpm.nasa.gov/data/imerg",
  ctd:"https://doi.org/10.1594/PANGAEA.891386",
  "glacier-front":"https://doi.org/10.5281/zenodo.15241675",
} as const;

const isObject = (value:unknown):value is Record<string,unknown> =>
  !!value && typeof value==="object" && !Array.isArray(value);
export const isLayerObservationRevision = (value:unknown):value is string =>
  typeof value==="string" && /^[a-f0-9]{64}$/u.test(value);
const isNumber = (value:unknown):value is number => typeof value==="number" && Number.isFinite(value);
const isMeasurement = (value:unknown):value is number|null => value===null || isNumber(value);
const validDay = (value:unknown):value is string => {
  if(typeof value!=="string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const day=new Date(value);
  return Number.isFinite(day.valueOf()) && day.toISOString().slice(0,10)===value;
};
const validSampleTime = (value:unknown):value is string =>
  typeof value==="string" &&
  /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?Z?$/u.test(value) &&
  validDay(value.slice(0,10));
const validIndex=(value:unknown,limit:number):value is number =>
  isNumber(value) && Number.isInteger(value) && value>=0 && value<limit;
const validText=(value:unknown,limit:number):value is string =>
  typeof value==="string" && value.trim().length>0 && value.length<=limit && !/[\u0000-\u001f\u007f]/u.test(value);

const identityFields = ["kind","datasetId","revision"] as const;
const referenceFields = {
  "imerg-cell":[...identityFields,"month","row","column","tileRevision"],
  ctd:[...identityFields,"stationId","sampledAt","variable","depthM"],
  "glacier-front":[...identityFields,"objectId","observedOn"],
} as const;
function isKind(value:unknown):value is LayerObservationKind {
  return value==="imerg-cell" || value==="ctd" || value==="glacier-front";
}

export function layerObservationLayer(kind:LayerObservationKind):"rain"|"ctd"|"front" {
  if(kind==="imerg-cell") return "rain";
  return kind==="ctd" ? "ctd" : "front";
}

export function readLayerObservationRef(value:unknown):LayerObservationRef|undefined {
  if(!isObject(value)) return;
  const {kind,datasetId,revision}=value;
  if(!isKind(kind) || !isLayerObservationRevision(revision)) return;
  const fields:readonly string[]=referenceFields[kind];
  if(Object.keys(value).some(key=>!fields.includes(key))) return;
  if(kind==="imerg-cell"){
    const {month,row,column,tileRevision}=value;
    if(datasetId!=="nasa:imerg-monthly" || typeof month!=="string" ||
      !/^\d{4}-(?:0[1-9]|1[0-2])$/u.test(month) || !validIndex(row,rainGrid.rows) ||
      !validIndex(column,rainGrid.columns) || !isLayerObservationRevision(tileRevision)) return;
    return {kind,datasetId,revision,month,row,column,tileRevision};
  }
  if(kind==="ctd"){
    const {stationId,sampledAt,variable,depthM}=value;
    if(datasetId!=="pangaea:891386" || !validText(stationId,80) || !validSampleTime(sampledAt) ||
      (variable!=="temperature" && variable!=="salinity") || !isNumber(depthM) || depthM<0) return;
    return {kind,datasetId,revision,stationId,sampledAt,variable,depthM};
  }
  const {objectId,observedOn}=value;
  if(datasetId!=="zenodo:15241675:fronts" || typeof objectId!=="string" ||
    !/^front-\d{1,7}$/u.test(objectId) || !validDay(observedOn)) return;
  return {kind,datasetId,revision,objectId,observedOn};
}

/** These are the original source locations used by the precipitation publisher. */
export function validRainObservationSource(value:unknown,run:RainRun,month:string):value is string {
  const match=/^(\d{4})-(0[1-9]|1[0-2])$/u.exec(month);
  if(typeof value!=="string" || !match)return false;
  const [,year,monthNumber]=match;
  if(run==="Late")return value==="https://climateserv.servirglobal.net/";
  if(run==="Derived"){
    const index=(Number(year)-1998)*12+Number(monthNumber)-1;
    return value==="https://nasa-power.s3.us-west-2.amazonaws.com/imerg/spatial/power_imerg_monthly_spatial_utc.zarr/IMERG_PRECTOT/"+index+".0.0";
  }
  return value==="https://osdf-director.osg-htc.org/ncar/gdex/d736000/gpm_3imergm_v07/"+year+
    "/3B-MO.MS.MRG.3IMERG."+year+monthNumber+"01-S000000-E235959."+monthNumber+".V07B.HDF5";
}

/** The archive holds verified values even if the live publication subsequently changes. */
export function readLayerObservation(value:unknown):LayerObservation|undefined {
  if(!isObject(value) || !isKind(value.kind)) return;
  const ref=readLayerObservationRef(Object.fromEntries(referenceFields[value.kind].map(key=>[key,value[key]])));
  const {point,sourceUrl}=value;
  if(!ref || !Array.isArray(point) ||
    point.length!==2 || !point.every((coordinate,index)=>isNumber(coordinate) &&
      Math.abs(coordinate)<=(index ? 90 : 180))) return;
  const coordinates=[point[0],point[1]] as Coordinate;
  if(ref.kind==="imerg-cell"){
    const {value:measurement,unit,productVersion,run,complete,through}=value;
    if(!isMeasurement(measurement) || (measurement!==null && measurement<0) || unit!=="mm/day" ||
      !validText(productVersion,100) || (run!=="Final" && run!=="Late" && run!=="Derived") ||
      !validRainObservationSource(sourceUrl,run,ref.month) || typeof complete!=="boolean" || (through!==undefined && (!validDay(through) || !through.startsWith(ref.month+"-")))) return;
    return {...ref,point:coordinates,sourceUrl,value:measurement,unit,productVersion,run,complete,...(through ? {through} : {})};
  }
  if(sourceUrl!==layerObservationSources[ref.kind])return;
  const provenance={point:coordinates,sourceUrl:layerObservationSources[ref.kind]};
  if(ref.kind==="ctd"){
    const {value:measurement,unit}=value;
    const expectedUnit=ref.variable==="temperature" ? "°C" : "无量纲";
    if(!isMeasurement(measurement) || unit!==expectedUnit) return;
    return {...ref,...provenance,value:measurement,unit:expectedUnit};
  }
  if(!validText(value.label,200)) return;
  return {...ref,...provenance,label:value.label};
}

export function readLayerObservationStatus(value:unknown):LayerObservationStatus|undefined {
  return value==="not-selected" || value==="unavailable" ? value : undefined;
}

export function layerObservationMatchesView(ref:LayerObservationRef,view:WorkspaceViewContext|undefined):boolean {
  const layer=view?.activeLayer;
  return view?.surface==="earth" && layer?.status==="ready" && layer.id===layerObservationLayer(ref.kind) &&
    (!layer.datasetId || layer.datasetId===ref.datasetId) &&
    (ref.kind!=="imerg-cell" || layer.controls.some(control=>control.id==="time" && control.current.id===ref.month));
}
