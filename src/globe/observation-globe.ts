import {createCesiumRenderer} from "./cesium-renderer";
import {strictCesiumMode} from "./cesium-mode";
import {createRenderer,type Scene} from "./renderer";

export function createObservationGlobe(
  root:HTMLDivElement,
  host:HTMLDivElement|null,
  base:HTMLCanvasElement|null,
  legacy:HTMLCanvasElement[],
  scene:Scene,
  label:string,
) {
  if(!strictCesiumMode){
    const engine=createRenderer(base!,root,()=>scene,camera=>{scene.camera=camera;},()=>{},()=>{});
    return {engine,viewport:base!,layers:legacy,present:(painted:()=>void)=>painted(),dispose:()=>engine.dispose()};
  }

  const engine=createCesiumRenderer(host!,()=>scene,camera=>{scene.camera=camera;},()=>{},()=>{},()=>{},()=>{});
  engine.canvas.setAttribute("aria-label",label);
  const layers=Array.from({length:legacy.length},()=>document.createElement("canvas"));
  const overlay=engine.observationOverlay(layers);
  const navigate=(event:MouseEvent)=>{
    if(!(event.target instanceof Element))return;
    const control=event.target.closest("button");
    if(control?.hasAttribute("data-plus"))engine.zoom(1);
    else if(control?.hasAttribute("data-minus"))engine.zoom(-1);
    else if(control?.hasAttribute("data-reset"))engine.flyTo({center:defaultCamera.center,zoom:defaultCamera.zoom,reason:defaultCamera.reason});
  };
  const defaultCamera=scene.camera;
  root.addEventListener("click",navigate);
  return {
    engine,viewport:engine.canvas,layers,present:overlay.present,
    dispose(){root.removeEventListener("click",navigate);overlay.dispose();engine.dispose();},
  };
}
