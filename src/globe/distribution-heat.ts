import {heatColor} from "../domain/distribution-heat";
import type {DistributionField,DistributionPaintRequest,DistributionRaster} from "./distribution-field";
import {createGpuHeatPainter} from "./heat-gpu";
const littleEndian=new Uint8Array(new Uint32Array([1]).buffer)[0]===1;
const colors=Uint32Array.from({length:256},(_,i)=>{
  const bytes=new Uint8ClampedArray(4);bytes.set(heatColor(i/255));
  return new Uint32Array(bytes.buffer)[0];
});

export function createDistributionHeatPainter(field:(request:DistributionPaintRequest)=>DistributionField,raster?:(request:DistributionPaintRequest)=>DistributionRaster) {
  let gpu:ReturnType<typeof createGpuHeatPainter>|undefined;
  let buffer:HTMLCanvasElement|undefined,image:ImageData|undefined,key="";
  const paint=(request:DistributionPaintRequest)=>{
    if(!request.counts.size)return;
    if(raster){
      gpu??=createGpuHeatPainter();
      if(gpu.draw(request.ctx,raster(request),request.width,request.height)){if(request.ctx.canvas?.dataset)request.ctx.canvas.dataset.heatBackend="gpu";return;}
    }
    if(request.ctx.canvas?.dataset)request.ctx.canvas.dataset.heatBackend="cpu";
    const data=field(request);
    buffer??=document.createElement("canvas");
    if(key!==data.key){
      if(buffer.width!==data.width || buffer.height!==data.height){buffer.width=data.width;buffer.height=data.height;image=undefined;}
      const target=buffer.getContext("2d")!;image??=target.createImageData(data.width,data.height);
      const pixels=new Uint32Array(image.data.buffer,image.data.byteOffset,data.values.length);
      for(let i=0;i<data.values.length;i++){
        const strength=data.values[i];
        // Cut the finite kernel's faint tail; empty areas retain the basemap.
        if(strength<.025){pixels[i]=0;continue;}
        const alpha=Math.round(235*Math.min(1,strength/.2));
        pixels[i]=colors[Math.min(255,Math.round(strength*255))]|(littleEndian?alpha<<24:alpha);
      }
      target.putImageData(image,0,0);key=data.key;
    }
    request.ctx.drawImage(buffer,0,0,request.width,request.height);
  };
  return Object.assign(paint,{dispose:()=>gpu?.dispose()});
}
