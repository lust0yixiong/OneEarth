import {CalendarRange,ChevronLeft,ChevronRight,Pause,Play} from "lucide-react";
import type {HainaForestManifest} from "../domain/regional-cases";

/** The forest layer reuses the observation timeline's shape and controls. */
export function ForestTimeline({manifest,frame,playing,choose,shift,toggle}:{
  manifest:HainaForestManifest;frame:number;playing:boolean;
  choose:(frame:number)=>void;shift:(delta:number)=>void;toggle:()=>void;
}){
  const frames=manifest.frames,total=frames.length;
  const current=frames[frame]?.date||"";
  const percent=total<=1?0:100*frame/(total-1);
  return <div className="globe-timeline forest-timeline" role="group" aria-label="森林嵌入时间轴">
    <span className="time-toggle forest-time-label"><CalendarRange size={14}/>时间轴 <b>{current}</b></span>
    <button aria-label="上一时相" disabled={frame<=0} onClick={()=>shift(-1)}><ChevronLeft size={14}/></button>
    <div className="time-scale">
      <span className="time-edge">{frames[0]?.date}</span>
      <div className="time-rail" onClick={event=>{
        if(event.target!==event.currentTarget||total<=1)return;
        const box=event.currentTarget.getBoundingClientRect();
        const position=Math.max(0,Math.min(1,(event.clientX-box.left-6)/Math.max(1,box.width-12)));
        choose(Math.round(position*(total-1)));
      }}>
        <div className="time-track"><span style={{left:0,right:100-percent+"%"}}/></div>
        <input aria-label="森林嵌入时相" type="range" min={0} max={Math.max(0,total-1)} value={frame} onChange={e=>choose(Number(e.target.value))}/>
      </div>
      <span className="time-edge">{frames.at(-1)?.date}</span>
    </div>
    <button aria-label="下一时相" disabled={frame>=total-1} onClick={()=>shift(1)}><ChevronRight size={14}/></button>
    <button aria-label={playing?"暂停图层":"播放图层"} onClick={toggle}>{playing?<Pause size={14}/>:<Play size={14}/>}{playing?"暂停":"播放"}</button>
  </div>;
}
