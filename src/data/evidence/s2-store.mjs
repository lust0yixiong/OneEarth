import {gunzipSync} from 'fflate';

export const s2Levels=[5,6,8,9,11,12];
export function s2LevelForH3(r){return s2Levels[Math.max(0,Math.min(5,r-2))];}
export function s2IdAt(u,i){return ((BigInt(u[i])<<32n)|BigInt(u[i+1])).toString();}
const positions=[[0,1,3,2],[2,1,3,0],[2,3,1,0],[0,3,1,2]];
const next=[[3,0,1,0],[1,1,0,2],[2,3,2,1],[0,2,3,3]];
const stUV=s=>s>=.5?(4*s*s-1)/3:(1-4*(1-s)*(1-s))/3;
function cellInfo(input){
  const id=BigInt(input),face=Number(id>>61n),lsb=id&-id;
  if(id<=0n||face>5)throw Error('无效 S2 CellId');
  let zeros=0;for(let bit=lsb;bit>1n;bit>>=1n)zeros++;
  const level=30-zeros/2;
  if(!Number.isInteger(level)||level<0||level>30)throw Error('无效 S2 层级');
  let i=0,j=0,state=face%2?3:0;
  for(let depth=0;depth<level;depth++){
    const p=Number((id>>BigInt(59-depth*2))&3n),q=positions[state].indexOf(p);
    i=i*2+(q>>1);j=j*2+(q&1);state=next[state][q];
  }
  const u=stUV((i+.5)/2**level),v=stUV((j+.5)/2**level);
  const [x,y,z]=[[1,u,v],[-u,1,v],[-u,-v,1],[-1,-v,-u],[v,-1,-u],[v,u,-1]][face];
  return {id,level,lon:Math.atan2(y,x)*180/Math.PI,lat:Math.atan2(z,Math.hypot(x,y))*180/Math.PI};
}
function bounds([lon,lat],radius){
  const deg=180/Math.PI,angle=Math.min(180,radius*deg);
  const halfLon=Math.abs(lat)+angle>=90?180:Math.asin(Math.min(1,Math.sin(angle/deg)/Math.cos(lat/deg)))*deg;
  return {lon,halfLon,lo:Math.max(-90,lat-angle),hi:Math.min(90,lat+angle)};
}
const delta=(a,b)=>Math.abs(((a-b+900)%360)-180);
async function readGzip(url){
  const response=await fetch(url);if(!response.ok)throw Error('S2 数据读取失败 '+response.status);
  const data=new Uint8Array(await response.arrayBuffer());
  const bytes=data[0]===31&&data[1]===139?gunzipSync(data):data;
  return bytes.byteOffset%4?bytes.slice():bytes;
}

/** Same 10-word callback rows as grid-store; words 0/1 hold canonical S2 CellId.
 * Integration:
 * const s2=createS2Store(schedule,{record:store.record});
 * s2.visit(s2LevelForH3(h3Level),camera,radius,(lon,lat,u,i)=>{
 *   const decimalId=s2IdAt(u,i), count=u[i+4]+u[i+5]+u[i+6];
 * });
 * await s2.meta(decimalId) -> [count0,count1,count2,representative0,...]
 * await s2.record(recordId) -> original [lon,lat,source,width?,height?]
 * await s2.records(decimalId) -> [{source,id,record}] for source representatives.
 * visit loads only geographic byte buckets listed in manifest; missing levels
 * return a clear status and never substitute other-level counts.
 */
export function createS2Store(redraw=()=>{},{record:resolveRecord,base='s2-data',maxBytes=128*1024*1024}={}){
  const cache=new Map(),pending=new Map(),failed=new Map();
  let manifest,manifestError=false,bytes=0;
  const ready=fetch(base+'/manifest.json').then(r=>{if(!r.ok)throw Error();return r.json();})
    .then(m=>{if(m.schema!=='oneearth-s2-grid-v1')throw Error();manifest=m;return m;})
    .catch(error=>{manifestError=true;throw error;}).finally(redraw);
  ready.catch(()=>{});
  function get(level,id){
    const key=level+'/'+id;
    if(cache.has(key)){const tile=cache.get(key);cache.delete(key);cache.set(key,tile);return Promise.resolve(tile);}
    if(pending.has(key))return pending.get(key);
    const job=readGzip(base+'/l'+level+'/'+id+'.gz').then(data=>{
      if(data.byteLength%40)throw Error('S2 网格行长度无效');
      const u=new Uint32Array(data.buffer,data.byteOffset,data.byteLength/4);
      const tile={u,f:new Float32Array(u.buffer,u.byteOffset,u.length)};
      cache.set(key,tile);bytes+=u.byteLength;failed.delete(key);
      while(bytes>maxBytes&&cache.size>1){const oldest=cache.keys().next().value;bytes-=cache.get(oldest).u.byteLength;cache.delete(oldest);}
      return tile;
    }).catch(error=>{failed.set(key,Date.now());throw error;}).finally(()=>{pending.delete(key);redraw();});
    pending.set(key,job);return job;
  }
  function visit(level,center,radius,onRow){
    if(manifestError)return 'S2 目录读取失败';
    if(!manifest)return '正在载入 S2 目录';
    const info=manifest.levels[String(level)];if(!info)return 'S2 L'+level+' 尚未构建';
    const box=bounds(center,radius),step=info.stepDegrees,cols=360/step,available=new Set(info.tiles);
    let loading=false,error=false;
    for(let ty=Math.max(0,Math.floor((box.lo+90)/step));ty<=Math.min(180/step-1,Math.floor((box.hi+90)/step));ty++){
      for(let tx=0;tx<cols;tx++){
        if(delta(tx*step-180+step/2,box.lon)>box.halfLon+step/2)continue;
        const id=ty*cols+tx;if(!available.has(id))continue;
        const key=level+'/'+id,tile=cache.get(key);
        if(!tile){
          if(failed.has(key)&&Date.now()-failed.get(key)<5000)error=true;
          else{loading=true;if(!pending.has(key))get(level,id).catch(()=>{});}continue;
        }
        const {u,f}=tile;
        for(let i=0;i<u.length;i+=10){
          const lon=f[i+2],lat=f[i+3];
          if(lat>=box.lo&&lat<=box.hi&&delta(lon,box.lon)<=box.halfLon)onRow(lon,lat,u,i);
        }
      }
    }
    return error?'S2 数据读取失败，移动或缩放重试':loading?'正在载入 S2 网格':'';
  }
  async function meta(input){
    const m=await ready,cell=cellInfo(input),info=m.levels[String(cell.level)];if(!info)return null;
    const step=info.stepDegrees,cols=360/step;
    const tileId=Math.min(180/step-1,Math.max(0,Math.floor((cell.lat+90)/step)))*cols+
      Math.min(cols-1,Math.max(0,Math.floor((cell.lon+180)/step)));
    if(!info.tiles.includes(tileId))return null;
    const {u}=await get(cell.level,tileId),hi=Number(cell.id>>32n),lo=Number(cell.id&0xffffffffn);
    let a=0,b=u.length/10-1;
    while(a<=b){const middle=(a+b)>>>1,i=middle*10;
      if(u[i]===hi&&u[i+1]===lo)return [...u.subarray(i+4,i+10)];
      if(u[i]<hi||(u[i]===hi&&u[i+1]<lo))a=middle+1;else b=middle-1;}
    return null;
  }
  async function record(id){if(!resolveRecord)throw Error('请传入现有 grid-store.record');return resolveRecord(id);}
  async function records(cellId){
    const row=await meta(cellId);if(!row)return [];
    return Promise.all(row.slice(3).flatMap((id,source)=>id?[Promise.resolve(resolveRecord?resolveRecord(id):null).then(value=>({source,id,record:value}))]:[]));
  }
  return {visit,meta,record,records,ready,get manifest(){return manifest;}};
}
