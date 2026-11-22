import assert from "node:assert/strict";
import { test } from "node:test";
import type { PaperRecord } from "../src/domain/paper-record";
import type { PaperQueryOutput } from "./discovery-materials-contract";
import { hainaRecord } from "../src/domain/haina-record";
import { hainaCatalogueProjection, paperCatalogueProjection } from "./runtime-workbench-queries";

function paper(dsKey: string, version: string): PaperRecord {
  return {
    id: "earthnano:" + version.repeat(64), dsKey, papers: 1, paperTitle: "Published paper",
    studyContext: "", points: [],
    need: {
      name: "Dataset", type: "Dataset", status: "Published", detail: "Dataset used in the paper",
      product: "Published dataset", source: "文献资料",
      profile: { role: "data", spatial: "coverage", coverage: "world", access: "Public", limitation: "" },
      tabs: [{ kind: "table", label: "论文用法（本页）", rows: [["", "", "", "", "paper", "dataset"]] }],
    },
  };
}

function page(records: PaperRecord[], total: number, nextCursor: string | null, revision: string): PaperQueryOutput["list"] {
  return { records, total, nextCursor, cached: true, catalog: {
    revision, complete: true, source: "test publication", sourceTotal: total, filteredOut: 0, updatedAt: null,
  } };
}

test("the mixed catalogue reuses a publication and replaces it when the same dataset gains a version", async () => {
  const earlier = paper("dataset", "a");
  const later = paper("dataset", "b");
  let current = earlier;
  let revision = "published-a";
  let time = 100_000;
  const pages: number[] = [];
  const updates: PaperRecord[][] = [];
  const refresh = paperCatalogueProjection(async input => {
    pages.push(input.limit);
    return page([current], 1, null, revision);
  }, batch => updates.push(batch), () => time);
  await Promise.all([refresh(), refresh(), refresh()]);
  assert.deepEqual(pages, [1, 500]);
  await refresh();
  assert.deepEqual(pages, [1, 500]);
  time += 2_000;
  await refresh();
  assert.deepEqual(pages, [1, 500, 1]);
  current = later;
  revision = "published-b";
  time += 2_000;
  await refresh();
  assert.deepEqual(pages, [1, 500, 1, 1, 500]);
  assert.deepEqual(updates, [[earlier], [later]]);
});

test("a revision change within a scan preserves the previously published mixed catalogue", async () => {
  let time = 100_000;
  let initial = true;
  let changed = true;
  const first = paper("alpha", "a");
  const second = paper("beta", "b");
  const updates: PaperRecord[][] = [];
  const refresh = paperCatalogueProjection(async input => {
    if (initial) return page([first], 1, null, "prior");
    if (input.cursor === "") return page([first], 2, "alpha", "current");
    return page([second], 2, null, changed ? "next" : "current");
  }, batch => updates.push(batch), () => time);
  await refresh();
  initial = false;
  time += 2_000;
  await assert.rejects(refresh, /分页期间更新/);
  assert.deepEqual(updates, [[first]]);
  changed = false;
  await refresh();
  assert.deepEqual(updates, [[first], [first, second]]);
});

test("the mixed catalogue pulls a Haina publication once and rejects mixed revisions", async () => {
  const first = hainaRecord({ id: 1, name: "First dataset" });
  const second = hainaRecord({ id: 2, name: "Second dataset" });
  let time = 100_000;
  let synced = "2026-11-22T00:00:00Z";
  let differentTail = false;
  const reads: [number, number][] = [];
  const snapshots: number[][] = [];
  const refresh = hainaCatalogueProjection(async (cursor, limit) => {
    reads.push([cursor, limit]);
    return {
      synced: cursor && differentTail ? "2026-11-23T00:00:00Z" : synced,
      endpoint: "https://provider.example", areaId: "area", total: 2, complete: true,
      nextCursor: cursor ? null : first.id, records: cursor ? [second] : [first],
      warning: "", refreshing: false,
    };
  }, records => { snapshots.push(records.map(record => record.id)); }, () => time);
  await Promise.all([refresh(), refresh()]);
  await refresh();
  assert.deepEqual(reads, [[0, 1], [0, 250], [1, 250]]);
  assert.deepEqual(snapshots, [[1, 2]]);
  time += 2_000;
  await refresh();
  assert.deepEqual(reads, [[0, 1], [0, 250], [1, 250], [0, 1]]);
  time += 2_000;
  synced = "2026-11-22T12:00:00Z";
  differentTail = true;
  await assert.rejects(refresh, /分页期间更新/);
  assert.deepEqual(snapshots, [[1, 2]]);
});
