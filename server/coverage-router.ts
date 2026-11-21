import { Router } from "express";
import { createHash } from "node:crypto";
import { catalogRevision } from "../src/domain/datasets";
import { catalogGrid } from "../src/domain/results";
import { regionRecords } from "../src/domain/product-distribution";
import { gridSpec } from "../src/domain/spatial";
import { validContext } from "./validation";
import { coverageScope, coverageCounter, coverageProducts, type coverageIndex } from "./coverage-index";
import type { CandidateSet, Filters, GridSpec } from "../src/domain/types";
import {coverageBatchKey} from "../src/domain/coverage";

const grids=(["h3","s2"] as const).flatMap(system=>[2,3,4,5,6,7].map(band=>gridSpec(system,band)));
const camera={center:[105,25],zoom:1,reason:"网格索引"};
function context(filters:unknown,batch?:CandidateSet|null) {
  return {caseId:batch?.caseId||null,filters,gridSystem:"h3",layer:batch?.layer||"all",camera,citation:null,selection:batch?.selection||null};
}
function validBatch(batch:any) {
  if(batch==null)return true;
  if(typeof batch!=="object" || !Array.isArray(batch.ids) || batch.ids.length>10000 || !batch.ids.every((id:unknown)=>typeof id==="string" && id.length<=500) ||
    (batch.metric!==undefined && !["products","scenes"].includes(batch.metric)) || (batch.sceneKey!==undefined && typeof batch.sceneKey!=="string"))return false;
  if(batch.lookups!==undefined && (!Array.isArray(batch.lookups) || batch.lookups.length>20 || !batch.lookups.every((lookup:any)=>
    typeof lookup?.assetId==="string" && Array.isArray(lookup.point) && lookup.point.length===2 && lookup.point.every(Number.isFinite) &&
    Math.abs(lookup.point[0])<=180 && Math.abs(lookup.point[1])<=90 && Array.isArray(lookup.years) && lookup.years.length===2 && lookup.years.every(Number.isFinite) &&
    Number.isSafeInteger(lookup.matched) && lookup.matched>=0 && Array.isArray(lookup.items) && lookup.items.length<=1000 && lookup.items.every((item:any)=>
      typeof item?.id==="string" && typeof item.datetime==="string" && Number.isFinite(Date.parse(item.datetime))))))return false;
  return true;
}
export function coverageRouter(index:ReturnType<typeof coverageIndex>, hydrateBatch?:(ids:string[])=>void) {
  const router=Router();
  const scopes=new Map<string,{filters:Filters;batch:CandidateSet|null;prepared:ReturnType<typeof coverageScope>;count:ReturnType<typeof coverageCounter>;bases:Map<string,Map<string,Set<string>>>}>();
  router.post("/scopes",(req,res)=>{
    const {filters,batch=null}=req.body||{};
    if(!validBatch(batch) || !validContext(context(filters,batch))) {res.status(400).json({error:"网格查询条件无效。"});return;}
    // Only restore already cached local evidence for an explicit saved batch.
    // Hydration registers references without publishing them to the catalogue.
    if(batch)hydrateBatch?.(batch.ids);
    const id=createHash("sha256").update(JSON.stringify([catalogRevision(),filters,coverageBatchKey(batch)])).digest("hex");
    if(!scopes.has(id)) {
      const prepared=coverageScope(regionRecords(filters,batch),batch?.metric==="scenes");
      scopes.set(id,{filters,batch,prepared,count:coverageCounter(prepared.products),bases:new Map()});
      if(scopes.size>32)scopes.delete(scopes.keys().next().value!);
    }
    res.set("Cache-Control","no-store").json({id});
  });
  router.post("/cells",async(req,res)=>{
    const {id,cells,includeProducts}=req.body||{};
    const grid=grids.find(g=>g.key===req.body?.grid?.key && g.system===req.body.grid.system && g.n===req.body.grid.n);
    const scope=scopes.get(id);
    if(!scope){res.status(404).json({error:"网格查询已过期，请重新载入。"});return;}
    if(!grid || !Array.isArray(cells) || !cells.length || cells.length>512 || !cells.every(cell=>typeof cell==="string" &&
      validContext({...context(scope.filters,scope.batch),selection:{id:cell,grid,point:[0,0]}}))) {res.status(400).json({error:"网格编号无效。"});return;}
    if((includeProducts!==undefined && typeof includeProducts!=="boolean") || (includeProducts && cells.length!==1)) {
      res.status(400).json({error:"请逐格读取可定位数据集名单。"});return;
    }
    const frozen=scope.batch?.selection;
    if(frozen && (frozen.grid.key!==grid.key || cells.some(cell=>cell!==frozen.id))) {res.status(400).json({error:"请读取原选网格。"});return;}
    try {
      const result=await index.read(grid,[...new Set(cells)],scope.prepared.geometries);
      let base=scope.bases.get(grid.key);
      if(!base){base=catalogGrid(grid,scope.filters,scope.batch);scope.bases.set(grid.key,base);}
      const counts=result.hits.map(([cell,geometries]):[string,number]=>[cell,scope.count(geometries,base!.get(cell))]);
      const members=includeProducts ? result.hits.map(([cell,geometries])=>[cell,[...coverageProducts(scope.prepared.products,geometries,base!.get(cell))]]) : undefined;
      res.set("Cache-Control","no-store").json({cells:counts.filter(([,count])=>count>0),ready:counts.map(([cell])=>cell),pending:result.pending,...(members?{members}:{})});
    } catch {res.status(503).json({error:"网格分布暂时不可用，请稍后重试。"});}
  });
  return router;
}
