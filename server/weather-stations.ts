import {parse} from "csv-parse/sync";
import {gunzip} from "node:zlib";
import {promisify} from "node:util";
import type {RequestHandler} from "express";
import type {WeatherStation,StationSnapshot} from "../src/domain/weather-stations";

const unzip=promisify(gunzip);
const base="https://aviationweather.gov/data/cache/";
async function download(file:string){
  const response=await fetch(base+file,{signal:AbortSignal.timeout(12000)});
  if(!response.ok) throw Error("AWC "+response.status);
  const bytes=Buffer.from(await response.arrayBuffer());
  return (bytes[0]===31 && bytes[1]===139 ? await unzip(bytes) : bytes).toString("utf8");
}
const numeric=(value:string)=>value?.trim() && Number.isFinite(Number(value)) ? Number(value) : null;
export function parseStations(csv:string,names:Map<string,string>):StationSnapshot{
  const rows:Record<string,string>[]=parse(csv,{columns:true,skip_empty_lines:true,bom:true});
  const stations=new Map<string,WeatherStation>();
  let latest=0;
  for(const row of rows){
    const id=row.station_id, observed=Date.parse(row.observation_time);
    const lon=numeric(row.longitude),lat=numeric(row.latitude);
    if(!id || !Number.isFinite(observed) || lon===null || lat===null || Math.abs(lon)>180 || Math.abs(lat)>90)continue;
    if((stations.get(id)?.observed ?? 0)>=observed)continue;
    const weather=row.wx_string || "";
    stations.set(id,{id,name:names.get(id)||id,point:[lon,lat],observed,weather,temperature:numeric(row.temp_c),wind:numeric(row.wind_speed_kt),storm:/(?:^|\s)[+-]?(?:VC)?TS[A-Z]*(?:\s|$)/.test(weather)});
    latest=Math.max(latest,observed);
  }
  if(!stations.size)throw Error("Empty METAR cache");
  return {stations:[...stations.values()],latest};
}
let names=new Map<string,string>(),nextNames=0;
async function load(){
  const [csv]=await Promise.all([download("metars.cache.csv.gz"),(async()=>{
    if(Date.now()<nextNames)return;
    try{
      const rows:{icaoId?:string;site?:string;id?:string}[]=JSON.parse(await download("stations.cache.json.gz"));
      names=new Map(rows.filter(row=>(row.icaoId||row.id)&&row.site).map(row=>[row.icaoId||row.id!,row.site!]));
      nextNames=Date.now()+86400000;
    }catch{nextNames=Date.now()+300000;}
  })()]);
  return parseStations(csv,names);
}
let cached:StationSnapshot|undefined, pending:Promise<StationSnapshot>|undefined,next=0;
export const weatherStations:RequestHandler=async(_req,res)=>{
  try{
    if(Date.now()>=next && !pending){
      pending=load().then(data=>{cached=data;next=Date.now()+55000;return data;})
        .catch(error=>{next=Date.now()+5000;throw error;}).finally(()=>{pending=undefined;});
    }
    const data=await pending ?? cached;
    if(!data)throw Error();
    res.set("Cache-Control","no-cache").json(data);
  }catch{res.status(503).json({error:"气象站观测更新失败"});}
};
