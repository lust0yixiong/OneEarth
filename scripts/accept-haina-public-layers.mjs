import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { hainaPublicLayerRoute } from "../server/haina-public-layer-routes.ts";

const [endpoint] = process.argv.slice(2);
const origin = new URL(endpoint);
assert.equal(origin.href, origin.origin + "/", "Use the isolated workbench origin without a path");
assert.equal(origin.protocol, "http:");
assert.equal(origin.hostname, "127.0.0.1");
assert.ok(Number(origin.port) > 1024 && ![5174,5474,5475,5476,5477].includes(Number(origin.port)),
  "Use an explicitly isolated workbench port");

const ids = [1835839,1835833,1846104];
const digests = [];

async function get(relative, accept) {
  assert.match(relative, hainaPublicLayerRoute, "Expected a published Haina pilot path");
  const response = await fetch(origin.origin + relative, {
    headers: {"Accept-Encoding":"identity", "Cache-Control":"no-cache"},
    signal: AbortSignal.timeout(8_000),
  });
  assert.equal(response.status, 200, relative);
  assert.equal(response.headers.get("x-oneearth-service"),"spatial",relative);
  assert.match(response.headers.get("content-type") ?? "",accept,relative);
  const body = Buffer.from(await response.arrayBuffer());
  assert.ok(body.length > 0 && body.length < 12_000_000,relative);
  const sha256 = createHash("sha256").update(body).digest("hex");
  assert.equal(response.headers.get("etag"),'"'+sha256+'"',relative);
  digests.push({path:relative,bytes:body.length,sha256});
  return body;
}

function bounds(value) {
  assert.ok(Array.isArray(value) && value.length===4 && value.every(Number.isFinite));
  const [w,s,e,n] = value;
  assert.ok(-180<=w && w<e && e<=180 && -90<=s && s<n && n<=90);
  return value;
}

function inside([lon,lat],[w,s,e,n]) {
  return w<=lon && lon<=e && s<=lat && lat<=n;
}

const installed = (await (await fetch(origin.origin+"/api/spatial/layers",{signal:AbortSignal.timeout(5_000)})).json());
const summaries=[];
for (const datasetId of ids) {
  assert.ok(installed.some(layer => layer.entity_id==="haina:"+datasetId), "Missing indexed entity "+datasetId);
  const root = "/visualizations/haina/"+datasetId+"/public-v1/";
  const manifestRoute=root+"manifest.json";
  const manifest = JSON.parse(await get(manifestRoute,/application\/json/));
  const manifestEtag='"'+digests.at(-1).sha256+'"';
  const unchanged = await fetch(origin.origin+manifestRoute,{
    headers:{"If-None-Match":manifestEtag},signal:AbortSignal.timeout(5_000),
  });
  assert.equal(unchanged.status,304,manifestRoute);
  assert.equal(await unchanged.text(),"");
  assert.equal(manifest.version,1);
  assert.equal(manifest.datasetId,datasetId);
  assert.ok(manifest.title && manifest.period && manifest.description);
  assert.ok(manifest.views.some(view => view.id===manifest.defaultView));
  const views=[];
  for (const view of manifest.views) {
    assert.ok(inside(view.center,bounds(view.bounds)),view.id);
    assert.ok(Number.isFinite(view.zoom) && view.zoom>=1);
    const own=route=>{
      assert.ok(route.startsWith(root),route);
      return route;
    };
    if (view.kind==="points") {
      assert.equal(datasetId,1835839);
      const collection=JSON.parse(await get(own(view.data),/application\/(?:geo\+)?json/));
      assert.equal(collection.type,"FeatureCollection");
      assert.equal(collection.features.length,85);
      assert.ok(collection.features.every(feature =>
        feature.geometry.type==="Point" && inside(feature.geometry.coordinates,view.bounds)));
      const dona=collection.features.find(feature=>feature.properties.volcano_number===351070);
      assert.deepEqual(dona.geometry.coordinates,[-76.936,1.5]);
      assert.equal(dona.properties.elevation_m,4137);
      views.push({id:view.id,features:85,example:dona.properties.name});
    } else {
      assert.equal(view.kind,"raster");
      const image=await get(own(view.image),/image\/(?:png|webp)/);
      let values;
      if (view.grid) {
        const grid=JSON.parse(await get(own(view.grid),/application\/json/));
        assert.deepEqual(grid.bounds,view.bounds);
        assert.ok(Number.isInteger(grid.width) && Number.isInteger(grid.height));
        assert.equal(grid.values.length,grid.width*grid.height);
        const finite=grid.values.filter(Number.isFinite);
        assert.ok(finite.length>0);
        assert.ok(grid.values.every(value=>Number.isFinite(value) || value===null));
        values={validCount:finite.length,min:finite.reduce((a,b)=>Math.min(a,b)),max:finite.reduce((a,b)=>Math.max(a,b))};
        assert.ok(values.min<values.max);
      }
      views.push({id:view.id,bounds:view.bounds,imageBytes:image.length,...(values?{values}:{})});
    }
  }
  if (datasetId===1835833) {
    assert.ok(views.length>=2 && views.every(view=>view.values), "VIIRS must verify multiple real windows");
    assert.ok(new Set(views.map(view=>view.bounds.join(","))).size===views.length);
    for (const view of manifest.views) {
      const [west,south,east,north]=view.bounds;
      const inset=[
        west+(east-west)*0.2,south+(north-south)*0.2,
        east-(east-west)*0.2,north-(north-south)*0.2,
      ];
      const query=new URLSearchParams({bbox:inset.join(","),start:"2025-08-01",end:"2025-08-31",level:"0"});
      const response=await fetch(origin.origin+"/api/spatial/layers/"+datasetId+"/chunks?"+query,{
        signal:AbortSignal.timeout(5_000),
      });
      assert.equal(response.status,200);
      const {chunks}=await response.json();
      assert.deepEqual(chunks.map(chunk=>chunk.route).sort(),[view.image,view.grid].sort());
    }
  }
  summaries.push({datasetId,title:manifest.title,period:manifest.period,views});
}

const missing=await fetch(origin.origin+"/visualizations/haina/1835839/public-v1/absent.json",{signal:AbortSignal.timeout(5_000)});
assert.equal(missing.status,404);
assert.equal(missing.headers.get("x-oneearth-service"),"spatial");
const outside=await fetch(origin.origin+"/visualizations/haina/1835484/public-v1/manifest.json",{signal:AbortSignal.timeout(5_000)});
assert.notEqual(outside.headers.get("x-oneearth-service"),"spatial");
console.log(JSON.stringify({summaries,digests,missingIndexedPath:missing.status,nonPilotReachedSpatial:false},null,2));
