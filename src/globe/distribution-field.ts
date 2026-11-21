import {geoArea,type GeoProjection} from "d3-geo";
import {cellShape} from "../domain/spatial";
import type {GridSpec} from "../domain/types";
import {heatIntensity,smoothHeatField} from "../domain/distribution-heat";
import {orthographicCellPath} from "./orthographic-cell";
export type DistributionField={key:string;width:number;height:number;values:Float32Array};
export type DistributionPaintRequest={ctx:CanvasRenderingContext2D;projection:GeoProjection;grid:GridSpec;counts:Map<string,number>;width:number;height:number;dragging:boolean;scenes:boolean;mesh:boolean};
export type DistributionRaster={key:string;width:number;height:number;sigma:number;canvas:HTMLCanvasElement};
export function createDistributionRaster() {
  let buffer:HTMLCanvasElement|undefined,cached:DistributionRaster|undefined;
  return ({projection,grid,counts,width,height,dragging}:DistributionPaintRequest):DistributionRaster=>{
    const key=JSON.stringify([width,height,projection.translate(),projection.scale(),projection.rotate(),grid.key,dragging,[...counts]]);
    if(cached?.key===key)return cached;
    const k=Math.min(1,(dragging?360:640)/Math.max(width,height)),w=Math.ceil(width*k),h=Math.ceil(height*k);
    buffer??=document.createElement("canvas");
    if(buffer.width!==w || buffer.height!==h){buffer.width=w;buffer.height=h;}
    const target=buffer.getContext("2d",{willReadFrequently:true})!;
    target.setTransform(1,0,0,1,0,0);target.clearRect(0,0,w,h);
    target.setTransform(k,0,0,k,0,0);
    const path=orthographicCellPath(projection,target);
    for(const [id,count] of counts){
      if(count<=0)continue;
      const shade=Math.round(255*heatIntensity(count));
      target.fillStyle=target.strokeStyle=`rgb(${shade},${shade},${shade})`;
      target.beginPath();path(cellShape(id,grid).geometry);target.fill();target.lineWidth=.5;target.stroke();
    }
    const first=counts.size?cellShape(counts.keys().next().value!,grid):null;
    const sigma=first?Math.max(.8,Math.min(3,projection.scale()*Math.sqrt(geoArea(first.geometry))*.35*k)):1;
    return cached={key,width:w,height:h,sigma,canvas:buffer};
  };
}

/** CPU fallback and contour input share the exact raster with the GPU painter. */
export function createDistributionField(raster=createDistributionRaster()) {
  let cached:DistributionField|undefined;
  let field=new Float32Array(),middle=new Float32Array(),output=new Float32Array();
  return (request:DistributionPaintRequest):DistributionField=>{
    const data=raster(request);if(cached?.key===data.key)return cached;
    const {width:w,height:h,sigma}=data,image=data.canvas.getContext("2d")!.getImageData(0,0,w,h);
    if(field.length!==w*h){field=new Float32Array(w*h);middle=new Float32Array(w*h);output=new Float32Array(w*h);}
    for(let i=0;i<field.length;i++)field[i]=image.data[4*i]*image.data[4*i+3]/65025;
    return cached={key:data.key,width:w,height:h,values:smoothHeatField(field,w,h,sigma,{middle,output})};
  };
}
