import type {RequestHandler} from "express";
import {load} from "cheerio";
import {parseEarthquakeDay,quakeFeed,stationDirectory,dayMs,type SeismicStation} from "../src/domain/earthquakes";
import {availableCaseObservationSnapshot,currentEarthquakeFeed,publishEarthquakeSnapshot} from "./case-observations";

async function request(url:string){
  const response=await fetch(url,{signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw Error("USGS "+response.status);
  return response;
}
function cachedFeed<T extends object>(
  ttl:number,loadData:()=>Promise<T>,now=Date.now,
  presentation:(data:T,stale:boolean)=>object=(data,stale)=>({...data,stale}),
):RequestHandler {
  let data:T|undefined,expires=0,pending:Promise<void>|undefined,failed=false;
  return async(_req,res)=>{
    if(now()>=expires && !pending){
      pending=loadData().then(next=>{data=next;expires=now()+ttl;failed=false;})
        .catch(()=>{failed=true;expires=now()+10000;})
        .finally(()=>{pending=undefined;});
    }
    await pending;
    res.set("Cache-Control","no-store");
    if(!data){res.status(503).json({error:"USGS 数据暂不可用"});return;}
    res.json(presentation(data,failed));
  };
}
export function createEarthquakeDay({
  now=Date.now, fetchFeed=async()=>await (await request(quakeFeed)).json(),
}: {now?:()=>number;fetchFeed?:()=>Promise<Parameters<typeof parseEarthquakeDay>[0]>}={}):RequestHandler {
  return cachedFeed(30_000,async()=>{
    const data=parseEarthquakeDay(await fetchFeed());
    return {data,snapshotId:publishEarthquakeSnapshot(data,now())};
  },now,({data,snapshotId},failed)=>{
    const current=now();
    const stale=failed||!currentEarthquakeFeed(data.generated,current);
    return {...data,stale,...(!stale&&snapshotId&&availableCaseObservationSnapshot("usgs-earthquake",snapshotId,current)
      ? {snapshotId}:{})};
  });
}
export const earthquakeDay=createEarthquakeDay();
export const seismicStations=cachedFeed(dayMs,async()=>{
  const $=load(await (await request(stationDirectory)).text());
  const stations:SeismicStation[]=[];
  for(const row of $("tbody tr[id^='row-']").toArray()){
    const cells=$(row).find("td").map((_,el)=>$(el).text().trim()).get();
    const [network,code,name,,latitude,longitude]=cells;
    const lat=Number(latitude),lon=Number(longitude);
    if(!network || !code || !name || !latitude || !longitude || !(Math.abs(lat)<=90 && Math.abs(lon)<=180))continue;
    stations.push({id:network+"."+code,name,point:[lon,lat]});
  }
  if(!stations.length)throw Error("USGS 台站目录为空");
  return {updated:Date.now(),stations};
});
