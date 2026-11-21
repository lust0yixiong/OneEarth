import test from "node:test";
import assert from "node:assert/strict";
import { emptyFilters } from "./spatial";
import {
  createDataView,
  ctdRows,
  ctdSamples,
  ctdCells,
  frontsFor,
  variableInfo,
} from "./visualization";
import { gridSpec } from "../data/evidence/research-grid.mjs";
import type { DataView } from "./types";
const gla = "NE-Greenland-1997-1998_Gla01-1";
test("CTD map values select an observed layer from the selected sampling date", () => {
  const view: Extract<DataView, { kind: "ctd" }> = {
    kind: "ctd",
    stationId: gla,
    depth: 150,
    variable: "temperature",
  };
  const samples = ctdSamples(view, emptyFilters());
  assert.equal(samples.length, 1);
  assert.equal(samples[0].date.slice(0, 10), "1998-08-12");
  assert(Math.abs(samples[0].depth - 150) <= 5);
  assert(
    ctdRows[gla].some(
      (r) => r[0] === samples[0].depth && r[1] === samples[0].value,
    ),
  );
});
test("missing salinity and out-of-range depth never borrow a nearby valid layer", () => {
  const view: Extract<DataView, { kind: "ctd" }> = {
    kind: "ctd",
    stationId: gla,
    depth: 119.7,
    variable: "salinity",
  };
  assert.equal(ctdSamples(view, emptyFilters()).length, 0);
  assert.equal(
    ctdSamples({ ...view, variable: "temperature", depth: 0 }, emptyFilters())
      .length,
    0,
  );
});
test("H3/S2 regroup the same observed station without changing its scalar value", () => {
  const view: Extract<DataView, { kind: "ctd" }> = {
    kind: "ctd",
    stationId: gla,
    depth: 150,
    variable: "temperature",
  };
  const h = [
    ...ctdCells(view, emptyFilters(), gridSpec("h3", 6)).values(),
  ].flat();
  const s = [
    ...ctdCells(view, emptyFilters(), gridSpec("s2", 6)).values(),
  ].flat();
  assert.deepEqual(h, s);
  assert(variableInfo("temperature").min < variableInfo("temperature").max);
});
test("front comparison uses only the actual first and last author geometries", () => {
  const view: Extract<DataView, { kind: "front" }> = {
    kind: "front",
    glacier: "Mendenhall",
    epoch: "compare",
  };
  const fronts = frontsFor(view, emptyFilters());
  assert.equal(fronts.length, 2);
  assert.match(fronts[0].label, /1984-04-11/);
  assert.match(fronts[1].label, /2020-09-05/);
  assert.equal(
    frontsFor(view, { ...emptyFilters(), period: [2000, 2010] }).length,
    0,
  );
  assert.equal(frontsFor({ ...view, epoch: "last" }, emptyFilters()).length, 1);
});
test("unsupported catalog assets cannot create a content rendering from metadata alone", () => {
  assert.equal(createDataView("Q02", 0, emptyFilters()), null);
});

test("native glacier-line view fits actual geometry beyond the overview zoom bands", async () => {
  const { dataCamera } = await import("./visualization");
  const camera = dataCamera({
    kind: "front",
    glacier: "Mendenhall",
    epoch: "compare",
  });
  assert(camera.zoom > 128.5 && camera.zoom <= 2200);
});
