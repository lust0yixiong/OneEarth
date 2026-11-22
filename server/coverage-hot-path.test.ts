import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import express from "express";
import { coverageIndex } from "./coverage-index";
import { coveragePublication } from "./coverage-publication";
import { coverageRouter } from "./coverage-router";
import type { PaperMapEntry } from "./paper-projection-contract";
import { catalogGroups, resources } from "../src/domain/catalog";
import { assetById, assets } from "../src/domain/datasets";
import { paperId } from "../src/domain/paper-record";
import { cellShape, emptyFilters, gridSpec } from "../src/domain/spatial";
import type { Coordinate } from "../src/domain/types";

function watchPaperRows<T extends {id: string}>(rows: T[]) {
  const restore: (() => void)[] = [];
  let reads = 0;
  rows.forEach((row, i) => {
    if (!paperId(row.id)) return;
    const original = Object.getOwnPropertyDescriptor(rows, i)!;
    Object.defineProperty(rows, i, {
      configurable: true, enumerable: true,
      get() { reads++; return row; },
    });
    restore.push(() => Object.defineProperty(rows, i, original));
  });
  return { read: () => reads, restore: () => restore.forEach(reset => reset()) };
}

test("normal HTTP coverage visits only the paper IDs returned by the spatial query", async t => {
  const grid = gridSpec("h3", 7);
  const id = "871f8aa03ffffff";
  const point = cellShape(id, grid).center as Coordinate;
  const selection = { id, grid, point };
  const emptyCell = "871f8aa08ffffff";
  const emptySelection = { id: emptyCell, grid, point: cellShape(emptyCell, grid).center as Coordinate };
  const filters = { ...emptyFilters(), period: [2003, 2003] };
  function paper(name: string, points: Coordinate[], published = true): PaperMapEntry {
    return {
      id: "earthnano:" + createHash("sha256").update(name).digest("hex"), dsKey: name,
      title: name, type: "fixture", source: "文献资料", points, published,
      profile: { role: "data", spatial: "coverage", coverage: "fixture", years: [2003, 2003] },
    };
  }
  const chosen = paper("coverage-hot-fixture-chosen", [point]);
  const exactPast = { ...paper("coverage-hot-fixture-archived", [point], false), dsKey: chosen.dsKey };
  const entries = [chosen, exactPast, ...Array.from({length:512}, (_, i) => paper("coverage-hot-fixture-"+i, [[60, 10]]))];
  const publication = coveragePublication();
  publication.activate({ generation: "candidate-fixture", revision: "candidate-fixture",
    publishedCount: entries.length - 1, versionCount: entries.length, entries });
  const directory = await mkdtemp(path.join(tmpdir(),"oneearth-coverage-hot-"));
  const index = coverageIndex(path.join(directory,"coverage.sqlite"));
  const app = express();
  app.use(express.json());
  app.use("/api/coverage", coverageRouter(index, {
    ...publication,
    async paperCandidates(_generation, _filters, batch, _grid, cells) {
      // The router sees the same list it would get after local SQL filtering.
      if (batch) return [exactPast.id];
      return cells.includes(id) ? [chosen.id] : [];
    },
  }));
  const server = app.listen(0,"127.0.0.1");
  await once(server,"listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = "http://127.0.0.1:"+address.port+"/api/coverage/";
  const assetRows = watchPaperRows(assets);
  const groupRows = watchPaperRows(catalogGroups);
  const resourceRows = watchPaperRows(resources);
  const getAsset = assetById.get;
  const lookedUp: string[] = [];
  assetById.get = function (key) {
    if (paperId(key)) lookedUp.push(key);
    return getAsset.call(this,key);
  };
  async function post(route: string, input: unknown) {
    const response = await fetch(base+route,{
      method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(input),
      signal:AbortSignal.timeout(5000),
    });
    const value = await response.json();
    assert.equal(response.status,200,JSON.stringify(value));
    return value;
  }
  async function read(selected: typeof selection, ids?: string[]) {
    const scope = await post("scopes",{filters, selection:selected,
      ...(ids ? {batch:{ids,caseId:null,layer:"all",selection:selected}} : {})});
    const result = await post("cells",{id:scope.id,revision:scope.revision,grid,cells:[selected.id],
      includeProducts:true,includeReferences:true,requireSelection:true});
    assert.deepEqual(result.ready,[selected.id]);
    return { products:result.members[0][1], records:result.references[0][1] };
  }
  function measure() {
    return { assetRows:assetRows.read(), groupRows:groupRows.read(), resourceRows:resourceRows.read(),
      paperIdLookups:lookedUp.splice(0) };
  }
  try {
    const one = await read(selection);
    assert.deepEqual(one.products,[chosen.dsKey,"rgi:glacier-inventory"]);
    assert.deepEqual(one.records.find(([key]: [string])=>key===chosen.dsKey),[chosen.dsKey,[chosen.id]]);
    const oneReads = measure();
    assert.deepEqual(oneReads,{assetRows:0, groupRows:0, resourceRows:0, paperIdLookups:Array(3).fill(chosen.id)});
    const zero = await read(emptySelection);
    assert.deepEqual(zero.products,["rgi:glacier-inventory"]);
    const zeroReads = measure();
    assert.deepEqual(zeroReads,{assetRows:0, groupRows:0, resourceRows:0, paperIdLookups:[]});
    t.diagnostic(JSON.stringify({publishedPaperRecords:entries.length-1,oneCandidate:oneReads,zeroCandidates:zeroReads}));

    // An explicitly selected old record remains selectable without promoting it to the live catalogue.
    assetById.get = getAsset;
    assetRows.restore(); groupRows.restore(); resourceRows.restore();
    const old = await read(selection,[exactPast.id]);
    assert.deepEqual(old.products,[chosen.dsKey]);
    assert.deepEqual(old.records,[[chosen.dsKey,[exactPast.id]]]);
  } finally {
    assetById.get = getAsset;
    assetRows.restore(); groupRows.restore(); resourceRows.restore();
    await new Promise<void>((resolve,reject) => server.close(error=>error?reject(error):resolve()));
    await index.close();
    await rm(directory,{recursive:true,force:true});
  }
});
