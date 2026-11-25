import {useEffect,useId,useRef,useState} from "react";
import {ChevronLeft,ChevronRight,Pause,Play} from "lucide-react";
import {isForestDate,type HainaForestManifest} from "../domain/regional-cases";
import {TimelinePickerButton,TimelinePickerPanel} from "./TimelinePicker";

export function ForestTimeline({manifest,date,playing,choose,toggle}:{
  manifest:HainaForestManifest;date:string;playing:boolean;
  choose:(day:string)=>void;toggle:()=>void;
}){
  const root=useRef<HTMLDivElement>(null);
  const opener=useRef<HTMLButtonElement>(null);
  const input=useRef<HTMLInputElement>(null);
  const panelId=useId();
  const [open,setOpen]=useState(false);
  const [draft,setDraft]=useState<{kind:"date"|"month";value:string}>();
  const frames=manifest.frames,total=frames.length;
  const end=frames.at(-1)!.date,start=frames[0].date;
  const at=frames.findIndex(frame=>frame.date>=date);
  const frame=at<0?total-1:at;
  const exists=frames[frame]?.date===date;
  const previous=at<0?total-1:at-1;
  const next=at<0?total:exists?at+1:at;
  const percent=total<=1?0:100*frame/(total-1);

  useEffect(()=>{
    if(!open)return;
    input.current?.focus({preventScroll:true});
    const dismiss=(event:PointerEvent)=>{
      if(event.target instanceof Node && !root.current?.contains(event.target))setOpen(false);
    };
    document.addEventListener("pointerdown",dismiss);
    return ()=>document.removeEventListener("pointerdown",dismiss);
  },[open]);

  function closePicker(){
    setOpen(false);
    opener.current?.focus({preventScroll:true});
  }
  function applyDate(){
    if(!draft)return;
    const requested=draft.kind==="date" ? draft.value : draft.value+"-01";
    if(!isForestDate(requested))return;
    const firstPublishedDate=draft.kind==="month"
      ? frames.find(item=>item.date.startsWith(draft.value+"-"))?.date : undefined;
    choose(firstPublishedDate ?? requested);
    closePicker();
  }

  return <div ref={root} className="globe-timeline forest-timeline" role="group" aria-label="森林嵌入时间轴">
    <TimelinePickerButton buttonRef={opener} className="forest-time-label" open={open} panelId={panelId}
      label={date} accessibleLabel={"选择森林日期，当前 "+date} toggle={()=>{
        if(open){closePicker();return;}
        setDraft(undefined);
        setOpen(true);
      }}/>
    <button aria-label="上一时相" disabled={previous<0} onClick={()=>choose(frames[previous].date)}><ChevronLeft size={14}/></button>
    <div className="time-scale">
      <span className="time-edge">{start}</span>
      <div className="time-rail" data-missing={exists?undefined:"true"} onClick={event=>{
        if(event.target!==event.currentTarget||total<=1)return;
        const box=event.currentTarget.getBoundingClientRect();
        const position=Math.max(0,Math.min(1,(event.clientX-box.left-6)/Math.max(1,box.width-12)));
        choose(frames[Math.round(position*(total-1))].date);
      }}>
        <div className="time-track">{exists && <span style={{left:0,right:100-percent+"%"}}/>}</div>
        <input aria-label="森林嵌入时相" type="range" min={0} max={total-1} value={frame}
          aria-valuetext={exists ? date : date+" · 该日无数据"}
          onKeyDown={event=>{
            if(exists || !["ArrowLeft","ArrowDown","ArrowRight","ArrowUp"].includes(event.key))return;
            event.preventDefault();
            const index=event.key==="ArrowLeft" || event.key==="ArrowDown" ? previous : next;
            if(frames[index])choose(frames[index].date);
          }}
          onChange={event=>choose(frames[Number(event.target.value)].date)}/>
      </div>
      <span className="time-edge">{end}</span>
    </div>
    <button aria-label="下一时相" disabled={next>=total} onClick={()=>choose(frames[next].date)}><ChevronRight size={14}/></button>
    <button aria-label={playing?"暂停图层":"播放图层"} disabled={!playing && (!exists || next>=total)} onClick={toggle}>
      {playing?<Pause size={14}/>:<Play size={14}/>}
      <span className="forest-time-caption">{playing?"暂停":"播放"}</span>
    </button>
    {!exists && <span className="forest-time-missing" role="status">该日无数据</span>}
    {open && <TimelinePickerPanel id={panelId} label="选择森林日期"
      onSubmit={event=>{event.preventDefault();applyDate();}}
      onKeyDown={event=>{
        if(event.key!=="Escape")return;
        event.stopPropagation();
        closePicker();
      }}>
      <label>跳到年月<input aria-label="森林图层年月" type="month" min={start.slice(0,7)} max={end.slice(0,7)}
        value={draft?.kind==="month"?draft.value:date.slice(0,7)} onChange={event=>setDraft({kind:"month",value:event.target.value})}/></label>
      <label>日期<input ref={input} aria-label="森林图层日期" type="date" min={start} max={end}
        value={draft?.kind==="date"?draft.value:date} onChange={event=>setDraft({kind:"date",value:event.target.value})}/></label>
      <button type="submit" disabled={!draft?.value}>应用日期</button>
    </TimelinePickerPanel>}
  </div>;
}
