import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import { coverageIndex, coverageScope, coverageCounter } from "../../server/coverage-index";
import { coverageRouter } from "../../server/coverage-router";
import { addCoverage } from "../globe/coverage-grid";
import { assetById, registerPapers, type Asset } from "./datasets";
import { cellAt, cellShape, emptyFilters, gridSpec } from "./spatial";
import { regionRecords, backgroundCoverageProduct, type Area, type RegionRecord } from "./product-distribution";
import { catalogGrid } from "./results";
import type { CandidateSet, GridSpec } from "./types";
import type { PaperRecord } from "./paper-record";
import { rectangle, rectangleContainsVertex } from "./geo-rectangle";
import { regionHit } from "./product-distribution";
import { footprintInCell } from "./push-observations";

const box=(w:number,s:number,e:number,n:number):Area=>({type:"Polygon",coordinates:[[[w,s],[w,n],[e,n],[e,s],[w,s]]]});
const fixture=(area:Area,product="one"):RegionRecord=>({area,asset:{...assetById.get("Q10-1")!,productId:product}});
async function ready(index:ReturnType<typeof coverageIndex>,grid:GridSpec,cells:string[],geometries:ReturnType<typeof coverageScope>["geometries"]) {
  for(let attempt=0;attempt<100;attempt++) {
    const result=await index.read(grid,cells,geometries);
    if(!result.pending)return result;
    await new Promise(resolve=>setTimeout(resolve,10));
  }
  throw Error("Background coverage did not finish");
}

test("persistent geometry indexes match intersections in H3/S2, include empty cells, and survive restart",async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),"oneearth-coverage-"));
  const file=path.join(directory,"coverage.sqlite");
  let index=coverageIndex(file);
  try {
    const areas=[box(121,31,122,32),box(179,-1,-179,1)];
    const regions=[fixture(areas[0]),fixture(areas[0],"two"),fixture(areas[1],"dateline")];
    const scope=coverageScope(regions),count=coverageCounter(scope.products);
    assert.equal(scope.geometries.length,2);
    await index.warm(scope.geometries);
    for(const system of ["h3","s2"] as const)for(const band of [2,3,4]) {
      const grid=gridSpec(system,band);
      const cells=[...new Map(([[121.5,31.5],[0,0],[179.8,0],[-179.8,0]] as [number,number][]).map(point=>{
        const cell=cellShape(cellAt(point,grid),grid);return [cell.id,cell] as const;
      })).values()];
      const expected=addCoverage(new Map(),cells,regions,false);
      const result=await ready(index,grid,cells.map(cell=>cell.id),scope.geometries);
      assert.deepEqual(result.hits.map(([cell,keys])=>[cell,count(keys)]),cells.map(cell=>[cell.id,expected.get(cell.id)?.size||0]));
      const warm=await index.read(grid,cells.map(cell=>cell.id),scope.geometries);
      assert.equal(warm.computed,result.computed,"reading a warm view never recomputes an intersection");
    }
    await index.close();index=coverageIndex(file);
    const restarted=await index.warm(scope.geometries);
    assert.equal(restarted.computed,0,"a process restart reuses the persisted coarse index");
    const grid=gridSpec("s2",4),cells=[[121.5,31.5],[0,0]].map(point=>cellAt(point as [number,number],grid));
    const result=await index.read(grid,cells,scope.geometries);
    assert.equal(result.pending,0,"both positive and empty fine cells survive restart");
    assert.equal(result.computed,0);
    const next=coverageScope([...regions,fixture(box(-122,30,-121,31),"new")]);
    const updated=await index.warm(next.geometries);
    assert.equal(updated.computed,4,"one new geometry computes only its four overview layers");
  } finally {await index.close();await rm(directory,{recursive:true,force:true});}
});

test("coverage HTTP reads preserve filtered product counts and do not turn malformed cells into empty results",async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),"oneearth-coverage-http-"));
  const index=coverageIndex(path.join(directory,"coverage.sqlite"));
  const app=express();app.use(express.json());app.use("/api/coverage",coverageRouter(index));
  const server=app.listen(0,"127.0.0.1");
  await new Promise<void>(resolve=>server.once("listening",resolve));
  const address=server.address();assert.ok(address && typeof address!=="string");
  const root="http://127.0.0.1:"+address.port+"/api/coverage/";
  const post=(route:string,body:unknown)=>fetch(root+route,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  try {
    const grid=gridSpec("h3",2),cells=([[32.3,41.6],[0,0]] as [number,number][]).map(point=>cellShape(cellAt(point,grid),grid));
    for(const source of ["","public","haina"]) {
      const filters={...emptyFilters(),source};
      const batch:CandidateSet={ids:["Q14-0"],caseId:null,title:"Boundary data",filters,selection:null,layer:"all",camera:{center:[32.3,41.6],zoom:1,reason:"test"},gridSystem:"h3"};
      const regions=regionRecords(filters,batch);
      await index.warm(coverageScope(regions).geometries);
      const scope=await (await post("scopes",{filters,batch})).json();
      const response=await post("cells",{id:scope.id,grid,cells:cells.map(cell=>cell.id)});assert.equal(response.status,200);
      const result=await response.json();
      const expected=addCoverage(catalogGrid(grid,filters,batch),cells,regions,false);
      assert.deepEqual(result.ready,cells.map(cell=>cell.id));
      assert.deepEqual(result.cells,cells.flatMap(cell=>expected.get(cell.id)?.size?[[cell.id,expected.get(cell.id)!.size]]:[]));
      for(const cell of cells){
        const details=await (await post("cells",{id:scope.id,grid,cells:[cell.id],includeProducts:true})).json();
        assert.deepEqual(details.ready,[cell.id]);
        assert.deepEqual(new Set(details.members[0][1]),expected.get(cell.id)||new Set(),"list membership exactly matches the coloured count, including verified zero cells");
      }
      assert.equal((await post("cells",{id:scope.id,grid,cells:cells.map(cell=>cell.id),includeProducts:true})).status,400);
      assert.equal((await post("cells",{id:scope.id,grid,cells:[cells[0].id],includeProducts:"true"})).status,400);
      assert.equal((await post("cells",{id:scope.id,grid,cells:["invalid"]})).status,400);
      assert.equal((await post("cells",{id:scope.id,grid:{...grid,n:7},cells:cells.map(cell=>cell.id)})).status,400);
    }
  } finally {await new Promise<void>(resolve=>server.close(()=>resolve()));await index.close();await rm(directory,{recursive:true,force:true});}
});

test("100,000 datasets sharing a footprint index one geometry and keep distinct dataset counts",async t=>{
  const directory=await mkdtemp(path.join(tmpdir(),"oneearth-coverage-scale-"));
  const index=coverageIndex(path.join(directory,"coverage.sqlite"));
  try {
    const area=box(121,31,122,32),start=performance.now();
    const rows=Array.from({length:100000},(_,i)=>fixture(area,"dataset:"+i));
    const scope=coverageScope(rows),count=coverageCounter(scope.products);
    assert.equal(scope.geometries.length,1);
    assert.equal(scope.products.values().next().value!.size,100000);
    const warm=await index.warm(scope.geometries);
    assert.equal(warm.computed,4);
    const grid=gridSpec("h3",2),cell=cellAt([121.5,31.5],grid);
    const result=await index.read(grid,[cell],scope.geometries);
    assert.equal(count(result.hits[0][1]),100000);
    assert.equal(result.computed,4,"dataset cardinality does not multiply geometry intersections");
    t.diagnostic(`100,000 shared-footprint dataset records, four precomputed layers and warm lookup: ${(performance.now()-start).toFixed(0)} ms`);
  } finally {await index.close();await rm(directory,{recursive:true,force:true});}
});

test("assertion datasets count once across paper usages and never inherit a study-context location",()=>{
  const dsKey="doi:10.test/same-dataset",area=box(121,31,122,32);
  const record=(letter:string):PaperRecord=>({id:"earthnano:"+letter.repeat(64),dsKey,papers:2,paperTitle:"Research "+letter,
    studyContext:"A different study area in Alaska",points:[],need:{name:"Dataset",product:"Shared dataset",type:"论文抽取线索",source:"EarthNano 论文断言库",detail:"Usage",
      status:"有论文用法记录",datasetId:dsKey,profile:{role:"data",spatial:"coverage",coverage:"Official footprint",area,areaBasis:"geometry",access:"DOI",limitation:"Study scope is independent"},
      tabs:[{kind:"table",label:"论文用法（本页）",columns:[],rows:[["Research","Role","Variable","Research context","paper-"+letter,"dataset-"+letter]]}]}});
  const a=record("a"),b=record("b");
  registerPapers([a]);registerPapers([b],false);
  const scope=coverageScope([a,b].map(record=>({area,asset:assetById.get(record.id)!})));
  assert.equal(scope.geometries.length,1);
  assert.deepEqual([...scope.products.values()][0],new Set([dsKey]));
  assert.equal(coverageCounter(scope.products)(scope.geometries.map(geometry=>geometry.key)),1);
  const unlocated=record("c");delete unlocated.need.profile!.area;
  registerPapers([unlocated]);
  const batch={ids:[unlocated.id],caseId:null,filters:emptyFilters(),layer:"all"} as CandidateSet;
  assert.equal(regionRecords(emptyFilters(),batch).length,0,"a paper's Alaska study context cannot create a dataset footprint");
  const metadata=record("d");
  metadata.points=[[-139,1]];
  metadata.need.profile={...metadata.need.profile!,area:box(-160,-10,-120,10),areaBasis:undefined};
  registerPapers([metadata]);
  const asset=assetById.get(metadata.id)!;
  assert.equal(backgroundCoverageProduct(asset),true,"legacy assertion metadata boxes remain coverage context");
  const regional=regionRecords(emptyFilters(),{...batch,ids:[metadata.id]});
  assert.equal(regional.length,1,"the metadata extent remains available to spatial lookup");
  assert.equal(coverageScope(regional).geometries.length,0,"the extent must not paint every intersected ocean cell");
  const grid=gridSpec("h3",2);
  const localized=catalogGrid(grid,{...emptyFilters(),source:"paper"});
  assert.ok(localized.get(cellAt([-139,1],grid))?.has(dsKey),"the actual metadata coordinate still contributes locally");
  assert.ok(!localized.get(cellAt([-150,0],grid))?.has(dsKey));
});

test("envelope classification does not hide an explicit geometry or an actually read scene",()=>{
  const area=box(121,31,122,32),base=fixture(area).asset;
  const envelope:Asset={...base,profile:{...base.profile!,area,areaBasis:"bounding-box"}};
  const precise:Asset={...base,profile:{...base.profile!,area,areaBasis:"geometry"}};
  assert.equal(backgroundCoverageProduct(envelope),true);
  assert.equal(backgroundCoverageProduct(precise),false,"sharing coordinates does not share provenance");
  assert.equal(coverageScope([{area,asset:envelope}]).geometries.length,0);
  assert.equal(coverageScope([{area,asset:precise}]).geometries.length,1);
  assert.equal(coverageScope([{area,asset:envelope,scene:"real-scene",date:"2025-01-01"}]).geometries.length,1);
});

test("rectangle acceleration preserves spherical boundary intersections and rejects arbitrary bbox envelopes",()=>{
  const areas=[rectangle(15,45,30,60),rectangle(15,-60,30,-45),rectangle(-5,-2,5,2)];
  for(const area of areas)for(const system of ["h3","s2"] as const) {
    const grid=gridSpec(system,4),[w,s,e,n]=area.bbox!;
    for(const x of [w-.1,w+.1,(w+e)/2,e-.1,e+.1])for(const y of [s-.1,s+.001,(s+n)/2,n-.001,n+.1]) {
      const cell=cellShape(cellAt([x,y],grid),grid);
      assert.equal(regionHit(area,cell.id,cell.geometry),footprintInCell(area,cell.geometry));
    }
  }
  const arbitrary:Area={type:"MultiPolygon",coordinates:[[[[0,0],[0,5],[5,0],[0,0]]]],bbox:[0,0,5,5]};
  assert.equal(rectangleContainsVertex(arbitrary,[[4,4]]),false,"a general polygon's bbox is not proof of coverage");
});

test("separate spatial components do not schedule intersections for the empty gap between them",async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),"oneearth-coverage-parts-"));
  const index=coverageIndex(path.join(directory,"coverage.sqlite"));
  try {
    const left=box(-81,30,-80,31),right=box(80,30,81,31);
    const area:Area={type:"MultiPolygon",coordinates:[left.coordinates,right.coordinates] as GeoJSON.MultiPolygon["coordinates"]};
    const scope=coverageScope([fixture(area)]),grid=gridSpec("h3",4);
    const gap=cellAt([0,30.5],grid),inside=cellAt([80.5,30.5],grid);
    const empty=await index.read(grid,[gap],scope.geometries);
    assert.equal(empty.pending,0);assert.equal(empty.computed,0);
    assert.deepEqual(empty.hits,[[gap,[]]]);
    const found=await ready(index,grid,[inside],scope.geometries);
    assert.equal(coverageCounter(scope.products)(found.hits[0][1]),1);
  } finally {await index.close();await rm(directory,{recursive:true,force:true});}
});
