import test from "node:test";
import assert from "node:assert/strict";
import {contourSegments} from "./distribution-contours";
import {parseDistributionMode,resolveDistributionMode} from "./distribution-modes";

test("contours interpolate a known linear field and leave uniform fields without lines",()=>{
  const field=Float32Array.from({length:25},(_,i)=>i%5),original=field.slice();
  const lines=contourSegments(field,5,5,2.5);
  assert.equal(lines.length,16);
  for(let i=0;i<lines.length;i+=4){assert.equal(lines[i],2.5);assert.equal(lines[i+2],2.5);}
  assert.deepEqual(field,original,"contouring cannot change the heat field");
  assert.equal(contourSegments(new Float32Array(25),5,5,.2).length,0);
  assert.equal(contourSegments(new Float32Array(25).fill(1),5,5,.2).length,0);
});

test("an isolated peak produces a closed contour and saddle crossings stay finite",()=>{
  const field=new Float32Array(9);field[4]=1;
  const lines=contourSegments(field,3,3,.5),ends=new Map<string,number>();
  assert.equal(lines.length,16);
  for(let i=0;i<lines.length;i+=2){const key=[lines[i],lines[i+1]].join(",");ends.set(key,(ends.get(key)||0)+1);}
  assert.deepEqual([...ends.values()],[2,2,2,2],"each crossing joins two segments without a gap");
  for(const level of [.4,.5,.6]){
    const saddle=contourSegments(new Float32Array([1,0,0,1]),2,2,level);
    assert.equal(saddle.length,8);
    assert.ok(saddle.every(v=>Number.isFinite(v)&&v>=0&&v<=1));
  }
});

test("stored display choices recover from obsolete values and fixed-cell views retain their scope",()=>{
  for(const value of [null,undefined,"obsolete","__proto__",{}])assert.equal(parseDistributionMode(value),"heatmap");
  assert.equal(parseDistributionMode("contours"),"contours");
  const preferred="contours";
  assert.equal(resolveDistributionMode(preferred,"fixed-cell"),"grid");
  assert.equal(resolveDistributionMode(preferred,"scenes"),"grid");
  assert.equal(resolveDistributionMode(preferred,"catalog"),"contours","leaving a constrained view restores the preferred display");
});

test("asymmetric saddle points do not connect peaks across a lower-valued gap",()=>{
  const lines=contourSegments(new Float32Array([10,-6,-3,1]),2,2,0);
  assert.equal(lines.length,8);
  assert.ok(Math.abs(lines[0]-.625)<1e-6);assert.equal(lines[1],0);
  assert.equal(lines[2],0);assert.ok(Math.abs(lines[3]-10/13)<1e-6);
});
