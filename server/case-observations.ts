import {randomUUID} from "node:crypto";
import {caseObservationUrl, readCaseObservation, readCaseObservationRef,
  type CaseObservation, type CaseObservationKind} from "../src/domain/case-observations";
import {dayMs, type EarthquakeDay} from "../src/domain/earthquakes";
import type {StationSnapshot} from "../src/domain/weather-stations";

const minute=60_000;
const metarMaxAge=120*minute;
const usgsMaxFeedAge=5*minute;

type Snapshot = {
  publishedAt: number;
  expiresAt: number;
  latestObservation: number;
  observations: Map<string, CaseObservation>;
};
const policy = {
  "usgs-earthquake": {age:30*minute, capacity:24, maxRows:5000},
  "awc-metar": {age:20*minute, capacity:8, maxRows:12000},
};
const snapshots: Record<CaseObservationKind, Map<string, Snapshot>> = {
  "usgs-earthquake": new Map(),
  "awc-metar": new Map(),
};

function expire(kind:CaseObservationKind,now:number) {
  const entries=snapshots[kind];
  for(const [id,snapshot] of entries) {
    if(now>=snapshot.expiresAt)entries.delete(id);
  }
  return entries;
}

function register(kind:CaseObservationKind,snapshotId:string,rows:CaseObservation[],now:number) {
  if(!rows.length)return;
  const config=policy[kind],entries=expire(kind,now);
  while(entries.size>=config.capacity)entries.delete(entries.keys().next().value!);
  entries.set(snapshotId,{publishedAt:now,expiresAt:now+config.age,
    latestObservation:rows.reduce((latest,row)=>Math.max(latest,row.observedAt),0),
    observations:new Map(rows.map(row=>[row.id,row]))});
  return snapshotId;
}

export function currentEarthquakeFeed(generated:number,now:number) {
  return Number.isSafeInteger(generated) && generated>0 &&
    generated>=now-usgsMaxFeedAge && generated<=now+minute;
}

function currentMetar(observedAt:number,now:number) {
  return observedAt<=now && observedAt>=now-metarMaxAge;
}

export function publishEarthquakeSnapshot(data:EarthquakeDay,now=Date.now()) {
  const kind="usgs-earthquake";
  if(!currentEarthquakeFeed(data.generated,now)||data.events.length>policy[kind].maxRows)return;
  const snapshotId=randomUUID();
  const rows=data.events.flatMap(event=>{
    if(event.time<data.generated-dayMs||event.time>data.generated||event.time>now)return [];
    const observation=readCaseObservation({kind,snapshotId,id:event.id,observedAt:event.time,point:event.point,
      sourceUrl:caseObservationUrl(kind,event.id),place:event.place,magnitude:event.mag,depthKm:event.depth});
    return observation?[observation]:[];
  });
  return register(kind,snapshotId,rows,now);
}

export function publishMetarSnapshot(data:StationSnapshot,now=Date.now()) {
  const kind="awc-metar";
  if(data.stations.length>policy[kind].maxRows)return;
  const snapshotId=randomUUID();
  const rows=data.stations.flatMap(station=>{
    if(!currentMetar(station.observed,now))return [];
    const observation=readCaseObservation({kind,snapshotId,id:station.id,observedAt:station.observed,point:station.point,
      sourceUrl:caseObservationUrl(kind,station.id),stationName:station.name,weather:station.weather,
      temperatureC:station.temperature,windKnots:station.wind,storm:station.storm});
    return observation?[observation]:[];
  });
  return register(kind,snapshotId,rows,now);
}

function publishedSnapshot(kind:CaseObservationKind,id:string,now:number) {
  if(!Number.isSafeInteger(now)||now<=0)return;
  const snapshot=expire(kind,now).get(id);
  if(snapshot&&snapshot.publishedAt<=now)return snapshot;
}

export function availableCaseObservationSnapshot(kind:CaseObservationKind,id:string,now=Date.now()) {
  const snapshot=publishedSnapshot(kind,id,now);
  return !!snapshot && (kind!=="awc-metar"||currentMetar(snapshot.latestObservation,now));
}

// The opaque identifier binds the observed value to the exact successful GET
// publication. A fresh correction never rewrites a previous playback snapshot.
export function resolveCaseObservation(value:unknown,now=Date.now()):CaseObservation|undefined {
  const ref=readCaseObservationRef(value);
  if(!ref)return;
  const row=publishedSnapshot(ref.kind,ref.snapshotId,now)?.observations.get(ref.id);
  if(!row||row.observedAt!==ref.observedAt)return;
  if(ref.kind==="awc-metar"&&!currentMetar(ref.observedAt,now))return;
  return structuredClone(row);
}
