import test from "node:test";
import assert from "node:assert/strict";
import {existsSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import manifest from "../../public/visualizations/haina/1846639/manifest.json";
import bundled from "../data/evidence/haina-c40.json";
import {datasetLayers,globeCases,layerFrameCount,regionalCases,regionalForDataset,type C40Manifest} from "./regional-cases";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");
const c40=manifest as unknown as C40Manifest;

test("The C40 layer binds Shanghai, Beijing and Guangzhou to one Haina dataset",()=>{
  assert.equal(regionalForDataset("haina:1846639"),"c40");
  assert.equal(datasetLayers.c40,"haina:1846639");
  assert.equal(layerFrameCount("c40"),3);
  assert.equal(globeCases.c40.month,0);
  assert.ok(globeCases.c40.zoom>1);
  assert.ok(globeCases.c40.center[0]>121&&globeCases.c40.center[0]<122);
  assert.ok(globeCases.c40.center[1]>30&&globeCases.c40.center[1]<32);
  assert.deepEqual(bundled,c40,"the bundled manifest matches the public manifest");
  assert.deepEqual(c40.cities.map(city=>city.name),["上海","北京","广州"]);
  assert.deepEqual(c40.cities.map(city=>city.samples),[162604,121404,95709]);
  for(const city of c40.cities){
    assert.match(city.image,/^\/visualizations\/haina\/1846639\/[a-z]+\.webp$/);
    assert.ok(existsSync(path.join(root,"public",city.image)),city.image);
    assert.equal(city.width,1600);
    assert.ok(city.height>=700);
    assert.ok(city.zoom>1);
    assert.equal(city.bounds.length,4);
    assert.equal(city.projection.type,"Azimuthal Equidistant");
    assert.ok(city.layers.building_polygon>0);
  }
  assert.equal(c40.source.datasetId,"1846639");
  assert.equal(c40.source.license,"ODbL-1.0");
});

test("The C40 manifest records the shared PCA and all city bounds",()=>{
  assert.equal(c40.snapshot,"2026-10-13");
  assert.equal(c40.defaultCity,"shanghai-chn");
  assert.equal(c40.embedding.dimensions,1024);
  assert.equal(c40.embedding.method,"PCA");
  assert.equal(c40.embedding.components.join(""),"RGB");
  assert.equal(c40.embedding.variance.length,3);
  assert.ok(c40.embedding.variance.every(value=>value>0&&value<1));
  assert.match(c40.embedding.note,/三个城市/);
  assert.match(c40.embedding.note,/不是土地利用类别/);
  assert.equal(c40.cities[0].layers.landuse_polygon,19125);
  assert.equal(c40.cities[0].layers.water_polygon,1118);
  const [west,south,east,north]=regionalCases.c40.extent;
  for(const city of c40.cities){
    assert.ok(west<=city.bounds[0]&&south<=city.bounds[1]);
    assert.ok(east>=city.bounds[2]&&north>=city.bounds[3]);
  }
});
