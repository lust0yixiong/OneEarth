import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { layerObjects, spatialStore, type Bounds, type Chunk, type Layer } from "../server/spatial-store";

const ids = ["1835833", "1835839", "1846104"];
const formats = { json:"application/json", geojson:"application/geo+json", png:"image/png" } as const;
const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

interface Asset {
  route: string;
  file: string;
  media: string;
  starts: string | null;
  ends: string | null;
  level: number | null;
  bounds: Bounds | null;
  sha256: string;
  size: number;
}
interface BundleLayer extends Layer { assets: Asset[] }

function isolated() {
  const database=new URL(process.env.ONEEARTH_SPATIAL_DATABASE_URL ?? "");
  const object=new URL(process.env.ONEEARTH_OBJECT_ENDPOINT ?? "");
  const databaseName=decodeURIComponent(database.pathname.slice(1));
  const bucket=process.env.ONEEARTH_OBJECT_BUCKET ?? "";
  assert.ok(["postgresql:","postgres:"].includes(database.protocol));
  assert.ok(["http:","https:"].includes(object.protocol));
  for (const origin of [database,object]) {
    assert.ok(["127.0.0.1","localhost","[::1]"].includes(origin.hostname) && origin.port,
      "Pilot requires explicitly configured loopback storage endpoints");
  }
  assert.notEqual(database.port,"55432","Primary PostgreSQL is excluded");
  assert.notEqual(object.port,"5900","Primary Garage is excluded");
  assert.ok(databaseName && !["postgres","oneearth_spatial"].includes(databaseName),"Use a dedicated pilot database");
  assert.ok(bucket && bucket!=="oneearth-layers","Use a dedicated pilot object bucket");
  return {databasePort:Number(database.port),databaseName,s3Port:Number(object.port),bucket};
}

function boundsAreValid(value: unknown): value is Bounds {
  if (!Array.isArray(value) || value.length!==4 || !value.every(Number.isFinite)) return false;
  const [west,south,east,north]=value;
  return -180<=west && west<east && east<=180 && -90<=south && south<north && north<=90;
}
function dateIsValid(value: string) {
  return /^\d{4}-\d\d-\d\d$/.test(value) && Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0,10)===value;
}

async function readBundle(root: string) {
  const index=JSON.parse(await readFile(path.join(root,"publication.json"),"utf8")) as {version:number;layers:BundleLayer[]};
  assert.equal(index.version,1);
  assert.deepEqual(index.layers.map(layer=>layer.id).sort(),ids);
  const entries=[];
  for (const {assets,...layer} of index.layers) {
    assert.equal(layer.version,"public-v1");
    assert.equal(layer.entity_id,`haina:${layer.id}`);
    const source=new URL(layer.source);
    assert.equal(source.origin,"https://cn.zero2x.org");
    assert.equal(source.searchParams.get("id"),layer.id);
    const base=`/visualizations/haina/${layer.id}/public-v1/`;
    const files=new Map<string,{chunk:Chunk;bytes:Buffer}>();
    for (const asset of assets) {
      const name=asset.route.slice(base.length);
      const match=/^[a-z0-9][a-z0-9-]*-(?<digest>[a-f0-9]{64})\.(?<kind>json|geojson|png)$/.exec(name);
      const isManifest=name==="manifest.json";
      assert.ok(asset.route.startsWith(base) && (isManifest || match?.groups));
      assert.ok(!files.has(asset.route) && asset.file===`${layer.id}/${name}`);
      const file=await realpath(path.join(root,asset.file));
      assert.equal(file,path.join(root,asset.file),"Publication asset cannot be redirected by a symlink");
      const bytes=await readFile(file);
      const hash=sha256(bytes);
      assert.equal(asset.sha256,hash);
      assert.equal(asset.size,bytes.length);
      const media=isManifest ? formats.json : formats[match!.groups!.kind as keyof typeof formats];
      assert.equal(asset.media,media);
      assert.ok(isManifest ? asset.bounds===null && asset.level===null : boundsAreValid(asset.bounds) && asset.level===0);
      assert.ok(asset.starts===null && asset.ends===null || (!isManifest && asset.starts && asset.ends &&
        dateIsValid(asset.starts) && dateIsValid(asset.ends) && asset.starts<=asset.ends));
      if (!isManifest) assert.equal(match!.groups!.digest,hash);
      files.set(asset.route,{bytes,chunk:{route:asset.route,layer_id:layer.id,starts:asset.starts,ends:asset.ends,
        bounds:asset.bounds,level:asset.level,hash,size:bytes.length,media}});
    }
    const manifestFile=files.get(base+"manifest.json");
    assert.ok(manifestFile,"Missing canonical manifest");
    const manifest=JSON.parse(manifestFile.bytes.toString());
    assert.equal(manifest.version,1);
    assert.equal(String(manifest.datasetId),layer.id);
    assert.equal(manifest.source,layer.source);
    assert.equal(manifest.title,layer.title);
    const viewIDs=new Set<string>();
    const referenced=new Set([base+"manifest.json"]);
    for (const view of manifest.views) {
      assert.ok(typeof view.id==="string" && !viewIDs.has(view.id) && boundsAreValid(view.bounds));
      viewIDs.add(view.id);
      const requirements: [string, string][] = view.kind==="points"
        ? [[view.data,formats.geojson]]
        : (assert.equal(view.kind,"raster"), [[view.image,formats.png],...(view.grid?[[view.grid,formats.json] as [string,string]]:[])]);
      for (const [route,media] of requirements) {
        const resource=files.get(route);
        assert.ok(resource && resource.chunk.media===media);
        assert.deepEqual(resource.chunk.bounds,view.bounds);
        referenced.add(route);
      }
    }
    assert.ok(viewIDs.has(manifest.defaultView));
    assert.equal(referenced.size,files.size);
    entries.push({layer,files:[...files.values()]});
  }
  return entries;
}

async function main() {
  const {values}=parseArgs({options:{isolated:{type:"boolean"},bundle:{type:"string"},receipt:{type:"string"}}});
  assert.ok(values.isolated && values.bundle && values.receipt,
    "Usage: --isolated --bundle <prepared-output> --receipt <evidence.json>");
  const target=isolated();
  const root=await realpath(values.bundle);
  const entries=await readBundle(root);
  const store=await spatialStore();
  try {
    const objects=layerObjects();
    // Upload and verify all objects before publishing any route, including canonical manifests.
    for (const {files} of entries) for (const file of files) {
      const uploaded=await objects.put(file.bytes);
      assert.equal(uploaded.hash,file.chunk.hash);
      assert.equal(sha256(await objects.read(uploaded.hash)),uploaded.hash,"S3 integrity check failed");
    }
    await store.publishLayerSet(entries.map(({layer,files})=>({layer,chunks:files.map(file=>file.chunk)})));
    for (const {files} of entries) for (const {chunk} of files) {
      assert.deepEqual(await store.object(chunk.route),{hash:chunk.hash,size:chunk.size,media:chunk.media});
    }
    const receipt={version:1,target,postgis:await store.version(),backend:objects.backend,
      layers:entries.map(({layer,files})=>({...layer,objects:files.map(file=>file.chunk)}))};
    await writeFile(values.receipt,JSON.stringify(receipt,null,2)+"\n",{mode:0o600});
    console.log(JSON.stringify({layers:entries.length,verifiedObjects:entries.reduce((sum,entry)=>sum+entry.files.length,0)}));
  } finally { await store.close(); }
}

main().catch(error=>{
  const detail=error instanceof Error ? error.message : "unknown error";
  console.error("Pilot publication failed:",detail.includes("://") ? "storage or path validation failed" : detail);
  process.exitCode=1;
});
