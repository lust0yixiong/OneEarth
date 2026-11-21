import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { layerObjects, spatialStore, type Bounds, type Chunk, type Layer } from "../server/spatial-store";
import type { RainCatalog, RainManifest } from "../src/domain/rainfall";

const sourceRoot=path.resolve(process.env.ONEEARTH_DATA_DIR || ".local/globe-data");
const index=await spatialStore();
const objects=layerObjects();
const queue:Chunk[]=[];
let count=0;
async function indexFile(layer:Layer, route:string, media:string, bytes:Buffer,
    starts:string|null=null, ends:string|null=null, level:number|null=null,bounds:Bounds|null=null) {
  queue.push({route,media,starts,ends,level,bounds,layer_id:layer.id,...await objects.put(bytes)});
  count++;
  if(queue.length>=240)await index.writeChunks(queue.splice(0));
}

try {
  const rainInfo:Layer={id:"imerg",entity_id:"nasa:imerg-monthly",version:"V07B",title:"NASA GPM IMERG 月降水",source:"https://gpm.nasa.gov/data/imerg"};
  await index.writeLayer(rainInfo);
  const rainDir=path.join(sourceRoot,"imerg");
  const original:RainCatalog=JSON.parse(await readFile(path.join(rainDir,"catalog.json"),"utf8"));
  const selected=(process.env.ONEEARTH_IMERG_YEARS || "2023,2024").split(",").map(Number);
  const catalog={...original, years:original.years.filter(entry=>selected.includes(entry.year))};
  if(catalog.years.length!==selected.length)throw Error("缺少指定的 IMERG 年份。");
  await indexFile(rainInfo,"/precip-data/catalog.json","application/json",Buffer.from(JSON.stringify(catalog)));
  for(const {year} of catalog.years){
    const manifestBytes=await readFile(path.join(rainDir,String(year),"manifest.json"));
    const manifest:RainManifest=JSON.parse(manifestBytes.toString());
    for(const month of manifest.months){
      if(!month)continue;
      const mm=String(month.month).padStart(2,"0");
      const starts=year+"-"+mm+"-01";
      const ends=new Date(Date.UTC(year,month.month,0)).toISOString().slice(0,10);
      for(const [level,factor] of manifest.factors.entries()){
        const dir=path.join(rainDir,month.path,String(level));
        const degrees=manifest.step*manifest.tileSize*factor;
        const entries=(await readdir(dir)).filter(name=>/^\d+-\d+\.bin\.gz$/.test(name));
        if(entries.length!==Math.round(360/degrees)*Math.round(180/degrees))throw Error("IMERG 分块不完整："+month.path+"/"+level);
        for(const file of entries){
          const [x,y]=file.split(/[.-]/).slice(0,2).map(Number);
          const w=-180+x*degrees,n=90-y*degrees;
          await indexFile(rainInfo,"/precip-data/"+month.path+"/"+level+"/"+file,"application/octet-stream",
            await readFile(path.join(dir,file)),starts,ends,level,[w,n-degrees,w+degrees,n]);
        }
      }
    }
    await indexFile(rainInfo,"/precip-data/"+year+"/manifest.json","application/json",manifestBytes);
  }
  for(const id of [1846764,1846639]){
    const base="/visualizations/haina/"+id;
    const dir=path.resolve("public"+base);
    const bytes=await readFile(path.join(dir,"manifest.json"));
    const data=JSON.parse(bytes.toString());
    const layer:Layer={id:String(id),entity_id:"haina:"+id,version:String(data.version),title:data.name || "海纳 "+id,source:"https://cn.zero2x.org/data-hub/portal/dataset?id="+id};
    await index.writeLayer(layer);
    for(const frame of data.frames ?? data.cities){
      const date=frame.date ?? data.date ?? null;
      await indexFile(layer,frame.image,"image/webp",await readFile(path.join(dir,path.basename(frame.image))),
        date,date,0,frame.bounds ?? data.grid?.bounds ?? null);
    }
    await indexFile(layer,base+"/manifest.json","application/json",bytes);
  }
  if(queue.length)await index.writeChunks(queue);
  console.log(JSON.stringify({layers:(await index.layers()).length,objectsIndexed:count,engine:index.engine,postgis:await index.version(),objects:objects.backend}));
} finally {await index.close();}
