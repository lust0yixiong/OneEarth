import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,writeFile,rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {geoContains} from "d3-geo";
import {researchRegions} from "../../server/research-region";
import {validResearchRegion,researchRegionCamera,sameResearchRegion} from "./research-region";
import {rectangle} from "./geo-rectangle";
import {cellAt,gridSpec} from "./spatial";
import {requiredDataSearch} from "../../server/data-search";

test("non-administrative study names use labeled view windows, not inferred dataset extents",async()=>{
  const service=researchRegions("/no-boundary-cache");
  const r=(await service.locate("川西地区"))!;
  assert(validResearchRegion(r));assert.equal(r.precision,"approximate");
  assert(geoContains(r.geometry!,[101,31]));assert(!geoContains(r.geometry!,[110,31]));
  assert.match(r.note,/不是精确研究边界/);
  const camera=researchRegionCamera(r)!;assert(camera.zoom>3 && camera.zoom<12);
  assert.equal((await service.locate("western Sichuan"))!.geometry?.type,"MultiPolygon");
  assert(sameResearchRegion(r,await service.locate("western Sichuan")),"aliases must not trigger another flight");
  assert.equal((await service.locate("大兴安岭地区"))!.precision,"approximate");
  assert.equal((await service.locate("西北太平洋"))!.status,"located");
  assert.equal(await service.locate(null),null);
  const unknown=(await service.locate("尚不能唯一定位的研究区"))!;
  assert.equal(unknown.status,"unresolved");assert.equal(researchRegionCamera(unknown),null);
  assert.equal((await service.locate("川西和滇西"))!.status,"unresolved");
  assert.equal((await service.locate("Mexico City"))!.status,"unresolved","a city is not its namesake country");
});

test("local atlas and cached administrative outlines retain their source and do not fetch",async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),"oneearth-region-"));
  try{
    await writeFile(path.join(dir,"CHN-ADM1-fixture.geojson"),JSON.stringify({type:"FeatureCollection",features:[
      {type:"Feature",properties:{shapeName:"Sichuan Province"},geometry:rectangle(97,26,108,34)},
    ]}));
    const service=researchRegions(dir),sichuan=(await service.locate("四川省"))!;
    assert.equal(sichuan.precision,"boundary");assert.match(sichuan.source,/geoBoundaries/);
    const france=(await service.locate("法国"))!;
    assert(validResearchRegion(france));assert(geoContains(france.geometry!,[2,46]));
    const sea=(await service.locate("南海"))!;assert.equal(sea.status,"located");
    const world=(await service.locate("全球"))!;assert.equal(world.precision,"global");assert.equal(researchRegionCamera(world)!.zoom,1);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test("an explicit grid retains its actual boundary rather than a coarse regional window",async()=>{
  const grid=gridSpec("h3",5),point:[number,number]=[101,31],id=cellAt(point,grid);
  const r=(await researchRegions("/no-cache").locate("川西",{grid,point,id}))!;
  assert(validResearchRegion(r));assert.equal(r.precision,"grid");assert(geoContains(r.geometry!,point));
});

test("corrupt or unbounded region geometries cannot reach the renderer",()=>{
  const base={label:"test",source:"fixture",note:"test",status:"located",precision:"boundary"};
  assert(!validResearchRegion({...base,geometry:{type:"Polygon",coordinates:[[[0,0],[1,1],[0,0],[200,0]]]}}));
  assert(!validResearchRegion({...base,geometry:null}));
  assert(!validResearchRegion({...base,geometry:{type:"Polygon",coordinates:[null]}}));
  assert(!validResearchRegion({...base,geometry:rectangle(0,0,1,1),sourceUrl:"javascript:alert(1)"}));
});

test("validated planning reports area before retrieval and keeps reframe confirmation required",async()=>{
  const plan={questionMode:"preserve",dataQuestion:"研究川西的形变",dataNeed:null,
    researchIntent:{purpose:"研究形变",task:"找证据",region:"川西地区",time:null,months:[]},
    conversationContext:"川西形变",conversationPeriod:null,conversationWindow:null,clarification:null,
    hainaQueries:["川西 形变"],paper:{name:"",facets:[{need:"地表形变",queries:["surface deformation"]}],region:["western Sichuan"],scenario:[]},web:[{web:"western Sichuan deformation",dataset:"InSAR"}]};
  const order:string[]=[];
  const deps={plan:async()=>JSON.stringify(plan),report:()=>{},stage:()=>{},planned:()=>{order.push("region");},
    paper:async()=>{order.push("paper");return {records:[],tools:[],incomplete:[]};},
    haina:async()=>{order.push("haina");return {assets:[],total:0,synced:"",endpoint:"",warning:""};},
    web:async()=>{order.push("web");return [];}};
  await requiredDataSearch("研究川西的形变",new AbortController().signal,deps);
  assert.equal(order[0],"region");assert.equal(order.length,4);
  const reframed=await requiredDataSearch("川西形变怎么理解？",new AbortController().signal,{...deps,
    plan:async()=>JSON.stringify({...plan,questionMode:"reframe",dataQuestion:"找川西形变数据"})});
  assert(reframed.questionCheck);assert.equal(reframed.papers.length,0);
});
