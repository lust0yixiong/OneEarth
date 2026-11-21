import {useEffect,useId,useLayoutEffect,useRef,useState} from "react";
import {Check,ChevronDown,Flame,Grid3X3,Mountain,type LucideIcon} from "lucide-react";
import {distributionModes,distributionModeIds,supportsDistributionMode,distributionModeRestriction,type DistributionMode,type DistributionContext} from "../domain/distribution-modes";
import "../styles/distribution-mode-picker.css";

const icons:Record<DistributionMode,LucideIcon>={grid:Grid3X3,heatmap:Flame,contours:Mountain};
export function DistributionModePicker({value,context,onChange}:{value:DistributionMode;context:DistributionContext;onChange:(mode:DistributionMode)=>void}) {
  const [open,setOpen]=useState(false),root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null);
  const menuElement=useRef<HTMLDivElement>(null);
  const menu=useId(),Icon=icons[value];
  const close=(restore=false)=>{setOpen(false);if(restore)trigger.current?.focus({preventScroll:true});};
  useLayoutEffect(()=>{
    if(!open || !root.current || !menuElement.current)return;
    const element=menuElement.current,parent=element.offsetParent as HTMLElement;
    const bounds=root.current.closest(".map-footer")?.getBoundingClientRect();
    if(!bounds || !parent)return;
    const width=Math.min(286,bounds.width),anchor=root.current.getBoundingClientRect();
    const left=Math.max(bounds.left,Math.min(anchor.left,bounds.right-width));
    element.style.width=width+"px";element.style.left=(left-parent.getBoundingClientRect().left)+"px";element.style.right="auto";
  },[open]);
  useEffect(()=>{
    if(!open)return;
    const selected=root.current?.querySelector<HTMLButtonElement>('[role="menuitemradio"][aria-checked="true"]');
    selected?.focus();
    const outside=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node))setOpen(false);};
    document.addEventListener("pointerdown",outside);
    return ()=>document.removeEventListener("pointerdown",outside);
  },[open]);
  useEffect(()=>setOpen(false),[context]);
  return <div className="distribution-picker" ref={root} onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node))setOpen(false);}}>
    <button ref={trigger} className="distribution-mode-trigger" aria-label={"显示方式："+distributionModes[value].label}
      aria-haspopup="menu" aria-expanded={open} aria-controls={open?menu:undefined}
      onClick={()=>setOpen(!open)} onKeyDown={e=>{if(e.key==="ArrowDown"||e.key==="ArrowUp"){e.preventDefault();setOpen(true);}}}>
      <span className="distribution-mode-label">显示方式</span><Icon size={14}/><strong>{distributionModes[value].label}</strong><ChevronDown size={12}/>
    </button>
    {open && <div ref={menuElement} id={menu} className="distribution-mode-menu" role="menu" aria-label="显示方式" onKeyDown={e=>{
      if(e.key==="Escape"){e.preventDefault();e.stopPropagation();close(true);return;}
      const buttons=[...e.currentTarget.querySelectorAll<HTMLButtonElement>('button[role="menuitemradio"]:not(:disabled)')];
      const at=buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next=e.key==="ArrowDown"?(at+1)%buttons.length:e.key==="ArrowUp"?(at-1+buttons.length)%buttons.length:e.key==="Home"?0:e.key==="End"?buttons.length-1:-1;
      if(next>=0){e.preventDefault();buttons[next]?.focus();}
    }}>
      <div className="distribution-mode-heading" aria-hidden="true">显示方式</div>
      {distributionModeIds.map(id=>{
        const mode=distributionModes[id],ModeIcon=icons[id],enabled=supportsDistributionMode(id,context);
        return <button key={id} role="menuitemradio" aria-checked={id===value} disabled={!enabled} tabIndex={-1}
          className={"distribution-mode-option "+id} onClick={()=>{onChange(id);close(true);}}>
          <span className="distribution-mode-preview" aria-hidden="true"><ModeIcon size={21}/></span>
          <span className="distribution-mode-copy"><strong>{mode.label}</strong><small>{enabled?mode.description:distributionModeRestriction(context)}</small></span>
          {id===value&&<Check size={16} aria-hidden="true"/>}
        </button>;
      })}
    </div>}
  </div>;
}
