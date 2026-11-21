import test from "node:test";
import assert from "node:assert/strict";
import {createCameraMotion} from "../globe/camera-motion";
import type {Camera} from "./types";
function harness(){
  let saved:Camera={center:[105,25],zoom:1,reason:"start"},tick=0,id=0;
  const frames=new Map<number,FrameRequestCallback>(),commits:Camera[]=[];
  const motion=createCameraMotion({read:()=>saved,commit:camera=>{saved=camera;commits.push(camera);},changed:()=>{},now:()=>tick,reducedMotion:()=>false,
    requestFrame:callback=>{frames.set(++id,callback);return id;},cancelFrame:key=>{frames.delete(key);}});
  return {motion,commits,frames,external:(camera:Camera)=>{saved=camera;},advance:(ms:number)=>{tick+=ms;const callbacks=[...frames.values()];frames.clear();for(const callback of callbacks)callback(tick);}};
}
test("globe drags render transient cameras and save only when motion settles",()=>{
  const h=harness();
  for(let i=0;i<24;i++)h.motion.move({center:[105-i,25],zoom:1,reason:"drag"});
  assert.equal(h.commits.length,0);assert.deepEqual(h.motion.camera().center,[82,25]);
  h.motion.settle();h.motion.settle();assert.equal(h.commits.length,1);
  assert.deepEqual(h.commits[0].center,[82,25]);
});
test("grid flight rotates and zooms without persisting intermediate animation frames",()=>{
  const h=harness(),target:Camera={center:[-130,50],zoom:50,reason:"grid"};
  h.motion.flyTo(target);h.advance(200);
  assert.notDeepEqual(h.motion.camera().center,[105,25]);assert.ok(h.motion.camera().zoom>1);assert.equal(h.commits.length,0);
  h.motion.settle();assert.equal(h.commits.length,0,"idle callbacks cannot save a running flight");
  h.advance(200);h.advance(200);h.advance(200);
  assert.deepEqual(h.motion.camera(),target);assert.deepEqual(h.commits,[target]);assert.equal(h.frames.size,0);
});
test("manual input cancels a flight and an external view change cannot be overwritten",()=>{
  const h=harness();h.motion.flyTo({center:[-130,50],zoom:50,reason:"grid"});h.advance(200);
  const halfway=h.motion.camera();h.motion.stopFlight();assert.equal(h.frames.size,0);assert.equal(h.motion.camera(),halfway);
  const external:Camera={center:[10,0],zoom:2,reason:"new view"};h.external(external);h.motion.settle();
  assert.equal(h.motion.camera(),external);assert.equal(h.commits.length,0);
});
