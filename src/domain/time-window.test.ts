import test from "node:test";
import assert from "node:assert/strict";
import {
  dateEvidence,
  windowFilters,
  windowLabel,
  withinWindow,
} from "./time-window";
import { findOpticalData, sample, inventoryId } from "./earth-search";
import { emptyFilters } from "./spatial";
import { assetById } from "./datasets";
import { assetMaterials } from "./evidence";
test("monthly queries agree with archived acquisition times and exclude the next month", () => {
  const answer = findOpticalData("找1998年7月长江口的光学卫星影像")!;
  const w = answer.catalogMatch!.utcWindow!;
  assert.equal(windowLabel(w), "1998-07");
  assert.ok(!withinWindow("1998-08-01T00:00:00Z", w));
  assert.ok(dateEvidence("1998-07", w));
  assert.ok(!dateEvidence("1998", w));
  const hits = sample.items.filter((i) => i.datetime.startsWith("1998-07"));
  assert.ok(answer.message.includes(hits.length + " 景"));
  const material = assetMaterials(
    assetById.get(inventoryId)!,
    { ...emptyFilters(), ...windowFilters(w) },
    null,
    null,
  );
  assert.equal(
    material.tabs.find((t) => t.kind === "table")?.rows?.length,
    hits.length,
  );
});
