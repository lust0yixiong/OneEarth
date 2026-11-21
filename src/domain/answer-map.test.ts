import test from "node:test";
import assert from "node:assert/strict";
import {geoDistance} from "d3-geo";
import {answerEvidence,answerFilters,answerMapBatch,evidenceSelection,geometryCamera,gridCamera,evidenceCamera,initialAnswerCamera,evidenceAction,coverageTimeNote} from "./answer-map";
import {flightCamera} from "./camera-flight";
import {assetById,registerPapers} from "./datasets";
import {emptyFilters,cellAt,gridSpec,cellShape} from "./spatial";
import {visualizationEntities} from "./entity-visualization";
import {snapshotResult,validResultSnapshot} from "./result-snapshot";
import {catalogGrid,selectedDistribution} from "./results";
import type {CandidateSet,Message} from "./types";
import type {PaperRecord} from "./paper-record";
const batch=(ids:string[]):CandidateSet=>({title:"研究资料",ids,caseId:null,filters:emptyFilters(),selection:null,gridSystem:"h3",layer:"all",camera:{center:[105,25],zoom:1,reason:"原视角"}});

test("answer conditions retain the request scope and explicit clearing independently of catalogue coverage",()=>{
  const request={...emptyFilters(),period:[2020,2023] as [number,number],place:"长江中下游"};
  const response={...structuredClone(request),utcWindow:[Date.UTC(2020,0,1),Date.UTC(2024,0,1)] as [number,number]};
  const filters=answerFilters(request,response);
  assert.deepEqual(filters,response);
  const message={id:"scope-answer",role:"assistant",text:"候选覆盖1998–2023不改变研究时段",time:1,candidates:{...batch([]),filters}} satisfies Message;
  request.period[0]=1998;
  assert.deepEqual(answerMapBatch(message)?.filters.period,[2020,2023],"saved answers must not share mutable request filter arrays");
  assert.deepEqual(answerFilters(response).period,[2020,2023],"retry without new filters retains the original attempt scope");
  assert.equal(answerFilters(response,{...response,period:null,utcWindow:null}).period,null);
  assert.equal(answerFilters(response,{...response,period:null,utcWindow:null}).utcWindow,null);
  assert.equal(answerFilters(response,{...response,source:""}).source,"");
});

test("official points remain viewable without becoming observations in an unverified or outside time window",()=>{
  const record:PaperRecord={id:"earthnano:"+"9".repeat(64),dsKey:"official-point",papers:1,paperTitle:"Swiss method reference",studyContext:"2015 is paper context only",points:[[7.7551,46.9115]],need:{name:"data",product:"Aeschau",type:"test",source:"EarthNano 论文断言库",status:"used",detail:"official point",datasetId:"official-point",profile:{role:"data",spatial:"coverage",coverage:"official point",access:"public",limitation:"observation time unverified"},tabs:[{kind:"table",label:"论文用法（本页）",rows:[["paper","use","variables","context","paper-id","D1"]]}]}};
  let b=batch([record.id]);b.filters.period=[2020,2023];
  for(const years of [undefined,[2015,2015] as [number,number]]){
    record.id="earthnano:"+(years?"8":"9").repeat(64);
    registerPapers([{...record,need:{...record.need,profile:{...record.need.profile!,years}}}]);
    b={...b,ids:[record.id]};
    const e=answerEvidence(b).get(record.id)!;
    assert.equal(e.kind,"range");assert.equal(e.coverageTime,years?"outside":"unverified");
    assert.deepEqual(e.coverageGeometries,[{type:"Point",coordinates:[7.7551,46.9115]}]);
    assert.deepEqual(e.geometries,[]);assert.equal(evidenceSelection(b,record.id,"h3"),null);
    const camera=evidenceCamera(b,record.id,"h3")!;
    assert.ok(camera);assert.ok(Math.abs(camera.center[0]-7.7551)<1e-6);assert.ok(Math.abs(camera.center[1]-46.9115)<1e-6);
    assert.ok(initialAnswerCamera(b));assert.equal(evidenceAction(e),"查看官方空间范围");
    assert.equal(catalogGrid(gridSpec("h3",2),b.filters,b).size,0);assert.equal(selectedDistribution(b).total,0);
  }
  const exact={...b,filters:{...b.filters,period:null,utcWindow:[Date.UTC(2020,0,1),Date.UTC(2024,0,1)] as [number,number]}};
  assert.equal(answerEvidence(exact).get(record.id)?.coverageTime,"unverified");
  for(const spatial of ["nonspatial","restricted"] as const){
    record.id="earthnano:"+(spatial==="nonspatial"?"7":"6").repeat(64);
    registerPapers([{...record,need:{...record.need,profile:{...record.need.profile!,spatial}}}]);
    b={...b,ids:[record.id]};
    assert.equal(answerEvidence(b).get(record.id)?.kind,"unlocated");assert.equal(evidenceCamera(b,record.id,"h3"),null);
  }
  record.id="earthnano:"+"5".repeat(64);
  registerPapers([{...record,points:[]}]);b={...b,ids:[record.id]};
  assert.equal(answerEvidence(b).get(record.id)?.kind,"unlocated","paper context alone never supplies a point");
});

test("answer maps separate measured locations, global coverage and metadata envelopes",()=>{
  const record:PaperRecord={id:"earthnano:"+"e".repeat(64),dsKey:"test-envelope",papers:1,paperTitle:"研究问题",studyContext:"中国",points:[],need:{name:"元数据",product:"边界框资料",type:"test",source:"EarthNano 论文断言库",status:"有论文用法记录",detail:"范围",datasetId:"test-envelope",profile:{role:"data",spatial:"coverage",coverage:"元数据边界框",areaBasis:"bounding-box",area:{type:"Polygon",coordinates:[[[100,20],[100,40],[120,40],[120,20],[100,20]]]},access:"目录",limitation:"非数据像元"},tabs:[{kind:"table",label:"论文用法（本页）",rows:[["","","","","论文","研究问题"]]}]}};
  registerPapers([record]);
  const locations=answerEvidence(batch(["Q02-0","wind-0",record.id,"Q14-7"]));
  assert.equal(locations.get("Q02-0")?.kind,"local");
  assert.equal(locations.get("wind-0")?.kind,"global");assert.equal(locations.get("wind-0")?.geometries.length,0);
  assert.equal(locations.get(record.id)?.kind,"range");assert.equal(locations.get(record.id)?.geometries.length,0);
  assert.equal(locations.get(record.id)?.coverageGeometries?.length,1,"range outlines are separate from actual data locations");
  const target=evidenceCamera(batch([record.id]),record.id,"h3")!;
  assert.ok(target.zoom>1);assert.ok(target.center[0]>=100 && target.center[0]<=120);
  assert.ok(initialAnswerCamera(batch([record.id])),"coverage-only answers still have a flyto target");
  assert.equal(locations.get("Q14-7")?.kind,"unlocated");
  assert.equal(evidenceSelection(batch([record.id]),record.id,"h3"),null);
});

test("grid flights fit original H3 and S2 cells while display level can adapt",()=>{
  for(const system of ["h3","s2"] as const)for(const band of [2,4,7])for(const point of [[179,70],[-120,-30]] as [number,number][]) {
    const grid=gridSpec(system,band),selection={grid,id:cellAt(point,grid),point};
    const camera=gridCamera(selection),shape=cellShape(selection.id,grid);
    assert.ok(camera.zoom>=1 && camera.zoom<=2200);
    assert.deepEqual(camera.center,shape.center);
    for(const vertex of shape.geometry.coordinates[0])assert.ok(Math.sin(geoDistance(camera.center,vertex))*camera.zoom<=.581);
  }
  const evidence=evidenceSelection(batch(["Q02-0"]),"Q02-0","s2")!;
  assert.equal(evidence.grid.system,"s2");assert.ok(evidence.grid.n>5);
});

test("great-circle flights cross the date line without longitude detours",()=>{
  const from={center:[179,20] as [number,number],zoom:1,reason:"start"},to={center:[-179,20] as [number,number],zoom:100,reason:"target"};
  const mid=flightCamera(from,to,.5);
  assert.ok(Math.abs(mid.center[0])>179);assert.ok(Math.abs(mid.zoom-10)<.00001);
  assert.deepEqual(flightCamera(from,to,1),to);
  const camera=geometryCamera([{type:"Point",coordinates:[179,20]},{type:"Point",coordinates:[-179,20]}],"date line")!;
  assert.ok(Math.abs(camera.center[0])>=179);assert.ok(camera.zoom>10);
});

test("historical answer mapping retains the answer's filters, selection and identities",()=>{
  const original=batch(["Q02-0"]);original.filters.period=[2011,2014];
  original.selection={grid:gridSpec("h3",2),id:cellAt([10,46],gridSpec("h3",2)),point:[10,46]};
  const message={id:"answer-1",role:"assistant",text:"回答",time:1,candidates:original} satisfies Message;
  const mapped=answerMapBatch(message)!;
  assert.equal(mapped.answerId,message.id);assert.deepEqual(mapped.filters,original.filters);assert.equal(mapped.selection,original.selection);
  assert.equal(original.answerId,undefined);
  const scope={caseId:mapped.caseId,filters:mapped.filters,selection:mapped.selection,gridSystem:mapped.gridSystem,layer:mapped.layer,camera:mapped.camera};
  const snapshot=snapshotResult("earth",mapped,scope,{query:"",type:"",source:"",savedOnly:false,kind:"all",result:mapped,compare:[]},[]);
  assert.ok(validResultSnapshot(snapshot),"answer association survives shared result validation");
  assert.equal(validResultSnapshot({...snapshot,batch:{...mapped,answerId:123}}),false);
});

test("entity visualization requires file evidence rather than a format word or paper link",()=>{
  const dem=assetById.get("Q02-0")!;
  assert.equal(visualizationEntities(dem).length,2);
  assert.ok(visualizationEntities(dem).every(e=>e.format==="GeoTIFF"));
  const noFile={...dem,dataEntities:undefined,url:"https://example.org/paper",tabs:[{kind:"text" as const,label:"TIFF / Shape",body:"Future GeoTIFF"}]};
  assert.equal(visualizationEntities(noFile).length,0);
  const shape={...noFile,url:"https://example.org/boundary.shp?version=1"};
  assert.equal(visualizationEntities(shape)[0].format,"Shapefile");
  const unsafe={...noFile,url:"javascript:dataset.tif"};assert.equal(visualizationEntities(unsafe).length,0);
});


test("verified catalogue lookup points follow their acquisition window",()=>{
  const b=batch(["Q02-1"]);
  b.lookups=[{assetId:"Q02-1",point:[10,46],matched:1,years:[2020,2020],url:"https://earth-search.aws.element84.com/v1/search",checkedAt:"2026-01-01T00:00:00Z",items:[{id:"real-scene",datetime:"2020-05-01T00:00:00Z",cloud:0,url:"https://earth-search.aws.element84.com/v1/collections/test/items/real-scene"}]}];
  assert.equal(answerEvidence(b).get("Q02-1")?.kind,"local");
  assert.notEqual(answerEvidence({...b,filters:{...b.filters,period:[2023,2023]}}).get("Q02-1")?.kind,"local");
});


test("global answers offer a world flight without fabricating a local grid",()=>{
  const b=batch(["wind-0"]);b.camera={center:[130,40],zoom:100,reason:"local view"};
  const camera=evidenceCamera(b,"wind-0","h3")!;
  assert.equal(camera.zoom,1);assert.deepEqual(camera.center,b.camera.center);
  assert.equal(evidenceSelection(b,"wind-0","h3"),null);
  assert.equal(initialAnswerCamera(b)?.zoom,1);
});

test("cited official coverage stays inspectable when the requested years are unverified or outside coverage",()=>{
  const make=(hex:string,extent:boolean,years?:[number,number]):PaperRecord=>({id:"earthnano:"+hex.repeat(64),dsKey:"F03-"+hex,papers:1,paperTitle:"paper",studyContext:"Mesozoic is not a footprint",points:[],need:{name:"data",product:"official extent",type:"test",source:"EarthNano 论文断言库",status:"used",detail:"metadata",datasetId:"F03-"+hex,profile:{role:"data",spatial:"coverage",coverage:"official metadata",areaBasis:"bounding-box",...(extent?{extent:"world" as const}:{area:{type:"Polygon" as const,coordinates:[[[100,20],[100,40],[120,40],[120,20],[100,20]]]}}),...(years?{years}:{}),access:"public",limitation:"not observed cells"},tabs:[{kind:"table",label:"论文用法（本页）",rows:[["paper","use","variables","context","paper-id","D1"]]}]}});
  const world=make("a",true),range=make("b",false),old=make("c",true,[1990,2000]);
  registerPapers([world,range,old]);
  const b=batch([world.id,range.id,old.id]);b.filters.period=[2020,2023];
  const original=structuredClone(b),mapped=answerEvidence(b);
  assert.equal(mapped.get(world.id)?.kind,"global");assert.equal(mapped.get(world.id)?.coverageTime,"unverified");
  assert.equal(mapped.get(range.id)?.kind,"range");assert.equal(mapped.get(range.id)?.coverageGeometries?.length,1);
  assert.equal(mapped.get(old.id)?.kind,"global");assert.equal(mapped.get(old.id)?.coverageTime,"outside");
  for(const id of b.ids){
    assert.deepEqual(mapped.get(id)?.geometries,[],"temporal fallback must never create observed points or filled cells");
    assert.equal(evidenceSelection(b,id,"h3"),null);assert.ok(evidenceCamera(b,id,"h3"));
  }
  assert.deepEqual(b,original,"neither filters nor the saved answer are relaxed");
  assert.equal(catalogGrid(gridSpec("h3",2),b.filters,b).size,0,"official outlines must not color intersected cells");
  assert.equal(selectedDistribution(b).total,0,"unknown/outside-time outlines must not count as matching observations");
  assert.match(coverageTimeNote(mapped.get(world.id))!,/时段未核/);
  assert.match(coverageTimeNote(mapped.get(old.id))!,/不匹配/);
  assert.match(coverageTimeNote(mapped.get(old.id))!,/不代表当前时段有观测/);
  assert.equal(evidenceAction(mapped.get(range.id)),"查看官方空间范围");
  assert.equal(evidenceAction(mapped.get(world.id)),"查看官方全球范围");
  assert.equal(answerEvidence({...b,layer:"joint"}).get(range.id)?.kind,"unlocated");
  assert.equal(answerEvidence({...b,filters:{...b.filters,depth:[0,1]}}).get(world.id)?.kind,"unlocated");
  const contextOnly=make("d",false);contextOnly.need.profile={...contextOnly.need.profile!,area:undefined};
  registerPapers([contextOnly]);assert.equal(answerEvidence({...b,ids:[contextOnly.id]}).get(contextOnly.id)?.kind,"unlocated","paper study context must not become a footprint");
});

test("Haina catalogue dates do not exclude historical observations from answer maps", async()=>{
  const {hainaNeed}=await import("./haina");
  const {registerHaina}=await import("./datasets");
  const record={id:1844702,name:"Sentinel-2 Cloud-Optimized GeoTIFFs",description:"L2A data available since 2017",
    provider:"Element 84",source:"Element 84",version:"",license:"",access:"Public",labels:[],card:{tags:[]}};
  const need=hainaNeed(record,"2026-11-14");
  assert.equal(need.profile?.years,undefined);
  assert.deepEqual(need.profile?.catalogYears,[2025,2025]);
  registerHaina([record],"2026-11-14","https://cn.zero2x.org",false);
  const b=batch(["haina:1844702"]);b.filters.period=[2018,2023];
  const mapped=answerEvidence(b).get(b.ids[0])!;
  assert.equal(mapped.coverageTime,"unverified");
  assert.equal(mapped.kind,"range");
  assert.ok(evidenceCamera(b,b.ids[0],"h3"));
});
