import test from "node:test";
import assert from "node:assert/strict";
import {heatIntensity,smoothHeatField} from "./distribution-heat";

test("heat smoothing preserves a uniform interior and does not add neighbouring counts",()=>{
  const field=new Float32Array(41*41).fill(.4),before=field.slice();
  const smooth=smoothHeatField(field,41,41,2);
  assert.ok(Math.abs(smooth[20*41+20]-.4)<1e-6);
  assert.ok(Math.max(...smooth)<=.400001);
  assert.deepEqual(field,before,"display smoothing cannot alter the source counts");
  assert.deepEqual(smoothHeatField(new Float32Array(41*41),41,41,2),new Float32Array(41*41));
});

test("an isolated heat cell spreads locally with conserved weight and a finite tail",()=>{
  const field=new Float32Array(41*41);field[20*41+20]=1;
  const smooth=smoothHeatField(field,41,41,2);
  assert.ok(smooth[20*41+20]>smooth[20*41+21]);
  assert.ok(smooth[20*41+21]>0);
  assert.equal(smooth[20*41+30],0,"blank distant cells receive no heat");
  assert.ok(Math.abs(smooth.reduce((a,b)=>a+b,0)-1)<1e-6);
  assert.ok(Math.abs(smooth[20*41+22]-smooth[22*41+20])<1e-8);
});

test("heat at image edges is zero padded without wrapping or renormalising",()=>{
  const weights=Array.from({length:13},(_,i)=>Math.exp(-.5*((i-6)/2)**2));
  const sum=weights.reduce((a,b)=>a+b,0);
  for(const [px,py] of [[0,0],[2,1]]){
    const field=new Float32Array(3*2);field[py*3+px]=1;
    const result=smoothHeatField(field,3,2,2);
    for(let y=0;y<2;y++)for(let x=0;x<3;x++)
      assert.ok(Math.abs(result[y*3+x]-weights[6+x-px]*weights[6+y-py]/sum**2)<1e-8);
  }
});

test("heat intensity is fixed across views and keeps empty and invalid counts cold",()=>{
  for(const n of [0,-1,NaN,Infinity])assert.equal(heatIntensity(n),0);
  assert.ok(heatIntensity(1)>0);
  assert.ok(heatIntensity(2)>heatIntensity(1));
  assert.ok(heatIntensity(40)>heatIntensity(10));
  assert.equal(heatIntensity(5000),1);
});
test("reused heat buffers preserve numerical results and clear a previous hot frame",()=>{
  const scratch={middle:new Float32Array(41*41),output:new Float32Array(41*41)};
  const peak=new Float32Array(41*41);peak[20*41+20]=1;
  for(const field of [peak,new Float32Array(41*41).fill(.4),new Float32Array(41*41)]){
    const original=field.slice(),expected=smoothHeatField(field,41,41,2);
    assert.deepEqual(smoothHeatField(field,41,41,2,scratch),expected);assert.deepEqual(field,original);
  }
  assert.deepEqual(smoothHeatField(peak,41,41,2,{middle:peak,output:peak}),smoothHeatField(peak,41,41,2));
});
