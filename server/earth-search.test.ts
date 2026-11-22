import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { test } from "node:test";
import type { AddressInfo } from "node:net";
import type { DiscoveryResponse } from "../src/domain/types";
import { resolveSceneQuery } from "./earth-search";
import { sceneCatalogQueryKind, sceneCatalogResultKind, type SceneCatalogAsset } from "./discovery-materials-contract";

test("runtime sends precise STAC terms to discovery and distinguishes zero from availability", async t => {
  const assetId: SceneCatalogAsset = "earth-search:landsat-c2-l2";
  const utcWindow: [number, number] = [Date.UTC(2015, 0, 1), Date.UTC(2015, 1, 1)];
  const point: [number, number] = [110.12, 30.5];
  const years: [number, number] = [2015, 2015];
  const input = { assetIds:[assetId], point, years, utcWindow };
  const url = "https://earth-search.aws.element84.com/v1/search";
  let behavior: "found" | "empty" | "failure" | "wrong-scope" = "found";
  const received: unknown[] = [];
  const server = createServer(async (req, res) => {
    const parts = [];
    for await (const chunk of req) parts.push(chunk);
    received.push({ method:req.method, path:req.url, version:req.headers["a2a-version"], body:JSON.parse(Buffer.concat(parts).toString()) });
    const value = behavior === "failure" ? { lookups:[], failures:[{ assetId,url }] } : {
      lookups:[{ assetId, url, point:behavior==="wrong-scope" ? [0,0] : point, years, utcWindow,
        matched:behavior==="found" ? 1 : 0, checkedAt:"2026-11-22T00:00:00Z",
        items:behavior==="found" ? [{ id:"scene-1", datetime:"2015-01-15T11:00:00Z", cloud:5, url:url+"/scene-1" }] : [] }],
      failures:[],
    };
    res.writeHead(200, {"Content-Type":"application/a2a+json"});
    res.end(JSON.stringify({message:{messageId:"reply",role:"ROLE_AGENT",parts:[{data:{kind:sceneCatalogResultKind,value}}]}}));
  }).listen(0,"127.0.0.1");
  await once(server,"listening");
  const saved = process.env.ONEEARTH_DISCOVERY_URL;
  process.env.ONEEARTH_DISCOVERY_URL = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
  t.after(() => {
    if (saved === undefined) delete process.env.ONEEARTH_DISCOVERY_URL;
    else process.env.ONEEARTH_DISCOVERY_URL = saved;
    server.close();
  });
  const request = () => {
    const answer: DiscoveryResponse = { message:"待核", catalogMatch:{
      ids:[assetId], period:years, utcWindow, conditions:[], rejected:[], sampleWindow:false,
    } };
    return resolveSceneQuery("找 Landsat 光学影像，坐标 110.12, 30.5",answer,new AbortController().signal);
  };
  const found = await request();
  assert.equal(found.catalogMatch?.lookups?.[0].items[0].id,"scene-1");
  assert.match(found.message,/命中 1 景/);
  behavior = "empty";
  const empty = await request();
  assert.match(empty.message,/命中 0 景/);
  assert.equal(empty.catalogMatch?.lookups?.[0].matched,0);
  for (const problem of ["failure","wrong-scope"] as const) {
    behavior = problem;
    const failed = await request();
    assert.match(failed.message,/匹配数未知/);
    assert.doesNotMatch(failed.message,/命中 0 景/);
    assert.deepEqual(failed.catalogMatch?.lookups,[]);
  }
  assert.equal(received.length,4);
  for (const raw of received as {method:string;path:string;version:string;body:{message:{parts:unknown[]}}}[]) {
    assert.deepEqual([raw.method,raw.path,raw.version],["POST","/message:send","1.0"]);
    assert.deepEqual(raw.body.message.parts,[{data:{kind:sceneCatalogQueryKind,input}}]);
  }
});
