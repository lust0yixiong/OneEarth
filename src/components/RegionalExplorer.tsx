import {useEffect,useMemo,useRef,useState} from "react";
import {ArrowLeft,Pause,Play,Plus,Minus,RotateCcw} from "lucide-react";
import {regionalCases,stormWindow,type RegionalData,type RegionalId,type XY} from "../domain/regional-cases";
import "../styles/regional-cases.css";

type ScreenPoint={x:number;y:number;index:number};
function color(id:RegionalId,t:number) {
  const palettes = {
    rain:[[28,68,93],[37,139,162],[89,209,178],[246,213,114]],
    rivers:[[41,112,154],[58,177,194],[125,226,199],[226,246,198]],
    lightning:[[98,64,133],[200,95,137],[254,167,98],[255,237,158]],
    forest:[[66,108,176],[76,175,150],[232,196,74],[204,72,132]],
    c40:[[66,108,176],[76,175,150],[232,196,74],[204,72,132]]
  };
  const stops=palettes[id],v=Math.max(0,Math.min(2.999,t*3)),i=Math.floor(v);
  return 'rgb('+stops[i].map((n,k)=>Math.round(n+(stops[i+1][k]-n)*(v-i))).join(',')+')';
}
function trace(ctx:CanvasRenderingContext2D, coords:XY[], close=false) {
  ctx.beginPath();
  coords.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));
  if(close)ctx.closePath();
}
export function RegionalExplorer({id,onBack}:{id:RegionalId;onBack:()=>void}) {
  const [storm,setStorm]=useState(false);
  return <ExplorerPlot key={id+storm} id={id} storm={storm} setStorm={setStorm} onBack={onBack}/>;
}
function ExplorerPlot({id,storm,setStorm,onBack}:{id:RegionalId;storm:boolean;setStorm:(v:boolean)=>void;onBack:()=>void}) {
  const annual=id==="lightning" && !storm;
  const item=storm?stormWindow:regionalCases[id],canvas=useRef<HTMLCanvasElement>(null),hits=useRef<ScreenPoint[]>([]);
  const [data,setData]=useState<RegionalData|null>(null),[error,setError]=useState(false),[retry,setRetry]=useState(0);
  const [frame,setFrame]=useState<number>(item.initial),[playing,setPlaying]=useState(false),[selected,select]=useState<number|null>(null);
  const [angle,setAngle]=useState(id==="lightning"?0:-.13),[zoom,setZoom]=useState(1),[size,resize]=useState([800,460]);
  const [offset,setOffset]=useState<XY>([0,0]);
  const drag=useRef<{x:number;y:number;offset:XY;pan:boolean;angle:number;moved:boolean}|null>(null);
  useEffect(()=>{const ctrl=new AbortController();setError(false);
    fetch("/visualizations/regional/"+(annual?"lightning-year":id==="rain"?"rain-native":id)+".json",{signal:ctrl.signal}).then(r=>{if(!r.ok)throw Error();return r.json()}).then(d=>{if(!ctrl.signal.aborted)setData(d)}).catch(()=>{if(!ctrl.signal.aborted)setError(true)});
    return ()=>ctrl.abort();},[annual,id,retry]);
  useEffect(()=>{const el=canvas.current;if(!el)return;const ob=new ResizeObserver(()=>resize([el.clientWidth,el.clientHeight]));ob.observe(el);return ()=>ob.disconnect()},[]);
  useEffect(()=>{if(!playing || !data)return;const timer=window.setInterval(()=>setFrame(i=>(i+1)%data.dates.length),id==="lightning"?270:150);return ()=>clearInterval(timer)},[playing,data,id]);
  const neighbors=useMemo(()=>new Map(data?.points.map((p,i)=>[p.xy.join(","),i])),[data]);
  useEffect(()=>{
    const el=canvas.current,ctx=el?.getContext("2d");if(!el||!ctx||!data)return;
    const [w,h]=size,dpr=Math.min(window.devicePixelRatio,2);el.width=w*dpr;el.height=h*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);
    const [west,south,east,north]=item.extent,lat=(north+south)/2,cosLat=Math.cos(lat*Math.PI/180);
    const tilt=id==="lightning"?.96:.72, scale=zoom*Math.min(w*.84/((east-west)*cosLat),h*.73/((north-south)*tilt));
    const project=([lon,y]:XY,height=0):XY=>{
      const dx=(lon-(west+east)/2)*cosLat,dy=lat-y;
      return [offset[0]+w/2+scale*(dx*Math.cos(angle)-dy*Math.sin(angle)),offset[1]+h*.53+scale*tilt*(dy*Math.cos(angle)+dx*Math.sin(angle))-height];
    };
    for(const ring of data.outline){trace(ctx,ring.map(p=>project(p)),true);ctx.fillStyle="#173646";ctx.fill();ctx.strokeStyle="#508093";ctx.lineWidth=.9;ctx.stroke();}
    if(data.network){
      ctx.strokeStyle="#376375";ctx.lineWidth=.65;
      for(const line of data.network){trace(ctx,line.map(p=>project(p)));ctx.stroke();}
    }
    const values=data.frames[frame],maxHeight=h*.17,targets:ScreenPoint[]=[];
    type Face={depth:number;coords:XY[];tone:string;edge:boolean};
    const faces:Face[]=[];
    data.points.forEach((p,i)=>{
      const value=values[i];if(value===null)return;
      const strength=(n:number)=>Math.min(1,id==="rain"?n/item.ceiling:Math.sqrt(n/item.ceiling));
      const t=strength(value),height=maxHeight*t;
      const [x,y]=project(p.xy,id==="lightning"?0:height);
      targets.push({x,y,index:i});
      if(id==="rain"){
        const [lon,lat]=p.xy;
        const corners=[i,...[[lon+.5,lat],[lon+.5,lat+.5],[lon,lat+.5]].map(x=>neighbors.get(x.join(",")))];
        if(corners.some(n=>n===undefined||values[n]===null))return;
        const ns=corners as number[],mean=ns.reduce((a,n)=>a+values[n]!,0)/4;
        faces.push({depth:project(p.xy)[1],coords:ns.map(n=>project(data.points[n].xy,maxHeight*strength(values[n]!))),tone:color(id,strength(mean)),edge:true});
      }else if(id==="rivers" && p.line){
        const line=p.line.map(q=>project(q)),top=line.map(([px,py]):XY=>[px,py-height]);
        for(let j=1;j<line.length;j++){
          targets.push({x:top[j][0],y:top[j][1],index:i},{x:line[j][0],y:line[j][1],index:i});
          faces.push({depth:(line[j-1][1]+line[j][1])/2,coords:[line[j-1],line[j],top[j],top[j-1]],tone:color(id,t*.8),edge:false});
        }
        ctx.strokeStyle="#35869c";ctx.lineWidth=.8+2.6*Math.sqrt(Math.min(1,(p.mean||0)/item.ceiling));trace(ctx,line);ctx.stroke();
      }else if(id==="lightning" && value>0){
        const [lon,lat]=p.xy,r=annual?.25:.125,cell:XY[]=[[-r,-r],[r,-r],[r,r],[-r,r]];
        trace(ctx,cell.map(([dx,dy])=>project([lon+dx,lat+dy])),true);ctx.fillStyle=color(id,t);ctx.fill();
      }
    });
    faces.sort((a,b)=>a.depth-b.depth);for(const face of faces){trace(ctx,face.coords,true);ctx.fillStyle=face.tone;ctx.fill();if(face.edge){ctx.strokeStyle="#182f4540";ctx.lineWidth=.4;ctx.stroke();}}
    if(id==="rivers")data.points.forEach((p,i)=>{if(!p.line||values[i]===null)return;
      const t=Math.min(1,Math.sqrt(values[i]!/item.ceiling));trace(ctx,p.line.map(q=>project(q,maxHeight*t)));ctx.lineWidth=.8+2.6*Math.sqrt(Math.min(1,(p.mean||0)/item.ceiling));ctx.strokeStyle=color(id,.45+t*.55);ctx.stroke();});
    hits.current=targets;const focus=targets.find(t=>t.index===selected);
    if(focus){ctx.beginPath();ctx.arc(focus.x,focus.y,5,0,Math.PI*2);ctx.strokeStyle="#fff";ctx.lineWidth=2;ctx.stroke();}
  },[size,data,id,item,frame,angle,zoom,selected,neighbors,annual,offset]);
  const focus=selected===null?null:data?.points[selected],value=selected===null?null:data?.frames[frame][selected];
  function pick(x:number,y:number){const r=canvas.current!.getBoundingClientRect();let best=24**2,index=null;for(const p of hits.current){const d=(p.x-x+r.left)**2+(p.y-y+r.top)**2;if(d<best){best=d;index=p.index}}select(index);}
  return <section className="regional-explorer" aria-label={item.title}>
    <button className="regional-back" onClick={onBack}><ArrowLeft size={15}/>返回球面</button>
    <header><h1>{item.title}</h1><p>{item.dataset} · {item.period}</p></header>
    {id==="lightning" && <div className="regional-modes" aria-label="闪电数据集">
      <button aria-pressed={annual} onClick={()=>setStorm(false)}>全年地闪</button>
      <button aria-pressed={storm} onClick={()=>setStorm(true)}>半小时卫星观测</button>
    </div>}
    <div className="regional-stage">
      <canvas ref={canvas} aria-label={item.variable+"空间分布"} onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);drag.current={x:e.clientX,y:e.clientY,pan:e.shiftKey,offset,angle,moved:false}}}
        onPointerMove={e=>{const d=drag.current;if(d){const dx=e.clientX-d.x,dy=e.clientY-d.y;if(Math.hypot(dx,dy)>3)d.moved=true;if(d.moved){if(d.pan)setOffset([d.offset[0]+dx,d.offset[1]+dy]);else setAngle(d.angle+dx*.006)}}else if(e.pointerType==="mouse")pick(e.clientX,e.clientY)}}
        onPointerUp={e=>{if(!drag.current?.moved)pick(e.clientX,e.clientY);drag.current=null}} onPointerCancel={()=>{drag.current=null}}/>
      {!data && <p role="status" className="regional-loading">{error?<button onClick={()=>setRetry(n=>n+1)}>读取失败 · 重新载入</button>:"正在载入数据…"}</p>}
      <div className="regional-tools"><button aria-label="放大视图" onClick={()=>setZoom(z=>Math.min(4,z*1.25))}><Plus size={15}/></button><button aria-label="缩小视图" onClick={()=>setZoom(z=>Math.max(.6,z/1.25))}><Minus size={15}/></button><button aria-label="复位视图" onClick={()=>{setAngle(id==="lightning"?0:-.13);setZoom(1);setOffset([0,0]);select(null)}}><RotateCcw size={14}/></button></div>
      <div className="regional-key"><strong>{item.variable} · {item.unit}</strong><i style={{background:'linear-gradient(to right,'+[0,.33,.66,1].map(t=>color(id,t)).join(',')+')'}}/><small>0 <span>{item.ceiling.toLocaleString()}+</span></small></div>
      {focus && <div className="regional-reading">{focus.name && <strong>{focus.name} · </strong>}{focus.xy.map(n=>n.toFixed(2)+"°").join(", ")}<br/>{value==null?"缺测":value.toLocaleString()+" "+item.unit}</div>}
    </div>
    {data && <div className="regional-time"><button aria-label={playing?"暂停":"播放"} onClick={()=>setPlaying(p=>!p)}>{playing?<Pause size={15}/>:<Play size={15}/>}</button><output>{data.dates[frame]}</output><input aria-label="数据时间轴" type="range" min={0} max={data.dates.length-1} value={frame} onChange={e=>{setPlaying(false);setFrame(+e.target.value)}}/></div>}
    <p>{item.intro} 拖动旋转，按住 Shift 拖动平移，点选读取数值。</p>
    <details><summary>数据与处理方法</summary><p>{item.method}</p><a href={item.source} target="_blank" rel="noreferrer">数据来源 ↗</a> · <a href={item.reference} target="_blank" rel="noreferrer">设计参考 · mapped.earth ↗</a></details>
  </section>;
}
