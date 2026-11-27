import assert from "node:assert/strict";
import {test} from "node:test";
import type {AddressInfo} from "node:net";
import express, {type RequestHandler} from "express";
import {dayMs, parseEarthquakeDay, type EarthquakeDay} from "../src/domain/earthquakes";
import type {StationSnapshot} from "../src/domain/weather-stations";
import {readCaseObservation} from "../src/domain/case-observations";
import {createEarthquakeDay} from "./earthquakes";
import {createWeatherStations, parseStations} from "./weather-stations";
import {publishEarthquakeSnapshot, publishMetarSnapshot, resolveCaseObservation} from "./case-observations";

const minute=60_000;
const quakeId="usfixture01";
type EarthquakeEnvelope = EarthquakeDay & {stale:boolean; snapshotId?:string};
type QuakeSource = Parameters<typeof parseEarthquakeDay>[0];

async function atSameOrigin<T>(
  handler:RequestHandler, path:string,
  run:(get:()=>Promise<{status:number;body:T;cache:string|null}>)=>Promise<void>,
) {
  const app=express();
  app.get(path,handler);
  const server=app.listen(0,"127.0.0.1");
  await new Promise<void>((ok,fail)=>server.once("listening",ok).once("error",fail));
  try {
    const origin="http://127.0.0.1:"+(server.address() as AddressInfo).port;
    await run(async()=>{
      const res=await fetch(origin+path);
      return {status:res.status,body:await res.json() as T,cache:res.headers.get("cache-control")};
    });
  } finally {
    await new Promise<void>((ok,fail)=>server.close(error=>error?fail(error):ok()));
  }
}

function quake(generated:number,time:number,mag:number|null=3.2):QuakeSource {
  return {metadata:{generated},features:[{
    id:quakeId,geometry:{type:"Point",coordinates:[120,30,null]},
    properties:{type:"earthquake",status:"reviewed",place:"fixture",time,mag,
      url:"https://untrusted.example/not-the-archive-url",updated:generated},
  }]};
}
const metarCsv=(age:number,now:number,temperature:string)=>{
  const utc=(time:number)=>new Date(time).toISOString();
  return "station_id,observation_time,latitude,longitude,temp_c,wind_speed_kt,wx_string\n"
    + "KJFK,"+utc(now-5*minute)+",40.64,-73.78,"+temperature+",0,TSRA\n"
    + "KBOS,"+utc(now-age)+",42.37,-71.03,,,\n"
    + "KDCA,"+utc(now-121*minute)+",38.85,-77.04,18,4,RA\n";
};

test("USGS same-origin GET keeps a frozen 24 h replay and distinguishes corrections at the same event UTC",async()=>{
  let now=Date.UTC(2026,0,1,12),calls=0;
  const time=now-dayMs+10*minute;
  let source:QuakeSource|undefined=quake(now,time);
  const route=createEarthquakeDay({now:()=>now,fetchFeed:async()=>{
    calls++;
    if(!source)throw Error("controlled upstream failure");
    return source;
  }});
  await atSameOrigin<EarthquakeEnvelope>(route,"/api/earthquakes/day",async get=>{
    const first=await get();
    assert.equal(first.status,200);assert.equal(first.cache,"no-store");
    assert.equal(first.body.stale,false);
    assert.equal(first.body.events[0].time,time);
    assert.ok(first.body.snapshotId);
    assert.equal((await get()).body.snapshotId,first.body.snapshotId);
    assert.equal(calls,1,"one upstream call for the still-fresh cache");
    const original={kind:"usgs-earthquake",id:quakeId,observedAt:time,snapshotId:first.body.snapshotId};
    const published=resolveCaseObservation(original,now);
    assert.deepEqual(published,{...original,point:[120,30],place:"fixture",magnitude:3.2,depthKm:null,
      sourceUrl:"https://earthquake.usgs.gov/earthquakes/eventpage/"+quakeId});
    published!.point[0]=99;
    assert.deepEqual(resolveCaseObservation(original,now)?.point,[120,30]);
    assert.equal(resolveCaseObservation({...original,observedAt:time+1},now),undefined);
    assert.equal(resolveCaseObservation({...original,place:"browser substitute"},now),undefined);
    assert.equal(resolveCaseObservation({...original,sourceUrl:"https://client.example"},now),undefined);
    assert.equal(resolveCaseObservation({...original,kind:"awc-metar",id:"KJFK"},now),undefined);

    now+=31_000;source=quake(now,time,4.6);
    const corrected=await get();
    assert.ok(corrected.body.snapshotId);
    assert.notEqual(corrected.body.snapshotId,original.snapshotId);
    assert.equal(corrected.body.events[0].time,time);
    assert.equal(resolveCaseObservation({...original,snapshotId:corrected.body.snapshotId},now)?.kind,"usgs-earthquake");
    assert.deepEqual(resolveCaseObservation(original,now),{...published,point:[120,30]});
    const newest=resolveCaseObservation({...original,snapshotId:corrected.body.snapshotId},now);
    assert.equal(newest?.kind==="usgs-earthquake"?newest.magnitude:null,4.6);

    now+=31_000;source=undefined;
    const stale=await get();
    assert.equal(stale.status,200);assert.equal(stale.body.stale,true);
    assert.equal(Object.hasOwn(stale.body,"snapshotId"),false);
    assert.equal(stale.body.events[0].mag,4.6);
    assert.ok(resolveCaseObservation(original,now),"a previous fresh publication still binds its frozen replay");
    now+=30*minute;
    assert.equal(resolveCaseObservation(original,now),undefined);
    assert.equal(readCaseObservation(newest)?.observedAt,time,"the saved copy keeps its original UTC after the live token expires");
  });
});

test("USGS upstream error and a successful but old upstream generation publish no snapshot ID",async()=>{
  const now=Date.UTC(2026,0,2,12);
  const stale=createEarthquakeDay({now:()=>now,fetchFeed:async()=>quake(now-6*minute,now-7*minute)});
  await atSameOrigin<EarthquakeEnvelope>(stale,"/api/earthquakes/day",async get=>{
    const r=await get();assert.equal(r.status,200);assert.equal(r.body.stale,true);
    assert.equal(Object.hasOwn(r.body,"snapshotId"),false);
  });
  const missing=createEarthquakeDay({now:()=>now,fetchFeed:async()=>{throw Error("controlled");}});
  await atSameOrigin<{error:string}>(missing,"/api/earthquakes/day",async get=>{
    const r=await get();assert.equal(r.status,503);assert.equal(Object.hasOwn(r.body,"snapshotId"),false);
  });
});

test("AWC METAR validates each station UTC, retains missing values and versions corrected observations",async()=>{
  let now=Date.UTC(2026,0,3,12);
  const captured=now;
  let calls=0,temperature="19.25";
  const route=createWeatherStations({now:()=>now,loadSnapshot:async()=>{
    calls++;
    return parseStations(metarCsv(120*minute-1000,captured,temperature),new Map([["KJFK","New York – JFK"]]));
  }});
  await atSameOrigin<StationSnapshot>(route,"/api/weather/stations",async get=>{
    const first=await get();assert.equal(first.status,200);assert.equal(first.cache,"no-cache");
    assert.ok(first.body.snapshotId);
    const ref=(id:string)=>({kind:"awc-metar",snapshotId:first.body.snapshotId,
      observedAt:first.body.stations.find(row=>row.id===id)!.observed,id});
    const origin=ref("KJFK"),old=resolveCaseObservation(origin,now);
    assert.deepEqual(old,{...origin,point:[-73.78,40.64],stationName:"New York – JFK",weather:"TSRA",
      temperatureC:19.25,windKnots:0,storm:true,sourceUrl:"https://aviationweather.gov/api/data/metar?ids=KJFK&format=json"});
    const missing=resolveCaseObservation(ref("KBOS"),now);
    assert.equal(missing?.kind==="awc-metar"?missing.temperatureC:false,null);
    assert.equal(missing?.kind==="awc-metar"?missing.windKnots:false,null);
    assert.equal(missing?.kind==="awc-metar"?missing.weather:false,"");
    assert.equal(resolveCaseObservation(ref("KDCA"),now),undefined,"the recent station elsewhere cannot make this row fresh");
    assert.equal(resolveCaseObservation(ref("KBOS"),now+1001),undefined,"freshness is checked again when the user submits");
    assert.equal((await get()).body.snapshotId,first.body.snapshotId);
    assert.equal(calls,1);

    now+=56_000;temperature="21";
    const revised=await get();
    assert.ok(revised.body.snapshotId);
    assert.notEqual(revised.body.snapshotId,first.body.snapshotId);
    assert.equal(revised.body.stations[0].observed,origin.observedAt);
    const correction=resolveCaseObservation({...origin,snapshotId:revised.body.snapshotId},now);
    assert.equal(correction?.kind==="awc-metar"?correction.temperatureC:false,21);
    assert.deepEqual(resolveCaseObservation(origin,now),old);
    assert.equal(resolveCaseObservation({...origin,windKnots:200},now),undefined);
    assert.equal(resolveCaseObservation(origin,now+20*minute),undefined);
  });
});

test("no recent METAR rows means no published snapshot; capacity evicts the oldest intact generation",async()=>{
  const now=Date.UTC(2026,0,4,12);
  const data=parseStations(metarCsv(121*minute,now-121*minute,"5"),new Map());
  const route=createWeatherStations({now:()=>now,loadSnapshot:async()=>data});
  await atSameOrigin<StationSnapshot>(route,"/api/weather/stations",async get=>{
    const r=await get();assert.equal(r.status,200);assert.equal(Object.hasOwn(r.body,"snapshotId"),false);
  });
  const recent=parseStations(metarCsv(5*minute,now,"5"),new Map());
  const weatherTokens=Array.from({length:9},(_,index)=>publishMetarSnapshot(recent,now+index));
  const windRef={kind:"awc-metar",id:"KJFK",observedAt:now-5*minute};
  assert.ok(weatherTokens.every(Boolean));
  assert.equal(resolveCaseObservation({...windRef,snapshotId:weatherTokens[0]},now+8),undefined);
  assert.ok(resolveCaseObservation({...windRef,snapshotId:weatherTokens[1]},now+8));
  assert.ok(resolveCaseObservation({...windRef,snapshotId:weatherTokens[8]},now+8));

  const instant=now-10*minute;
  const quakeTokens=Array.from({length:25},(_,index)=>
    publishEarthquakeSnapshot(parseEarthquakeDay(quake(now+index,instant)),now+index));
  const quakeRef={kind:"usgs-earthquake",id:quakeId,observedAt:instant};
  assert.ok(quakeTokens.every(Boolean));
  assert.equal(resolveCaseObservation({...quakeRef,snapshotId:quakeTokens[0]},now+24),undefined);
  assert.ok(resolveCaseObservation({...quakeRef,snapshotId:quakeTokens[1]},now+24));
  assert.ok(resolveCaseObservation({...quakeRef,snapshotId:quakeTokens[24]},now+24));
});
