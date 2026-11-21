import type {createRenderer} from "../globe/renderer";
import type {LightningFrame} from "../domain/lightning-frame";
import type {WeatherStation,StationSnapshot} from "../domain/weather-stations";
import type {Coordinate} from "../domain/types";

type Globe=ReturnType<typeof createRenderer>;
export interface WeatherHit {x:number;y:number;station:WeatherStation}
interface Feeds {stations?:StationSnapshot;east?:LightningFrame;west?:LightningFrame;paused:boolean}
const teal="#187d77",gold="#bc7917";
function surface(canvas:HTMLCanvasElement){
  const width=canvas.clientWidth,height=canvas.clientHeight,dpr=Math.min(devicePixelRatio,2);
  if(canvas.width!==Math.round(width*dpr) || canvas.height!==Math.round(height*dpr)){
    canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);
  }
  const ctx=canvas.getContext("2d")!;
  ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,width,height);
  return ctx;
}
export function mapStations(canvas:HTMLCanvasElement,stations:WeatherStation[],globe:Globe){
  const ctx=surface(canvas), hits:WeatherHit[]=[];
  ctx.fillStyle="rgba(75,118,115,.58)";
  for(const station of stations){
    const p=globe.projectVisible(station.point);
    if(!p || p[0]<0 || p[1]<0 || p[0]>canvas.clientWidth || p[1]>canvas.clientHeight)continue;
    hits.push({x:p[0],y:p[1],station});
    ctx.fillRect(p[0]-.85,p[1]-.85,1.7,1.7);
  }
  return hits;
}
interface Pulse {point:Coordinate;stamp:number;born:number;satellite:string}
interface Playback {frame?:LightningFrame;anchor:number;index:number}
// Preserve the cadence within each 20-second observation file. Only a new file
// starts a sequence; a poll, camera move or foreground transition cannot repeat it.
export function animateWeather(canvas:HTMLCanvasElement,globe:Globe,read:()=>Feeds,
  drawStations:(stations:WeatherStation[])=>WeatherHit[],sound:(point:Coordinate,interval:number)=>void){
  let running=true,raf=0,lastTick=0,clock=0,revision=-1,snapshot:StationSnapshot|undefined;
  let storms:WeatherHit[]=[],pulses:Pulse[]=[];
  let label:{point:Coordinate;text:string;born:number}|undefined;
  let lastTone=-Infinity,lastLabel=-Infinity;
  let place:((point:Coordinate)=>string)|undefined;
  void import("../data/evidence/geo-orientation.mjs").then(m=>{if(running)place=p=>m.geoOrientation(p).split("（")[0];}).catch(()=>{});
  const streams:Playback[]=[{anchor:0,index:0},{anchor:0,index:0}];
  function consume(stream:Playback,frame:LightningFrame|undefined,satellite:string){
    if(!frame)return;
    if(stream.frame!==frame){
      stream.frame=frame;stream.anchor=clock;stream.index=0;
    }
    if(Date.now()-frame.end>120000)return;
    const at=frame.start+clock-stream.anchor;
    while(stream.index<frame.flashes.length && frame.flashes[stream.index][0]<=at){
      const [stamp,lon,lat]=frame.flashes[stream.index++];
      if(at-stamp>2200)continue;
      pulses.push({point:[lon,lat],stamp,born:clock-(at-stamp),satellite});
    }
  }
  function annotate(ctx:CanvasRenderingContext2D,x:number,y:number,title:string,color:string){
    ctx.font="12px system-ui";ctx.textBaseline="middle";
    const w=ctx.measureText(title).width+10;
    x=Math.max(2,Math.min(canvas.clientWidth-w-2,x+9));
    ctx.fillStyle="rgba(255,255,255,.92)";ctx.fillRect(x,y-18,w,19);
    ctx.fillStyle=color;ctx.fillText(title,x+5,y-8);
  }
  function draw(now:number){
    if(!running)return;
    raf=requestAnimationFrame(draw);
    if(document.hidden || now-lastTick<40)return;
    const feeds=read(),delta=lastTick?now-lastTick:0;lastTick=now;
    if(!feeds.paused)clock+=Math.min(delta,150);
    if(revision!==globe.observationRevision || snapshot!==feeds.stations){
      const previous=snapshot;
      revision=globe.observationRevision;snapshot=feeds.stations;storms=drawStations(snapshot?.stations ?? []);
      if(previous && snapshot!==previous && !feeds.paused){
        const before=new Map(previous.stations.map(s=>[s.id,s.observed]));
        const report=storms.find(({station})=>station.observed>(before.get(station.id) ?? 0));
        if(report && clock-lastTone>190){
          sound(report.station.point,600);lastTone=clock;
        }
      }
    }
    const ctx=surface(canvas);
    const stormPhase=(clock%2600)/2600;
    for(const {x,y} of storms){
      ctx.strokeStyle=teal;ctx.lineWidth=1.8;ctx.beginPath();ctx.arc(x,y,4,0,Math.PI*2);ctx.stroke();
      ctx.globalAlpha=.47*(1-stormPhase);ctx.lineWidth=1;ctx.beginPath();ctx.arc(x,y,5+stormPhase*10,0,Math.PI*2);ctx.stroke();ctx.globalAlpha=1;
    }
    if(storms.length){
      const {station,x,y}=storms[Math.floor(clock/5000)%storms.length];
      annotate(ctx,x,y,station.name+" · 雷暴 "+new Date(station.observed).toISOString().slice(11,16)+" UTC",teal);
    }
    if(!feeds.paused){
      consume(streams[0],feeds.east,"GOES-19");consume(streams[1],feeds.west,"GOES-18");
    }
    pulses=pulses.filter(p=>clock-p.born<2000);
    for(const pulse of pulses){
      const xy=globe.projectVisible(pulse.point);
      if(!xy || xy[0]<0 || xy[1]<0 || xy[0]>canvas.clientWidth || xy[1]>canvas.clientHeight)continue;
      const [x,y]=xy,age=(clock-pulse.born)/2000;
      ctx.globalAlpha=1-age;ctx.fillStyle=gold;ctx.beginPath();
      ctx.moveTo(x,y-4);ctx.lineTo(x+3,y);ctx.lineTo(x,y+4);ctx.lineTo(x-3,y);ctx.closePath();ctx.fill();
      ctx.globalAlpha=.7*(1-age);ctx.strokeStyle=gold;ctx.lineWidth=1;ctx.beginPath();ctx.arc(x,y,4+age*23,0,Math.PI*2);ctx.stroke();
      if(!feeds.paused && clock-pulse.born<=delta && clock-lastTone>190){
        sound(pulse.point,Number.isFinite(lastTone)?clock-lastTone:500);lastTone=clock;
      }
      if(!feeds.paused && place && clock-pulse.born<=delta && clock-lastLabel>1600){
        const name=place(pulse.point);
        label={point:pulse.point,born:clock,text:name+" · "+pulse.satellite+" "+new Date(pulse.stamp).toISOString().slice(11,19)+" UTC"};lastLabel=clock;
      }
    }
    ctx.globalAlpha=1;
    if(label && clock-label.born<1900){
      const p=globe.projectVisible(label.point);
      if(p)annotate(ctx,p[0],p[1],label.text,"#795113");
    }
  }
  raf=requestAnimationFrame(draw);
  return ()=>{running=false;cancelAnimationFrame(raf);};
}
