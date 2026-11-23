import {CalendarRange,ChevronLeft,ChevronRight,Pause,Play} from "lucide-react";
import {isForestDate,type HainaForestManifest} from "../domain/regional-cases";

export function ForestTimeline({manifest,date,playing,choose,toggle}:{
  manifest:HainaForestManifest;date:string;playing:boolean;
  choose:(day:string)=>void;toggle:()=>void;
}){
  const frames=manifest.frames,total=frames.length;
  const end=frames.at(-1)!.date,start=frames[0].date;
  const at=frames.findIndex(frame=>frame.date>=date);
  const frame=at<0?total-1:at;
  const exists=frames[frame]?.date===date;
  const previous=at<0?total-1:at-1;
  const next=at<0?total:exists?at+1:at;
  const percent=total<=1?0:100*frame/(total-1);
  return <div className="forest-date-controls" role="group" aria-label="森林嵌入时间轴">
    <div className="forest-date-pickers">
      <label>跳到年月<input aria-label="森林图层年月" type="month" min={start.slice(0,7)} max={end.slice(0,7)}
        value={date.slice(0,7)} onChange={event=>{
          const month=event.target.value;
          if(isForestDate(month+"-01"))
            choose(frames.find(item=>item.date.startsWith(month+"-"))?.date ?? month+"-01");
        }}/></label>
      <label>日期<input aria-label="森林图层日期" type="date" min={start} max={end} value={date}
        onChange={event=>{if(isForestDate(event.target.value))choose(event.target.value);}}/></label>
      {!exists && <span role="status">该日无数据</span>}
    </div>
    <div className="globe-timeline forest-timeline">
      <span className="time-toggle forest-time-label"><CalendarRange size={14}/>时间轴 <b>{date}</b></span>
      <button aria-label="上一时相" disabled={previous<0} onClick={()=>choose(frames[previous].date)}><ChevronLeft size={14}/></button>
      <div className="time-scale">
        <span className="time-edge">{start}</span>
        <div className="time-rail" onClick={event=>{
          if(event.target!==event.currentTarget||total<=1)return;
          const box=event.currentTarget.getBoundingClientRect();
          const position=Math.max(0,Math.min(1,(event.clientX-box.left-6)/Math.max(1,box.width-12)));
          choose(frames[Math.round(position*(total-1))].date);
        }}>
          <div className="time-track"><span style={{left:0,right:100-percent+"%"}}/></div>
          <input aria-label="森林嵌入时相" type="range" min={0} max={total-1} value={frame}
            onChange={event=>choose(frames[Number(event.target.value)].date)}/>
        </div>
        <span className="time-edge">{end}</span>
      </div>
      <button aria-label="下一时相" disabled={next>=total} onClick={()=>choose(frames[next].date)}><ChevronRight size={14}/></button>
      <button aria-label={playing?"暂停图层":"播放图层"} disabled={!exists || next>=total} onClick={toggle}>
        {playing?<Pause size={14}/>:<Play size={14}/>}{playing?"暂停":"播放"}</button>
    </div>
  </div>;
}
