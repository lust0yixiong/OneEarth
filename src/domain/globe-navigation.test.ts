import test from "node:test";
import assert from "node:assert/strict";
import { navigation } from "../data/evidence/globe-navigation.mjs";

test("long pole drags always keep longitude in the valid camera range", () => {
  for (const dx of [-4000, -1000, 1000, 4000]) {
    let camera = [0, 89.9];
    const canvas: any = {
      clientWidth:500, clientHeight:500,
      getBoundingClientRect:()=>({left:0,top:0}), setPointerCapture:()=>{},
      addEventListener:()=>{},removeEventListener:()=>{},
    };
    const buttons = new Map();
    const engine = navigation({canvas,root:{querySelector:(key:string)=>{
      if(!buttons.has(key))buttons.set(key,{});
      return buttons.get(key);
    }},getCamera:()=>camera,getScale:()=>1,baseRadius:()=>200,
    setCamera:(_zoom:number,center:number[])=>{camera=center;},stopFlight:()=>{},pick:()=>{}});
    canvas.onpointerdown({button:0,pointerId:1,clientX:250,clientY:250});
    canvas.onpointermove({pointerId:1,clientX:250+dx,clientY:250});
    assert.ok(camera[0]>=-180 && camera[0]<180, String(camera));
    assert.ok(camera.every(Number.isFinite));
    engine.dispose();
  }
});
