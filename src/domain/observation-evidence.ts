import type {ObservationArtifactSource} from "./observation-source";

export type ObservationMissingMarker=number|"NaN"|"+Infinity"|"-Infinity";
export type ObservationNetcdfEvidence={
  format:"classic"|"64-bit-offset";
  standardName:string|null;
  longName:string|null;
  timeVariable:string;
  timeUnits:string;
  calendar:"standard"|"gregorian"|"proleptic_gregorian";
  firstUtc:string|null;
  lastUtc:string|null;
  firstRaw:number|null;
  lastRaw:number|null;
  fillValues:ObservationMissingMarker[];
  missingValues:ObservationMissingMarker[];
  validMin:number|null;
  validMax:number|null;
  qcApplied:false;
  totalSamples:number;
  excluded:{missingValue:number;nonFinite:number;outsideValidRange:number;invalidTime:number};
  relatedVariables:{name:string;standardName:string|null;longName:string|null;unit:string|null}[];
  relatedVariablesTruncated:boolean;
};
export type ObservationEvidence = {
  artifactId: string;
  version: string;
  sha256: string;
  variable: string;
  unit: string;
  count: number;
  first: string|null;
  last: string|null;
  netcdf?:ObservationNetcdfEvidence;
  artifactSource?:ObservationArtifactSource;
};

export function validObservationNetcdfEvidence(value:unknown,count:number,first:string|null,last:string|null):value is ObservationNetcdfEvidence{
  if(!value||typeof value!=="object"||Array.isArray(value))return false;
  const n=value as Record<string,any>,keys=["format","standardName","longName","timeVariable","timeUnits","calendar","firstUtc","lastUtc","firstRaw","lastRaw","fillValues","missingValues","validMin","validMax","qcApplied","totalSamples","excluded","relatedVariables","relatedVariablesTruncated"];
  if(Object.keys(n).length!==keys.length||!keys.every(k=>Object.hasOwn(n,k)))return false;
  const text=(v:unknown,max:number)=>typeof v==="string"&&v.length>0&&v.length<=max&&!/[\x00-\x1f\x7f]/.test(v);
  const optional=(v:unknown,max:number)=>v===null||text(v,max);
  const scalar=(v:unknown)=>v===null||typeof v==="number"&&Number.isFinite(v);
  const markers=(v:unknown)=>Array.isArray(v)&&v.length<=16&&v.every(x=>typeof x==="number"&&Number.isFinite(x)||["NaN","+Infinity","-Infinity"].includes(x));
  const utc=(v:unknown)=>typeof v==="string"&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
  if(!["classic","64-bit-offset"].includes(n.format)||!optional(n.standardName,160)||!optional(n.longName,200)||
    !text(n.timeVariable,80)||!text(n.timeUnits,200)||!["standard","gregorian","proleptic_gregorian"].includes(n.calendar)||n.qcApplied!==false||
    !markers(n.fillValues)||!markers(n.missingValues)||!scalar(n.validMin)||!scalar(n.validMax)||
    n.validMin!==null&&n.validMax!==null&&n.validMin>n.validMax||typeof n.relatedVariablesTruncated!=="boolean"||
    !Array.isArray(n.relatedVariables)||n.relatedVariables.length>20)return false;
  if(!n.relatedVariables.every((r:any)=>r&&typeof r==="object"&&!Array.isArray(r)&&Object.keys(r).length===4&&
    ["name","standardName","longName","unit"].every(k=>Object.hasOwn(r,k))&&text(r.name,80)&&optional(r.standardName,160)&&optional(r.longName,200)&&optional(r.unit,40)))return false;
  if(new Set(n.relatedVariables.map((r:any)=>r.name)).size!==n.relatedVariables.length)return false;
  if(!Number.isSafeInteger(n.totalSamples)||n.totalSamples<0||n.totalSamples>2_000_000||!n.excluded||typeof n.excluded!=="object"||Array.isArray(n.excluded)||
    Object.keys(n.excluded).length!==4||!["missingValue","nonFinite","outsideValidRange","invalidTime"].every(k=>Number.isSafeInteger(n.excluded[k])&&n.excluded[k]>=0)||
    Object.values(n.excluded).reduce<number>((sum,n)=>sum+Number(n),count)!==n.totalSamples)return false;
  return count===0?n.firstUtc===null&&n.lastUtc===null&&n.firstRaw===null&&n.lastRaw===null:
    utc(n.firstUtc)&&utc(n.lastUtc)&&n.firstUtc<=n.lastUtc&&n.firstUtc.slice(0,10)===first&&n.lastUtc.slice(0,10)===last&&
    typeof n.firstRaw==="number"&&Number.isFinite(n.firstRaw)&&typeof n.lastRaw==="number"&&Number.isFinite(n.lastRaw);
}
