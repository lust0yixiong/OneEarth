import type {RequestHandler} from "express";
import {mkdtemp,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import type {Dataset} from "h5wasm/node";
import type {LightningFrame} from "../src/domain/lightning-frame";


function prefix(ms:number) {
  const date=new Date(ms), year=date.getUTCFullYear();
  const day=Math.floor((ms-Date.UTC(year,0,1))/86400000)+1;
  return `GLM-L2-LCFA/${year}/${String(day).padStart(3,"0")}/${String(date.getUTCHours()).padStart(2,"0")}/`;
}
async function request(url:string) {
  const res=await fetch(url,{signal:AbortSignal.timeout(10000)});
  if(!res.ok) throw Error("NOAA HTTP "+res.status);
  return res;
}
async function latestKey(bucket:string,time:number) {
  const xml=await (await request(bucket+"/?list-type=2&prefix="+prefix(time))).text();
  return [...xml.matchAll(/<Key>(GLM-L2-LCFA\/[\w/.-]+\.nc)<\/Key>/g)].at(-1)?.[1];
}
async function load(bucket:string,cached?:LightningFrame):Promise<LightningFrame> {
  const now=Date.now();
  const key=await latestKey(bucket,now) || await latestKey(bucket,now-3600000);
  if(!key)throw Error("最近两小时未找到观测文件");
  const source=bucket+"/"+key;
  if(cached?.source===source)return cached;
  const bytes=await (await request(source)).arrayBuffer();
  const h5=(await import("h5wasm/node")).default;
  await h5.ready;
  const dir=await mkdtemp(join(tmpdir(),"oneearth-glm-"));
  try {
    const path=join(dir,"frame.nc");
    await writeFile(path,new Uint8Array(bytes));
    const f=new h5.File(path,"r");
    try {
      const start=Date.parse(String(f.attrs.time_coverage_start.value));
      const end=Date.parse(String(f.attrs.time_coverage_end.value));
      if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)throw Error("无效的观测时间");
      const dataset=(name:string)=>f.get(name) as Dataset;
      const values=(name:string)=>dataset(name).value as ArrayLike<number>;
      const lat=values("flash_lat"),lon=values("flash_lon"),quality=values("flash_quality_flag");
      const time=dataset("flash_time_offset_of_first_event");
      const offsets=time.value as ArrayLike<number>;
      const scale=Number(time.attrs.scale_factor.value),bias=Number(time.attrs.add_offset.value);
      const unsigned=String(time.attrs._Unsigned.value)==="true";
      const flashes:LightningFrame["flashes"]=[];
      for(let i=0;i<lat.length;i++){
        if(quality[i]!==0||!(Math.abs(lat[i])<=90 && Math.abs(lon[i])<=180))continue;
        const seconds=(unsigned ? offsets[i]&65535 : offsets[i])*scale+bias;
        flashes.push([start+Math.round(seconds*1000),lon[i],lat[i]]);
      }
      return {start,end,source,flashes:flashes.sort((a,b)=>a[0]-b[0])};
    }finally{f.close();}
  }finally{await rm(dir,{recursive:true,force:true});}
}
interface SatelliteCache {frame?:LightningFrame; pending?:Promise<LightningFrame>; next:number}
const caches:Record<string,SatelliteCache>={"18":{next:0},"19":{next:0}};
export const lightning:RequestHandler=async(req,res)=>{
  res.set("Cache-Control","no-store");
  const satellite=req.query.satellite ?? "19";
  if(satellite!=="18" && satellite!=="19"){res.status(400).json({error:"未知卫星"});return;}
  const cache=caches[satellite];
  try{
    if(Date.now()>=cache.next && !cache.pending){
      cache.pending=load("https://noaa-goes"+satellite+".s3.amazonaws.com",cache.frame)
        .then(frame=>cache.frame=frame).finally(()=>{cache.next=Date.now()+4000;cache.pending=undefined;});
    }
    const frame=await cache.pending ?? cache.frame;
    if(!frame)throw Error();
    res.json(frame);
  }catch{res.status(503).json({error:"暂时无法读取 NOAA 闪电观测"});}
};
