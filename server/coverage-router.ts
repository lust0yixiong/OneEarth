import { Router, type Response } from "express";
import { createHash, randomUUID } from "node:crypto";
import { assetById } from "../src/domain/datasets";
import { catalogGrid } from "../src/domain/results";
import { backgroundCoverageProduct, productKey, regionRecords } from "../src/domain/product-distribution";
import { gridSpec } from "../src/domain/spatial";
import { validContext } from "./validation";
import { coverageGeometryKey, coverageScope, coverageCounter, coverageProducts, type coverageIndex } from "./coverage-index";
import type { CandidateSet, Filters, GridSpec, Selection } from "../src/domain/types";
import type { CoverageScopeSummary } from "../src/domain/coverage";

const grids=(["h3","s2"] as const).flatMap(system=>[2,3,4,5,6,7].map(band=>gridSpec(system,band)));
const camera={center:[105,25],zoom:1,reason:"网格索引"};
function context(filters:unknown,batch?:CandidateSet|null,selection = batch?.selection ?? null) {
  return {caseId:batch?.caseId||null,filters,gridSystem:"h3",layer:batch?.layer||"all",camera,citation:null,selection};
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
type CoveragePublication = { revision(): string; hydrateBatch?(ids: string[]): void };
type Scope = {
  id: string;
  revision: string;
  filters: Filters;
  batch: CandidateSet | null;
  selection: Selection | null;
  summary: CoverageScopeSummary;
  prepared: ReturnType<typeof coverageScope>;
  count: ReturnType<typeof coverageCounter>;
  bases: Map<string, Map<string, Set<string>>>;
};

function normalizeFilters(f: Filters): Filters {
  const { need, type, source, place, period, depth, maxDem, utcWindow } = f;
  return { need, type, source, place, period, depth, maxDem, utcWindow: utcWindow ?? null };
}

function scopeBatchKey(batch: CandidateSet | null) {
  if (!batch) return null;
  const { selection } = batch;
  const lookups = (batch.lookups ?? []).map(({ assetId, point, years, matched, items }) => {
    const scenes = [...new Set(items.map(item => JSON.stringify([item.id, item.datetime])))].sort();
    return JSON.stringify([assetId, point, years, matched, scenes]);
  });
  return [
    batch.caseId, batch.ids, batch.layer, batch.metric ?? "products", batch.sceneKey ?? null,
    selection ? [selection.grid.key, selection.id] : null,
    [...new Set(lookups)].sort(),
  ];
}

function summarizeScope(
  filters: Filters, batch: CandidateSet | null, selection: Selection | null, batchKey: ReturnType<typeof scopeBatchKey>,
): CoverageScopeSummary {
  return {
    filters,
    selection: selection && { id: selection.id, point: selection.point, grid: grids.find(g => g.key === selection.grid.key)! },
    caseId: batch?.caseId ?? null,
    layer: batch?.layer ?? "all",
    metric: batch?.metric ?? "products",
    candidateCount: batch?.ids.length ?? null,
    candidateIdentity: batchKey && createHash("sha256").update(JSON.stringify(batchKey)).digest("hex"),
  };
}

function expired(res: Response, revision: string) {
  return res.status(410).json({ code: "coverage_scope_expired", error: "数据已更新或查询范围已过期，请重新载入。", revision });
}

function sourceReferences(scope: Scope, grid: GridSpec, cell: string, geometryKeys: string[], members: string[]) {
  const records = new Map<string, Set<string>>();
  catalogGrid(grid, scope.filters, scope.batch, { cell, records });
  const geometries = new Set(geometryKeys);
  if (geometries.size) {
    const frequency = scope.batch?.metric === "scenes";
    for (const region of regionRecords(scope.filters, scope.batch)) {
      if (!frequency && !region.scene && backgroundCoverageProduct(region.asset)) continue;
      const member = frequency ? region.scene && region.asset.datasetId + "/" + region.scene : productKey(region.asset);
      if (!member || !geometries.has(coverageGeometryKey(region.area))) continue;
      const ids = records.get(member) ?? new Set<string>();
      ids.add(region.asset.id);
      records.set(member, ids);
    }
  }
  return members.map(member => [member, [...(records.get(member) ?? [])].sort()] as const);
}

export function coverageRouter(index: ReturnType<typeof coverageIndex>, publication: CoveragePublication) {
  const router=Router();
  const scopes = new Map<string, Scope>();
  const scopeKeys = new Map<string, Scope>();
  let activeRevision: string | undefined;
  function currentRevision() {
    const revision = publication.revision();
    if (activeRevision !== revision) {
      scopes.clear();
      scopeKeys.clear();
      activeRevision = revision;
    }
    return revision;
  }

  router.use((_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
  router.get("/revision", (_req, res) => res.json({ revision: currentRevision() }));
  router.post("/scopes",(req,res)=>{
    const {filters: requestedFilters, batch: requestedBatch = null, revision: expected} = req.body || {};
    const batchSelection = requestedBatch?.selection ?? null;
    const selection: Selection | null = req.body?.selection ?? batchSelection;
    if (!validBatch(requestedBatch) || !validContext(context(requestedFilters, requestedBatch)) ||
        !validContext(context(requestedFilters, requestedBatch, selection)) || selection?.simulated ||
        (selection && !grids.some(grid => grid.key === selection.grid.key && grid.system === selection.grid.system && grid.n === selection.grid.n)) ||
        (batchSelection && selection && (batchSelection.id !== selection.id || batchSelection.grid.key !== selection.grid.key)) ||
        (expected !== undefined && (typeof expected !== "string" || !/^[0-9a-f]{64}$/.test(expected)))) {
      res.status(400).json({error:"网格查询条件无效。"});return;
    }
    const revision = currentRevision();
    if (expected !== undefined && expected !== revision) {
      res.status(409).json({ code: "coverage_revision_changed", error: "覆盖数据已更新。", revision }); return;
    }
    const filters = normalizeFilters(requestedFilters);
    const batch: CandidateSet | null = requestedBatch ? {
      ...requestedBatch, caseId: requestedBatch.caseId || null, layer: requestedBatch.layer || "all",
      ids: [...new Set<string>(requestedBatch.ids)].sort(), filters,
    } : null;
    // Only restore already cached local evidence for an explicit saved batch.
    // Hydration registers references without publishing them to the catalogue.
    if (batch) {
      publication.hydrateBatch?.(batch.ids);
      if (batch.ids.some(id => !assetById.has(id))) {
        res.status(503).json({ code: "coverage_inputs_unavailable", error: "部分覆盖来源尚不可读。", revision }); return;
      }
    }
    const batchKey = scopeBatchKey(batch);
    const key = JSON.stringify([filters, batchKey, selection ? [selection.grid.key, selection.id, selection.point] : null]);
    let scope = scopeKeys.get(key);
    if (!scope) {
      const prepared = coverageScope(regionRecords(filters, batch), batch?.metric === "scenes");
      scope = {
        id: randomUUID(), revision, filters, batch, selection, summary: summarizeScope(filters, batch, selection, batchKey),
        prepared, count: coverageCounter(prepared.products), bases: new Map(),
      };
      scopes.set(scope.id, scope);
    } else {
      scopeKeys.delete(key);
    }
    scopeKeys.set(key, scope);
    if (scopeKeys.size > 32) {
      const oldest = scopeKeys.entries().next().value!;
      scopeKeys.delete(oldest[0]);
      scopes.delete(oldest[1].id);
    }
    res.json({ id: scope.id, revision, scope: scope.summary });
  });
  router.post("/cells",async(req,res)=>{
    const {id,cells,includeProducts,includeReferences,requireSelection}=req.body||{};
    const grid=grids.find(g=>g.key===req.body?.grid?.key && g.system===req.body.grid.system && g.n===req.body.grid.n);
    const revision = currentRevision();
    const scope=scopes.get(id);
    if (!scope || (req.body.revision !== undefined && req.body.revision !== revision)) {
      expired(res, revision); return;
    }
    if(!grid || !Array.isArray(cells) || !cells.length || cells.length>512 || !cells.every(cell=>typeof cell==="string" &&
      validContext({...context(scope.filters,scope.batch),selection:{id:cell,grid,point:[0,0]}}))) {res.status(400).json({error:"网格编号无效。"});return;}
    if((includeProducts!==undefined && typeof includeProducts!=="boolean") || (includeProducts && cells.length!==1)) {
      res.status(400).json({error:"请逐格读取可定位数据集名单。"});return;
    }
    if (includeReferences !== undefined && (typeof includeReferences !== "boolean" || (includeReferences && !includeProducts))) {
      res.status(400).json({ error: "来源记录需要同时读取单格成员。" }); return;
    }
    const frozen=scope.selection;
    if (requireSelection !== undefined && typeof requireSelection !== "boolean") {
      res.status(400).json({ error: "选格查询条件无效。" }); return;
    }
    if (requireSelection && !frozen) {
      res.status(400).json({ code: "coverage_selection_required", error: "请附加由时空服务登记的有效网格。" }); return;
    }
    if(frozen && (frozen.grid.key!==grid.key || cells.some(cell=>cell!==frozen.id))) {res.status(400).json({error:"请读取原选网格。"});return;}
    try {
      const result=await index.read(grid,[...new Set(cells)],scope.prepared.geometries);
      const latest = currentRevision();
      if (latest !== scope.revision || !scopes.has(scope.id)) { expired(res, latest); return; }
      let base=scope.bases.get(grid.key);
      if(!base){base=catalogGrid(grid,scope.filters,scope.batch);scope.bases.set(grid.key,base);}
      const counts=result.hits.map(([cell,geometries]):[string,number]=>[cell,scope.count(geometries,base!.get(cell))]);
      const members = includeProducts ? result.hits.map(([cell, geometries]): [string, string[]] =>
        [cell, [...coverageProducts(scope.prepared.products, geometries, base!.get(cell))].sort()]) : undefined;
      const references = includeReferences && members ? result.hits.map(([cell, geometries], i) =>
        [cell, sourceReferences(scope, grid, cell, geometries, members[i][1])] as const) : undefined;
      const sourceIds = references?.map(([cell, grouped]) =>
        [cell, [...new Set(grouped.flatMap(([, ids]) => ids))].slice(0, 32)]);
      const response = {
        revision, cells: counts.filter(([,count])=>count>0), ready: counts.map(([cell])=>cell),
        pending: result.pending, members, references, sourceIds,
      };
      res.json(requireSelection ? { ...response, scope: scope.summary } : response);
    } catch {res.status(503).json({code:"coverage_unavailable",error:"覆盖未知，网格分布暂时无法读取。"});}
  });
  router.use((_error: unknown, _req: unknown, res: Response, _next: unknown) => {
    res.status(503).json({ code: "coverage_unavailable", error: "覆盖未知，网格分布暂时无法读取。" });
  });
  return router;
}
