import {NetCDFReader} from "netcdfjs";
import type {ObservationEvidence,ObservationNetcdfEvidence,ObservationMissingMarker} from "../src/domain/observation-evidence";
import type {ObservationReadTarget} from "./observation-check-contract";

export const observationNetcdfMaxBytes=256*1024*1024;
const maxSamples=2_000_000,maxHeader=1024*1024;
export class ObservationNetcdfError extends Error{constructor(readonly reason:string){super(reason);}}
const fail=(reason:string):never=>{throw new ObservationNetcdfError(reason);};
const widths=[0,1,1,2,4,4,8];
/** Bound all library allocations before its header parser sees the byte array. */
function preflight(bytes:Buffer){
  let p=4;const take=(n:number)=>{if(!Number.isSafeInteger(n)||n<0||p+n>bytes.length||p+n>maxHeader)fail("netcdf_header_limit");const at=p;p+=n;return at;};
  const u32=()=>bytes.readUInt32BE(take(4));
  const name=()=>{const n=u32();if(!n||n>4096)fail("netcdf_header_limit");take(Math.ceil(n/4)*4);};
  const list=(tag:number,max:number)=>{const t=u32(),n=u32();if(t===0&&n===0)return 0;if(t!==tag||n>max)fail("netcdf_header_limit");return n;};
  const attrs=()=>{const n=list(12,128);for(let i=0;i<n;i++){name();const type=u32(),length=u32();if(type<1||type>6||length>8192)fail("netcdf_header_limit");take(Math.ceil(length*widths[type]/4)*4);}};
  const records=u32();if(records>maxSamples)fail("netcdf_dimension_limit");
  const dims=list(10,32);let unlimited=0;for(let i=0;i<dims;i++){name();const size=u32();if(size>maxSamples||size===0&&++unlimited>1)fail("netcdf_dimension_limit");}
  attrs();const variables=list(11,256);for(let i=0;i<variables;i++){name();const nd=u32();if(nd>32)fail("netcdf_dimension_limit");for(let j=0;j<nd;j++)if(u32()>=dims)fail("netcdf_dimension_limit");attrs();const type=u32();if(type<1||type>6)fail("netcdf_type");u32();if(bytes[3]===2&&u32()!==0)fail("netcdf_offset_limit");u32();}
  return p;
}
type Variable=NetCDFReader["variables"][number];
type Attr={name:string;value:unknown};
function attributes(v:Variable){const a=v.attributes as Attr[];if(new Set(a.map(x=>x.name)).size!==a.length)fail("netcdf_attribute");return new Map(a.map(x=>[x.name,x.value]));}
function metadata(a:Map<string,unknown>,key:string,max:number){const x=a.get(key);if(x===undefined)return null;if(typeof x!=="string"||!x.trim()||x.length>max||/[\x00-\x1f\x7f]/.test(x))fail("netcdf_attribute");return (x as string).trim();}
function numbers(a:Map<string,unknown>,key:string):number[]{const x=a.get(key);if(x===undefined)return [];const values=Array.isArray(x)?x:[x];if(values.length>16||!values.length||values.some(v=>typeof v!=="number"))fail("netcdf_attribute");return values as number[];}
const marker=(v:number):ObservationMissingMarker=>Number.isNaN(v)?"NaN":v===Infinity?"+Infinity":v===-Infinity?"-Infinity":v;
const typeWidth:Record<string,number>={byte:1,short:2,int:4,float:4,double:8};
const defaults:Record<string,number>={byte:-127,short:-32767,int:-2147483647,float:Math.fround(9.969209968386869e36),double:9.969209968386869e36};
function masking(v:Variable){
  const a=attributes(v);if(a.has("_Unsigned"))fail("netcdf_unsigned_unsupported");
  const declared=numbers(a,"_FillValue"),fill=declared.length?declared:[defaults[v.type]],missing=numbers(a,"missing_value"),range=numbers(a,"valid_range"),min=numbers(a,"valid_min"),max=numbers(a,"valid_max");
  if(declared.length>1||range.length&&range.length!==2||min.length>1||max.length>1)fail("netcdf_attribute");
  const validMin=range.length?range[0]:min[0]??null,validMax=range.length?range[1]:max[0]??null;
  if(validMin!==null&&!Number.isFinite(validMin)||validMax!==null&&!Number.isFinite(validMax)||validMin!==null&&validMax!==null&&validMin>validMax)fail("netcdf_attribute");
  const factor=numbers(a,"scale_factor"),offset=numbers(a,"add_offset");if(factor.length>1||offset.length>1||!Number.isFinite(factor[0]??1)||!Number.isFinite(offset[0]??0))fail("netcdf_attribute");
  const allMissing=[...fill,...missing],transform=(raw:number)=>raw*(factor[0]??1)+(offset[0]??0);
  const excluded=(raw:number):"nonFinite"|"missingValue"|"outsideValidRange"|undefined=>{
    if(!Number.isFinite(raw))return "nonFinite";
    if(allMissing.some(x=>Object.is(x,raw)||x===raw))return "missingValue";
    if(validMin!==null&&raw<validMin||validMax!==null&&raw>validMax)return "outsideValidRange";
    if(!Number.isFinite(transform(raw)))return "nonFinite";
  };
  return {fill,missing,validMin,validMax,excluded,decode:(raw:number)=>excluded(raw)?null:transform(raw)};
}
/** CF Gregorian subset; unsupported calendars/units are explicit failures. */
export function cfTime(units:string,calendar:string){
  if(!["standard","gregorian","proleptic_gregorian"].includes(calendar))fail("netcdf_calendar_unsupported");
  const m=/^(milliseconds?|msecs?|seconds?|secs?|s|minutes?|mins?|hours?|hrs?|days?|d) since (\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2})(?::(\d{1,2}))?(?::(\d{1,2}(?:\.\d+)?))?)?\s*(Z|UTC|[+-]\d{1,2}(?::?\d{2})?)?$/i.exec(units);
  if(!m)fail("netcdf_time_units");
  const [,unit,y,mo,day,h="0",min="0",sec="0",zone="Z"]=m!;
  const date=new Date(0);date.setUTCFullYear(Number(y),Number(mo)-1,Number(day));date.setUTCHours(Number(h),Number(min),Math.floor(Number(sec)),Math.round((Number(sec)%1)*1000));
  if(Number(y)<1||Number(y)>9999||date.getUTCFullYear()!==Number(y)||date.getUTCMonth()!==Number(mo)-1||date.getUTCDate()!==Number(day)||Number(h)>23||Number(min)>59||Number(sec)>=60)fail("netcdf_time_units");
  let offset=0;if(!/^(Z|UTC)$/i.test(zone)){const z=/^([+-])(\d{1,2})(?::?(\d{2}))?$/.exec(zone)!;if(Number(z[2])>23||Number(z[3]??0)>59)fail("netcdf_time_units");offset=(Number(z[2])*60+Number(z[3]??0))*60000*(z[1]==="+"?1:-1);}
  const epoch=date.getTime()-offset,gregorian=Date.parse("1582-10-15T00:00:00Z");if(calendar!=="proleptic_gregorian"&&epoch<gregorian)fail("netcdf_calendar_unsupported");
  const scale=/^(milliseconds?|msecs?)/i.test(unit)?1:/^(s|sec)/i.test(unit)?1000:/^(min)/i.test(unit)?60000:/^(h)/i.test(unit)?3600000:86400000;
  return (value:number)=>{const ms=Math.round(epoch+value*scale);if(!Number.isFinite(ms)||ms<Date.parse("0001-01-01T00:00:00Z")||ms>Date.parse("9999-12-31T23:59:59.999Z"))fail("netcdf_time_range");if(calendar!=="proleptic_gregorian"&&ms<gregorian)fail("netcdf_calendar_unsupported");return ms;};
}

export function readNetcdfObservation(bytes:Buffer,check:ObservationReadTarget,sha256:string,allowedVariables:string[]):ObservationEvidence{
  if(bytes.length>observationNetcdfMaxBytes||bytes.length<8||bytes.toString("ascii",0,3)!=="CDF"||![1,2].includes(bytes[3]))fail("netcdf_format");
  const headerEnd=preflight(bytes);let reader:NetCDFReader;try{reader=new NetCDFReader(bytes);}catch{fail("netcdf_header_invalid");}
  const r=reader!,variables=r.variables,dims=r.dimensions,record=r.recordDimension;
  if(new Set(variables.map(v=>v.name)).size!==variables.length||new Set(dims.map(d=>d.name)).size!==dims.length)fail("netcdf_header_invalid");
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),recordVars=variables.filter(v=>v.record);
  const dimSize=(id:number)=>id===record.id?record.length:dims[id].size;
  function layout(v:Variable){
    if(record.id!==undefined&&v.dimensions.includes(record.id)&&v.dimensions[0]!==record.id)fail("netcdf_layout_invalid");
    const width=typeWidth[v.type];if(!width)fail("netcdf_type");
    const shape=v.dimensions.map(dimSize),perRecord=v.record?shape.slice(1).reduce((a,b)=>a*b,1):shape.reduce((a,b)=>a*b,1);
    if(!Number.isSafeInteger(perRecord)||perRecord<0||perRecord*width>observationNetcdfMaxBytes||v.offset<headerEnd||!Number.isSafeInteger(v.offset))fail("netcdf_layout_limit");
    // A sole byte/short record variable has no per-record 4-byte padding (NUG).
    const step=v.record?(recordVars.length===1?perRecord*width:record.recordStep!):width;
    const count=v.record?record.length*perRecord:perRecord;
    const end=v.record?v.offset+Math.max(0,record.length-1)*step+(record.length?perRecord*width:0):v.offset+count*width;
    if(!Number.isSafeInteger(end)||end>bytes.length||!Number.isSafeInteger(step)||step<=0||v.size<perRecord*width||v.size>Math.ceil(perRecord*width/4)*4)fail("netcdf_layout_invalid");
    const value=(i:number)=>{const at=v.offset+i*(v.record?step:width);switch(v.type){case "byte":return view.getInt8(at);case "short":return view.getInt16(at);case "int":return view.getInt32(at);case "float":return view.getFloat32(at);default:return view.getFloat64(at);}};
    return {shape,count,value};
  }
  const selected=variables.find(v=>v.name===check.variable);if(!selected||!allowedVariables.includes(check.variable))fail("variable_unavailable");
  const a=attributes(selected!),unit=metadata(a,"units",40);if(!unit)fail("netcdf_units_missing");
  const candidates=variables.filter(v=>v.dimensions.length===1&&selected!.dimensions.includes(v.dimensions[0])&&(()=>{const attrs=attributes(v);return attrs.get("standard_name")==="time"||attrs.get("axis")==="T"||dims[v.dimensions[0]].name===v.name&&typeof attrs.get("units")==="string"&&/ since /i.test(attrs.get("units") as string);})());
  if(candidates.length!==1)fail("netcdf_time_ambiguous");const time=candidates[0],timeDimension=time.dimensions[0];
  if(selected!.dimensions.filter(id=>id===timeDimension).length!==1||selected!.dimensions.some(id=>id!==timeDimension&&dimSize(id)!==1))fail("netcdf_layout_unsupported");
  const data=layout(selected!),clock=layout(time);if(data.count!==clock.count||data.count>maxSamples)fail("netcdf_dimension_limit");
  const ta=attributes(time),timeUnits=metadata(ta,"units",200);if(!timeUnits)fail("netcdf_time_units");const calendar=(metadata(ta,"calendar",80)??"standard").toLowerCase(),convert=cfTime(timeUnits!,calendar),mask=masking(selected!),timeMask=masking(time);
  if((numbers(ta,"scale_factor")[0]??1)!==1||(numbers(ta,"add_offset")[0]??0)!==0)fail("netcdf_time_packing_unsupported");
  let count=0,firstMs:number|null=null,lastMs:number|null=null,firstRaw:number|null=null,lastRaw:number|null=null;
  const excluded={missingValue:0,nonFinite:0,outsideValidRange:0,invalidTime:0};
  for(let i=0;i<data.count;i++){
    const rejection=mask.excluded(data.value(i));if(rejection){excluded[rejection]++;continue;}
    const raw=clock.value(i),t=timeMask.decode(raw);if(t===null){excluded.invalidTime++;continue;}const ms=convert(t);count++;
    if(firstMs===null||ms<firstMs){firstMs=ms;firstRaw=raw;}if(lastMs===null||ms>lastMs){lastMs=ms;lastRaw=raw;}
  }
  const firstUtc=firstMs===null?null:new Date(firstMs).toISOString(),lastUtc=lastMs===null?null:new Date(lastMs).toISOString();
  const related=variables.filter(v=>allowedVariables.includes(v.name)&&v.name!==selected!.name),relatedVariables=related.slice(0,20).map(v=>{const attrs=attributes(v);return {name:v.name,standardName:metadata(attrs,"standard_name",160),longName:metadata(attrs,"long_name",200),unit:metadata(attrs,"units",40)};});
  const netcdf:ObservationNetcdfEvidence={format:bytes[3]===1?"classic":"64-bit-offset",standardName:metadata(a,"standard_name",160),longName:metadata(a,"long_name",200),timeVariable:time.name,timeUnits:timeUnits!,calendar:calendar as ObservationNetcdfEvidence["calendar"],
    firstUtc,lastUtc,firstRaw,lastRaw,fillValues:mask.fill.map(marker),missingValues:mask.missing.map(marker),validMin:mask.validMin,validMax:mask.validMax,qcApplied:false,totalSamples:data.count,excluded,relatedVariables,relatedVariablesTruncated:related.length>20};
  return {artifactId:check.artifactId,version:check.version,sha256,variable:check.variable,unit:unit!,count,first:firstUtc?.slice(0,10)??null,last:lastUtc?.slice(0,10)??null,netcdf};
}
