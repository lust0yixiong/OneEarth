import {geoArea,geoBounds,geoCentroid,geoDistance} from "d3-geo";
import type {Geometry} from "geojson";
import {assetById,assetMatchesEntry,catalogRevision} from "./datasets";
import {acceptsAsset,backgroundCoverageProduct,globalProduct,regionRecords} from "./product-distribution";
import {cellAt,cellShape,gridSpec,spatialEntries} from "./spatial";
import {lookupInPeriod} from "./results";
import {resolution} from "../data/evidence/globe-navigation.mjs";
import type {Camera,CandidateSet,Coordinate,Filters,GridSystem,Message,Selection} from "./types";
import type {Asset} from "./datasets";

export type MappedEvidence={kind:"local"|"global"|"range"|"unlocated";geometries:Geometry[];coverageGeometries?:Geometry[];coverageTime?:"unverified"|"outside"};
/** Research conditions come from the response or the original request snapshot,
 * never a catalogue candidate's availability period. Preserve explicit nulls. */
export function answerFilters(request:Filters,response?:Filters,source?:Filters["source"]):Filters {
  return structuredClone({...request,...response,...(source?{source}:{})});
}
/** A catalogue footprint can be known even when its temporal applicability is not.
 * This is only an outline for an explicitly cited asset, never observed cells. */
function temporalCoverageOutline(a:Asset,batch:CandidateSet):MappedEvidence|null {
  const f=batch.filters,p=a.profile;
  if(!p || p.role==="method" || p.role==="request" || !acceptsAsset(a,f) || batch.layer!=="all" || f.place ||
    (batch.caseId && batch.caseId!==a.caseId) || (!f.period && !f.utcWindow))return null;
  const years=p.years,utc=p.utcWindow;
  const outside=!!((f.period && years && (years[0]>f.period[1] || (years[1]??new Date().getUTCFullYear())<f.period[0])) ||
    (f.utcWindow && utc && (utc[0]>=f.utcWindow[1] || f.utcWindow[0]>=utc[1])));
  const unverified=!!((f.period && !years) || (f.utcWindow && !utc));
  if(!outside && !unverified)return null;
  const coverageTime=outside?"outside":"unverified";
  if(p.extent==="world")return {kind:"global",geometries:[],coverageTime};
  if(!p.area){
    const geometries=spatialEntries(a.caseId,{...f,period:null,utcWindow:null},batch.layer)
      .filter(e=>!e.studyOnly && assetMatchesEntry(a,e))
      .map(e=>e.geometry || {type:"Point" as const,coordinates:e.center});
    return geometries.length?{kind:"range",geometries:[],coverageGeometries:geometries,coverageTime}:null;
  }
  const area=structuredClone(p.area);
  for(const rings of area.type==="Polygon"?[area.coordinates]:area.coordinates)
    if(geoArea({type:"Polygon",coordinates:[rings[0]]})>2*Math.PI)rings.forEach(ring=>ring.reverse());
  return {kind:"range",geometries:[],coverageGeometries:[area],coverageTime};
}
export function coverageTimeNote(evidence?:MappedEvidence):string|null {
  if(evidence?.coverageTime==="outside")return "官方覆盖时段与当前时段不匹配；仅查看官方空间范围，不代表当前时段有观测。";
  if(evidence?.coverageTime==="unverified")return "官方覆盖时段未核；仅查看官方空间范围，不代表当前时段有观测。";
  return null;
}
const evidenceCache=new WeakMap<CandidateSet,{revision:number;value:Map<string,MappedEvidence>}>();
/** Only source data locations qualify. A paper's study area is never a data footprint. */
export function answerEvidence(batch:CandidateSet) {
  const revision=catalogRevision(),cached=evidenceCache.get(batch);
  if(cached?.revision===revision)return cached.value;
  const result=new Map<string,MappedEvidence>();
  const regions=new Map<string,ReturnType<typeof regionRecords>>();
  for(const region of regionRecords(batch.filters,batch)) {
    const group=regions.get(region.asset.id)||[];group.push(region);regions.set(region.asset.id,group);
  }
  const entries=new Map<string,ReturnType<typeof spatialEntries>>();
  for(const id of batch.ids) {
    const a=assetById.get(id);if(!a)continue;
    if(a.profile?.spatial==="nonspatial" || a.profile?.spatial==="restricted") {
      result.set(id,{kind:"unlocated",geometries:[]});continue;
    }
    if(globalProduct(a,batch.filters)){result.set(id,{kind:"global",geometries:[]});continue;}
    const geometries:Geometry[]=(regions.get(id)||[]).filter(r=>r.scene || !backgroundCoverageProduct(a)).map(r=>r.area);
    if(!entries.has(a.caseId))entries.set(a.caseId,spatialEntries(a.caseId,batch.filters,batch.layer));
    for(const lookup of batch.lookups || [])if(lookup.assetId===id && lookup.matched>0 && lookupInPeriod(lookup,batch.filters))
      geometries.push({type:"Point",coordinates:lookup.point});
    for(const e of entries.get(a.caseId)!)if(!e.studyOnly && assetMatchesEntry(a,e))
      geometries.push(e.geometry || {type:"Point",coordinates:e.center});
    const coverageGeometries=(regions.get(id)||[]).filter(r=>!r.scene && backgroundCoverageProduct(a)).map(r=>r.area);
    const outline=!geometries.length && !coverageGeometries.length?temporalCoverageOutline(a,batch):null;
    result.set(id,outline ||
      {kind:geometries.length?"local":coverageGeometries.length?"range":"unlocated",geometries,coverageGeometries});
  }
  evidenceCache.set(batch,{revision,value:result});
  return result;
}
export function answerMapBatch(message:Message):CandidateSet|null {
  const batch=message.candidates;
  if(!batch)return null;
  return {...batch,answerId:message.id,originKind:"chat"};
}
export function geometryCamera(geometries:Geometry[],reason:string):Camera|null {
  if(!geometries.length)return null;
  const [[west,south],[east,north]]=geoBounds({type:"GeometryCollection",geometries});
  if(![west,south,east,north].every(Number.isFinite))return null;
  const span=east-west>=359.99?360:(east-west+360)%360;
  const center:Coordinate=[((west+span/2+540)%360)-180,(south+north)/2];
  const extent=Math.max(.18,north-south,span*Math.max(.1,Math.cos(center[1]*Math.PI/180)));
  return {center,zoom:Math.max(1,Math.min(300,55/extent)),reason};
}
export function gridCamera(selection:Selection):Camera {
  const shape=cellShape(selection.id,selection.grid);
  const center=shape.center as Coordinate;
  const radius=Math.max(...shape.geometry.coordinates[0].map((p:number[])=>geoDistance(center,p as Coordinate)));
  return {center,zoom:Math.max(1,Math.min(2200,.58/Math.max(.00001,Math.sin(radius)))),reason:"定位网格 · "+selection.grid.label+" · "+selection.id};
}
export function initialAnswerCamera(batch:CandidateSet) {
  if(batch.selection)return gridCamera(batch.selection);
  const evidence=[...answerEvidence(batch).values()];
  return geometryCamera(evidence.flatMap(e=>e.geometries),"本轮回答的数据位置") ||
    geometryCamera(evidence.flatMap(e=>e.coverageGeometries || []),"本轮资料的目录覆盖范围") ||
    (evidence.some(e=>e.kind==="global")?{center:batch.camera.center,zoom:1,reason:"本轮资料的全球覆盖范围"}:null);
}
export function evidenceCamera(batch:CandidateSet,id:string,system:GridSystem):Camera|null {
  const evidence=answerEvidence(batch).get(id);
  const temporal=evidence?.coverageTime==="outside"?"（覆盖时段不匹配）":evidence?.coverageTime==="unverified"?"（覆盖时段未核）":"";
  if(evidence?.kind==="global")return {center:batch.camera.center,zoom:1,reason:(temporal?"官方全球范围":"全球覆盖")+temporal+" · "+(assetById.get(id)?.title || "本轮资料")};
  if(evidence?.kind==="range")return geometryCamera(evidence.coverageGeometries || [],"目录覆盖范围"+temporal+" · "+(assetById.get(id)?.title || "本轮资料"));
  const selection=evidenceSelection(batch,id,system);
  return selection?gridCamera(selection):null;
}
export function evidenceSelection(batch:CandidateSet,id:string,system:GridSystem):Selection|null {
  const evidence=answerEvidence(batch).get(id);
  if(evidence?.kind!=="local")return null;
  const geometry=evidence.geometries[0];
  const point=geoCentroid(geometry) as Coordinate;
  if(!point.every(Number.isFinite))return null;
  const camera=geometryCamera([geometry],"数据位置")!;
  const grid=gridSpec(system,resolution(camera.zoom));
  return {id:cellAt(point,grid),grid,point};
}

export function evidenceAction(evidence?:MappedEvidence):string|null {
  if(evidence?.coverageTime && evidence.kind==="global")return "查看官方全球范围";
  if(evidence?.coverageTime && evidence.kind==="range")return "查看官方空间范围";
  if(evidence?.kind==="global")return "查看全球覆盖";
  if(evidence?.kind==="range")return "定位覆盖范围";
  if(evidence?.kind==="local")return "定位资料网格";
  return null;
}
