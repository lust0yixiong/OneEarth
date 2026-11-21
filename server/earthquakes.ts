import type {RequestHandler} from "express";
import {load} from "cheerio";
import {parseEarthquakeDay,quakeFeed,stationDirectory,dayMs,type SeismicStation} from "../src/domain/earthquakes";

async function request(url:string){
  const response=await fetch(url,{signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw Error("USGS "+response.status);
  return response;
}
function cachedFeed<T>(ttl:number,loadData:()=>Promise<T>):RequestHandler {
  let data:T|undefined,expires=0,pending:Promise<void>|undefined,failed=false;
  return async(_req,res)=>{
    if(Date.now()>=expires && !pending){
      pending=loadData().then(next=>{data=next;expires=Date.now()+ttl;failed=false;})
        .catch(()=>{failed=true;expires=Date.now()+10000;})
        .finally(()=>{pending=undefined;});
    }
    await pending;
    res.set("Cache-Control","no-store");
    if(!data){res.status(503).json({error:"USGS 数据暂不可用"});return;}
    res.json({...data,stale:failed});
  };
}
export const earthquakeDay=cachedFeed(30000,async()=>parseEarthquakeDay(await (await request(quakeFeed)).json()));
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
