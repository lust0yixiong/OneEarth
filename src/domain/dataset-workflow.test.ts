import {productKey} from "./product-distribution";
import test from "node:test";
import assert from "node:assert/strict";
import { assets, assetIdentity, distinctAssets } from "./datasets";
import {
  candidates,
  includesArea,
  catalogGrid,
  makeCandidates,
  makeMappedCandidates,
  catalogEvidenceGrid,
} from "./results";
import { emptyFilters, spatialEntries, gridSpec, cellAt } from "./spatial";
import { evidenceFor } from "./evidence";
import { discover } from "./discovery";
const filters = { ...emptyFilters(), place: "阿尔卑斯窗口" };
test("Alpine window uses identical coordinates in the globe, candidate list and evidence", () => {
  const entries = spatialEntries("glacier", filters, "all");
  assert(entries.some((e) => /ALETSCH/i.test(e.label)));
  const doc = evidenceFor("glacier", 0, filters);
  assert.equal(
    doc.tabs[0].rows!.length,
    entries.filter((e) => e.need === 0).length,
  );
  assert.deepEqual(
    candidates("glacier", filters, "all", null).map((a) => a.id),
    ["glacier-0", "glacier-1"],
  );
  const apcc = evidenceFor("glacier", 2, filters);
  assert.equal(apcc.tabs[0].rows!.length, 0);
  assert.equal(
    apcc.fullSource!.tabs.find((t) => t.kind === "table")!.rows!.length,
    9,
  );
  assert(!includesArea("Q07", emptyFilters(), "all", [105, 25]));
  assert(includesArea("Q07", emptyFilters(), "all", [70, 35]));
});
test("catalog cells deduplicate dataset identities and keep global coverage separate", () => {
  assert.equal(
    distinctAssets(assets.filter((a) => a.datasetId === "nasa:MOD13Q1.061"))
      .length,
    1,
  );
  const assetIds = assets
    .filter((a) => a.caseId === "Q19" && a.needIndex === 2)
    .map((a) => a.datasetId);
  assert.equal(new Set(assetIds).size, 3);
  for (const system of ["h3", "s2"] as const) {
    const grid = gridSpec(system, 2);
    const point: [number, number] = [10.75, 46.8];
    const sel = { id: cellAt(point, grid), grid, point };
    const ids = catalogGrid(grid, emptyFilters()).get(sel.id)!;
    const found = candidates(null, emptyFilters(), "all", sel);
    assert(ids.size > 0);
    assert(!ids.has(assetIdentity(assets.find((a) => a.caseId === "wind")!)));
    assert(found.some((a) => a.datasetId === "gfs-wind"));
    for (const id of ids) assert(found.some((a) => productKey(a) === id));
    const result = makeCandidates({
      title: "所选网格",
      gridSystem: system,
      caseId: null,
      camera: { center: point, zoom: 2, reason: "所选网格" },
      filters: emptyFilters(),
      selection: sel,
      layer: "all",
    });
    assert.deepEqual(
      [...catalogGrid(grid, emptyFilters(), result).keys()],
      [sel.id],
    );
  }
});

test("candidate scope excludes simulated counts and incompatible resolution and layers", () => {
  const grid = gridSpec("h3", 2);
  const point: [number, number] = [105, 25];
  const selected = { id: cellAt(point, grid), point, grid, simulated: true };
  assert.deepEqual(candidates(null, emptyFilters(), "all", selected), []);
  assert(
    !candidates("Q02", { ...emptyFilters(), maxDem: 10 }, "all", null).some(
      (a) => a.needIndex === 0,
    ),
  );
  assert.deepEqual(candidates("Q08", emptyFilters(), "paired", null), []);
  assert.deepEqual(candidates("Q15", emptyFilters(), "verified", null), []);
});

test("a paired cell returns both the DEM and the containing boundary, only at verified pixel centres", () => {
  const point: [number, number] = [10.751666666666667, 46.80222222222223];
  for (const system of ["h3", "s2"] as const) {
    const grid = gridSpec(system, 7);
    const selection = { grid, id: cellAt(point, grid), point };
    const paired = candidates("Q02", filters, "paired", selection);
    assert.deepEqual(
      paired.map((a) => a.id),
      ["Q02-0", "Q02-2"],
    );
    const outlines = evidenceFor(
      "Q02",
      2,
      filters,
      undefined,
      "Q02-2",
      selection,
    );
    assert(
      outlines.tabs.some((t) =>
        t.rows?.some((row) => row.includes("RGI60-11.00897")),
      ),
    );
    const scope = {
      caseId: "Q02",
      ids: paired.map((a) => a.id),
      filters,
      selection: null,
      layer: "paired" as const,
      title: "",
      camera: { center: point, zoom: 1, reason: "" },
      gridSystem: system,
    };
    assert.deepEqual(
      [...catalogGrid(grid, filters, scope).keys()],
      [selection.id],
    );
    assert.deepEqual(
      candidates("Q02", { ...filters, maxDem: 10 }, "paired", selection),
      [],
    );
  }
});

test("a frozen selection never paints or exports another cell when zoom or grid system changes", () => {
  const alaska: [number, number] = [-146.88777777777776, 61.29888888888889];
  const alps: [number, number] = [10.751666666666667, 46.80222222222223];
  for (const gridSystem of ["h3", "s2"] as const) {
    const original = gridSpec(gridSystem, 5);
    const selection = {
      id: cellAt(alaska, original),
      grid: original,
      point: alaska,
    };
    const batch = makeCandidates({
      title: "Columbia",
      filters: emptyFilters(),
      selection,
      caseId: "Q02",
      gridSystem,
      camera: { center: alaska, zoom: 20, reason: "原始样本" },
      layer: "all",
    });
    assert.deepEqual(batch.ids, ["Q02-0", "Q02-2"]);
    for (const display of [gridSpec("h3", 7), gridSpec("s2", 2)]) {
      const evidenceGrid = catalogEvidenceGrid(display, batch);
      assert.deepEqual(
        [...catalogGrid(evidenceGrid, batch.filters, batch).keys()],
        [selection.id],
      );
      assert.equal(catalogGrid(display, batch.filters, batch).size, 0);
      const pick = (point: [number, number]) =>
        makeMappedCandidates(batch, {
          ...batch,
          gridSystem: display.system,
          selection: { id: cellAt(point, display), grid: display, point },
        });
      assert.deepEqual(pick(alps).ids, []);
      assert.deepEqual(pick(alaska).ids, batch.ids);
      assert.deepEqual(pick(alaska).selection, selection);
      assert.equal(pick(alaska).gridSystem, original.system);
    }
  }
});

test("station report dates and available GFS frames survive matching year filters", () => {
  for (const [id, year] of [
    ["dongting", 2022],
    ["manaus", 2024],
    ["wind", 2026],
  ] as const) {
    const f = { ...emptyFilters(), period: [year, year] as [number, number] };
    assert.equal(candidates(id, f, "all", null).length, 1);
    assert.equal(
      candidates(id, { ...f, period: [1900, 1900] }, "all", null).length,
      0,
    );
  }
  const table = evidenceFor("manaus", 0, {
    ...emptyFilters(),
    period: [2024, 2024],
  }).tabs.find((t) => t.kind === "table");
  assert.equal(table?.rows?.length, 1);
  assert.match(String(table?.rows?.[0][0]), /2024/);
});
