import type {Polygon,MultiPolygon} from "geojson";
import {geometryCamera} from "./answer-map";
import type {Camera} from "./types";

/** A view annotation of the user's research area, never a dataset footprint or
 * an implicit spatial query filter. Keep its provenance with historical turns. */
export type ResearchRegion = {
  label:string;
  status:"located"|"unresolved";
  geometry:Polygon|MultiPolygon|null;
  precision:"boundary"|"approximate"|"grid"|"global";
  source:string;
  sourceUrl?:string;
  note:string;
};
export type ResearchRegionLayer={messageId:string;region:ResearchRegion;visible:boolean};

export function sameResearchRegion(a:ResearchRegion|null|undefined,b:ResearchRegion|null|undefined):boolean {
  if(!a || !b)return a==null && b==null;
  if(a.status!==b.status || a.precision!==b.precision)return false;
  return a.status==="located"?JSON.stringify(a.geometry)===JSON.stringify(b.geometry):a.label===b.label;
}

export function researchRegionCamera(region:ResearchRegion):Camera|null {
  if(region.status!=="located")return null;
  if(region.precision==="global")return {center:[105,20],zoom:1,reason:"研究区域 · 全球"};
  return region.geometry?geometryCamera([region.geometry],"研究区域 · "+region.label):null;
}

/** Bound persisted/streamed geometries so the extra layer stays inexpensive. */
export function validResearchRegion(value:unknown):value is ResearchRegion {
  if(!value || typeof value!=="object")return false;
  const v=value as ResearchRegion;
  if(typeof v.label!=="string" || !v.label.trim() || v.label.length>1200 ||
    !["located","unresolved"].includes(v.status) || !["boundary","approximate","grid","global"].includes(v.precision) ||
    typeof v.source!=="string" || v.source.length>600 || typeof v.note!=="string" || v.note.length>1600 ||
    (v.sourceUrl!==undefined && (typeof v.sourceUrl!=="string" || !/^https?:\/\//.test(v.sourceUrl))))return false;
  if(v.geometry===null)return v.status==="unresolved" || v.precision==="global";
  if(!v.geometry || !["Polygon","MultiPolygon"].includes(v.geometry.type))return false;
  const polygons=v.geometry.type==="Polygon"?[v.geometry.coordinates]:v.geometry.coordinates;
  if(!Array.isArray(polygons) || !polygons.length || polygons.length>300)return false;
  let size=0;
  return polygons.every(rings=>Array.isArray(rings) && rings.length>0 && rings.every(ring=>
    Array.isArray(ring) && ring.length>=4 && (size+=ring.length)<=8000 && ring.every(p=>
      Array.isArray(p) && p.length===2 && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0])<=180 && Math.abs(p[1])<=90) &&
      ring[0][0]===ring.at(-1)![0] && ring[0][1]===ring.at(-1)![1]));
}
