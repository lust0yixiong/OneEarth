import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import express from "express";
import { coverageIndex } from "./coverage-index";
import { coveragePublication, projectedCoverageRecords } from "./coverage-publication";
import { coverageRouter } from "./coverage-router";
import { assetById, assets } from "../src/domain/datasets";
import type { PaperMapEntry } from "./paper-projection-contract";
import { validPaperRecord } from "../src/domain/paper-record";
import { cellAt, cellShape, emptyFilters, gridSpec } from "../src/domain/spatial";
import type { Coordinate } from "../src/domain/types";

const grid = gridSpec("h3", 7);
const publicCell = "871f8aa03ffffff";
const point = cellShape(publicCell, grid).center as Coordinate;
const selection = { id: publicCell, grid, point };
const time = { period: [2003, 2003] as [number, number] };
const filters = { ...emptyFilters(), ...time, source: "paper", type: "coverage-test-selected" };
function record(name: string, kind: string, location: Coordinate, polygon = false): PaperMapEntry {
  const dsKey = "coverage-test:" + name;
  const id = "earthnano:" + createHash("sha256").update(JSON.stringify([dsKey, kind, location])).digest("hex");
  const [x, y] = location;
  const w = x - 0.025, s = y - 0.025, e = x + 0.025, n = y + 0.025;
  return {
    dsKey, id, title:name, type:kind, source:"文献资料", published:true, points:polygon ? [] : [location],
    profile:{
      role:"data", spatial:"coverage", years:time.period, coverage:"fixture",
      ...(polygon ? {areaBasis:"geometry",area:{type:"Polygon",coordinates:[[[w,s],[w,n],[e,n],[e,s],[w,s]]]}} : {}),
    },
  };
}

test("coverage publishes committed inputs, binds the exact scope, and never reuses an expired handle", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "coverage-publication-"));
  const index = coverageIndex(path.join(directory, "coverage.sqlite"));
  let indexClosed = false;
  const anchor = record("anchor", filters.type, point);
  const moving = record("moving", filters.type, point, true);
  const otherType = record("other-type", "coverage-test-other", point);
  const moved = record("moving", filters.type, [140,36], true);
  const historical = record("unpublished", filters.type, point);
  const [localProjection] = projectedCoverageRecords([anchor]);
  assert.deepEqual(localProjection.need.tabs, []);
  assert.equal(validPaperRecord(localProjection), false);
  const publication = coveragePublication();
  function apply(generation: string, entries: PaperMapEntry[], publishedCount: number, versionCount: number, baseGeneration?: string) {
    publication.activate({generation, revision:generation, entries, publishedCount, versionCount, baseGeneration});
  }
  const app = express();
  app.use(express.json());
  app.use("/api/coverage", coverageRouter(index, publication));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = "http://127.0.0.1:" + address.port;
  async function request(route: string, body?: unknown) {
    const response = await fetch(origin + "/api/coverage/" + route, body === undefined
      ? { signal: AbortSignal.timeout(5000) }
      : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(5000) });
    assert.equal(response.headers.get("cache-control"), "no-store");
    return { status: response.status, body: await response.json() };
  }
  async function scope(overrides: Record<string, unknown> = {}) {
    const result = await request("scopes", { filters, selection, ...overrides });
    assert.equal(result.status, 200);
    return result.body;
  }
  const read = (s: {id: string; revision: string}) => request("cells",
    { id: s.id, revision: s.revision, grid, cells: [publicCell], includeProducts: true, includeReferences: true, requireSelection: true });
  async function ready(s: {id: string; revision: string; scope: unknown}) {
    for (let i = 0; i < 50; i++) {
      const result = await read(s);
      assert.equal(result.status, 200);
      assert.equal(result.body.revision, s.revision);
      assert.deepEqual(result.body.scope, s.scope);
      if (result.body.ready.includes(publicCell)) return result.body;
      assert.ok(result.body.pending > 0);
      assert.deepEqual(result.body.cells, []);
      assert.deepEqual(result.body.members, []);
      assert.deepEqual(result.body.references, []);
      await delay(10);
    }
    throw new Error("Coverage didn't finish");
  }
  try {
    const coldStart = await request("scopes", {filters, selection});
    assert.equal(coldStart.status,503);
    assert.equal(coldStart.body.code,"coverage_unavailable");
    apply("g1",[anchor,moving,otherType],3,3);
    const original = await scope();
    const batch = { ids: [moving.id, otherType.id], layer: "all", selection, caseId: null };
    const frozen = await scope({batch});
    assert.deepEqual(frozen.scope, {
      filters: { ...filters, utcWindow: null }, selection, caseId: null, layer: "all", metric: "products",
      candidateCount: 2, candidateIdentity: frozen.scope.candidateIdentity,
    });
    assert.match(frozen.scope.candidateIdentity, /^[0-9a-f]{64}$/);
    // Read before warming the fine grid. A pending grid must not look like a verified zero.
    const cold = await read(frozen);
    assert.equal(cold.status, 200);
    assert.equal(cold.body.revision, frozen.revision);
    assert.deepEqual(cold.body.scope, frozen.scope);
    assert.equal(cold.body.pending, 1);
    assert.deepEqual(cold.body.ready, []);
    assert.deepEqual(cold.body.cells, []);
    assert.deepEqual(cold.body.members, []);
    assert.deepEqual(cold.body.references, []);
    const initial = await ready(original);
    assert.deepEqual(initial.cells, [[publicCell, 2]]);
    assert.deepEqual(initial.members, [[publicCell, [anchor.dsKey, moving.dsKey]]]);
    assert.deepEqual(initial.references, [[publicCell, [[anchor.dsKey, [anchor.id]], [moving.dsKey, [moving.id]]]]]);
    assert.deepEqual(initial.sourceIds, [[publicCell, [anchor.id, moving.id]]]);
    assert.deepEqual(original.scope.filters, { ...filters, utcWindow: null });
    assert.equal(original.scope.candidateCount, null);
    assert.equal(original.scope.candidateIdentity, null);

    const reordered = Object.fromEntries(Object.entries(filters).reverse());
    assert.equal((await scope({ filters: reordered })).id, original.id);
    const publicOnly = await ready(await scope({ filters: { ...emptyFilters(), ...time, source: "public" } }));
    assert.ok(publicOnly.members[0][1].includes("rgi:glacier-inventory"));
    assert.ok(!publicOnly.members[0][1].includes(anchor.dsKey));
    const allPaperTypes = await ready(await scope({ filters: { ...filters, type: "" } }));
    assert.deepEqual(allPaperTypes.members, [[publicCell, [anchor.dsKey, moving.dsKey, otherType.dsKey]]]);

    const equivalent = await scope({ batch: { ...batch, ids: [otherType.id, moving.id, moving.id], title: "different label" } });
    assert.equal(equivalent.id, frozen.id);
    assert.equal(equivalent.scope.candidateIdentity, frozen.scope.candidateIdentity);
    const second = await scope({ batch: { ...batch, ids: [anchor.id, otherType.id] } });
    assert.equal(second.scope.candidateCount, frozen.scope.candidateCount);
    assert.notEqual(second.scope.candidateIdentity, frozen.scope.candidateIdentity);
    const frozenRead = await ready(frozen);
    const secondRead = await ready(second);
    assert.deepEqual(frozenRead.cells, [[publicCell, 1]]);
    assert.deepEqual(secondRead.cells, [[publicCell, 1]]);
    assert.deepEqual(frozenRead.members, [[publicCell, [moving.dsKey]]]);
    assert.deepEqual(secondRead.members, [[publicCell, [anchor.dsKey]]]);
    const empty = await scope({ batch: { ...batch, ids: [] } });
    assert.equal(empty.scope.candidateCount, 0);
    assert.match(empty.scope.candidateIdentity, /^[0-9a-f]{64}$/);

    const legacyScope = await scope({selection:null});
    const legacy = await request("cells", { id: legacyScope.id, grid, cells: [publicCell], includeProducts: true });
    assert.equal(legacy.status, 200);
    assert.deepEqual(legacy.body, {
      revision: legacyScope.revision, cells: [[publicCell, 2]], ready: [publicCell], pending: 0,
      members: [[publicCell, [anchor.dsKey, moving.dsKey]]],
    });
    const differentCell = cellAt([140,36], grid);
    const legacyBatch = await request("cells", { id: legacyScope.id, grid, cells: [publicCell, differentCell], requireSelection: false });
    assert.equal(legacyBatch.status, 200);
    assert.deepEqual(legacyBatch.body, {
      revision: legacyScope.revision, cells: [[publicCell, 2]], ready: [publicCell, differentCell], pending: 0,
    });
    const outOfScope = await request("cells", {id: frozen.id, revision: frozen.revision, grid, cells: [differentCell]});
    assert.equal(outOfScope.status, 400);
    const unbound = await read(legacyScope);
    assert.equal(unbound.status, 400);
    assert.equal(unbound.body.code, "coverage_selection_required");
    assert.equal((await scope({ filters: { ...filters, period: [1900,1900] } })).scope.filters.period[0], 1900);
    const zero = await ready(await scope({ filters: { ...filters, period: [1900,1900] } }));
    assert.deepEqual(zero.ready,[publicCell]);
    assert.deepEqual(zero.cells,[]);
    assert.deepEqual(zero.members,[[publicCell,[]]]);

    for (let i = 0; i < 10; i++) await ready(original);
    apply("g2",[{...historical,published:false}],3,4,"g1");
    assert.equal((await request("revision")).body.revision, original.revision);
    apply("g3",[{...moving,published:false},moved],3,5,"g2");
    assert.deepEqual(assets.filter(asset=>asset.datasetId===moving.dsKey).map(asset=>asset.id),[moved.id]);
    const expired = await read(original);
    assert.equal(expired.status, 410);
    assert.equal(expired.body.code, "coverage_scope_expired");
    assert.equal("scope" in expired.body, false);
    assert.equal((await read(frozen)).status, 410);
    assert.notEqual(expired.body.revision, original.revision);
    const wrongRevision = await request("scopes", { filters, selection, revision: original.revision });
    assert.equal(wrongRevision.status, 409);
    assert.equal(wrongRevision.body.code, "coverage_revision_changed");
    const next = await scope();
    assert.notEqual(next.id, original.id);
    assert.deepEqual((await ready(next)).members, [[publicCell, [anchor.dsKey]]]);
    const saved = await scope({batch:{...batch,ids:[moving.id]}});
    assert.deepEqual((await ready(saved)).sourceIds,[[publicCell,[moving.id]]]);
    assert.deepEqual(assets.filter(asset=>asset.datasetId===moving.dsKey).map(asset=>asset.id),[moved.id]);
    const reopened = coveragePublication();
    reopened.activate({generation:"g3",revision:"g3",publishedCount:3,versionCount:5,
      entries:[moved,anchor,otherType,{...moving,published:false},{...historical,published:false}]});
    assert.equal(reopened.revision(), next.revision, "revision must be independent of in-process registration order");

    apply("g4",[{...moved,published:false}],2,5,"g3");
    assert.notEqual((await request("revision")).body.revision, next.revision);
    assert.ok(!assets.some(asset => asset.id === moved.id));
    assert.ok(assetById.has(moving.id), "historical cited records remain addressable");
    const beforeUnavailable = await scope();
    await index.close();
    indexClosed = true;
    const unavailable = await read(beforeUnavailable);
    assert.equal(unavailable.status, 503);
    assert.equal(unavailable.body.code, "coverage_unavailable");
    assert.equal("scope" in unavailable.body, false);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    if (!indexClosed) await index.close();
    await rm(directory, { recursive: true, force: true });
  }
});
