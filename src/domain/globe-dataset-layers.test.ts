import assert from "node:assert/strict";
import test from "node:test";
import {decodeGlobeLayers,encodeGlobeLayers,globeDatasetLayer,setDatasetLayer} from "./globe-dataset-layers";

test("layer selection changes and visibility update only the same dataset",()=>{
  const viirs=globeDatasetLayer({kind:"public",selection:{id:1835833,view:"global"}});
  const harbin=globeDatasetLayer({kind:"public",selection:{id:1846104,view:"patch_000186",month:"2025-04"}});
  const june=globeDatasetLayer({kind:"public",selection:{...harbin.selection,id:1846104,month:"2025-06"}});
  const first=[viirs,harbin];
  const next=setDatasetLayer(first,june);
  assert.deepEqual(next.map(layer=>layer.id),["haina:1835833","haina:1846104"]);
  assert.equal(next[0],viirs);
  assert.equal(next[1],june);
  const hidden=setDatasetLayer(next,{...june,visible:false});
  assert.equal(hidden[1]?.visible,false);
  assert.equal(hidden[1]?.selection,june.selection);
  assert.equal(harbin.visible,true);
});

test("a combination link carries camera, individual controls, order and a visible focus",()=>{
  const viirs=globeDatasetLayer({kind:"public",selection:{id:1835833,view:"global"}},false);
  const harbin=globeDatasetLayer({kind:"public",selection:{id:1846104,view:"patch_000186",month:"2025-10"}});
  const forest=globeDatasetLayer({kind:"field",selection:{id:"forest",frame:0,date:"2024-03-26"}});
  const camera={center:[126.5093,45.8217] as [number,number],zoom:1400,reason:"哈尔滨"};
  const layers=[viirs,harbin,forest];
  const value=decodeGlobeLayers(encodeGlobeLayers(layers,harbin.id,camera));
  assert.deepEqual(value?.layers,layers);
  assert.deepEqual(value?.focus,harbin);
  assert.deepEqual(value?.camera?.center,camera.center);
  assert.equal(value?.camera?.zoom,camera.zoom);
  assert.equal(decodeGlobeLayers(encodeGlobeLayers(layers,viirs.id,camera))?.focus,null);
});

test("a combination link rejects duplicate datasets, unsupported recipes and invalid camera",()=>{
  const entry=["public",true,{id:1835833}];
  assert.equal(decodeGlobeLayers(JSON.stringify([1,null,[entry,entry],[0,0,1]])),null);
  assert.equal(decodeGlobeLayers(JSON.stringify([1,null,[["public",true,{id:9999999}]],[0,0,1]])),null);
  assert.equal(decodeGlobeLayers(JSON.stringify([1,null,[entry],[999,0,1]]))?.camera,null);
});
