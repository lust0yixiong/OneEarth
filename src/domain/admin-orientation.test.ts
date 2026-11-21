import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {mkdtemp,rm,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import type {Feature,FeatureCollection,Polygon} from "geojson";
import {administrativeIndex,administrativeLocations,administrativeOrientation} from "../../server/admin-orientation";
import {administrativeLabel,administrativeLevel} from "./admin-orientation";
import {geoCountry} from "../data/evidence/geo-orientation.mjs";

const feature=(name:string,id:string,rings:number[][][],level="ADM1"):Feature<Polygon>=>({type:"Feature",properties:{shapeName:name,shapeID:id,shapeGroup:"VNM",shapeType:level},geometry:{type:"Polygon",coordinates:rings}});
const square=(x:number,y:number,size:number)=>[[x,y],[x+size,y],[x+size,y+size],[x,y+size],[x,y]];
const collection=(...features:Feature[]):FeatureCollection=>({type:"FeatureCollection",features});
const meta=(level:number)=>({boundaryID:`VNM-ADM${level}-1234`,boundaryISO:"VNM",boundaryType:`ADM${level}`,boundaryYearRepresented:"2020",boundaryCanonical:level===1?"Province":"District",boundarySource:"Reviewed source",boundaryLicense:"CC BY 4.0",simplifiedGeometryGeoJSON:`https://example.test/VNM/ADM${level}.geojson`});
const scopePoint:[number,number]=[103.98,22.25];
const payload=(level:number)=>collection(feature(level===1?"Province A":"District A",`id-${level}`,[square(103,22,2)],`ADM${level}`));

test("view orientation scales from country to every supported administrative tier without fabricating missing tiers",()=>{
  assert.deepEqual([1,8,32,120,400,1200,2200].map(administrativeLevel),[0,1,2,3,4,5,5]);
  const areas=[1,3,5].map(level=>({level,name:"Area "+level,id:String(level),year:"2020",kind:"Local subdivision",source:"source",url:"https://example.test/",license:"CC BY"}));
  assert.equal(administrativeLabel("Country",areas,0),"Country");
  assert.equal(administrativeLabel("Country",areas,3),"Country · Area 1 · Area 3");
  assert.equal(administrativeLabel("Country",[...areas,areas[2]],5),"Country · Area 1 · Area 3 · Area 5");
  assert.equal(geoCountry([103.98,22.25])?.id,"704");
  assert.equal(geoCountry([-175,15]),null);
  assert.equal(geoCountry([0,100]),null);
});
test("administrative membership uses polygons, handles holes and the dateline, and never chooses nearest land",()=>{
  const at=administrativeIndex(collection(feature("Ring","ring",[square(0,0,10),[...square(4,4,2)].reverse()]),feature("Dateline","date",[[[170,-10],[-170,-10],[-170,10],[170,10],[170,-10]]])));
  assert.equal(at([2,2])[0].name,"Ring");assert.deepEqual(at([5,5]),[]);assert.deepEqual(at([11,5]),[]);
  assert.equal(at([179,0])[0].name,"Dateline");assert.equal(at([-179,0])[0].name,"Dateline");assert.deepEqual(at([0,-5]),[]);
  assert.throws(()=>administrativeIndex(collection()),/格式/);
  assert.throws(()=>administrativeIndex(payload(1),{iso:"CHN",level:"ADM1"}),/身份/);
  const unknown=feature("","unknown",[square(20,20,1)]);unknown.properties!.shapeName=null;
  const mixed=administrativeIndex(collection(unknown,feature("Named","named",[square(22,20,1)])));
  assert.equal(mixed([20.5,20.5])[0].name,null);assert.equal(mixed([22.5,20.5])[0].name,"Named");
});
test("compact source topology retains its real URL and yields the same containing administration",async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),"oneearth-admin-topology-")),source={...meta(1),tjDownloadURL:'https://example.test/VNM/ADM1.topojson'};
  const shape=feature('Province A','id-1',[square(103,22,2)]);
  const topology={type:'Topology',transform:{scale:[1,1],translate:[0,0]},arcs:[[[103,22],[2,0],[0,2],[-2,0],[0,-2]]],objects:{boundary:{type:'GeometryCollection',geometries:[{type:'Polygon',arcs:[[0]],properties:shape.properties}]}}};
  const urls:string[]=[];
  try{
    const service=administrativeLocations(directory,{baseUrl:'https://example.test/',fetchImpl:async input=>{const url=String(input);urls.push(url);return Response.json(url.includes('/ALL/')?[source]:topology);}});
    const result=await service.locate('704',scopePoint,3,new AbortController().signal);
    assert.equal(result.areas[0].name,'Province A');assert.equal(result.areas[0].url,source.tjDownloadURL);assert.equal(urls[1],source.tjDownloadURL);
  }finally{await rm(directory,{recursive:true,force:true});}
});
test("simultaneous lookups share downloads and indexes; verified source files survive restart with no external requests",async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),"oneearth-admin-"));let requests=0;
  const fetchImpl:typeof fetch=async input=>{requests++;const url=String(input);return Response.json(url.includes('/ALL/')?[meta(1),meta(2)]:payload(url.includes('ADM1')?1:2));};
  try{
    const service=administrativeLocations(directory,{baseUrl:"https://example.test/",fetchImpl}),signal=new AbortController().signal;
    const results=await Promise.all([1,2,3].map(()=>service.locate("704",scopePoint,5,signal)));
    assert.equal(requests,3);assert.deepEqual(results[0].availableLevels,[1,2]);assert.equal(results[0].areas.length,2);assert.equal(results[0].partial,false);
    assert.equal(results[0].areas[1].year,"2020");assert.equal(results[0].areas[1].source,"Reviewed source");
    const restarted=administrativeLocations(directory,{baseUrl:"https://example.test/",fetchImpl:async()=>{throw Error('offline');}});
    assert.deepEqual(await restarted.locate("704",scopePoint,5,signal),results[0]);
    assert.deepEqual((await service.locate("704",[107,22.5],5,signal)).areas,[],'no nearby or cached neighbour may be substituted');
  }finally{await rm(directory,{recursive:true,force:true});}
});
test("missing layers, overlapping boundaries and failed files retain only confirmed administrative names",async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),"oneearth-admin-partial-"));
  const fetchImpl:typeof fetch=async input=>{
    const url=String(input);if(url.includes('/ALL/'))return Response.json([meta(1),meta(2),meta(3)]);
    if(url.includes('ADM3'))return new Response('Unavailable',{status:503});
    if(url.includes('ADM2'))return Response.json(collection(feature('East','e',[square(103,22,2)],'ADM2'),feature('West','w',[square(103,22,2)],'ADM2')));
    return Response.json(payload(1));
  };
  try{
    const result=await administrativeLocations(directory,{baseUrl:"https://example.test/",fetchImpl}).locate("704",scopePoint,5,new AbortController().signal);
    assert.deepEqual(result.areas.map(a=>a.name),['Province A']);assert.equal(result.partial,true);assert.deepEqual(result.availableLevels,[1,2,3]);
  }finally{await rm(directory,{recursive:true,force:true});}
});
test("malformed metadata cannot become a successful empty location; corrupt cached geometry is replaced",async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),"oneearth-admin-invalid-"));
  try{
    const bad=administrativeLocations(directory,{baseUrl:"https://example.test/",fetchImpl:async()=>Response.json({error:'upstream failure'})});
    await assert.rejects(bad.locate('704',scopePoint,2,new AbortController().signal),/格式/);
    await writeFile(path.join(directory,'VNM-ADM1-1234.geojson'),'{"error":"not geometry"}');
    const good=administrativeLocations(directory,{baseUrl:"https://example.test/",fetchImpl:async input=>Response.json(String(input).includes('/ALL/')?[meta(1)]:payload(1))});
    assert.equal((await good.locate('704',scopePoint,2,new AbortController().signal)).areas[0].name,'Province A');
  }finally{await rm(directory,{recursive:true,force:true});}
});
test("orientation HTTP validates coordinates and source identity before any download",async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),"oneearth-admin-http-"));let calls=0;
  const app=express();app.use('/orientation',administrativeOrientation(directory,{baseUrl:'https://example.test/',fetchImpl:async input=>{calls++;return Response.json(String(input).includes('/ALL/')?[meta(1)]:payload(1));}}));
  const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+(server.address() as {port:number}).port;
  try{
    for(const suffix of ['country=xyz&lon=103&lat=22&level=2','country=704&lon=181&lat=22&level=2','country=704&lon=103&lat=91&level=2','country=704&lon=103&lat=22&level=6'])assert.equal((await fetch(base+'/orientation?'+suffix)).status,400);
    assert.equal(calls,0);
    const response=await fetch(base+'/orientation?country=704&lon=103.98&lat=22.25&level=5');assert.equal(response.status,200);const result=await response.json();
    assert.equal(result.areas[0].name,'Province A');assert.deepEqual(result.point,scopePoint);
  }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(directory,{recursive:true,force:true});}
});
