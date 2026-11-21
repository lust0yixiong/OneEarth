import {useEffect,useRef,useState} from "react";
import {ArrowLeft, Volume2, VolumeX, X} from "lucide-react";
import {createRenderer,type Scene} from "../globe/renderer";
import {emptyFilters} from "../domain/spatial";
import {useWorkspace} from "../domain/store";
import type {WeatherStation} from "../domain/weather-stations";
import type {Coordinate} from "../domain/types";
import {useWeatherObservations} from "./weather-observations";
import {animateWeather,mapStations,type WeatherHit} from "./weather-globe";
import "../styles/live-lightning.css";

const utc=(ms:number)=>new Date(ms).toISOString().slice(0,19).replace("T"," ")+" UTC";
function chime(ac:AudioContext,lon:number,lat:number,interval:number){
  const scale=[0,2,4,7,9];
  const degree=Math.min(4,Math.floor((lon+180)/72));
  const octave=lat>25?2:lat< -25?.5:1;
  const frequency=220*octave*2**(scale[degree]/12);
  const duration=Math.min(1.6,Math.max(.42,interval/550));
  const pan=ac.createStereoPanner();
  pan.pan.value=Math.sin(lon*Math.PI/180)*.8;
  pan.connect(ac.destination);
  for(const [ratio,volume] of [[1,.052],[1.5,.017]]){
    const osc=ac.createOscillator(),gain=ac.createGain(),t=ac.currentTime;
    osc.frequency.value=frequency*ratio;
    gain.gain.setValueAtTime(.0001,t);gain.gain.exponentialRampToValueAtTime(volume,t+.025);
    gain.gain.exponentialRampToValueAtTime(.0001,t+duration);
    osc.connect(gain);gain.connect(pan);osc.start();osc.stop(t+duration+.04);
    osc.onended=()=>{osc.disconnect();gain.disconnect();if(ratio!==1)pan.disconnect();};
  }
}

export function LiveLightning({back}:{back:()=>void}){
  const {patch}=useWorkspace();
  const [paused,setPaused]=useState(false),[sound,setSound]=useState(false);
  const {stations,east,west}=useWeatherObservations(paused);
  const [selected,setSelected]=useState<WeatherStation|null>(null);
  const [audioError,setAudioError]=useState(false);
  const root=useRef<HTMLDivElement>(null),base=useRef<HTMLCanvasElement>(null);
  const dots=useRef<HTMLCanvasElement>(null),effects=useRef<HTMLCanvasElement>(null);
  const audio=useRef<AudioContext|null>(null),engine=useRef<ReturnType<typeof createRenderer>|null>(null);
  const live=useRef({stations:stations.data,east:east.data,west:west.data,paused});
  useEffect(()=>{live.current={stations:stations.data,east:east.data,west:west.data,paused};},[stations.data,east.data,west.data,paused]);
  useEffect(()=>{patch({chatOpen:false});},[patch]);
  useEffect(()=>{
    let hits:WeatherHit[]=[];
    const scene:Scene={observationGlobe:true,camera:{center:[103,18],zoom:1,reason:"全球天气"},caseId:null,filters:emptyFilters(),gridSystem:"h3",layer:"all",source:-1,selection:null,dataView:null,mesh:false,windTheme:"light",
      onObservationPick(x,y){
        let limit=13**2,nearest:WeatherStation|null=null;
        for(const hit of hits){
          const distance=(hit.x-x)**2+(hit.y-y)**2;
          if(distance<limit){limit=distance;nearest=hit.station;}
        }
        setSelected(nearest);
      }};
    const globe=createRenderer(base.current!,root.current!,()=>scene,camera=>{scene.camera=camera;},()=>{},()=>{});
    engine.current=globe;
    const stop=animateWeather(effects.current!,globe,()=>live.current,(stations)=>{
      hits=mapStations(dots.current!,stations,globe);
      return hits.filter(hit=>hit.station.storm);
    },(point,interval)=>{if(audio.current?.state==="running")chime(audio.current,...point,interval);});
    return ()=>{stop();globe.dispose();engine.current=null;const ac=audio.current;audio.current=null;if(ac)void ac.close();};
  },[]);
  async function toggleSound(){
    try{
      const ac=audio.current??=new AudioContext();
      if(ac.state==="running" && sound)await ac.suspend();else await ac.resume();
      setSound(ac.state==="running");setAudioError(false);
    }catch{setAudioError(true);}
  }
  function focus(center:Coordinate){engine.current?.flyTo({center,zoom:1,reason:"天气视野"});}
  const station=stations.data?.stations.find(row=>row.id===selected?.id);
  const stormCount=stations.data?.stations.filter(row=>row.storm).length;
  const feedTime=(time:number|undefined,failed:boolean,age:number)=>{
    if(!time)return failed?"暂不可用，正在重试":"读取中…";
    return utc(time)+(failed?" · 更新失败":!paused && Date.now()-time>age?" · 延迟":"");
  };
  return <section className="strike-case"><div className="strike-globe" ref={root}>
    <canvas className="strike-base" ref={base} aria-label="全球雷暴与天气实况地球"/>
    <canvas className="strike-overlay" ref={dots} aria-hidden="true"/>
    <canvas className="strike-overlay" ref={effects} aria-hidden="true"/>
    <header className="strike-heading"><button onClick={back}><ArrowLeft size={15}/>案例</button>
      <h1>全球雷暴与天气实况</h1>
      <div className="weather-key"><span><i className="station-dot"/>气象站</span><span><i className="storm-ring"/>站点雷暴</span><span><i className="flash-diamond"/>卫星闪电</span></div>
    </header>
    <div className="strike-navigation"><button data-plus aria-label="放大">＋</button><button data-minus aria-label="缩小">−</button><button data-reset>全球视野</button><button onClick={()=>focus([-88,6])}>美洲视野</button></div>
    {station && <aside className="weather-detail"><button aria-label="关闭站点详情" onClick={()=>setSelected(null)}><X size={15}/></button>
      <strong>{station.name}</strong><small>{station.id} · {station.storm?"站点报告雷暴":"气象站观测"}</small>
      <span>{[station.temperature!==null && station.temperature+" °C",station.wind!==null && "风速 "+station.wind+" kt",station.weather].filter(Boolean).join(" · ")}</span>
      <time>{utc(station.observed)}</time></aside>}
    <div className="strike-caption">
      <div className="weather-sources">
        <div><a href="https://aviationweather.gov/data/api/" target="_blank" rel="noreferrer">全球站点 ↗</a><span>{stations.data?stations.data.stations.length.toLocaleString()+" 站 · "+stormCount+" 站报告雷暴":"METAR / SPECI"}</span></div>
        <div><em>最新站点观测</em><time>{feedTime(stations.data?.latest,stations.failed,7200000)}</time></div>
        {([["GOES-19",east],["GOES-18",west]] as const).map(([name,feed])=><div key={name}><a href={feed.data?.source ?? "https://www.ncei.noaa.gov/products/goes-terrestrial-weather-abi-glm"} target="_blank" rel="noreferrer">{name} ↗</a><time title="最新卫星观测窗口结束时间">{feedTime(feed.data?.end,feed.failed,120000)}</time></div>)}
      </div><div className="weather-controls"><button aria-pressed={paused} onClick={()=>setPaused(!paused)}>{paused?"继续":"暂停"}</button>
      <button aria-pressed={sound} onClick={()=>void toggleSound()}>{sound?<Volume2 size={15}/>:<VolumeX size={15}/>}声音</button>{audioError && <small>声音暂不可用</small>}</div>
    </div></div></section>;
}
