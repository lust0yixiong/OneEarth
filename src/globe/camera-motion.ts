import {flightCamera} from "../domain/camera-flight";
import type {Camera} from "../domain/types";

/** Transient motion belongs to the renderer. Persist only the settled camera. */
export function createCameraMotion({read,commit,changed,flightChanged=()=>{},canFly=()=>true,
  requestFrame=requestAnimationFrame,cancelFrame=cancelAnimationFrame,now=()=>performance.now(),
  reducedMotion=()=>matchMedia("(prefers-reduced-motion: reduce)").matches,
}:{read:()=>Camera;commit:(camera:Camera)=>void;changed:()=>void;flightChanged?:(flying:boolean)=>void;canFly?:()=>boolean;
  requestFrame?:(callback:FrameRequestCallback)=>number;cancelFrame?:(id:number)=>void;now?:()=>number;reducedMotion?:()=>boolean}) {
  let current:Camera|undefined,observed=read(),lastCommit:Camera|undefined,frame=0;
  function stopFlight(){cancelFrame(frame);frame=0;flightChanged(false);}
  function camera() {
    const external=read();
    if(external!==observed) {
      observed=external;
      if(external!==lastCommit){stopFlight();current=undefined;}
      else if(current===external)current=undefined;
    }
    return current || external;
  }
  function move(next:Camera){camera();current=next;changed();}
  function settle(){camera();if(frame)return;if(current && current!==read() && current!==lastCommit){lastCommit=current;commit(current);}}
  function flyTo(target:Camera) {
    const from=camera(),start=now();stopFlight();
    if(reducedMotion()){move(target);settle();return;}
    flightChanged(true);
    const step=(time:number)=>{
      camera();
      if(!frame)return;
      if(!canFly()){stopFlight();current=undefined;changed();return;}
      const t=Math.min(1,(time-start)/760);
      move(flightCamera(from,target,t));
      if(t<1)frame=requestFrame(step);else {stopFlight();settle();}
    };
    frame=requestFrame(step);
  }
  return {camera,move,settle,flyTo,stopFlight,dispose:stopFlight};
}
