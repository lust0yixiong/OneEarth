import {cellToLatLng, getResolution} from 'h3-js';
import {gunzipSync} from 'fflate';

const steps=[0,0,0,60,30,15,10,10];
const keyOf=(r,id)=>r+'/'+id;
function tileId(r,lon,lat){
  const step=steps[r],cols=360/step;
  return Math.min(180/step-1,Math.max(0,Math.floor((lat+90)/step)))*cols+
    Math.min(cols-1,Math.max(0,Math.floor((lon+180)/step)));
}
async function readGzip(url){
  const response=await fetch(url);
  if(!response.ok)throw Error('网格数据读取失败 '+response.status);
  const bytes=new Uint8Array(await response.arrayBuffer());
  return bytes[0]===31&&bytes[1]===139?gunzipSync(bytes):bytes;
}
// Tiles contain exact H3 cells. Their geographic buckets only select which bytes to load.
export function createGridStore(redraw){
  const cache=new Map(),pending=new Map(),failed=new Map(),pointBlocks=new Map();
  let bytes=0,ranges;
  function get(r,id){
    const key=keyOf(r,id);
    if(cache.has(key)){
      const tile=cache.get(key);cache.delete(key);cache.set(key,tile);
      return Promise.resolve(tile);
    }
    if(pending.has(key))return pending.get(key);
    const job=readGzip('grid-data/r'+r+'/'+id+'.gz').then(data=>{
      const u=new Uint32Array(data.buffer,data.byteOffset,data.byteLength/4);
      const tile={u,f:new Float32Array(u.buffer,u.byteOffset,u.length)};
      cache.set(key,tile);bytes+=data.byteLength;failed.delete(key);
      while(bytes>128*1024*1024&&cache.size>1){const old=cache.keys().next().value;bytes-=cache.get(old).u.byteLength;cache.delete(old);}
      return tile;
    }).catch(error=>{failed.set(key,Date.now());throw error;}).finally(()=>{pending.delete(key);redraw();});
    pending.set(key,job);return job;
  }
  function bounds(center,radius){
    const [lon,lat]=center,deg=180/Math.PI,angle=Math.min(90,radius*deg);
    const halfLon=Math.abs(lat)+angle>=90?180:Math.asin(Math.min(1,Math.sin(angle/deg)/Math.cos(lat/deg)))*deg;
    return {lon,halfLon,lo:Math.max(-90,lat-angle),hi:Math.min(90,lat+angle)};
  }
  function visit(r,center,radius,onRow){
    const step=steps[r],cols=360/step,box=bounds(center,radius);
    let loading=false,error=false;
    for(let ty=Math.max(0,Math.floor((box.lo+90)/step));ty<=Math.min(180/step-1,Math.floor((box.hi+90)/step));ty++){
      for(let tx=0;tx<cols;tx++){
        if(Math.abs(((tx*step-180+step/2-box.lon+900)%360)-180)>box.halfLon+step/2)continue;
        const id=ty*cols+tx,key=keyOf(r,id),tile=cache.get(key);
        if(!tile){
          if(failed.has(key)&&Date.now()-failed.get(key)<5000)error=true;
          else{loading=true;if(!pending.has(key))get(r,id).catch(()=>{});}
          continue;
        }
        const {u,f}=tile;
        for(let i=0;i<u.length;i+=10){
          const lat=f[i+3],lon=f[i+2];
          if(lat<box.lo||lat>box.hi||Math.abs(((lon-box.lon+900)%360)-180)>box.halfLon)continue;
          onRow(lon,lat,u,i);
        }
      }
    }
    return error?'读取失败，移动或缩放重试':loading?'正在载入网格':'';
  }
  async function meta(cell){
    const r=getResolution(cell),[lat,lon]=cellToLatLng(cell);
    const {u}=await get(r,tileId(r,lon,lat));
    const hi=parseInt(cell.slice(0,-8),16),lo=parseInt(cell.slice(-8),16);
    let a=0,b=u.length/10-1;
    while(a<=b){const mid=(a+b)>>>1,i=mid*10;if(u[i]===hi&&u[i+1]===lo)return [...u.subarray(i+4,i+10)];
      if(u[i]<hi||(u[i]===hi&&u[i+1]<lo))a=mid+1;else b=mid-1;}
    return null;
  }
  async function record(id){
    if(id>9988000){
      ranges??=fetch('grid-data/ranges.json').then(r=>{if(!r.ok)throw Error();return r.json();}).catch(e=>{ranges=null;throw e;});
      return (await ranges)[id-9988001];
    }
    const i=id-1,block=i>>>16;
    if(!pointBlocks.has(block))pointBlocks.set(block,readGzip('grid-data/points/'+block+'.gz').then(a=>new Int32Array(a.buffer,a.byteOffset,a.byteLength/4)).catch(e=>{pointBlocks.delete(block);throw e;}));
    const a=await pointBlocks.get(block),j=(i%65536)*2;
    return [a[j]/100000,a[j+1]/100000,i%3];
  }
  return {visit,meta,record};
}
