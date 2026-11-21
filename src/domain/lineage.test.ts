import {productKey} from "./product-distribution";
import test from "node:test";
import assert from "node:assert/strict";
import { assetById, assetIdentity, assets, distinctAssets, relatedAssets, registerPapers } from "./datasets";
import { datasetLineage } from "./lineage";
import { catalogCellColor, catalogGrid, catalogScale, candidates, spatialGroups } from "./results";
import { cellAt, emptyFilters, gridSpec } from "./spatial";

const asset = (id: string) => assetById.get(id)!;

test("source records only coalesce at an identified product edition", () => {
  const modis = asset("Q03-1");
  assert.equal(modis.version, "Collection 6.1");
  assert.equal(relatedAssets(modis).length, 4);
  assert.equal(distinctAssets([modis, asset("Q17-2")]).length, 1);
  assert.equal(distinctAssets([modis, { ...modis, version: "Collection 6" }]).length, 2);
  const unknown = assets.filter(a => a.datasetId === "cds:reanalysis-era5-land");
  assert(unknown.length > 1);
  assert.equal(distinctAssets(unknown).length, unknown.length);
  assert.equal(relatedAssets(unknown[0]).length, 1);
  assert.equal(distinctAssets([unknown[0], unknown[0]]).length, 1);
});

test("lineage distinguishes actual paper use, local reads, and recommendations", () => {
  const atm = datasetLineage(asset("Q19-3/ATM"));
  assert.equal(atm.version, null);
  assert.match(atm.records[0].actualPeriod, /2012、2014/);
  assert.match(atm.records[0].relation, /原论文记载使用/);
  assert(atm.records[0].materials.some(m => m.url?.includes("s41467-018")));
  const alternate = datasetLineage(asset("Q07-0"));
  assert.match(alternate.records[0].relation, /替代/);
  assert.match(alternate.records[0].actualRegion, /待核/);
  const archive = datasetLineage(asset("Q19-4"));
  assert.match(archive.records[0].relation, /归档/);
  assert.match(archive.records[0].actualPeriod, /1998/);
});

test("batch spatial categories partition version-distinct resources and keep global coverage outside cell color", () => {
  const items = [asset("Q02-2"), asset("glacier-1"), asset("wind-0"), asset("Q15-3"), asset("glacier-3")];
  const groups = spatialGroups(items);
  assert.deepEqual(Object.values(groups).map(x => x.length), [1, 1, 1, 1]);
  const grid = gridSpec("h3", 2);
  const point: [number, number] = [10.75, 46.8];
  const selection = { id: cellAt(point, grid), point, grid };
  const selected = candidates(null, emptyFilters(), "all", selection);
  const hits = spatialGroups(selected, { selection });
  const ids = catalogGrid(grid, emptyFilters()).get(selection.id)!;
  assert.deepEqual(new Set(hits.local.flatMap(a=>productKey(a)||[])), ids);
  assert(hits.coverage.some(a => a.caseId === "wind"));
  assert.equal(catalogCellColor(0), undefined);
  for (const tick of catalogScale) assert.equal(catalogCellColor(tick.min), tick.color);
  assert.equal(catalogCellColor(7), catalogCellColor(6));
  assert.notEqual(catalogCellColor(4), catalogCellColor(5));
  assert.notEqual(catalogCellColor(10), catalogCellColor(40));
});

test("unstructured paper study context is retained without claiming a verified geographical region", () => {
  const id="earthnano:"+"f9".repeat(32);
  registerPapers([{id,dsKey:"test:mesozoic",papers:1,paperTitle:"Bird morphology",studyContext:"Mesozoic",points:[],need:{
    name:"Bird morphology matrix",type:"形态矩阵",status:"used",product:"Bird morphology matrix",source:"EarthNano 论文断言库",detail:"论文形态学矩阵",url:"https://example.org/records/matrix",
    profile:{coverage:"尚无可定位范围",role:"index",spatial:"nonspatial",access:"public",limitation:"coordinates not supplied"},tabs:[{label:"论文用法（本页）",kind:"table",rows:[["paper","id","name","variables","Usage","Mesozoic"]]}],
  }}] as import("./paper-record").PaperRecord[],false);
  const r=datasetLineage(asset(id)).records[0];
  assert.equal(r.studyContext,"Mesozoic");assert.match(r.actualRegion,/未单独核实/);assert.notEqual(r.actualRegion,"Mesozoic");
  assert.match(r.actualPeriod,/未单独核实/);
});
