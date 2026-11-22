import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {once} from "node:events";
import test from "node:test";
import express from "express";
import {discoveryA2aRouter} from "./discovery-a2a-server";
import type {DiscoveryA2aStore} from "./discovery-a2a-store";
import {sceneCatalogAssets,sceneCatalogQueryKind,sceneCatalogResultKind,
  type SceneCatalogQuery,type SceneCatalogResult} from "./discovery-materials-contract";

const [landsat,sentinel] = sceneCatalogAssets;
const root = "https://earth-search.aws.element84.com/v1/";
const point = [-122.33,47.61] as [number,number];
const utcWindow = [Date.UTC(2021,5,1),Date.UTC(2021,6,1)] as [number,number];
const query: SceneCatalogQuery = {assetIds:[landsat,sentinel],point,years:[2020,2021],utcWindow};

test("Earth Search A2A reads only the specified STAC collections and distinguishes data, zero and failure",async t => {
  const observed: URL[] = [];
  let mode:"partial"|"invalid"|"valid" = "valid";
  const sceneFetcher: typeof fetch = async (input,init) => {
    const url = new URL(String(input)), collection = url.searchParams.get("collections");
    observed.push(url);
    assert.equal(url.origin+url.pathname,root+"search");
    assert.equal(init?.redirect,"error");
    assert.ok(init?.signal && !init.signal.aborted);
    if (collection === "sentinel-2-l2a") {
      if (mode === "partial") return new Response("",{status:502});
      return Response.json({numberMatched:0,features:[]});
    }
    assert.equal(collection,"landsat-c2-l2");
    const features = Array.from({length:5},(_,index) => ({
      collection,id:index === 0 ? "LC08 fixture/1" : "LC08_"+index,
      properties:{datetime:"2021-06-15T10:02:40Z",...(index === 0 ? {"eo:cloud_cover":12.5} : {})},
    }));
    if (mode === "invalid") return Response.json({numberMatched:6,features:features.slice(0,1)});
    return Response.json({numberMatched:6,features});
  };
  const tasks = new Proxy({} as DiscoveryA2aStore,{get(_target,key) {assert.fail("Scene lookup accessed Task storage: "+String(key));}});
  const app = express();
  app.use(discoveryA2aRouter(tasks,async () => assert.fail("Scene lookup entered model-backed discovery"),{sceneFetcher}));
  const server = app.listen(0,"127.0.0.1");
  await once(server,"listening");
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>(resolve=>server.close(()=>resolve()));
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = "http://127.0.0.1:" + address.port;
  function send(input:object,path="/message:send") {
    return fetch(origin+path,{method:"POST",headers:{"A2A-Version":"1.0","Content-Type":"application/a2a+json"},
      body:JSON.stringify({message:{role:"ROLE_USER",messageId:randomUUID(),parts:[{data:{kind:sceneCatalogQueryKind,input}}]}})});
  }
  async function read(input:SceneCatalogQuery) {
    const response = await send(input);
    assert.equal(response.status,200,await response.clone().text());
    assert.equal(response.headers.get("Cache-Control"),"no-store");
    const receipt = await response.json();
    assert.equal(receipt.task,undefined);
    assert.equal(receipt.message.role,"ROLE_AGENT");
    assert.match(receipt.message.contextId,/^[0-9a-f-]{36}$/);
    assert.equal(receipt.message.taskId,undefined);
    assert.ok(receipt.message.messageId);
    assert.equal(receipt.message.parts.length,1);
    const data = receipt.message.parts[0].data;
    assert.equal(data.kind,sceneCatalogResultKind);
    return data.value as SceneCatalogResult;
  }
  const card = await (await fetch(origin+"/.well-known/agent-card.json")).json();
  assert.ok(card.skills.some((skill:{id:string})=>skill.id==="oneearth.scene.catalog"));

  for (const input of [
    {...query,url:"https://example.test/stac"},
    {...query,assetIds:["earth-search:landsat-c2-l2:yangtze-1998"]},
    {...query,assetIds:[landsat,landsat]},
    {...query,assetIds:[]},
    {...query,assetIds:[landsat,sentinel,landsat]},
    {...query,point:[-181,20]},
    {...query,point:[0,91]},
    {...query,point:["-122.33",47.61]},
    {...query,years:[2022,2020]},
    {...query,years:[2020.5,2021]},
    {...query,utcWindow:[0,1000]},
    {...query,utcWindow:[utcWindow[1],utcWindow[0]]},
  ]) {
    const response = await send(input);
    assert.equal(response.status,400);
    assert.equal((await response.json()).error.status,"INVALID_ARGUMENT");
  }
  assert.equal((await send(query,"/message:stream")).status,400);
  assert.equal(observed.length,0);

  const data = await read(query);
  assert.equal(observed.length,2);
  for (const url of observed) {
    assert.deepEqual([...url.searchParams.keys()],["collections","intersects","datetime","limit"]);
    assert.deepEqual(JSON.parse(url.searchParams.get("intersects")!),{type:"Point",coordinates:point});
    assert.equal(url.searchParams.get("datetime"),"2021-06-01T00:00:00.000Z/2021-06-30T23:59:59.999Z");
    assert.equal(url.searchParams.get("limit"),"5");
  }
  const [first,zero] = data.lookups;
  assert.deepEqual(data.failures,[]);
  assert.equal(first.assetId,landsat);
  assert.equal(first.matched,6);
  assert.deepEqual(first.point,point);
  assert.deepEqual(first.years,query.years);
  assert.deepEqual(first.utcWindow,utcWindow);
  assert.equal(first.items.length,5);
  assert.deepEqual(first.items[0],{id:"LC08 fixture/1",datetime:"2021-06-15T10:02:40Z",cloud:12.5,
    url:root+"collections/landsat-c2-l2/items/LC08%20fixture%2F1"});
  assert.equal(first.items[1].cloud,null);
  assert.equal(zero.assetId,sentinel);
  assert.equal(zero.matched,0);
  assert.deepEqual(zero.items,[]);

  mode = "partial";
  const partial = await read({...query,utcWindow:undefined});
  assert.equal(partial.lookups.length,1);
  assert.equal(partial.lookups[0].assetId,landsat);
  assert.deepEqual(partial.failures,[{assetId:sentinel,url:observed.at(-1)!.href}]);
  assert.equal(observed.at(-1)!.searchParams.get("datetime"),"2020-01-01T00:00:00Z/2021-12-31T23:59:59Z");

  mode = "invalid";
  const invalid = await read({...query,assetIds:[landsat]});
  assert.deepEqual(invalid.lookups,[]);
  assert.deepEqual(invalid.failures,[{assetId:landsat,url:observed.at(-1)!.href}]);
});
