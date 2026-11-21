import {validWindow} from "./time-window";
import {validConversationReferences} from "./reference-memory";
import {scopeKey} from "./question-scope";
import { validVisualization } from "./visualization-catalog";
import { ctdStations } from "./visualization";
import { isValidCell, getResolution } from "h3-js";
import type { DiscoveryContext } from "./types";
import { caseById } from "./catalog";
function pair(v: unknown): v is [number, number] {
  return (
    Array.isArray(v) &&
    v.length === 2 &&
    v.every((n) => typeof n === "number" && Number.isFinite(n))
  );
}
function coordinate(v: unknown) {
  return pair(v) && v[0] >= -180 && v[0] <= 180 && v[1] >= -90 && v[1] <= 90;
}
function grid(v: any) {
  return (
    v &&
    typeof v.label === "string" &&
    typeof v.key === "string" &&
    ((v.system === "h3" && Number.isInteger(v.n) && v.n >= 2 && v.n <= 7) ||
      (v.system === "s2" && [5, 6, 8, 9, 11, 12].includes(v.n)))
  );
}
export function validContext(v: any): v is DiscoveryContext {
  if (
    !v ||
    !(
      v.caseId === null ||
      (typeof v.caseId === "string" && caseById(v.caseId))
    ) ||
    !["h3", "s2"].includes(v.gridSystem) ||
    !["all", "verified", "joint", "paired"].includes(v.layer)
  )
    return false;
  const f = v.filters;
  if (
    !f ||
    !Number.isInteger(f.need) ||
    f.need < -1 ||
    f.need >= Math.max(1, caseById(v.caseId)?.needs.length || 1) ||
    !["type", "source", "place"].every(
      (k) => typeof f[k] === "string" && f[k].length <= 100,
    )
  )
    return false;
  if (
    (f.utcWindow != null && !validWindow(f.utcWindow)) ||
    ![f.period, f.depth].every((r) => r === null || (pair(r) && r[0] <= r[1]))
  )
    return false;
  if (!(
    f.maxDem === null ||
    (typeof f.maxDem === "number" && Number.isFinite(f.maxDem) && f.maxDem > 0)
  ))
    return false;
  if (
    !v.camera ||
    !coordinate(v.camera.center) ||
    typeof v.camera.zoom !== "number" ||
    v.camera.zoom < 1 ||
    v.camera.zoom > 2200 ||
    !Number.isFinite(v.camera.zoom) ||
    typeof v.camera.reason !== "string"
  )
    return false;
  if (
    v.citation !== null &&
    (!v.citation ||
      !["title", "scope", "body"].every(
        (k) =>
          typeof v.citation[k] === "string" && v.citation[k].length <= 20000,
      ))
  )
    return false;
  if (
    v.visualization != null &&
    (v.caseId !== "wind" ||
      !validVisualization(v.visualization) ||
      v.dataView != null)
  )
    return false;
  if (v.dataView != null) {
    const d = v.dataView;
    if (d.kind === "ctd") {
      if (
        v.caseId !== "Q19" ||
        typeof d.stationId !== "string" ||
        !ctdStations.some((s) => s.name === d.stationId) ||
        !["temperature", "salinity"].includes(d.variable) ||
        typeof d.depth !== "number" ||
        !Number.isFinite(d.depth) ||
        d.depth < 0 ||
        d.depth > 600
      )
        return false;
    } else if (d.kind === "front") {
      if (
        v.caseId !== "Q20" ||
        !["Mendenhall", "Alsek"].includes(d.glacier) ||
        !["first", "last", "compare"].includes(d.epoch)
      )
        return false;
    } else return false;
  }
  if (v.inCandidateScope !== undefined && typeof v.inCandidateScope !== "boolean") return false;
  if (v.candidateIds !== undefined && (!Array.isArray(v.candidateIds) || !v.candidateIds.every((id:unknown)=>typeof id==="string"))) return false;
  if (!validSelection(v.selection)) return false;
  if(v.attachedScope!==undefined){
    const items=v.attachedScope;
    if(!Array.isArray(items) || items.length>10)return false;
    const keys=new Set<string>();
    for(const i of items){
      if(!i || typeof i!=="object")return false;
      if(i.kind==="grid"){
        const g=i.selection;
        if(!g || !validSelection(g) || g.simulated || !v.selection || g.id!==v.selection.id ||
          g.grid.key!==v.selection.grid.key || g.grid.key!==(g.grid.system==="h3"?"h":"s")+g.grid.n ||
          g.grid.label!==(g.grid.system==="h3"?"H3 R":"S2 L")+g.grid.n ||
          JSON.stringify(g.point)!==JSON.stringify(v.selection.point) || typeof i.place!=="string" || i.place.length>300)return false;
      }else if(i.kind==="time"){
        if(!pair(i.period) || !i.period.every(Number.isInteger) || i.period[0]>i.period[1] ||
          JSON.stringify(i.period)!==JSON.stringify(f.period) || (i.utcWindow!==null && !validWindow(i.utcWindow)) ||
          JSON.stringify(i.utcWindow)!==JSON.stringify(f.utcWindow ?? null))return false;
      }else if(i.kind==="reference"){
        if(!validConversationReferences([i.reference]) || !Number.isSafeInteger(i.number) || i.number<1 ||
          typeof i.messageId!=="string" || i.messageId.length>160)return false;
      }else if(i.kind==="dataset"){
        if(![i.id,i.title,i.source].every(s=>typeof s==="string" && s.length<=2000) || !i.id || !i.title ||
          !(i.version===null || typeof i.version==="string" && i.version.length<=500))return false;
      }else return false;
      const key=scopeKey(i);
      if(keys.has(key))return false;
      keys.add(key);
    }
  }
  if (v.observationSource !== undefined && typeof v.observationSource !== "boolean") return false;
  if (v.observationBatch !== undefined) {
    const b = v.observationBatch;
    if (!b || !validSelection(b.selection) || (b.utcWindow != null && !validWindow(b.utcWindow)) || !(b.period === null || (pair(b.period) && b.period[0] <= b.period[1])) ||
        !(b.catalogConditions === undefined || (Array.isArray(b.catalogConditions) && b.catalogConditions.every((c:unknown) => typeof c === "string"))) ||
        !Array.isArray(v.candidateIds) || v.candidateIds.length > 1000 ||
        !v.candidateIds.every((id:unknown) => typeof id === "string" && /^constellation:[a-f0-9]{64}$/.test(id))) return false;
  }
  return true;
}

function validSelection(s: any) {
  if (s !== null) {
    if (!s || !coordinate(s.point) || !grid(s.grid) || typeof s.id !== "string")
      return false;
    if (
      s.grid.system === "h3" &&
      (!isValidCell(s.id) || getResolution(s.id) !== s.grid.n)
    )
      return false;
    if (s.grid.system === "s2") {
      if (!/^[0-9]{1,20}$/.test(s.id)) return false;
      const id = BigInt(s.id),
        levelBit = 1n << BigInt(2 * (30 - s.grid.n));
      if (id <= 0n || id >> 61n > 5n || (id & -id) !== levelBit) return false;
    }
  }
  return true;
}
