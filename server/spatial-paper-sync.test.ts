import assert from "node:assert/strict";
import test from "node:test";
import { coveragePublication, synchronizeSpatialPaperPublication } from "./coverage-publication";
import type { PaperMapEntry, PaperProjectionResult } from "./paper-projection-contract";
import { fetchSpatialPaperUpdate, type ProjectionQuery } from "./spatial-paper-sync";

const longitude = 180.00000000000006;
const latitude = 90.00000000000003;
const signal = AbortSignal.timeout(5000);
const area: NonNullable<PaperMapEntry["profile"]["area"]> = {
  type: "MultiPolygon",
  bbox: [171, -latitude, longitude, latitude],
  coordinates: [[[[171, -latitude], [171, latitude], [longitude, latitude], [longitude, -latitude], [171, -latitude]]]],
};

function record(id: string, published: boolean): PaperMapEntry {
  return {
    id: "earthnano:" + id.repeat(64), dsKey: "fixture",
    title: "Antimeridian fixture", type: "fixture", source: "fixture",
    points: [[-longitude, latitude], [179.99999999999997, -latitude]],
    profile: { role: "data", spatial: "coverage", coverage: "fixture", areaBasis: "geometry", area: structuredClone(area) },
    published,
  };
}

function query(entries: PaperMapEntry[]): ProjectionQuery {
  const head = { revision: "revision-2", generation: "generation-2", versionCount: 2, publishedCount: 1 };
  return async input => {
    const reply: PaperProjectionResult = input.operation === "head" ? { ...head, operation: "head" }
      : { ...head, operation: "page", entries, nextCursor: null, baseGeneration: input.baseGeneration };
    return reply;
  };
}

test("projection bounds two-ULP spillover on each axis without changing version identities or the source payload", async () => {
  const rows = [record("1", false), record("2", true)];
  const source = structuredClone(rows);
  const snapshot = await fetchSpatialPaperUpdate(query(rows), null, signal);
  assert.ok(snapshot);
  assert.deepEqual(rows, source);
  assert.equal(snapshot.revision, "revision-2");
  assert.equal(snapshot.generation, "generation-2");
  for (const [i, row] of snapshot.entries.entries()) {
    assert.equal(row.id, source[i].id);
    assert.equal(row.published, source[i].published);
    assert.deepEqual(row.points, [[-180, 90], [179.99999999999997, -90]]);
    assert.deepEqual(row.profile.area, {
      type: "MultiPolygon", bbox: [171, -90, 180, 90],
      coordinates: [[[[171, -90], [171, 90], [180, 90], [180, -90], [171, -90]]]],
    });
  }
});

test("actually out-of-bound coordinates and a raw open ring leave the current projection in place", async () => {
  const publication = coveragePublication();
  publication.activate({
    revision: "revision-1", generation: "generation-1", versionCount: 1, publishedCount: 1,
    entries: [{ ...record("0", true), points: [], profile: { role: "data", spatial: "coverage", coverage: "fixture" } }],
  });
  const original = publication.head();
  const store = {
    async publish() { assert.fail("an invalid generation must never be persisted"); },
    async readCurrent() { assert.fail("current generation must remain active"); },
  };
  const historical = record("1", false);
  const badPoint = record("2", true);
  badPoint.points[0] = [-180.00000000000009, 90];
  const badLatitude = record("2", true);
  badLatitude.profile.area = { type: "Polygon", coordinates: [[[171, 89], [172, 89], [172, 90.00000000000004], [171, 89]]] };
  const badBounds = record("2", true);
  badBounds.profile.area!.bbox = [171, -90, 180.001, 90];
  const open = record("2", true);
  open.profile.area = { type: "Polygon", coordinates: [[[longitude, 20], [179, 21], [179, 20], [180, 20]]] };
  for (const row of [badPoint, badLatitude, badBounds, open]) {
    await assert.rejects(synchronizeSpatialPaperPublication(store, publication, query([historical, row]), signal),
      /Invalid paper coverage projection/);
    assert.deepEqual(publication.head(), original);
  }
});
