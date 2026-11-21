import type {Coordinate} from "./types";

export const quakeFeed="https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson";
export const stationDirectory="https://earthquake.usgs.gov/monitoring/operations/network.php";
export const dayMs=24*60*60*1000;

export interface Earthquake {
  id:string;
  point:Coordinate;
  place:string;
  time:number;
  depth:number|null;
  mag:number|null;
  url:string;
}
interface Feature {
  id:string;
  geometry:{type:string;coordinates:[number,number,number|null]}|null;
  properties:{type:string;status:string;place:string|null;time:number;mag:number|null;url:string;updated:number};
}
export interface EarthquakeDay {generated:number;events:Earthquake[]}
export interface SeismicStation {id:string;name:string;point:Coordinate}
export interface StationDirectory {updated:number;stations:SeismicStation[]}

export function parseEarthquakeDay(feed:{metadata:{generated:number};features:Feature[]}):EarthquakeDay {
  const generated=feed.metadata.generated;
  if(!Number.isFinite(generated)||!Array.isArray(feed.features))throw Error("无效的 USGS 目录");
  const events=new Map<string,Earthquake>();
  for(const f of feed.features){
    const p=f.properties;
    if(!f.id || !p || p.type!=="earthquake" || p.status==="deleted" || f.geometry?.type!=="Point")continue;
    const [lon,lat,depth]=f.geometry.coordinates;
    if(!Number.isFinite(lon)||!Number.isFinite(lat)||Math.abs(lon)>180||Math.abs(lat)>90)continue;
    if(!Number.isFinite(p.time)||p.time<generated-dayMs||p.time>generated)continue;
    events.set(f.id,{id:f.id,point:[lon,lat],depth:Number.isFinite(depth)?depth:null,
      time:p.time,place:p.place || `${Math.abs(lat).toFixed(2)}°${lat<0?"S":"N"} · ${Math.abs(lon).toFixed(2)}°${lon<0?"W":"E"}`,
      mag:Number.isFinite(p.mag)?p.mag:null,url:p.url});
  }
  return {generated,events:[...events.values()].sort((a,b)=>a.time-b.time)};
}
