import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import { observationIntent } from "./observation-intent";
import { discoverObservations, parseObservationQuery } from "../../server/observation-query";
import { constellationService } from "../../server/constellations";
import { pushId, footprintInCell, type Observation } from "./push-observations";
import { assetById, registerObservations } from "./datasets";
import { emptyFilters, gridSpec, cellAt } from "./spatial";
import { includesArea, makeMappedCandidates } from "./results";
import { createResearchList, parseResearchList } from "./research-list";
import type { CandidateSet, DiscoveryContext } from "./types";

test("partner pushes survive replay, revisions and restart, with exact source files and footprints", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "oneearth-push-")),
    filename = path.join(directory, "obs.sqlite");
  const sources = {
    lab: {
      name: "隔离联调",
      token: "abcdefghijk1234567890123456789",
      test: false,
    },
  };
  const service = constellationService(filename, sources);
  const app = express();
  app.use("/api/constellations", service.router);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  try {
    const addr = server.address();
    assert.ok(addr && typeof addr !== "string");
    const root = "http://127.0.0.1:" + addr.port + "/api/constellations";
    const packet = {
      schemaVersion: 1,
      collection: "ocean-color",
      id: "S101",
      revision: 1,
      title: "联调色素观测",
      satellite: "TEST-01",
      observedAt: "2025-01-03T10:00:00Z",
      publishedAt: "2025-01-03T10:12:00Z",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [121, 31],
            [122, 31],
            [122, 32],
            [121, 32],
            [121, 31],
          ],
        ],
      },
      measurements: [{ variable: "chlorophyll", value: 1.2, unit: "mg/m³" }],
      file: {
        name: "test.csv",
        base64: Buffer.from("value,unit\n1.2,mg/m3\n").toString("base64"),
      },
    };
    const push = (p: object, token = sources.lab.token) =>
      fetch(root + "/lab/observations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify(p),
      });
    assert.equal((await push(packet, "wrong")).status, 401);
    assert.equal(
      (
        await push({
          ...packet,
          geometry: { type: "Point", coordinates: [1, 91] },
        })
      ).status,
      400,
    );
    const replies = await Promise.all([push(packet), push(packet)]);
    assert.deepEqual(replies.map((r) => r.status).sort(), [200, 201]);
    const key = (await replies[0].json()).key;
    assert.equal((await push({ ...packet, title: "changed" })).status, 409);
    assert.equal((await push({ ...packet, revision: 3 })).status, 201);
    assert.equal((await push({ ...packet, revision: 2 })).status, 201);
    assert.equal(
      (
        await push({
          ...packet,
          id: "older",
          observedAt: "2024-01-01T01:00:00Z",
        })
      ).status,
      201,
    );
    const feed = service.latest().records;
    assert.deepEqual(
      feed.map((r) => [r.id, r.revision]),
      [
        ["S101", 3],
        ["older", 1],
      ],
    );
    assert.equal(service.latest([121.5, 31.5]).records.length, 2);
    assert.equal(service.latest([-75, 3]).records.length, 0);
    const record: Observation = await (
      await fetch(root + "/observations/" + key)
    ).json();
    assert.equal(record.test, false);
    assert.equal(record.revision, 1);
    assert.ok(record.receivedAt > record.publishedAt!);
    assert.equal(
      await (await fetch(root + "/observations/" + key + "/file")).text(),
      Buffer.from(packet.file.base64, "base64").toString(),
    );
    registerObservations([record], true);
    const id = pushId(record),
      filters = emptyFilters();
    const b: CandidateSet = {
      ids: [id],
      caseId: null,
      title: "直推观测",
      filters,
      selection: null,
      layer: "all",
      camera: { center: [121.5, 31.5], zoom: 10, reason: "footprint" },
      gridSystem: "h3",
    };
    assert.ok(includesArea(id, filters, "all", b.camera.center));
    const list = createResearchList(b);
    registerObservations(feed, true);
    assert.equal(
      parseResearchList(JSON.stringify(list)).items[0].version,
      "r1",
    );
    for (const system of ["h3", "s2"] as const) {
      const grid = gridSpec(system, 3);
      assert.deepEqual(
        makeMappedCandidates(b, {
          ...b,
          selection: {
            id: cellAt(b.camera.center, grid),
            grid,
            point: b.camera.center,
          },
        }).ids,
        [id],
      );
    }
    assert.equal(assetById.get(id)?.origins[0], "constellation");
    // The only match is older than the unrestricted feed's 50-item window.
    for (let i = 0; i < 51; i++) {
      assert.equal((await push({...packet, id:"newer-" + i, satellite:"TEST-02", publishedAt:null, observedAt:"2026-01-01T00:00:00Z"})).status, 201);
    }
    const grid = gridSpec("h3", 3);
    const selection = {grid, id:cellAt([121.5,31.5],grid), point:[121.5,31.5] as [number,number]};
    const parse = (q:string) => parseObservationQuery(q, selection, service.satellites());
    const constraints = parse("查看星座推送 TEST-01，2025年1月1日至3日，坐标（121.5,31.5），当前选区");
    assert.deepEqual(constraints.unsupported, []);
    assert.deepEqual(service.latest(constraints).records.map(r => r.id), ["S101"]);
    for (const q of ["星座推送 TEST-01 2020年", "星座推送 TEST-01 2026年", "星座推送 TEST-01 坐标（0,0）", "星座推送 TEST-01 云量低于20%", "星座推送 排除 TEST-02", "星座推送 不要TEST-01"]) {
      assert.equal(service.latest(parse(q)).records.length, 0, q);
    }
    assert.deepEqual(service.latest(parse("星座推送2024年1月")).records.map(r=>r.id), ["older"]);
    assert.deepEqual(service.latest(parse("星座推送TEST-02")).records.length, 50);
    const allKeys = service.latest().records.map(pushId);
    assert.equal(observationIntent("只看 TEST-02", true), "refine");
    assert.equal(observationIntent("只看 2020 年", true), "refine");
    assert.equal(observationIntent("重新查全部星座", true), "reset");
    assert.equal(observationIntent("查找 1998 年长江口光学卫星影像", true), null);
    assert.equal(observationIntent("只看 TEST-02", false), null);
    const firstRefinement = service.latest(parse("只看 TEST-02"), allKeys).records;
    assert.equal(firstRefinement.length,50);
    const noMatch = service.latest(parse("只看2020年"), firstRefinement.map(pushId)).records;
    assert.equal(noMatch.length,0);
    assert.equal(service.latest(parse("只看TEST-02"), noMatch.map(pushId)).records.length,0);
    assert.equal(service.latest(parse("重新查全部星座")).records.length,50);
    assert.ok(parse("只看 TEST-01 或 2020 年的星座观测").unsupported.length);
    assert.equal(service.latest(parse("只看 TEST-01 或 2020 年的星座观测"), allKeys).records.length,0);
    assert.deepEqual(service.latest(parse("只看 TEST-01"), [pushId(record)]).records.map(r => r.revision), [1]);
    const context: DiscoveryContext = {caseId:null, filters:emptyFilters(), gridSystem:"h3", layer:"all",
      selection, camera:b.camera, citation:null};
    const questions: [string, number, boolean][] = [
      ["查看星座最新推送的观测",50,false],
      ["只看 TEST-02",50,true],
      ["只看 2020 年",0,true],
      ["其中只看 TEST-01",0,true],
      ["云量低于20%的星座观测",0,false],
      ["星座观测排除 TEST-02",0,false],
      ["只看 TEST-01 或 2020 年的星座观测",0,false],
      ["只看2025年1月2日到3日 TEST-01 星座观测",1,false],
      ["在这批星座观测中，只看 2024 年",0,true],
      ["重新查全部星座",50,false],
    ];
    for (const [q,count,withinBatch] of questions) {
      const reply = discoverObservations(q, context, service)!;
      const match = reply.catalogMatch!;
      assert.equal(match.ids.length,count,q);
      assert.equal(reply.message.startsWith("在上一批观测中筛选。"),withinBatch,q);
      if (q.includes("1月2日到3日")) {
        assert.deepEqual(reply.pushFeed!.records.map(r => r.id), ["S101"]);
        assert.ok(!match.conditions.some(c => /2020|云量|排除|未执行/.test(c)), q);
      }
      context.observationSource = true;
      context.candidateIds = match.ids;
      context.observationBatch = {catalogConditions:match.conditions, period:match.period, selection:match.selection || null};
    }
    service.close();
    const reopened = constellationService(filename, sources);
    try {
      assert.equal(reopened.latest(parseObservationQuery("星座推送 TEST-01", null, reopened.satellites())).records[0].revision, 3);
    } finally {
      reopened.close();
    }
  } finally {
    server.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("footprints intersect cells across the dateline and across edges with no contained vertex", () => {
  const box = (
    w: number,
    s: number,
    e: number,
    n: number,
  ): GeoJSON.Polygon => ({
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
  assert.ok(footprintInCell(box(-2, -0.2, 2, 0.2), box(-0.2, -2, 0.2, 2)));
  assert.ok(footprintInCell(box(179, -2, -179, 2), box(179.5, -1, -179.5, 1)));
  assert.equal(
    footprintInCell(box(179, -2, -179, 2), box(-2, -1, 2, 1)),
    false,
  );
});

test("coarse footprint membership and picking agree across H3/S2 for disconnected islands", async()=>{
  const {observationCells}=await import("./observation-grid");
  const {observationBatchCamera}=await import("./push-observations");
  const make=(west:number)=>[[[west,31],[west+.6,31],[west+.6,31.5],[west,31.5],[west,31]]];
  const scene={key:"grid-islands",geometry:{type:"MultiPolygon",coordinates:[make(121),make(-122)]}} as Observation;
  for(const system of ["h3","s2"] as const) for(const band of [2,3]){
    const grid=gridSpec(system,band);
    const cells=observationCells(scene,grid);
    assert.ok(cells.includes(cellAt([121.3,31.25],grid)));
    assert.ok(cells.includes(cellAt([-121.7,31.25],grid)));
    assert.ok(!cells.includes(cellAt([0,0],grid)));
    assert.equal(new Set(cells).size,cells.length);
  }
  assert.ok(observationBatchCamera([scene,{...scene,key:"grid-copy"}]).zoom<2);
});
