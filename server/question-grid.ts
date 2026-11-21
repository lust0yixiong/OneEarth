import {cellAt} from "../src/domain/spatial";
import {dateEvidence} from "../src/domain/time-window";
import {setTimeout as pause} from "node:timers/promises";
import {catalogGrid} from "../src/domain/results";
import {assets} from "../src/domain/datasets";
import {productKey,regionRecords} from "../src/domain/product-distribution";
import type {DiscoveryContext} from "../src/domain/types";
import {coverageScope,coverageProducts,type coverageIndex} from "./coverage-index";

// Run after question confirmation. Use the same two spatial indexes as the globe.
export async function questionGridEvidence(ctx:DiscoveryContext,index:ReturnType<typeof coverageIndex>,signal:AbortSignal){
  const cell=ctx.attachedScope?.find(i=>i.kind==="grid")?.selection;
  if(!cell)return;
  const scope=coverageScope(regionRecords(ctx.filters));
  for(let i=0;i<6;i++){
    signal.throwIfAborted();
    const hit=await index.read(cell.grid,[cell.id],scope.geometries);
    if(!hit.hits.length){await pause(120,undefined,{signal});continue;}
    const keys=coverageProducts(scope.products,hit.hits[0][1],catalogGrid(cell.grid,ctx.filters).get(cell.id));
    const chosen=ctx.attachedScope!.filter(i=>i.kind==="dataset").map(i=>i.id);
    const ids=assets.filter(a=>keys.has(productKey(a) || "")).sort((a,b)=>Number(chosen.includes(b.id))-Number(chosen.includes(a.id))).slice(0,32).map(a=>a.id);
    return {count:keys.size,ids};
  }
}

// Product-level samples in other cells must never be interpreted as local readings.
export function pickedSamples(tabs:import("../src/domain/types").EvidenceTab[],ctx:DiscoveryContext){
  if(!ctx.selection || !ctx.attachedScope?.length)return;
  const {grid,id}=ctx.selection;
  return tabs.flatMap(tab=>{
    const cols=tab.columns || [];
    const x=cols.findIndex(c=>/经度|^lon(?:gitude)?$/i.test(c)), y=cols.findIndex(c=>/纬度|^lat(?:itude)?$/i.test(c));
    if(x<0 || y<0)return [];
    const t=cols.findIndex(c=>/日期|观测时间|采集时间|^时间$|^date(time)?$/i.test(c));
    const rows=(tab.rows || []).filter(row=>{
      const lon=row[x],lat=row[y];
      if(typeof lon!=="number" || !Number.isFinite(lon) || Math.abs(lon)>180 || typeof lat!=="number" || !Number.isFinite(lat) || Math.abs(lat)>90 || cellAt([lon,lat],grid)!==id)return false;
      if(ctx.filters.utcWindow)return dateEvidence(row[t],ctx.filters.utcWindow);
      if(ctx.filters.period){const year=String(row[t] ?? "").match(/^(\d{4})(?:-|$)/)?.[1];return !!year && +year>=ctx.filters.period[0] && +year<=ctx.filters.period[1];}
      return true;
    }).slice(0,4);
    return rows.length?[{label:tab.label,columns:cols,rows:rows.map(row=>row.map(v=>String(v ?? "").slice(0,180)))}]:[];
  });
}
