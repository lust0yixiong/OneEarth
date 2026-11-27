import {useEffect,useLayoutEffect,useRef,useState} from "react";
import {ArrowLeft,Pause,Play,RotateCcw,X} from "lucide-react";
import type {createRenderer,Scene} from "../globe/renderer";
import {createObservationGlobe} from "../globe/observation-globe";
import {strictCesiumMode} from "../globe/cesium-mode";
import {readCaseObservationRef,type CaseObservationRef} from "../domain/case-observations";
import {emptyFilters} from "../domain/spatial";
import {useWorkspace} from "../domain/store";
import {dayMs,quakeFeed,stationDirectory,type EarthquakeDay,type StationDirectory,type Earthquake,type SeismicStation} from "../domain/earthquakes";
import type {Coordinate} from "../domain/types";
import {useFeed} from "./use-feed";
import "../styles/live-lightning.css";
import "../styles/earthquakes.css";

type Quakes=EarthquakeDay & {stale:boolean};
type Stations=StationDirectory & {stale:boolean};
type Choice={kind:"event";record:Earthquake}|{kind:"station";record:SeismicStation};
type Selection={choice:Choice;observation?:CaseObservationRef};
type Mode="play"|"pause"|"live";
const feedKey=(d:Quakes)=>d.generated+"/"+d.stale+"/"+(d.snapshotId??"");
const stationKey=(d:Stations)=>d.updated+"/"+d.stale;
const utc=(t:number)=>new Date(t).toISOString().slice(0,19).replace("T"," ")+" UTC";
const magnitude=(q:Earthquake)=>q.mag===null?"震级待定":"M "+q.mag.toFixed(1);
type Globe=ReturnType<typeof createRenderer>;
type Hit={choice:Choice;x:number;y:number};
interface MapState {events:Earthquake[];stations:SeismicStation[];cursor:number;selection:Selection|null;showStations:boolean;snapshotId?:string}

function paint(canvas:HTMLCanvasElement,viewport:HTMLCanvasElement,globe:Globe,view:MapState):Hit[]{
  const width=viewport.clientWidth,height=viewport.clientHeight,dpr=Math.min(devicePixelRatio,2);
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
    hits.push({choice:{kind:"station",record:s},x,y});
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
    hits.push({choice:{kind:"event",record:q},x,y});
  }
  const sel=hits.find(h=>h.choice.kind===view.selection?.choice.kind && h.choice.record.id===view.selection.choice.record.id);
  if(sel){ctx.strokeStyle="#303f38";ctx.lineWidth=1.4;ctx.beginPath();ctx.arc(sel.x,sel.y,11,0,Math.PI*2);ctx.stroke();}
  return hits;
}

function selectObservation(choice:Choice,snapshotId?:string):Selection {
  const observation=choice.kind==="event"?readCaseObservationRef({
    kind:"usgs-earthquake",snapshotId,id:choice.record.id,observedAt:choice.record.time,
  }):undefined;
  return {choice,observation};
}

export function EarthquakeCase({back}:{back:()=>void}){
  const {patch,registerWorkspaceSurface}=useWorkspace();
  const quakes=useFeed<Quakes>("/api/earthquakes/day",60000,false,feedKey);
  const network=useFeed<Stations>("/api/earthquakes/stations",3600000,false,stationKey);
  const [mode,setMode]=useState<Mode>("play"),[cursor,setCursor]=useState<number|null>(null);
  const [selection,select]=useState<Selection|null>(null),[showStations,toggleStations]=useState(true);
  const base=useRef<HTMLCanvasElement>(null),overlay=useRef<HTMLCanvasElement>(null),root=useRef<HTMLDivElement>(null);
  const cesiumHost=useRef<HTMLDivElement>(null);
  const globe=useRef<Globe|null>(null),initialized=useRef(false),endRef=useRef(0);
  const end=quakes.data?.generated ?? 0,start=end-dayMs;
  const time=mode==="live"?end:Math.max(start,Math.min(end,cursor??start));
  const events=quakes.data?.events,stations=network.data?.stations;
  const view=useRef<MapState>({events:[],stations:[],cursor:0,showStations:true,selection:null});
  const snapshotId=quakes.data?.snapshotId;
  useLayoutEffect(()=>{view.current={events:events??[],stations:stations??[],cursor:time,selection,showStations,snapshotId};},
    [events,stations,time,selection,showStations,snapshotId]);
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
    let presented:{hits:Hit[];revision:number;snapshotId?:string}|undefined;
    const scene:Scene={observationGlobe:true,camera:{center:[155,20],zoom:1,reason:"全球地震"},caseId:null,filters:emptyFilters(),gridSystem:"h3",layer:"all",source:-1,selection:null,dataView:null,mesh:false,windTheme:"light",
      onObservationPick(x,y){
        if(!presented||presented.revision!==engine.observationRevision)return;
        const {hits,snapshotId}=presented;
        const nearest=(kind:Choice["kind"])=>{
          let best:Hit|undefined,limit=10**2;
          for(const hit of hits){
            const distance=(hit.x-x)**2+(hit.y-y)**2;
            if(hit.choice.kind===kind&&distance<=limit){best=hit;limit=distance;}
          }
          return best;
        };
        const hit=nearest("event")??nearest("station");
        if(hit){
          select(selectObservation(hit.choice,snapshotId));
          engine.flyTo({center:hit.choice.record.point,zoom:3.2,reason:"定位"+hit.choice.record.id});
        }
      }};
    const globeSurface=createObservationGlobe(root.current!,cesiumHost.current,base.current,[overlay.current!],scene,"全球地震地球");
    const {engine,viewport,layers,present}=globeSurface;
    globe.current=engine;
    let revision=-1,prior:MapState|undefined,raf=0;
    function draw(){
      if(engine.observationRevision!==revision||view.current!==prior){
        revision=engine.observationRevision;prior=view.current;
        const next={hits:paint(layers[0],viewport,engine,prior),revision,snapshotId:prior.snapshotId};
        present(()=>{
          presented=next;
          viewport.dataset.observationEvents=String(next.hits.filter(hit=>hit.choice.kind==="event").length);
          viewport.dataset.observationStations=String(next.hits.filter(hit=>hit.choice.kind==="station").length);
        });
      }
      raf=requestAnimationFrame(draw);
    }
    draw();return ()=>{cancelAnimationFrame(raf);globeSurface.dispose();globe.current=null;};
  },[]);
  const quake=selection?.choice.kind==="event"?selection.choice.record:undefined;
  const station=selection?.choice.kind==="station"?selection.choice.record:undefined;
  const latest=events?.at(-1);
  function goLive(){setMode("live");}
  function showLatest(){
    if(!latest)return;
    goLive();select(selectObservation({kind:"event",record:latest},snapshotId));
    globe.current?.flyTo({center:latest.point,zoom:3.2,reason:"定位最新震中"});
  }
  function replay(){select(null);setCursor(start);setMode("play");}
  useLayoutEffect(() => registerWorkspaceSurface(() => ({
    surface: "cases", case: {id: "earthquakes", title: "全球地震"},
    observation: selection?.observation,
    activeLayer: {
      id: "earthquakes", title: "全球地震", status: quakes.data ? "ready" : quakes.failed ? "unavailable" : "loading",
      controls: [],
      display: [
        {label: "播放状态", value: mode === "live" ? "实时更新" : mode === "pause" ? "回放已暂停" : "过去 24 小时回放"},
        ...(end > 0 ? [{label: "当前时刻", value: utc(time)}] : []),
        {label: "地震台站", value: showStations ? "显示" : "隐藏"},
      ],
    },
    ...(quake || station ? {display: [{label: quake ? "已选震中" : "已选地震台站",
      value: (quake?.place || station?.name || "已选记录").slice(0,240)}]} : {}),
  })));
  return <section className="strike-case quake-case"><div className="strike-globe" ref={root}>
    {strictCesiumMode ? <div className="strike-cesium" ref={cesiumHost}/> : <>
      <canvas className="strike-base" ref={base} aria-label="全球地震地球"/>
      <canvas className="strike-overlay" ref={overlay} aria-hidden="true"/>
    </>}
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
