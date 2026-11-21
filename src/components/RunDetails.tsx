import {literatureDisplay, literatureText} from "../domain/literature-label";
import {useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState} from "react";
import {Clock3,Copy,Check,ChevronDown} from "lucide-react";
import type {RunTrace,SearchRun,ToolCall} from "../domain/types";

export function CopyButton({text,label}:{text:string;label:string}) {
  const [status,setStatus]=useState("");
  useEffect(()=>{if(status){const timer=setTimeout(()=>setStatus(""),1600);return ()=>clearTimeout(timer);}},[status]);
  async function copy() {
    try {
      if(navigator.clipboard) await navigator.clipboard.writeText(text);
      else {
        const input=document.createElement("textarea");
        const previous=document.activeElement;
        (previous?.closest("dialog") || document.body).append(input);
        input.value=text;input.select();
        const ok=document.execCommand("copy");input.remove();
        if(previous instanceof HTMLElement)previous.focus({preventScroll:true});
        if(!ok) throw Error();
      }
      setStatus("已复制");
    } catch {setStatus("复制失败");}
  }
  return <button type="button" title={status || label} aria-label={label} onClick={copy}>{status==="已复制"?<Check size={13}/>:<Copy size={13}/>}<small role="status">{status}</small></button>;
}
function StageText({text,live}:{text:string;live:boolean}) {
  return <p>{text}</p>;
}
function StageHistory({stages,working}:{stages:string[];working:boolean}) {
  const viewport=useRef<HTMLDivElement>(null);
  const follow=useRef(true);
  const [expanded,setExpanded]=useState(false),[overflow,setOverflow]=useState(false);
  useEffect(()=>{
    const el=viewport.current!;
    const update=()=>{
      setOverflow(el.scrollHeight>36);
      if(follow.current)el.scrollTop=el.scrollHeight;
    };
    const mutations=new MutationObserver(update),resize=new ResizeObserver(update);
    mutations.observe(el,{childList:true,characterData:true,subtree:true});
    resize.observe(el);
    update();
    return ()=>{mutations.disconnect();resize.disconnect();};
  },[]);
  return <div className="oe-stage-history">
    <div ref={viewport} className="oe-stages" data-expanded={expanded} role="region" aria-label="检索过程" tabIndex={0}
      aria-live={working?"polite":"off"} onScroll={e=>{
        const el=e.currentTarget;
        follow.current=el.scrollHeight-el.clientHeight-el.scrollTop<12;
      }}>
      {stages.map((s,i)=><StageText key={i} text={s} live={working && i===stages.length-1}/>)}
    </div>
    {(overflow || expanded) && <button className="oe-stage-expand" aria-expanded={expanded} onClick={()=>setExpanded(!expanded)}>
      {expanded?"收起过程":"展开过程"}<ChevronDown size={12}/>
    </button>}
  </div>;
}
function CallHistory({calls,runs,working,failed}:{calls:ToolCall[];runs:SearchRun[];working:boolean;failed:boolean}) {
  const viewport=useRef<HTMLDivElement>(null),follow=useRef(true);
  const previous=useRef<{top:number;height:number;total:number} | null>(null);
  const [expanded,setExpanded]=useState(false),[overflow,setOverflow]=useState(false);
  const update=useCallback(()=>{
    const el=viewport.current;
    if(!el?.clientHeight)return;
    // Scroll events can arrive after a streaming render. Respect an upward move immediately.
    const last=previous.current;
    if(last && el.clientHeight===last.height && el.scrollHeight>=last.total && el.scrollTop<last.top-1)follow.current=false;
    setOverflow(el.scrollHeight>30);
    if(el.querySelector('details[open]'))follow.current=false;
    if(follow.current)el.scrollTop=el.scrollHeight;
    previous.current={top:el.scrollTop,height:el.clientHeight,total:el.scrollHeight};
  },[]);
  useLayoutEffect(update,[calls,expanded,update]);
  useEffect(()=>{
    const resize=new ResizeObserver(update);
    resize.observe(viewport.current!);
    return ()=>resize.disconnect();
  },[update]);
  function openCall(row:HTMLDetailsElement) {
    if(!row.open)return;
    follow.current=false;previous.current=null;setExpanded(true);
    requestAnimationFrame(()=>{
      const el=viewport.current;
      if(el && row.open)el.scrollTop+=row.getBoundingClientRect().top-el.getBoundingClientRect().top;
    });
  }
  return <>
    <div className="oe-call-heading">
      <div className="oe-call-summary">{calls.length} 次调用 · Skill {calls.filter(c=>c.kind==="Skill").length} · MCP {calls.filter(c=>c.kind==="MCP").length} · {calls.filter(c=>c.status==="done").length} 成功{calls.some(c=>c.status==="partial") && <> · {calls.filter(c=>c.status==="partial").length} 部分完成</>} · {calls.filter(c=>c.status==="failed").length} 失败</div>
      {(overflow || expanded) && <button className="oe-call-expand" aria-expanded={expanded} onClick={()=>{
        if(expanded)viewport.current?.querySelectorAll<HTMLDetailsElement>('details[open]').forEach(row=>{row.open=false;});
        follow.current=true;previous.current=null;setExpanded(!expanded);
      }}>
        {expanded?"收起调用":"展开调用"}<ChevronDown size={12}/>
      </button>}
    </div>
    <div ref={viewport} className="oe-calls" data-expanded={expanded} role="region" aria-label="工具调用记录" tabIndex={0}
      onScroll={e=>{
        const el=e.currentTarget;
        follow.current=!el.querySelector('details[open]') && el.scrollHeight-el.clientHeight-el.scrollTop<12;
      }}>
      {calls.map(c=><details key={c.id} data-status={c.status} onToggle={e=>openCall(e.currentTarget)}><summary>{c.kind==="Skill"?"读取":"调用"} {c.name} {c.kind!=="tool" && <small>{c.kind}</small>}<em>{c.status==="done"?"成功":c.status==="partial"?"部分完成":c.status==="failed"?"⚠ 失败":working?"进行中":failed?"已中断":"未完成"}</em><ChevronDown size={12}/></summary>
        {runs.find((_,i)=>c.id==="search-"+i)?.hits.map(hit=><a key={hit.url} className="oe-search-hit" href={hit.url} target="_blank" rel="noreferrer">{hit.title}</a>)}
        {c.error && <p>{c.error}</p>}{[["输入",c.input],["输出",c.output || c.error]].map(([label,value])=>value && <section key={label}><header>{label}<CopyButton text={value} label={"复制"+label}/></header><pre>{value}</pre></section>)}</details>)}
    </div>
  </>;
}
export function RunDetails({trace:rawTrace,stage:rawStage,runs:rawReported,working=false,failed=false,openFinding}:{trace?:RunTrace;stage?:string;runs?:SearchRun[];working?:boolean;failed?:boolean;openFinding?:(id:string)=>void}) {
  const trace=useMemo(()=>literatureDisplay(rawTrace),[rawTrace]);
  const reported=useMemo(()=>literatureDisplay(rawReported),[rawReported]);
  const stage=rawStage && literatureText(rawStage);
  const runs=reported ?? trace?.searches ?? [];
  const [open,setOpen]=useState(working),[now,setNow]=useState(Date.now);
  useEffect(()=>{if(working){const timer=setInterval(()=>setNow(Date.now()),1000);return ()=>clearInterval(timer);}},[working]);
  const calls:ToolCall[]=[...(trace?.calls || []),...runs.map((r,i)=>({
    id:"search-"+i,kind:"tool" as const,name:r.engine+(r.cacheStoredAt?"（本地缓存）":""),input:r.query,status:r.status,error:r.error,
    output:r.status==="done"?JSON.stringify({returned:r.hits.length,total:r.total,hits:r.hits,warning:r.warning,cacheStoredAt:r.cacheStoredAt},null,2):undefined,
  }))];
  const stages=trace?.stages?.length?trace.stages:stage?[stage]:[];
  if(!working && !calls.length && !stages.length)return null;
  const findings=trace?.findings?.length ? <section className="oe-findings" aria-label="阶段发现" aria-live={working?"polite":"off"}>
    {trace.findings.map(f=><div key={f.id}>
      <p><strong>{f.source}</strong> · {f.summary}</p>
      {!!f.items.length && <ul>{f.items.map((item,i)=><li key={i}>{item.assetId && openFinding ? <button className="activity-link" type="button" onClick={()=>openFinding(item.assetId!)}>{item.title}</button> :
        item.url && /^https?:\/\//.test(item.url) ? <a href={item.url} target="_blank" rel="noreferrer">{item.title}</a> : item.title}{item.detail && <small>{item.detail}</small>}</li>)}</ul>}
    </div>)}
    {working && <p className="oe-findings-note">继续核对中，完整回答将汇总各来源的适用性和依据。</p>}
  </section> : null;
  return <>{working && findings}<details className="oe-run" open={open} onToggle={e=>setOpen(e.currentTarget.open)}>
    <summary><Clock3 size={14}/><span>{working?"Working for "+Math.max(0,Math.floor((now-(trace?.started||now))/1000))+"秒":"思考过程"}</span><ChevronDown size={13}/></summary>
    {!working && findings}
    <StageHistory stages={stages} working={working}/>
    {!!calls.length && <div className="oe-call-group">
    <CallHistory calls={calls} runs={runs} working={working} failed={failed}/></div>}
  </details></>;
}
