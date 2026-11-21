import test from "node:test";
import assert from "node:assert/strict";
import {
  findOpticalData,
  inventoryId,
  sample,
  sampleCamera,
  pointFromQuery,
  type SceneLookup,
} from "./earth-search";
import { assetById } from "./datasets";
import {
  createResearchList,
  parseResearchList,
  listMarkdown,
} from "./research-list";
import { catalogGrid, makeMappedCandidates, includesArea } from "./results";
import { emptyFilters, gridSpec, cellAt } from "./spatial";
import type { CandidateSet } from "./types";

test("STAC search distinguishes collection dates, a bounded inventory and a new place", () => {
  const local = findOpticalData(
    "1998 年长江口有哪些光学卫星影像？",
  )!.catalogMatch!;
  assert.deepEqual(local.ids, [inventoryId]);
  assert.equal(local.rejected[0].title, "Sentinel-2 Level-2A");
  assert.deepEqual(
    findOpticalData("1998 年西雅图有哪些光学卫星影像？")!.catalogMatch!.ids,
    ["earth-search:landsat-c2-l2"],
  );
  assert.equal(
    new Set(sample.items.map((i) => i.id)).size,
    sample.items.length,
  );
  assert.ok(
    includesArea("earth-search", emptyFilters(), "all", sampleCamera.center),
  );
  assert.equal(
    includesArea("earth-search", emptyFilters(), "all", [-122.33, 47.61]),
    false,
  );
  assert.deepEqual(pointFromQuery("坐标（-122.33, 47.61）"), [-122.33, 47.61]);
  assert.equal(pointFromQuery("坐标（190, 47.61）"), undefined);
  assert.equal(
    findOpticalData("找1998年坐标（190, 47.61）的光学影像")?.catalogMatch,
    undefined,
  );
});
test("a live item snapshot survives handoff, contributes one dataset in its evidence cell, and rejects invalid imports", () => {
  const id = "earth-search:landsat-c2-l2",
    item = sample.items[0];
  const lookup: SceneLookup = {
    assetId: id,
    point: sampleCamera.center,
    years: [1998, 1998],
    matched: 1,
    url: sample.url,
    checkedAt: new Date().toISOString(),
    items: [item],
  };
  const b: CandidateSet = {
    ids: [id],
    lookups: [lookup],
    caseId: null,
    title: "核对原始影像",
    filters: emptyFilters(),
    selection: null,
    layer: "all",
    camera: sampleCamera,
    gridSystem: "h3",
  };
  for (const system of ["h3", "s2"] as const) {
    const grid = gridSpec(system, 4),
      cell = cellAt(lookup.point, grid);
    assert.equal(catalogGrid(grid, b.filters, b).get(cell)?.size, 1);
    assert.deepEqual(
      makeMappedCandidates(b, {
        ...b,
        selection: { grid, point: lookup.point, id: cell },
      }).ids,
      [id],
    );
    const outside: [number, number] = [-122.33, 47.61];
    assert.deepEqual(
      makeMappedCandidates(b, {
        ...b,
        selection: { grid, point: outside, id: cellAt(outside, grid) },
      }).ids,
      [],
    );
  }
  assert.ok(assetById.has(id));
  const list = createResearchList(b);
  assert.deepEqual(parseResearchList(JSON.stringify(list)), list);
  assert.ok(listMarkdown(list).includes(item.url));
  const invalid = structuredClone(list);
  invalid.batch.lookups![0].items[0].url = "javascript:alert(1)";
  assert.throws(() => parseResearchList(JSON.stringify(invalid)));
});
