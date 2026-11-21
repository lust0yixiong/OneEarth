import test from "node:test";
import assert from "node:assert/strict";
import {geoOrthographic} from "d3-geo";
import {rainCell,rainLevel,rainTileCell,rainVisibleTiles,type RainManifest} from "./rainfall";
import {RainTiles} from "../globe/rain-tiles";

const manifest={id:"imerg-v07b-2024",product:"GPM IMERG V07B Final",year:2024,step:.1,columns:3600,rows:1800,
  tileSize:180,factors:[10,2,1],bands:[],source:"",unit:"mm/day",scale:.01,missing:65535,
  months:Array.from({length:12},(_,i)=>({month:i+1,path:"2024/"+String(i+1).padStart(2,"0"),
    source:{run:"Final" as const,version:"V07B",url:"",conversion:"",sha256:""},complete:true,through:""}))} satisfies RainManifest;
async function ready(store:RainTiles){
  for(let i=0;i<100 && store.loading;i++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(store.loading,false);
}
test("native IMERG indexing preserves 0.1 degree cells, tile boundaries, dateline and polar edges",()=>{
  assert.equal(rainCell([-179.95,89.95]).index,0);
  assert.equal(rainCell([179.95,-89.95]).index,1800*3600-1);
  assert.equal(rainCell([180,0]).index,rainCell([-180,0]).index);
  assert.equal(rainCell([114.3,30.4]).column,2943);
  assert.equal(rainCell([114.3,30.4]).row,596);
  assert.equal(rainTileCell([-162.05,72.05]).offset,180*180-1);
  assert.equal(rainTileCell([-161.95,71.95]).offset,0);
  assert.notEqual(rainTileCell([-162.05,72.05]).id,rainTileCell([-161.95,71.95]).id);
});
test("viewport tile bounds cover visible native cells across the dateline and both poles",()=>{
  for(const center of [[179,15],[-179,-40],[105,88],[-25,-88],[114,30]] as [number,number][]){
    const p=geoOrthographic().rotate([-center[0],-center[1]]).translate([420,300]).scale(2500);
    const visible=new Set(rainVisibleTiles(2,center,2500,420,300,840,600));
    assert.ok(visible.size<200,"zoomed view must not request the full globe");
    for(let y=0;y<600;y+=13)for(let x=0;x<840;x+=17){
      const point=p.invert!([x+.5,y+.5]) as [number,number];
      assert.ok(visible.has(rainTileCell(point).id),String([center,point]));
    }
  }
  assert.equal(rainLevel(80),0);assert.equal(rainLevel(400),1);assert.equal(rainLevel(2500),2);
});
test("tile loading distinguishes missing, zero and pending, survives frame changes and retries failed tiles",async()=>{
  let failing=true;
  const calls:string[]=[];
  const fetcher=(async(url:RequestInfo|URL)=>{
    const path=String(url);calls.push(path);
    if(path.includes("/03/2/") && failing)return new Response("",{status:503});
    const data=new Uint16Array(180*180).fill(path.includes("/07/")?1234:0);
    data[1]=65535;
    return new Response(data.buffer);
  }) as typeof fetch;
  const store=new RainTiles(manifest,fetcher);
  try{
    assert.equal(store.series([-179.95,89.95])[6],undefined);
    store.setView(6,2,[0]);await ready(store);
    assert.equal(store.series([-179.95,89.95])[6],12.34);
    assert.equal(store.series([-179.85,89.95])[6],null);
    store.select([-179.95,89.95]);await ready(store);
    assert.equal(store.series([-179.95,89.95])[0],0);
    assert.equal(store.series([-179.95,89.95])[2],undefined);
    assert.equal(store.error,true);
    failing=false;store.retry();await ready(store);
    assert.equal(store.series([-179.95,89.95])[2],0);
    store.setView(0,0,[0,1]);await ready(store);
    assert.equal(store.get(0,0,0)?.[0],0);
    assert.equal(store.get(6,0,0)?.[0],1234);
    assert.ok(calls.length<20,"requests should be shared between view and selected-cell series");
  }finally{store.dispose();}
});

test("year-specific paths and unpublished months keep cache and replay aligned",async()=>{
  const partial:RainManifest={...manifest,id:"imerg-2026-test",year:2026,
    months:manifest.months.map((m,i)=>i<2?{...m!,path:"2026/"+String(i+1).padStart(2,"0")}:null)};
  const calls:string[]=[];
  const fetcher=(async(url:RequestInfo|URL)=>{
    calls.push(String(url));
    const data=new Uint16Array(180*180).fill(String(url).includes("/2026/")?5678:1234);
    return new Response(data.buffer);
  }) as typeof fetch;
  const old=new RainTiles(manifest,fetcher),recent=new RainTiles(partial,fetcher);
  try{
    old.setView(0,2,[0]);recent.setView(0,2,[0]);recent.select([-179.95,89.95]);
    await ready(old);await ready(recent);
    assert.equal(old.series([-179.95,89.95])[0],12.34);
    assert.equal(recent.series([-179.95,89.95])[0],56.78);
    assert.equal(recent.available(2),false);
    assert.equal(recent.series([-179.95,89.95])[2],undefined);
    assert.equal(recent.nextMonth(1),0);
    assert.ok(!calls.some(url=>url.includes("/2026/03/")));
  }finally{old.dispose();recent.dispose();}
});
