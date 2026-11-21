import {useLayoutEffect,useMemo,useRef,useState} from "react";
import {ArrowUpRight,MapPin} from "lucide-react";
import {useGridMembership} from "./use-grid-membership";
import {summarizeGridAccess,type indexGridAccess} from "../domain/grid-hover-summary";
import {gridHoverPlacement,type GridHover} from "../globe/grid-hover";
import type {CandidateSet,Filters} from "../domain/types";

export function GridHoverOverview({hover,filters,batch,index,locate,width,height,pushConfigured}:{
  hover:GridHover;filters:Filters;batch:CandidateSet|null;
  index:ReturnType<typeof indexGridAccess>;locate:(point:[number,number])=>string;
  width:number;height:number;pushConfigured?:number;
}) {
  const card=useRef<HTMLElement>(null),[cardHeight,setCardHeight]=useState(230);
  const {members,error}=useGridMembership(true,hover.selection,filters,batch);
  const summary=useMemo(()=>members?summarizeGridAccess(members,index):null,[members,index]);
  const label=useMemo(()=>locate(hover.selection.point).replace(/（.*?）/g,""),[locate,hover.selection]);
  const position=gridHoverPlacement(hover.x,hover.y,width,height,cardHeight);
  useLayoutEffect(()=>{
    const element=card.current;if(!element)return;
    const observer=new ResizeObserver(()=>setCardHeight(element.offsetHeight));
    observer.observe(element);setCardHeight(element.offsetHeight);
    return ()=>observer.disconnect();
  },[]);
  const count=(key:"entities"|"clues"|"timely",unit:string)=>summary?.complete
    ? <strong>{summary[key]}<small> {unit}</small></strong>
    : <span className="grid-hover-pending">{error?"暂不可用":summary?"待核对":"…"}</span>;
  const coordinates=hover.selection.point.map((v,i)=>Math.abs(v).toFixed(2)+"°"+(i?(v<0?"S":"N"):(v<0?"W":"E"))).join("　");
  return <section ref={card} className="grid-hover-overview" style={position} role="status" aria-label="网格概览" data-grid-id={hover.selection.id} data-grid-key={hover.selection.grid.key}>
    <header><span><MapPin size={15}/>{label}</span><small>{hover.selection.grid.label}</small></header>
    <div className="grid-hover-coordinate">{coordinates}</div>
    <div className="grid-hover-total"><strong>{summary?.total??"…"}</strong><span>格内可定位数据集</span></div>
    <div className="grid-hover-types">
      <div><span>实体数据</span>{count("entities","种")}</div>
      <div><span>数据线索</span>{count("clues","条")}</div>
      <div><span>即时数据</span>{summary?.timely?count("timely","条"):pushConfigured===0?<span className="grid-hover-pending">尚未接入</span>:count("timely","条")}</div>
    </div>
    <footer><span>{error?"概览暂时无法读取，点击网格查看详情":"点击网格，查看资料与来源"}</span><ArrowUpRight size={14}/></footer>
  </section>;
}
