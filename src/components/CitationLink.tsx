import {CitationIcon} from "./CitationIcon";
import {useEffect,useId,useLayoutEffect,useRef,useState} from "react";
import {createPortal} from "react-dom";
import {MessageCirclePlus,Check} from "lucide-react";
import {citationTypeLabels} from "../domain/citation-types";
import type {CitationDetails} from "../domain/answer-sources";
import type {AnswerReference} from "../domain/types";

const safeUrl=(raw:string)=>{try{const u=new URL(raw);return /^https?:$/.test(u.protocol)&&!u.username&&!u.password?u.href:undefined;}catch{return undefined;}};
export function CitationLink({reference,number,label,details,inspect,hover,inCell,focused,quote,selected}:{
  reference:AnswerReference;number:number;label:string;details:CitationDetails;inspect:(id:string)=>void;
  quote?:(reference:AnswerReference,number:number)=>void;selected?:boolean;
  hover?:(id:string|null)=>void;inCell?:boolean;focused?:boolean;
}){
  const [open,setOpen]=useState(false),[position,setPosition]=useState({left:12,top:12});
  const trigger=useRef<HTMLAnchorElement|HTMLButtonElement|null>(null),tooltip=useRef<HTMLDivElement>(null);
  const timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),tooltipId=useId();
  const id=reference.kind==="asset"?reference.id:undefined;
  function cancelClose(){clearTimeout(timer.current);}
  function show(){cancelClose();timer.current=setTimeout(()=>setOpen(true),650);}
  function hide(){cancelClose();setOpen(false);}
  function delayedClose(){cancelClose();timer.current=setTimeout(()=>setOpen(false),140);}
  useEffect(()=>()=>clearTimeout(timer.current),[]);
  useLayoutEffect(()=>{
    if(!open || !trigger.current || !tooltip.current)return;
    const rect=trigger.current.getBoundingClientRect(),height=tooltip.current.offsetHeight,width=tooltip.current.offsetWidth;
    const frame=trigger.current.closest(".chat-panel")?.getBoundingClientRect() || rect;
    const block=trigger.current.closest(".oe-answer-block,.oe-answer-lead")?.getBoundingClientRect() || rect;
    const beside=frame.left-width-8>=12,right=!beside && frame.right+width+8<=innerWidth-12;
    const left=beside?frame.left-width-8:right?frame.right+8:Math.max(12,Math.min(rect.left,innerWidth-width-12));
    const top=beside || right?Math.max(12,Math.min(rect.top,innerHeight-height-12)):
      block.top-height-8>=12?block.top-height-8:Math.max(12,Math.min(block.bottom+8,innerHeight-height-12));
    setPosition({left,top});
  },[open,reference.title,details.type,details.channel,details.evidence,details.nature]);
  useEffect(()=>{
    if(!open)return;
    const close=()=>{clearTimeout(timer.current);setOpen(false);};
    const key=(event:KeyboardEvent)=>{if(event.key==="Escape"){event.stopPropagation();close();}};
    const outside=(event:PointerEvent)=>{if(!trigger.current?.contains(event.target as Node) && !tooltip.current?.contains(event.target as Node))close();};
    const scroll=(event:Event)=>{if(!tooltip.current?.contains(event.target as Node))close();};
    window.addEventListener("resize",close);document.addEventListener("scroll",scroll,true);
    document.addEventListener("keydown",key,true);document.addEventListener("pointerdown",outside,true);
    return ()=>{window.removeEventListener("resize",close);document.removeEventListener("scroll",scroll,true);document.removeEventListener("keydown",key,true);document.removeEventListener("pointerdown",outside,true);};
  },[open]);
  const shared={
    className:"answer-citation"+(inCell?" in-cell":"")+(focused?" map-focused":""),
    "data-reference-type":details.type,
    "aria-label":"依据 "+number+"，"+reference.title+"，"+citationTypeLabels[details.type],
    "aria-describedby":open?tooltipId:undefined,
    onPointerEnter:(event:React.PointerEvent)=>{if(event.pointerType!=="touch")show();if(id)hover?.(id);},
    onPointerLeave:()=>{delayedClose();if(id)hover?.(null);},
    onFocus:()=>{show();if(id)hover?.(id);},
    onBlur:()=>{hide();if(id)hover?.(null);},
  };
  const marker="〔"+number+"〕",shortTitle=label.endsWith(marker)?label.slice(0,-marker.length):label;
  const content=<><CitationIcon type={details.type} className="answer-citation-icon"/>
    {shortTitle && <span className="answer-citation-label">{shortTitle}</span>}<span className="answer-citation-number">{marker}</span></>;
  return <><span className="citation-inline-group">
    {reference.kind==="web"?<a {...shared} ref={el=>{trigger.current=el;}} href={safeUrl(reference.url)} target="_blank" rel="noreferrer" onClick={hide}>{content}</a>:
      <button {...shared} ref={el=>{trigger.current=el;}} type="button" data-asset-id={reference.id} onClick={()=>{hide();inspect(reference.id);}}>{content}</button>}
    {quote && <button type="button" className="citation-followup" aria-label={"引用并追问 "+reference.title}
      title={selected?"已引用，可继续提问":"引用并追问"} onClick={()=>{hide();quote(reference,number);}}>
      {selected?<Check size={13}/>:<MessageCirclePlus size={13}/>}
    </button>}</span>
    {open && createPortal(<div ref={tooltip} id={tooltipId} className="oe-citation-tooltip" role="tooltip" style={position}
      onPointerEnter={cancelClose} onPointerLeave={delayedClose}>
      <div className="oe-citation-tooltip-heading"><span>引用详情</span><span>〔{number}〕</span></div>
      <strong>{reference.title}</strong>
      <dl><dt>引用类型</dt><dd><CitationIcon type={details.type}/>{citationTypeLabels[details.type]}</dd>
        {details.nature && <><dt>数据性质</dt><dd>{details.nature}</dd></>}
        <dt>发现渠道</dt><dd>{details.channel}</dd><dt>本次依据</dt><dd>{details.evidence}</dd></dl>
    </div>,trigger.current?.closest("dialog") || document.body)}
  </>;
}
