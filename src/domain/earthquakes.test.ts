import test from "node:test";
import assert from "node:assert/strict";
import {dayMs,parseEarthquakeDay} from "./earthquakes";

test("the rolling USGS layer uses origin time, excludes blasts, retains signed depth and unknown magnitudes",()=>{
  const generated=Date.UTC(2026,10,13);
  function feature(id:string,type:string,time:number){
    return {id,geometry:{type:"Point",coordinates:[0,-5,-0.6] as [number,number,number]},properties:{type,time,status:"reviewed",place:null,mag:null,url:"",updated:generated}};
  }
  const {events}=parseEarthquakeDay({metadata:{generated},features:[
    feature("late","earthquake",generated-1000),feature("old","earthquake",generated-dayMs-100),
    feature("blast","quarry blast",generated),feature("early","earthquake",generated-dayMs)]});
  assert.deepEqual(events.map(q=>q.id),["early","late"]);
  assert.equal(events[0].depth,-0.6);assert.equal(events[0].mag,null);
});
