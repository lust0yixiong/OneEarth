import {useEffect,useRef,useState} from "react";
import {ArrowLeft,Pause,Play,RotateCcw,X} from "lucide-react";
import {createRenderer,type Scene} from "../globe/renderer";
import {emptyFilters} from "../domain/spatial";
import {useWorkspace} from "../domain/store";
import {dayMs,quakeFeed,stationDirectory,type EarthquakeDay,type StationDirectory,type Earthquake,type SeismicStation} from "../domain/earthquakes";
import type {Coordinate} from "../domain/types";
import {useFeed} from "./use-feed";
import "../styles/live-lightning.css";
import "../styles/earthquakes.css";

type Quakes=EarthquakeDay & {stale:boolean};
type Stations=StationDirectory & {stale:boolean};
type Selection={kind:"event"|"station";id:string};
type Mode="play"|"pause"|"live";
const feedKey=(d:Quakes)=>d.generated+"/"+d.stale;
const stationKey=(d:Stations)=>d.updated+"/"+d.stale;
const utc=(t:number)=>new Date(t).toISOString().slice(0,19).replace("T"," ")+" UTC";
const magnitude=(q:Earthquake)=>q.mag===null?"震级待定":"M "+q.mag.toFixed(1);
type Globe=ReturnType<typeof createRenderer>;
type Hit=Selection & {x:number;y:number;point:Coordinate};
interface MapState {events:Earthquake[];stations:SeismicStation[];cursor:number;selection:Selection|null;showStations:boolean}

function paint(canvas:HTMLCanvasElement,globe:Globe,view:MapState):Hit[]{
  const width=canvas.clientWidth,height=canvas.clientHeight,dpr=Math.min(devicePixelRatio,2);
  if(canvas.width!==Math.round(width*dpr)||canvas.height!==Math.round(height*dpr)){
    canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);
  }
  const ctx=canvas.getContext("2d")!;
  ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,width,height);
  const hits:Hit[]=[];
  function project(point:Coordinate){
    const p=globe.projectVisible(point);
    return p && p[0]>=0 && p[0]<=width && p[1]>=0 && p[1]<=height?p:null;
  }
  ctx.fillStyle="#548078";
  if(view.showStations)for(const s of view.stations){
    const p=project(s.point);if(!p)continue;
    const [x,y]=p;ctx.beginPath();ctx.moveTo(x,y-3.8);ctx.lineTo(x+3.5,y+2.8);ctx.lineTo(x-3.5,y+2.8);ctx.closePath();ctx.fill();
    hits.push({kind:"station",id:s.id,x,y,point:s.point});
  }
  for(const q of view.events){
    if(q.time>view.cursor)break;
    const p=project(q.point);if(!p)continue;
    const [x,y]=p,r=Math.max(2.6,2.5+(q.mag??0)*.85);
    ctx.fillStyle="#b55334";ctx.strokeStyle="#fff7e9";ctx.lineWidth=1;
    ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();ctx.stroke();
    const age=(view.cursor-q.time)/1800000;
    if(age<1){
      ctx.globalAlpha=.85*(1-age);ctx.strokeStyle="#b55334";
      ctx.beginPath();ctx.arc(x,y,r+2+age*15,0,Math.PI*2);ctx.stroke();ctx.globalAlpha=1;
    }
    hits.push({kind:"event",id:q.id,x,y,point:q.point});
  }
  const sel=hits.find(h=>h.kind===view.selection?.kind && h.id===view.selection.id);
  if(sel){ctx.strokeStyle="#303f38";ctx.lineWidth=1.4;ctx.beginPath();ctx.arc(sel.x,sel.y,11,0,Math.PI*2);ctx.stroke();}
  return hits;
}

export function EarthquakeCase({back}:{back:()=>void}){
  const {patch}=useWorkspace();
  const quakes=useFeed<Quakes>("/api/earthquakes/day",60000,false,feedKey);
  const network=useFeed<Stations>("/api/earthquakes/stations",3600000,false,stationKey);
  const [mode,setMode]=useState<Mode>("play"),[cursor,setCursor]=useState<number|null>(null);
  const [selection,select]=useState<Selection|null>(null),[showStations,toggleStations]=useState(true);
  const base=useRef<HTMLCanvasElement>(null),overlay=useRef<HTMLCanvasElement>(null),root=useRef<HTMLDivElement>(null);
  const globe=useRef<Globe|null>(null),initialized=useRef(false),endRef=useRef(0);
  const end=quakes.data?.generated ?? 0,start=end-dayMs;
  const time=mode==="live"?end:Math.max(start,Math.min(end,cursor??start));
  const events=quakes.data?.events,stations=network.data?.stations;
  const view=useRef<MapState>({events:[],stations:[],cursor:0,showStations:true,selection:null});
  useEffect(()=>{view.current={events:events??[],stations:stations??[],cursor:time,selection,showStations};},[events,stations,time,selection,showStations]);
  useEffect(()=>{patch({chatOpen:false});},[patch]);
  useEffect(()=>{
    if(!end)return;
    endRef.current=end;
    if(!initialized.current){
      initialized.current=true;setCursor(start);
      const first=events?.[0];
      if(first)globe.current?.flyTo({center:first.point,zoom:1,reason:"回放起点"});
    }
  },[end,start,events]);
  useEffect(()=>{
    if(mode!=="play" || !endRef.current)return;
    let last=performance.now();
    const timer=setInterval(()=>{
      const now=performance.now(),step=(now-last)*1800;
      last=now;if(document.hidden)return;
      setCursor(t=>Math.min(endRef.current,(t??endRef.current-dayMs)+step));
    },120);
    return ()=>clearInterval(timer);
  },[mode,!!end]);
  useEffect(()=>{if(mode==="play" && end && cursor!==null && cursor>=end)setMode("live");},[cursor,mode,end]);
  useEffect(()=>{
    let hits:Hit[]=[];
    const scene:Scene={observationGlobe:true,camera:{center:[155,20],zoom:1,reason:"全球地震"},caseId:null,filters:emptyFilters(),gridSystem:"h3",layer:"all",source:-1,selection:null,dataView:null,mesh:false,windTheme:"light",
      onObservationPick(x,y){
        const nearest=(kind:Hit["kind"])=>{
          let best:Hit|undefined,limit=10**2;
          for(const h of hits){const d=(h.x-x)**2+(h.y-y)**2;if(h.kind===kind && d<=limit){best=h;limit=d;}}
          return best;
        };
        const hit=nearest("event")??nearest("station");
        if(hit){select({kind:hit.kind,id:hit.id});engine.flyTo({center:hit.point,zoom:3.2,reason:"定位"+hit.id});}
      }};
    const engine=createRenderer(base.current!,root.current!,()=>scene,c=>{scene.camera=c;},()=>{},()=>{});
    globe.current=engine;
    let revision=-1,prior:MapState|undefined,raf=0;
    function draw(){
      if(engine.observationRevision!==revision || view.current!==prior){
        revision=engine.observationRevision;prior=view.current;
        hits=paint(overlay.current!,engine,prior);
      }
      raf=requestAnimationFrame(draw);
    }
    draw();return ()=>{cancelAnimationFrame(raf);engine.dispose();globe.current=null;};
  },[]);
  const quake=selection?.kind==="event"?events?.find(q=>q.id===selection.id):undefined;
  const station=selection?.kind==="station"?stations?.find(s=>s.id===selection.id):undefined;
  const latest=events?.at(-1);
  function goLive(){setMode("live");}
  function showLatest(){
    if(!latest)return;
    goLive();select({kind:"event",id:latest.id});
    globe.current?.flyTo({center:latest.point,zoom:3.2,reason:"定位最新震中"});
  }
  function replay(){select(null);setCursor(start);setMode("play");}
  return <section className="strike-case quake-case"><div className="strike-globe" ref={root}>
    <canvas className="strike-base" ref={base} aria-label="全球地震地球"/>
    <canvas className="strike-overlay" ref={overlay} aria-hidden="true"/>
    <header className="strike-heading"><button onClick={back}><ArrowLeft size={15}/>案例</button><h1>全球地震</h1>
      <div className="quake-key"><span><b>●</b> 震中</span><label><input type="checkbox" checked={showStations} onChange={e=>{toggleStations(e.target.checked);if(station)select(null);}}/>▲ 地震台站</label></div>
      <small><a href={quakeFeed} target="_blank" rel="noreferrer">USGS 地震目录 ↗</a> · <a href={stationDirectory} target="_blank" rel="noreferrer">GSN / ANSS ↗</a></small>
    </header>
    <div className="strike-navigation"><button data-plus aria-label="放大">＋</button><button data-minus aria-label="缩小">−</button><button data-reset>全球视野</button></div>
    {(quake||station) && <aside className="quake-detail"><button aria-label="关闭详情" onClick={()=>select(null)}><X size={16}/></button>
      {quake?<><small>震中</small><strong>{quake.place}</strong><span>{magnitude(quake)} · 深度 {quake.depth===null?"待定":quake.depth+" km"}</span><time>发生于 {utc(quake.time)}</time><a href={quake.url} target="_blank" rel="noreferrer">USGS 事件页 ↗</a></>:<><small>地震台站 · {station!.id}</small><strong>{station!.name}</strong></>}
    </aside>}
    <div className="quake-timeline">
      <div className="quake-summary"><strong>{mode==="live"?"实时更新":mode==="pause"?"回放已暂停":"过去 24 小时回放"}</strong>
        <span>{events?events.length+" 次地震":"正在读取地震目录"}{stations?" · "+stations.length+" 个台站":""}</span></div>
      {end>0 && <><time>{utc(time)}</time><input aria-label="地震回放时间" type="range" min={start} max={end} step={1000} value={time} onChange={e=>{select(null);setMode("pause");setCursor(Number(e.target.value));}}/>
        <div className="quake-actions"><button onClick={mode==="live"?replay:()=>setMode(mode==="play"?"pause":"play")}>{mode==="play"?<Pause size={14}/>:<Play size={14}/>} {mode==="play"?"暂停":mode==="pause"?"继续":"回放"}</button>
        <button onClick={replay} aria-label="从头回放"><RotateCcw size={14}/></button><button aria-pressed={mode==="live"} onClick={goLive}>实时</button>
        {latest && <button onClick={showLatest}>定位最新地震</button>}</div></>}
      {(quakes.failed||quakes.data?.stale)&&<small>地震目录更新失败，正在重试</small>}
      {(network.failed||network.data?.stale)&&<small>台站目录暂未更新</small>}
    </div>
  </div></section>;
}
