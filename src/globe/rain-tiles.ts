import {gunzipSync} from "fflate";
import {rainFactors,rainGrid,rainTileCell,rainTileSize,rainTileXY,type RainCatalog,type RainManifest} from "../domain/rainfall";
import type {XY} from "../domain/regional-cases";
import {rainTileRoot} from "../domain/rain-catalog";

type TileRequest={key:string;month:number;level:number;id:number};
const request=(month:number,level:number,id:number):TileRequest=>({key:month+"/"+level+"/"+id,month,level,id});
export class RainTiles {
  private cache=new Map<string,Uint16Array>();
  private pending=new Map<string,AbortController>();
  private failures=new Set<string>();
  private view:TileRequest[]=[];
  private viewKey="";
  private point:TileRequest[]=[];
  private listeners=new Set<()=>void>();
  private disposed=false;
  revision=0;
  level=0;
  constructor(readonly manifest:RainManifest,private fetcher:typeof fetch=(input,init)=>fetch(input,init),
    readonly catalog:RainCatalog={id:"imerg-monthly",defaultYear:2024,years:[{year:manifest.year,months:manifest.months.flatMap(m=>m?[m.month]:[])}]}){}
  available(month:number){return !!this.manifest.months[month];}
  nextMonth(month:number){
    for(let step=1;step<=12;step++){const next=(month+step)%12;if(this.available(next))return next;}
    return month;
  }
  subscribe(listener:()=>void){this.listeners.add(listener);return ()=>{this.listeners.delete(listener);};}
  private notify(){this.revision++;this.listeners.forEach(listener=>listener());}
  private wanted(){return [...this.view,...this.point];}
  get(month:number,level:number,id:number){
    const key=request(month,level,id).key,value=this.cache.get(key);
    if(value){this.cache.delete(key);this.cache.set(key,value);}
    return value;
  }
  setView(month:number,level:number,ids:number[]){
    const key=month+"/"+level+"/"+ids.join(",");
    if(key===this.viewKey)return;
    this.viewKey=key;
    this.level=level;
    this.view=this.available(month)?[request(month,0,0),request(month,0,1),
      ...ids.map(id=>request(month,level,id))]:[];
    this.pump();this.notify();
  }
  select(point:XY|undefined){
    this.point=point?this.manifest.months.flatMap((m,month)=>m?[request(month,2,rainTileCell(point).id)]:[]):[];
    this.pump();
  }
  series(point:XY){
    const {id,offset}=rainTileCell(point);
    return Array.from({length:12},(_,month)=>{
      const raw=this.get(month,2,id)?.[offset];
      return raw===65535?null:raw===undefined?undefined:raw/100;
    });
  }
  get loading(){return this.wanted().some(t=>!this.cache.has(t.key) && !this.failures.has(t.key));}
  get error(){return this.wanted().some(t=>this.failures.has(t.key));}
  retry(){this.failures.clear();this.pump();this.notify();}
  private pump(){
    if(this.disposed)return;
    const wanted=this.wanted(),keys=new Set(wanted.map(t=>t.key));
    for(const [key,controller] of this.pending)if(!keys.has(key))controller.abort();
    for(const tile of wanted){
      if(this.pending.size>=6)break;
      if(this.cache.has(tile.key)||this.pending.has(tile.key)||this.failures.has(tile.key))continue;
      const controller=new AbortController();
      this.pending.set(tile.key,controller);
      void this.load(tile,controller);
    }
  }
  private async load(tile:TileRequest,controller:AbortController){
    try{
      const {x,y}=rainTileXY(tile.level,tile.id);
      const url=rainTileRoot+"/"+this.manifest.months[tile.month]!.path+"/"+tile.level+"/"+x+"-"+y+".bin.gz";
      const response=await this.fetcher(url,{signal:controller.signal});
      if(!response.ok)throw Error("降水瓦片载入失败");
      const payload=new Uint8Array(await response.arrayBuffer());
      const bytes=payload[0]===31 && payload[1]===139?gunzipSync(payload):payload;
      if(bytes.length!==rainTileSize*rainTileSize*2)throw Error("降水瓦片不完整");
      if(controller.signal.aborted||this.disposed)return;
      this.cache.set(tile.key,new Uint16Array(bytes.buffer,bytes.byteOffset,bytes.byteLength/2));
      const keep=new Set(this.wanted().map(t=>t.key));
      for(const key of this.cache.keys()){
        if(this.cache.size<=128)break;
        if(!keep.has(key))this.cache.delete(key);
      }
    }catch{
      if(!controller.signal.aborted && !this.disposed)this.failures.add(tile.key);
    }finally{
      this.pending.delete(tile.key);
      if(!this.disposed){this.notify();this.pump();}
    }
  }
  dispose(){
    this.disposed=true;
    this.pending.forEach(controller=>controller.abort());
    this.listeners.clear();this.cache.clear();
  }
}
export async function loadRainTiles(signal:AbortSignal,year:number,catalog:RainCatalog){
  const published=catalog.years.find(entry=>entry.year===year);
  if(!published)throw Error("降水年份尚未发布");
  const response=await fetch(rainTileRoot+"/"+year+"/manifest.json",{signal});
  if(!response.ok)throw Error("降水图层清单载入失败");
  const manifest=await response.json() as RainManifest;
  if(manifest.year!==year || manifest.step!==rainGrid.step ||
    manifest.columns!==rainGrid.columns || manifest.rows!==rainGrid.rows ||
    manifest.tileSize!==rainTileSize || String(manifest.factors)!==String(rainFactors) ||
    manifest.unit!=="mm/day" || manifest.scale!==.01 || manifest.missing!==65535 ||
    manifest.bands.length!==12 || manifest.bands.some(b=>b.length!==18) ||
    manifest.months.length!==12 || manifest.months.some((month,i)=>month && (month.month!==i+1 || !month.path.startsWith(year+"/"))) ||
    published.months.some(month=>!manifest.months[month-1]))
    throw Error("降水发布目录与图层清单不匹配");
  const months=manifest.months.map((month,i)=>published.months.includes(i+1)?month:null);
  const bands=manifest.bands.map((band,i)=>months[i]?band:band.map(()=>null));
  return new RainTiles({...manifest,months,bands},(input,init)=>fetch(input,init),catalog);
}
