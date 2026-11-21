import test from "node:test";
import assert from "node:assert/strict";
import type { Polygon } from "geojson";
import { assetById, type Asset } from "./datasets";
import {
  products,
  globalProduct,
  type RegionRecord,
  checkedScenes,
} from "./product-distribution";
import { addCoverage } from "../globe/coverage-grid";
import { cellAt, cellShape, gridSpec, emptyFilters } from "./spatial";
import { inventoryId } from "./earth-search";
import { windowFilters } from "./time-window";
import type { CandidateSet } from "./types";

test("global, national and state coverage count products independently of source, revision and grid scheme", () => {
  const base = assetById.get("Q10-1")!,
    f = emptyFilters();
  assert.ok(globalProduct(base, f));
  assert.equal(globalProduct(base, { ...f, period: [1930, 1931] }), false);
  assert.equal(globalProduct(assetById.get("Q09-2")!, f), false); // land only
  const box = (w: number, s: number, e: number, n: number): Polygon => ({
    type: "Polygon",
    coordinates: [
      [
        [w, s],
        [w, n],
        [e, n],
        [e, s],
        [w, s],
      ],
    ],
  });
  // Synthetic coverage for count semantics, not catalog content.
  const country = box(-125, 25, -66, 49),
    state = box(-124, 33, -118, 41);
  const records: RegionRecord[] = Array.from({ length: 6 }, (_, i) => ({
    asset: { ...base, productId: "p" + i },
    area: i < 4 ? country : state,
  }));
  records.push({
    ...records[4],
    asset: {
      ...records[4].asset,
      id: "another-source",
      version: "second-release",
    },
  });
  assert.equal(products(records.map((r) => r.asset)).size, 6);
  for (const system of ["h3", "s2"] as const) {
    const grid = gridSpec(system, 4);
    const cells = [
      [-121, 37],
      [-115, 39],
      [-120, 55],
    ].map(
      (p) =>
        cellShape(cellAt(p as [number,number], grid), grid) as {
          id: string;
          geometry: Polygon;
          center: [number, number];
        },
    );
    const colored = addCoverage(new Map(), cells, records, false);
    assert.deepEqual(
      cells.map((c) => colored.get(c.id)?.size || 0),
      [6, 4, 0],
    );
  }
});
test("two July acquisitions count as one Landsat product, and an exact selection keeps its scene", () => {
  const b: CandidateSet = {
    ids: [inventoryId],
    title: "长江口",
    caseId: null,
    filters: {
      ...emptyFilters(),
      ...windowFilters([Date.UTC(1998, 6), Date.UTC(1998, 7)]),
    },
    selection: null,
    layer: "all",
    gridSystem: "h3",
    camera: { zoom: 2, center: [121, 31], reason: "测试" },
  };
  const rows = checkedScenes(b);
  assert.equal(rows.length, 2);
  assert.equal(products(rows.map((r) => r.asset)).size, 1);
  assert.equal(checkedScenes({ ...b, sceneKey: rows[0].id }).length, 1);
});

test("latitude-band products remain available without painting remote ocean cells", () => {
  const band = assetById.get("haina:1832681")!;
  const grid = gridSpec("h3", 2);
  const id = cellAt([-150, 10], grid);
  const cell = cellShape(id, grid);
  const regions: RegionRecord[] = [{asset:band, area:band.profile!.area!}];
  assert.equal(addCoverage(new Map(), [cell], regions, false).has(id), false);
});
