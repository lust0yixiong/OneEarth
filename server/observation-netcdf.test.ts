import assert from "node:assert/strict";
import test from "node:test";
import {createHash,randomUUID} from "node:crypto";
import {mkdtemp,writeFile,rm} from "node:fs/promises";
import path from "node:path";
import {readNetcdfObservation,cfTime} from "./observation-netcdf";
import {executeObservationRead} from "./observation-adapter";
import {observationResponse} from "./runtime-observation";
import {observationCheckSkill,validObservationEvidence,validObservationResult,observationResultMatchesRequest} from "./observation-check-contract";
import {modelObservationEvidence,parseObservationResearchResult} from "./observation-research-contract";
import {openTaskStore} from "./task-store";

type Attr=string|number|number[];
type Var={name:string;dims:number[];type?:number;attrs?:Record<string,Attr>;values:number[]};
const u32=(v:number)=>{const b=Buffer.alloc(4);b.writeUInt32BE(v);return b;};
const pad=(b:Buffer)=>Buffer.concat([b,Buffer.alloc((4-b.length%4)%4)]);
const name=(s:string)=>Buffer.concat([u32(Buffer.byteLength(s)),pad(Buffer.from(s))]);
const widths=[0,1,1,2,4,4,8];
function nums(values:number[],type:number){const b=Buffer.alloc(values.length*widths[type]);values.forEach((v,i)=>{const p=i*widths[type];switch(type){case 1:b.writeInt8(v,p);break;case 3:b.writeInt16BE(v,p);break;case 4:b.writeInt32BE(v,p);break;case 5:b.writeFloatBE(v,p);break;default:b.writeDoubleBE(v,p);}});return b;}
function attrs(values:Record<string,Attr>={}){const entries=Object.entries(values);return entries.length?Buffer.concat([u32(12),u32(entries.length),...entries.flatMap(([key,value])=>{const type=typeof value==="string"?2:6,raw=typeof value==="string"?Buffer.from(value):nums(Array.isArray(value)?value:[value],type);return [name(key),u32(type),u32(type===2?raw.length:raw.length/8),pad(raw)];})]):Buffer.alloc(8);}
/** Small standards-shaped fixture writer, independent of the production parser. */
function file(variables:Var[],options:{version?:1|2;record?:boolean;dimensions?:{name:string;size:number}[]}={}){
  const dimensions=options.dimensions??[{name:"TIME",size:variables[0].values.length}],version=options.version??1;
  const dimensionList=Buffer.concat([u32(10),u32(dimensions.length),...dimensions.flatMap((d,i)=>[name(d.name),u32(options.record&&i===0?0:d.size)])]);
  const records=options.record?dimensions[0].size:0;
  const sizes=variables.map(v=>pad(nums(options.record?v.values.slice(0,v.values.length/records):v.values,v.type??5)).length);
  function header(offsets:number[]){return Buffer.concat([Buffer.from([67,68,70,version]),u32(records),dimensionList,attrs(),u32(11),u32(variables.length),...variables.flatMap((v,i)=>[name(v.name),u32(v.dims.length),...v.dims.map(u32),attrs(v.attrs),u32(v.type??5),u32(sizes[i]),...(version===2?[u32(0)]:[]),u32(offsets[i]??0)])]);}
  const h0=header([]),offsets:number[]=[];let offset=h0.length;
  if(options.record){for(const s of sizes){offsets.push(offset);offset+=s;}
    const chunks=[];for(let i=0;i<records;i++)for(let j=0;j<variables.length;j++){const v=variables[j],width=v.values.length/records;chunks.push(pad(nums(v.values.slice(i*width,(i+1)*width),v.type??5)));}
    return Buffer.concat([header(offsets),...chunks]);
  }
  for(const v of variables){offsets.push(offset);offset+=pad(nums(v.values,v.type??5)).length;}
  return Buffer.concat([header(offsets),...variables.map(v=>pad(nums(v.values,v.type??5)))]);
}
const target={artifactId:"authorized-buoy",version:"A",variable:"WSPD"};
const clock=(values:number[],more:Record<string,Attr>={}):Var=>({name:"TIME",dims:[0],type:6,values,attrs:{standard_name:"time",axis:"T",units:"hours since 2020-01-01T00:00:00Z",...more}});
const wind=(values:number[],more:Record<string,Attr>={}):Var=>({name:"WSPD",dims:[0],values,attrs:{standard_name:"wind_speed",long_name:"wind speed",units:"m/s",_FillValue:Math.fround(1e35),missing_value:-999,valid_min:0,valid_max:100,...more}});
const read=(bytes:Buffer,allowed=["WSPD"])=>readNetcdfObservation(bytes,target,createHash("sha256").update(bytes).digest("hex"),allowed);

test("classic CF masks raw markers/nonfinite/range separately and takes actual chronological UTC bounds",()=>{
  const bytes=file([clock([48,0,1,2,3,0,4]),wind([1,Math.fround(1e35),NaN,-999,999,2,Infinity]),{name:"WDIR",dims:[0],values:[1,2,3,4,5,6,7],attrs:{standard_name:"wind_to_direction",long_name:"wind direction (blowing to)",units:"degree"}}]);
  const e=read(bytes,["WSPD","WDIR"]);assert.equal(e.count,2);assert.equal(e.first,"2020-01-01");assert.equal(e.last,"2020-01-03");assert.deepEqual(e.netcdf!.excluded,{missingValue:2,nonFinite:2,outsideValidRange:1,invalidTime:0});
  assert.equal(e.netcdf!.firstUtc,"2020-01-01T00:00:00.000Z");assert.equal(e.netcdf!.lastUtc,"2020-01-03T00:00:00.000Z");assert.equal(e.netcdf!.firstRaw,0);assert.equal(e.netcdf!.lastRaw,48);assert.deepEqual(e.netcdf!.fillValues,[Math.fround(1e35)]);assert.deepEqual(e.netcdf!.missingValues,[-999]);assert.equal(e.netcdf!.qcApplied,false);
  assert.deepEqual(e.netcdf!.relatedVariables,[{name:"WDIR",standardName:"wind_to_direction",longName:"wind direction (blowing to)",unit:"degree"}]);assert.ok(!JSON.stringify(e.netcdf!.relatedVariables).includes("first"));assert.ok(validObservationEvidence(e));
});
for(const version of [1,2] as const)for(const record of [false,true])test("classic/CDF2 fixed and interleaved-record time layouts: "+version+"/"+record,()=>{
  const e=read(file([clock([1,3]),wind([2,3])],{version,record}));assert.equal(e.count,2);assert.equal(e.netcdf!.firstUtc,"2020-01-01T01:00:00.000Z");assert.equal(e.netcdf!.lastUtc,"2020-01-01T03:00:00.000Z");assert.ok(validObservationEvidence(e));
});
test("default fill, invalid timestamps and zero observations never manufacture an interval",()=>{
  const v=wind([Math.fround(9.969209968386869e36),3,NaN]);delete v.attrs!._FillValue;
  const e=read(file([clock([0,NaN,2]),v]));assert.equal(e.count,0);assert.equal(e.first,null);assert.equal(e.netcdf!.firstUtc,null);assert.equal(e.netcdf!.firstRaw,null);assert.deepEqual(e.netcdf!.excluded,{missingValue:1,nonFinite:1,outsideValidRange:0,invalidTime:1});assert.ok(validObservationEvidence(e));
});
for(const [units,calendar,value,expected] of [
  ["days since 1950-01-01T00:00:00Z","standard",19890.833333333332,"2004-06-16T20:00:00.000Z"],
  ["seconds since 2020-1-1 0:0:0 +05:30","gregorian",0,"2019-12-31T18:30:00.000Z"],
  ["minutes since 2020-01-01","standard",90,"2020-01-01T01:30:00.000Z"],
  ["milliseconds since 2020-01-01","standard",1234,"2020-01-01T00:00:01.234Z"],
  ["days since 1500-01-01","proleptic_gregorian",1,"1500-01-02T00:00:00.000Z"],
] as const)test("CF unit/calendar conversion: "+units,()=>assert.equal(new Date(cfTime(units,calendar)(value)).toISOString(),expected));
for(const [units,calendar] of [["months since 2020-01-01","standard"],["days since 2000-01-01","360_day"],["days since 1500-01-01","standard"],["days since 2020-02-30","standard"],["seconds since 2020-01-01T00:00:60Z","standard"]])test("unsupported or invalid time semantics fail explicitly: "+units+calendar,()=>assert.throws(()=>cfTime(units,calendar),/netcdf_time|netcdf_calendar/));
test("parser preflight rejects large counts, offsets, extra sample dimensions and truncation without allocating requested arrays",()=>{
  const bytes=file([clock([0,1]),wind([2,3])]);const bomb=Buffer.from(bytes);bomb.writeUInt32BE(0xffffffff,12);assert.throws(()=>read(bomb),/netcdf_header_limit/);
  assert.throws(()=>read(bytes.subarray(0,bytes.length-4)),/netcdf_layout_invalid/);
  const deep=file([clock([0,1]),{...wind([1,2,3,4]),dims:[0,1]}],{dimensions:[{name:"TIME",size:2},{name:"DEPTH",size:2}]});assert.throws(()=>read(deep),/netcdf_layout_unsupported/);
  const unsupported=Buffer.from(bytes);unsupported[3]=5;assert.throws(()=>read(unsupported),/netcdf_format/);
  assert.throws(()=>readNetcdfObservation(bytes,{...target,variable:"WDIR"},"a".repeat(64),["WSPD"]),/variable_unavailable/);
});
test("related metadata is limited to current registered exact variables, with no values or other periods",()=>{
  const e=read(file([clock([0]),wind([1]),{name:"secret",dims:[0],values:[99],attrs:{units:"hidden",long_name:"PRIVATE_METADATA"}}]));assert.deepEqual(e.netcdf!.relatedVariables,[]);assert.ok(!JSON.stringify(e).includes("PRIVATE_METADATA"));
});
test("the C process verifies exact SHA and registration before producing a real NetCDF receipt; archive keeps its full evidence",async t=>{
  const dir=await mkdtemp("/tmp/oe-netcdf-C-"),registry=path.join(dir,"registry.json"),bytes=file([clock([48,1,2]),wind([1,Math.fround(1e35),2])]),sha256=createHash("sha256").update(bytes).digest("hex");
  t.after(()=>rm(dir,{recursive:true,force:true}));await writeFile(path.join(dir,"source.nc"),bytes);await writeFile(registry,JSON.stringify({artifacts:[{id:target.artifactId,version:target.version,path:"source.nc",sha256,variables:["WSPD"],modelVisible:true}]}));
  const events:string[]=[],receipt=await executeObservationRead(target,registry,sha256,randomUUID(),new AbortController().signal,async kind=>{events.push(kind);},true);assert.equal(receipt.status,"read");if(receipt.status!=="read")return;
  assert.deepEqual(events,["reader_spawned","file_read"]);assert.ok(validObservationEvidence(receipt.evidence));
  const result={status:"verified" as const,evidence:receipt.evidence},check={...target,skill:observationCheckSkill,purpose:"describe"} as const;assert.ok(validObservationResult(result));assert.ok(observationResultMatchesRequest(result,check));
  const answer=observationResponse(result,check,10).result;assert.match(answer.message,/2020-01-01T02:00:00.000Z/);assert.match(answer.answerNotes.limitation,/未按关联 QC 标志筛选/);assert.deepEqual(answer.answerNotes.references[0].observationEvidence,receipt.evidence);
  const store=openTaskStore(":memory:");try{const id=randomUUID();store.submit(id,{});store.claim();store.finish(id,"complete",{result:answer});assert.deepEqual((store.terminal(id)!.result as any).answerNotes.references[0].observationEvidence,receipt.evidence);}finally{store.close();}
  const bad=await executeObservationRead(target,registry,"b".repeat(64),randomUUID(),new AbortController().signal,async()=>{},true);assert.equal(bad.status,"failed");if(bad.status==="failed")assert.equal(bad.reason,"authorization_changed");
});
test("new evidence fields cross the model-safe contract but inconsistent UTC/count or invented metadata is rejected",()=>{
  const e=read(file([clock([0,1]),wind([1,2])])),safe=modelObservationEvidence(e);assert.ok(!Object.hasOwn(safe,"sha256"));assert.ok(parseObservationResearchResult({action:"answer",basedOn:"read",evidence:safe}));
  assert.equal(validObservationEvidence({...e,netcdf:{...e.netcdf,firstUtc:"2021-01-01T00:00:00.000Z"}}),false);assert.equal(validObservationEvidence({...e,netcdf:{...e.netcdf,totalSamples:99}}),false);
  assert.equal(validObservationEvidence({...e,netcdf:{...e.netcdf,relatedVariables:[{name:"WDIR",standardName:null,longName:null,unit:"degree",first:"invented"}]}}),false);
  assert.equal(validObservationEvidence({...e,unknownField:true}),false);
});
test("nonidentity packed time is rejected rather than reporting unreconstructable raw time bounds",()=>{
  assert.throws(()=>read(file([clock([0,1],{scale_factor:2}),wind([1,2])])),/netcdf_time_packing_unsupported/);
});
test("NetCDF answer shows actual markers, trusted publication label and independent roles without empty headings",()=>{
  const e=read(file([clock([0,1]),wind([1,2])])),source={dataUrl:"https://example.invalid/source.nc",catalogUrl:"https://example.invalid/catalog",versionLabel:"fixed official release"};
  const answer=observationResponse({status:"verified",evidence:{...e,artifactSource:source}}, {...target,skill:observationCheckSkill,purpose:"describe"},1).result;
  assert.match(answer.message,/fixed official release/);assert.ok(answer.message.includes(String(Math.fround(1e35))));assert.match(answer.message,/missing_value 标记：\[-999\]/);assert.match(answer.message,/非缺测记录共 2 条/);assert.ok(!answer.message.includes(source.dataUrl));
  const blank={...e,netcdf:{...e.netcdf!,standardName:null,longName:null}};
  assert.ok(!observationResponse({status:"verified",evidence:blank},{...target,skill:observationCheckSkill,purpose:"describe"},1).result.message.includes("文件变量角色："));
});
