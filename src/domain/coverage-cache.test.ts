import test from "node:test";
import assert from "node:assert/strict";
import { addCoverage, createCoverageCache, coverageSignature } from "../globe/coverage-grid";
import { regionRecords } from "./product-distribution";
import { emptyFilters, gridSpec, cellAt, cellShape } from "./spatial";
import seed from "../data/evidence/catalog-coverage.json";

test("cached coverage preserves exact H3/S2 products across camera moves, base changes and scope changes", () => {
  const regions = regionRecords(emptyFilters());
  assert.equal(coverageSignature(regions), seed.signature, "the build snapshot matches current catalogue geometries");
  for (const system of ["h3", "s2"] as const) {
    const grid = gridSpec(system, 2), cache = createCoverageCache();
    const cells = ([[105,25],[-75,10],[120,30],[0,-30]] as [number,number][]).map(point => cellShape(cellAt(point, grid), grid));
    const base = new Map([[cells[0].id, new Set(["point-product"])]]);
    const expected = addCoverage(base, cells, regions, false);
    const first = cache.read(base, cells, regions, false, Infinity, grid.key);
    assert.deepEqual(first.cells, expected);
    assert.equal(first.computed, 0, "default overview uses precomputed coverage without intersecting polygons");
    const rotated = cache.read(base, [...cells].reverse(), regions.map(r => ({...r})), false, Infinity, grid.key);
    assert.deepEqual(rotated.cells, expected);
    assert.equal(rotated.computed, 0);
    const changedBase = new Map([[cells[0].id, new Set(["new-point-product"])]]);
    assert.deepEqual(cache.read(changedBase, cells, regions, false, Infinity, grid.key).cells, addCoverage(changedBase, cells, regions, false));
    const subset = regions.slice(0,2);
    const changedScope = cache.read(base, cells, subset, false, Infinity, grid.key);
    assert.deepEqual(changedScope.cells, addCoverage(base, cells, subset, false));
    assert.equal(changedScope.computed, cells.length);
    const frequency = cache.read(base, cells, regions, true, Infinity, grid.key);
    assert.deepEqual(frequency.cells, addCoverage(base, cells, regions, true));
    assert.equal(frequency.computed, cells.length);
  }
});

test("incremental coverage yields between cells, caches empty results and completes with exact membership", () => {
  const regions = regionRecords(emptyFilters()).slice(0,3), grid = gridSpec("h3",2);
  const cells = ([[105,25],[-75,10],[120,30]] as [number,number][]).map(point => cellShape(cellAt(point,grid),grid));
  const cache = createCoverageCache(), base = new Map<string,Set<string>>();
  for (let i=0;i<cells.length;i++) {
    const batch = cache.read(base,cells,regions,false,0,grid.key);
    assert.equal(batch.computed,1);
    assert.equal(batch.pending,i<cells.length-1);
    if (!batch.pending) assert.deepEqual(batch.cells,addCoverage(base,cells,regions,false));
  }
  const warm = cache.read(base,cells,regions,false,0,grid.key);
  assert.equal(warm.computed,0);
  assert.equal(warm.pending,false);
});
