import type {Selection} from "../domain/types";

export type GridHover = {selection:Selection;x:number;y:number};

/** Hit-testing is deferred until the pointer rests; movement never queries coverage. */
export function createHoverIntent<T>({resolve,show,hide,delay=1000}:{
  resolve:(x:number,y:number)=>T|null;show:(value:T)=>void;hide:()=>void;delay?:number;
}) {
  let timer:ReturnType<typeof setTimeout>|undefined;
  let origin:{x:number;y:number}|undefined,visible=false;
  function cancel() {
    clearTimeout(timer);timer=undefined;origin=undefined;
    if(visible){visible=false;hide();}
  }
  return {
    move(x:number,y:number) {
      if(origin && Math.hypot(x-origin.x,y-origin.y)<=3)return;
      cancel();origin={x,y};
      timer=setTimeout(()=>{
        timer=undefined;
        const value=resolve(x,y);
        if(value!==null){visible=true;show(value);}
      },delay);
    },
    cancel,
  };
}

/** Prefer the pointer's right, flip near an edge, then keep the full overview visible. */
export function gridHoverPlacement(x:number,y:number,width:number,height:number,cardHeight:number) {
  const margin=12,cardWidth=Math.max(0,Math.min(316,width-2*margin));
  const preferred=x+24+cardWidth<=width-margin?x+24:x-24-cardWidth;
  return {width:cardWidth,left:Math.max(margin,Math.min(preferred,width-cardWidth-margin)),
    top:Math.max(margin,Math.min(y-90,height-cardHeight-margin))};
}
