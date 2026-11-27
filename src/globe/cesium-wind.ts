import {BoundingRectangle, Cartesian2, Color, Material, ViewportQuad, type Scene as CesiumScene} from "cesium";
import {getWindData, windFrame, windVector, type WindData} from "../domain/wind";
import type {Camera, Coordinate, VisualizationState} from "../domain/types";
import type {GeoImageFrame} from "./geo-image-layer";
import type {Scene} from "./renderer";
import {windRgb, type WindTheme} from "./wind-layer";

type WindSelection = {id:string;view:VisualizationState};
type Particle = {point:Coordinate;life:number};
type Projection = {
  ground(pixel:Cartesian2):Coordinate|undefined;
  visible(point:Coordinate):[number,number]|null;
};
type TrailsInput = {wind:WindSelection;theme:WindTheme;camera:Camera;data:WindData;width:number;height:number};

export function visibleCesiumWind(state:Scene):WindSelection|undefined {
  if(state.datasetLayers){
    const wind=state.datasetLayers.find(layer=>layer.kind==="wind");
    return wind && {id:wind.id,view:wind.selection};
  }
  return state.visualization ? {id:state.visualization.id,view:state.visualization} : undefined;
}

export function createWindImages() {
  let previous:WindData|null=null;
  const frames=new Map<string,GeoImageFrame>();
  return (view:VisualizationState,theme:WindTheme):GeoImageFrame|undefined=>{
    const data=getWindData();
    if(data!==previous){
      previous=data;
      frames.clear();
    }
    if(!data||!view.color)return;
    const frame=windFrame(view);
    const key=frame.id+"/"+theme;
    const stored=frames.get(key);
    if(stored)return stored;
    // Retain the same original u/v interpolation and palette as the product readout.
    const width=720,height=360;
    const pixels=new Uint8ClampedArray(width*height*4);
    const max=frame.level==="10m"?35:110;
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const vector=windVector(data,frame,-180+(x+.5)*.5,90-(y+.5)*.5);
      if(!vector)continue;
      const offset=(y*width+x)*4;
      const rgb=windRgb(vector.speed,max,theme);
      pixels[offset]=rgb[0];
      pixels[offset+1]=rgb[1];
      pixels[offset+2]=rgb[2];
      pixels[offset+3]=255;
    }
    const image:GeoImageFrame={bounds:[-180,-90,180,90],width,height,pixels};
    if(frames.size>=4)frames.delete(frames.keys().next().value!);
    frames.set(key,image);
    return image;
  };
}

export function createCesiumWind(scene:CesiumScene,canvas:HTMLCanvasElement,projection:Projection) {
  const trail=document.createElement("canvas");
  const buffers=[document.createElement("canvas"),document.createElement("canvas")];
  const context=trail.getContext("2d")!;
  const transfer=buffers.map(buffer=>buffer.getContext("2d")!);
  const material=Material.fromType(Material.ImageType,{image:buffers[0],color:Color.TRANSPARENT});
  const quad=scene.primitives.add(new ViewportQuad(new BoundingRectangle(),material));
  quad.show=false;
  let input:TrailsInput|undefined;
  let key="",particles:Particle[]=[],animation=0,previousStep=0,bufferIndex=0,scale=1;
  let pending:{frame:string;sequence:number;drawn:number;settling:number}|undefined;
  let sequence=0;

  function cancel(){
    cancelAnimationFrame(animation);
    animation=0;
    previousStep=0;
  }
  function clearObservation(){
    delete canvas.dataset.windFrame;
    delete canvas.dataset.windTick;
    delete canvas.dataset.windSegments;
  }
  function suspend(){
    cancel();
    quad.show=false;
    pending=undefined;
    clearObservation();
  }
  function spawn(current:TrailsInput):Particle {
    for(let i=0;i<14;i++){
      const pixel=new Cartesian2(Math.random()*current.width,Math.random()*current.height);
      const point=projection.ground(pixel);
      if(point)return {point,life:36+Math.random()*44};
    }
    return {point:current.camera.center,life:45};
  }
  function paint(current:TrailsInput,seconds:number,advance:boolean){
    const {view}=current.wind;
    const frame=windFrame(view);
    const max=frame.level==="10m"?35:110;
    const movement=seconds*18000/Math.max(1,current.camera.zoom);
    context.setTransform(scale,0,0,scale,0,0);
    context.globalCompositeOperation="destination-in";
    context.fillStyle="rgba(0,0,0,.9)";
    context.fillRect(0,0,current.width,current.height);
    context.globalCompositeOperation="source-over";
    context.lineWidth=1.25;
    context.lineCap="round";
    let drawn=0;
    for(let i=0;i<particles.length;i++){
      const particle=particles[i], [lon,lat]=particle.point;
      const vector=windVector(current.data,frame,lon,lat);
      if(!vector||particle.life<=0||Math.abs(lat)>=89.8){
        if(advance)particles[i]=spawn(current);
        continue;
      }
      const before=projection.visible(particle.point);
      const afterPoint:Coordinate=[
        ((lon+(vector.u*movement)/(111320*Math.max(.0035,Math.cos(lat*Math.PI/180)))+540)%360)-180,
        lat+vector.v*movement/111320,
      ];
      const after=Math.abs(afterPoint[1])<89.8?projection.visible(afterPoint):null;
      if(!before||!after||Math.hypot(after[0]-before[0],after[1]-before[1])>36){
        if(advance)particles[i]=spawn(current);
        continue;
      }
      const rgb=windRgb(vector.speed*.7+max*.4,max,current.theme);
      context.strokeStyle=current.theme==="dark"?`rgba(${rgb.join(",")},.85)`
        : view.color&&vector.speed>max*.58?"rgba(238,252,255,.95)":"rgba(16,69,88,.82)";
      context.beginPath();
      context.moveTo(before[0],before[1]);
      context.lineTo(after[0],after[1]);
      context.stroke();
      drawn++;
      if(advance){particle.point=afterPoint;particle.life--;}
    }
    // Upload a bounded scratch texture, then composite through the only visible Cesium canvas.
    bufferIndex=1-bufferIndex;
    const output=buffers[bufferIndex];
    if(output.width!==trail.width)output.width=trail.width;
    if(output.height!==trail.height)output.height=trail.height;
    transfer[bufferIndex].clearRect(0,0,output.width,output.height);
    transfer[bufferIndex].drawImage(trail,0,0);
    material.uniforms.image=output;
    pending={frame:frame.id,sequence:++sequence,drawn,settling:2};
    scene.requestRender();
  }
  function queue(){
    if(!animation&&input?.wind.view.playing&&!document.hidden)animation=requestAnimationFrame(tick);
  }
  function tick(now:number){
    animation=0;
    if(!input?.wind.view.playing||document.hidden)return;
    // Let Cesium present the previous upload before recycling its texture input.
    if((!pending||pending.settling===0)&&(!previousStep||now-previousStep>=45)){
      const dt=previousStep?Math.min(.07,(now-previousStep)/1000):.05;
      previousStep=now;
      paint(input,dt,true);
    }
    queue();
  }
  function visibility(){
    if(document.hidden)cancel();
    else queue();
  }
  document.addEventListener("visibilitychange",visibility);
  const resize=scene.preRender.addEventListener(()=>{
    quad.rectangle.width=canvas.width;
    quad.rectangle.height=canvas.height;
  });
  const present=scene.postRender.addEventListener(()=>{
    if(!quad.show||!pending||pending.settling===0)return;
    if(--pending.settling>0){
      material.uniforms.color=Color.WHITE;
      scene.requestRender();
      return;
    }
    canvas.dataset.windFrame=pending.frame;
    canvas.dataset.windTick=String(pending.sequence);
    canvas.dataset.windSegments=String(pending.drawn);
  });
  return {
    update(wind:WindSelection|undefined,theme:WindTheme,camera:Camera,moving:boolean){
      const width=canvas.clientWidth,height=canvas.clientHeight,data=getWindData();
      if(!wind||!data||!width||!height||moving){
        input=undefined;
        key="";
        suspend();
        return;
      }
      const next={wind,theme,camera,data,width,height};
      const frame=windFrame(wind.view);
      const identity=JSON.stringify([wind.id,frame.id,theme,wind.view.color,camera.center,camera.zoom,width,height]);
      const changed=key!==identity||data!==input?.data;
      const pause=!wind.view.playing&&input?.wind.view.playing;
      input=next;
      if(changed){
        key=identity;
        cancel();
        clearObservation();
        scale=Math.min(1,820/Math.max(width,height));
        trail.width=Math.ceil(width*scale);
        trail.height=Math.ceil(height*scale);
        particles=Array.from({length:width<650?560:1000},()=>spawn(next));
        quad.show=true;
        material.uniforms.color=Color.TRANSPARENT;
        paint(next,.05,false);
      }else if(pause)cancel();
      queue();
    },
    dispose(){
      suspend();
      document.removeEventListener("visibilitychange",visibility);
      resize();
      present();
      scene.primitives.remove(quad);
      material.destroy();
    },
  };
}
