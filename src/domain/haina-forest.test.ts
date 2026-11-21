import test from "node:test";
import assert from "node:assert/strict";
import {existsSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import manifest from "../../public/visualizations/haina/1846764/manifest.json";
import bundled from "../data/evidence/haina-forest.json";
import {datasetLayers,globeCases,layerFrameCount,regionalCases,regionalForDataset,type HainaForestManifest} from "./regional-cases";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");
const forest=manifest as HainaForestManifest;

test("The forest embedding layer is bound to its Haina dataset and has twelve monthly slices",()=>{
  assert.equal(regionalForDataset("haina:1846764"),"forest");
  assert.equal(datasetLayers.forest,"haina:1846764");
  assert.equal(layerFrameCount("forest"),forest.frames.length);
  assert.ok(globeCases.forest.zoom>1,"the layer opens at its own scale");
  assert.ok(globeCases.forest.center[0]>119&&globeCases.forest.center[0]<127);
  assert.ok(globeCases.forest.center[1]>46&&globeCases.forest.center[1]<54);
  assert.equal(layerFrameCount("forest"),12);
  assert.equal(globeCases.forest.month,6,"July is the default month");
  assert.equal(regionalCases.forest.initial,6);
  assert.deepEqual(bundled,forest,"the bundled manifest matches the public manifest");
  assert.deepEqual(forest.frames.map(f=>f.date),["2023-01-15","2023-02-15","2023-03-15","2023-04-15","2023-05-15","2023-06-15","2023-07-15","2023-08-15","2023-09-15","2023-10-15","2023-11-15","2023-12-15"]);
  for(const frame of forest.frames){
    assert.equal(frame.validPixels,30419);
    assert.match(frame.image,/^\/visualizations\/haina\/1846764\/\d{8}\.webp$/);
    assert.equal(frame.sourceSha256.length,64);
    assert.ok(existsSync(path.join(root,"public",frame.image)),frame.image);
  }
});

test("The forest manifest keeps the grid, PCA method and source conditions auditable",()=>{
  assert.deepEqual(forest.grid.bounds,[117.95,44.96,129.05,54.05]);
  assert.equal(forest.grid.width,370);assert.equal(forest.grid.height,303);
  assert.equal(forest.grid.resolution,0.03);
  assert.equal(forest.embedding.dimensions,64);
  assert.equal(forest.embedding.method,"PCA");
  assert.equal(forest.embedding.components.join(""),"RGB");
  assert.equal(forest.embedding.stretch[0],0.02);
  assert.equal(forest.embedding.stretch[1],0.98);
  assert.ok(forest.embedding.variance.every(v=>v>0&&v<1));
  assert.ok(forest.embedding.note.includes("不是物理量"));
  assert.ok(forest.embedding.note.includes("12 个日期"));
  assert.equal(forest.source.datasetId,"1846764");
  assert.equal(forest.source.license,"CC-BY-4.0");
  const [west,south,east,north]=regionalCases.forest.extent;
  assert.ok(west>forest.grid.bounds[0]&&south>forest.grid.bounds[1]);
  assert.ok(east<forest.grid.bounds[2]&&north<forest.grid.bounds[3]);
});
