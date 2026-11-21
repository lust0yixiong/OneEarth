import type {RequestHandler} from "express";
import {unzipSync,strFromU8} from "fflate";
import {readFile,mkdir,writeFile,rename} from "node:fs/promises";
import {join} from "node:path";
import type {LightningFrame} from "../src/domain/lightning-frame";

const source="https://dudwlln.otago.ac.nz/WWLLN.kmz";
function decode(bytes:Uint8Array):LightningFrame {
  const files=unzipSync(bytes,{filter:f=>f.name.endsWith(".kml") && f.originalSize<80000000});
  const entry=Object.values(files)[0];
  if(!entry)throw Error("Missing WWLLN observations");
  const flashes:LightningFrame["flashes"]=[];
  for(const [mark] of strFromU8(entry).matchAll(/<Placemark>[\s\S]*?<\/Placemark>/g)){
    const stamp=mark.match(/<name>(\d{4})\/(\d\d)\/(\d\d) (\d\d:\d\d) UTC<\/name>/);
    const coord=mark.match(/<coordinates>([-\d.]+),([-\d.]+),/);
    if(!stamp || !coord)continue;
    const time=Date.parse(stamp[1]+"-"+stamp[2]+"-"+stamp[3]+"T"+stamp[4]+":00Z");
    const lon=Number(coord[1]),lat=Number(coord[2]);
    if(Number.isFinite(time)&&Math.abs(lon)<=180&&Math.abs(lat)<=90)flashes.push([time,lon,lat]);
  }
  if(!flashes.length)throw Error("Empty WWLLN file");
  flashes.sort((a,b)=>a[0]-b[0]);
  return {start:flashes[0][0],end:flashes.at(-1)![0]+60000,source,flashes};
}

export function worldLightning(directory:string):RequestHandler {
  const path=join(directory,"wwlln.kmz");
  let frame:LightningFrame|undefined,loading:Promise<void>|undefined,next=0;
  async function refresh(){
    const r=await fetch(source,{signal:AbortSignal.timeout(90000)});
    if(!r.ok)throw Error("WWLLN unavailable");
    const bytes=new Uint8Array(await r.arrayBuffer());
    const fresh=decode(bytes);
    await mkdir(directory,{recursive:true});await writeFile(path+".tmp",bytes);await rename(path+".tmp",path);
    frame=fresh;
  }
  return async(_req,res)=>{
    if(!frame){try{frame=decode(await readFile(path));}catch{/* First run. */}}
    if(Date.now()>=next && !loading){
      loading=refresh().then(()=>{next=Date.now()+600000;}).catch(()=>{next=Date.now()+30000;}).finally(()=>{loading=undefined;});
    }
    if(!frame)await loading;
    if(!frame){res.status(503).json({error:"全球观测暂未取得"});return;}
    res.set("Cache-Control","no-cache").json(frame);
  };
}
