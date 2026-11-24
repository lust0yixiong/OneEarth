import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { layerObjects, spatialStore, type Bounds, type Chunk, type Layer } from "../server/spatial-store";

const prefix = "/visualizations/haina/1846104/coverage-v1/";
const layerId = "haina-1846104-coverage";
const provider = "https://cn.zero2x.org/data-hub/portal/dataset?id=1846104";
const hash = (bytes:Buffer|string) => createHash("sha256").update(bytes).digest("hex");
const checksum = /^[a-f0-9]{64}$/;
const patchId = /^patch_\d{6}$/;
const monthCode = /^20\d{2}-(?:0[1-9]|1[0-2])$/;
const verifiedFiles = ["coverage.json","frames.ndjson","ledger.json","colors.json","representative-frames.json"] as const;

type SafeFiles = typeof verifiedFiles[number];
type Coverage = {
  version:1;datasetId:1846104;source:string;title:string;period:string;description:string;
  defaultPatch:string;defaultMonth:string;months:string[];
  patches:{id:string; bounds:Bounds; center:[number,number]; months:string[]}[];
  colors:{kind:string; labels:string[]};
};
type GroundFrame = {
  patch:string;month:string;sha256:string;sourceSHA256:string;file:string;bytes:number;
  bounds:Bounds;valid:number;alphaValid:number;colorSHA256:string;
};
function isolatedTarget() {
  const db = new URL(process.env.ONEEARTH_SPATIAL_DATABASE_URL || "");
  const objects = new URL(process.env.ONEEARTH_OBJECT_ENDPOINT || "");
  const bucket = process.env.ONEEARTH_OBJECT_BUCKET || "";
  for (const endpoint of [db,objects]) {
    assert.ok(endpoint.port && ["127.0.0.1","localhost","[::1]"].includes(endpoint.hostname),
      "Coverage publication requires explicit dedicated local storage");
  }
  assert.ok(["postgresql:","postgres:"].includes(db.protocol) && db.port!=="55432");
  assert.ok(["http:","https:"].includes(objects.protocol) && objects.port!=="5900");
  assert.match(db.pathname,/^\/next_haina_[a-z0-9_]+$/);
  assert.match(bucket,/^oneearth-next-haina-[a-z0-9-]+$/);
  return {database:db.pathname.slice(1),databasePort:Number(db.port),objectPort:Number(objects.port),bucket};
}

function validBounds(b:Bounds) {
  return Array.isArray(b) && b.length===4 && b.every(Number.isFinite) &&
    b[0]>=-180 && b[0]<b[2] && b[2]<=180 && b[1]>=-90 && b[1]<b[3] && b[3]<=90;
}

async function loadCoverage(root:string) {
  const receipt=JSON.parse(await readFile(path.join(root,"complete.json"),"utf8")) as {frames:number;sha256:Record<SafeFiles,string>};
  const files = new Map<SafeFiles,Buffer>();
  for (const filename of verifiedFiles) {
    const blob=await readFile(path.join(root,filename));
    assert.equal(hash(blob),receipt.sha256[filename],filename+" changed after preparing coverage");
    files.set(filename,blob);
  }
  const coverage=JSON.parse(files.get("coverage.json")!.toString()) as Coverage;
  assert.equal(coverage.source,provider);
  assert.equal(coverage.datasetId,1846104);
  assert.equal(coverage.version,1);
  assert.ok(coverage.title && coverage.description && ["shared-pca","per-frame-pca"].includes(coverage.colors.kind)
    && coverage.colors.labels.length===3);
  assert.ok(coverage.months.length>0 && coverage.patches.length>0 && coverage.patches.length<=424 &&
    coverage.months.every(month=>monthCode.test(month)));
  assert.deepEqual(coverage.months,[...new Set(coverage.months)].sort());
  const defaults = coverage.patches.find(patch=>patch.id===coverage.defaultPatch);
  assert.ok(defaults?.months.includes(coverage.defaultMonth));
  const counts = new Map<string,Bounds>();
  const presentPatches = new Set<string>();
  for (const patch of coverage.patches) {
    assert.ok(patchId.test(patch.id) && !presentPatches.has(patch.id) && validBounds(patch.bounds));
    presentPatches.add(patch.id);
    assert.equal(patch.center.length,2);
    const [x,y] = patch.center;
    const [w,s,e,n] = patch.bounds;
    assert.ok(x>=w && x<=e && y>=s && y<=n);
    assert.deepEqual(patch.months,[...new Set(patch.months)].sort());
    assert.ok(patch.months.length>0);
    for (const month of patch.months) {
      assert.ok(coverage.months.includes(month));
      counts.set(patch.id+"/"+month,patch.bounds);
    }
  }
  const frames=files.get("frames.ndjson")!.toString().trim().split("\n").map(line=>JSON.parse(line) as GroundFrame);
  assert.equal(frames.length,receipt.frames);
  const months = new Set<string>();
  for (const frame of frames) {
    const key = frame.patch+"/"+frame.month;
    assert.ok(counts.has(key));
    assert.deepEqual(frame.bounds,counts.get(key));
    assert.equal(frame.file,"frames/"+frame.month+"/"+frame.patch+".png");
    assert.ok(checksum.test(frame.sha256) && checksum.test(frame.sourceSHA256) && checksum.test(frame.colorSHA256));
    assert.equal(frame.colorSHA256,receipt.sha256["colors.json"]);
    assert.ok(Number.isSafeInteger(frame.bytes) && frame.bytes>8 && frame.bytes<2_000_000 && frame.valid>0 && frame.alphaValid>0);
    months.add(frame.month);
    counts.delete(key);
  }
  assert.equal(counts.size,0);
  assert.deepEqual([...months].sort(),coverage.months);
  // Include the published coverage, source and rendered frames, and color basis.
  // Additional audit receipts do not change the addresses of identical images.
  const materialFiles: SafeFiles[] = ["coverage.json","frames.ndjson","colors.json"];
  const revision=hash(JSON.stringify(materialFiles.map(filename=>receipt.sha256[filename])));
  const period=coverage.months.length===1 ? coverage.months[0] : coverage.months[0]+" 至 "+coverage.months.at(-1);
  return { coverage:{...coverage,period,revision}, frames };
}

async function main() {
  const {values}=parseArgs({options:{isolated:{type:"boolean"},bundle:{type:"string"},receipt:{type:"string"}}});
  assert.ok(values.isolated && values.bundle && values.receipt,
    "Usage: --isolated --bundle <complete-coverage> --receipt <receipt.json>");
  const target=isolatedTarget();
  const root=await realpath(values.bundle);
  const {coverage,frames}=await loadCoverage(root);
  const store=await spatialStore();
  const objects=layerObjects();
  const manifest=Buffer.from(JSON.stringify(coverage)+"\n");
  const layer:Layer={id:layerId,entity_id:"haina:1846104",version:coverage.revision,title:coverage.title,source:coverage.source};
  let uploaded=0;
  async function checkUploaded(bytes:Buffer,expected:string) {
    const result=await objects.put(bytes);
    assert.equal(result.hash,expected);
    assert.equal(hash(await objects.read(expected)),expected,"Object storage integrity check failed");
    return result;
  }
  try {
    const chunks:Chunk[]=[];
    async function uploadFrame(frame:GroundFrame) {
      const canonical=path.join(root,frame.file);
      assert.equal(await realpath(canonical),canonical,"Frame cannot follow a symlink");
      const body=await readFile(canonical);
      assert.equal(body.length,frame.bytes);
      assert.equal(hash(body),frame.sha256);
      assert.ok(body.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])));
      await checkUploaded(body,frame.sha256);
      const [year,month]=frame.month.split("-").map(Number);
      const lastDay=new Date(Date.UTC(year,month,0)).getUTCDate();
      chunks.push({route:prefix+"frame/"+coverage.revision+"/"+frame.patch+"/"+frame.month+".png",
        layer_id:layerId,starts:frame.month+"-01",ends:frame.month+"-"+lastDay,bounds:frame.bounds,
        level:0,size:frame.bytes,hash:frame.sha256,media:"image/png"});
      if (++uploaded % 160 === 0) console.log(JSON.stringify({framesChecked:uploaded,total:frames.length}));
    }
    let cursor=0;
    await Promise.all(Array.from({length:8},async () => {
      for (let frame=frames[cursor++];frame;frame=frames[cursor++]) await uploadFrame(frame);
    }));
    const manifestHash=hash(manifest);
    await checkUploaded(manifest,manifestHash);
    chunks.push({route:prefix+"manifest.json",layer_id:layerId,starts:null,ends:null,
      bounds:null,level:null,size:manifest.length,hash:manifestHash,media:"application/json"});
    chunks.sort((a,b)=>a.route.localeCompare(b.route));
    await store.publishLayerSet([{layer,chunks}]);
    const rows=new Map((await store.exportChunks(layerId)).map(row=>[row.route,row]));
    for (const chunk of chunks) {
      const row=rows.get(chunk.route);
      assert.ok(row && row.hash===chunk.hash && row.size===chunk.size && row.starts===chunk.starts && row.ends===chunk.ends,
        "Published route or time index differs");
    }
    const result={target,layer,frames:frames.length,frameBytes:frames.reduce((sum,frame)=>sum+frame.bytes,0),
      patches:coverage.patches.length,months:coverage.months,manifestHash,objects:chunks.length,
      routeFingerprint:hash(JSON.stringify(chunks))};
    await writeFile(values.receipt,JSON.stringify(result,null,2)+"\n",{mode:0o600});
    console.log(JSON.stringify(result));
  } finally { await store.close(); }
}
main().catch(error=>{
  const message=error instanceof Error?error.message:"unknown error";
  console.error("Xuannv coverage publication failed:",message.includes("://")?"storage or validation failed":message);
  process.exitCode=1;
});
