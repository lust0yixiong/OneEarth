import type {FormEventHandler,KeyboardEventHandler,ReactNode,Ref} from "react";
import {CalendarRange} from "lucide-react";
import "../styles/globe-timeline.css";

export function TimelinePickerButton({label,open,toggle,panelId,accessibleLabel,className,buttonRef}:{
  label:string;open:boolean;toggle:()=>void;panelId?:string;accessibleLabel?:string;
  className?:string;buttonRef?:Ref<HTMLButtonElement>;
}){
  return <button ref={buttonRef} type="button" className={className?"time-toggle "+className:"time-toggle"}
    aria-expanded={open} aria-controls={open?panelId:undefined} aria-label={accessibleLabel} onClick={toggle}>
    <CalendarRange size={14}/><span className="time-caption">时间轴</span> <b>{label}</b>
  </button>;
}

export function TimelinePickerPanel({id,label,onSubmit,onKeyDown,children}:{
  id?:string;label?:string;onSubmit?:FormEventHandler<HTMLFormElement>;
  onKeyDown?:KeyboardEventHandler<HTMLElement>;children:ReactNode;
}){
  const props={id,className:"time-range-panel","aria-label":label,onKeyDown};
  return onSubmit ? <form {...props} onSubmit={onSubmit}>{children}</form> : <div {...props}>{children}</div>;
}
