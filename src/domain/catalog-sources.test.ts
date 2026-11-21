import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { cases } from "./catalog";
import { assets, assetById } from "./datasets";
import { candidates } from "./results";
import { emptyFilters } from "./spatial";
import september from "../data/evidence/september-sea-ice-pdo.json";

test("every benchmark need has a traceable, selectable candidate", () => {
  const benchmarks = cases.filter((c) => /^Q\d{2}$/.test(c.id));
  assert.equal(benchmarks.length, 20);
  for (const study of benchmarks) {
    const items = candidates(study.id, emptyFilters(), "all", null);
    for (const [index, need] of study.needs.entries()) {
      assert(
        items.some((a) => a.needIndex === index),
        study.id + ": " + need.name,
      );
      if (!need.profile) continue;
      assert.match(need.url!, /^https:\/\//);
      assert(
        need.profile.access && need.profile.coverage && need.profile.limitation,
      );
      for (const tab of need.tabs.filter((t) => t.kind === "pdf")) {
        for (const page of tab.pages!) {
          assert(
            existsSync(
              new URL("../../public/evidence/" + page.image, import.meta.url),
            ),
          );
        }
      }
    }
  }
});

test("models, application routes and derived quantities are catalog clues", () => {
  for (const asset of assets.filter((a) => a.profile)) {
    const profile = asset.profile!;
    const isClue = ["request", "method", "derived"].includes(profile.role);
    assert.equal(asset.kind, isClue ? "clue" : "dataset", asset.title);
    if (profile.role === "request") assert.equal(profile.spatial, "restricted");
  }
  assert.equal(assetById.get("Q06-4")!.profile!.role, "method");
  assert.equal(assetById.get("Q10-2")!.profile!.role, "method");
  assert.equal(assetById.get("Q15-3")!.profile!.role, "request");
  assert.deepEqual(assetById.get("Q15-2")!.profile!.years, [2021, 2021]);
  assert.deepEqual(assetById.get("Q09-0")!.profile!.years, [1991, 2014]);
});

test("selected observations retain their date, variables and units", () => {
  const ice = assetById.get("Q08-0")!;
  const pdo = assetById.get("Q08-1")!;
  assert.equal(september.length, 47);
  assert.deepEqual(
    september.map((r) => r[0]),
    Array.from({ length: 47 }, (_, i) => 1979 + i + "-09"),
  );
  assert.equal(september[0][1], 7.05);
  assert.equal(september.at(-1)![1], 4.75);
  assert(
    september.every((r) => typeof r[2] === "number" && Math.abs(r[2]) < 10),
  );
  assert.equal(pdo.profile!.spatial, "nonspatial");
  assert.deepEqual(
    ice.tabs[0].rows,
    september.map((r) => [r[0], r[1]]),
  );
  assert.deepEqual(
    pdo.tabs[0].rows,
    september.map((r) => [r[0], r[2]]),
  );
});
