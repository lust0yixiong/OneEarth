import {contourLevels,contourSegments} from "../domain/distribution-contours";
import {heatColor} from "../domain/distribution-heat";
import type {DistributionField,DistributionPaintRequest} from "./distribution-field";
export function createDistributionContourPainter(field:(request:DistributionPaintRequest)=>DistributionField) {
  let buffer:HTMLCanvasElement|undefined,key="";
  return (request:DistributionPaintRequest)=>{
    if(!request.counts.size)return;
    const data=field(request);buffer??=document.createElement("canvas");
    if(key!==data.key){
      const width=Math.ceil(request.width),height=Math.ceil(request.height);
      if(buffer.width!==width || buffer.height!==height){buffer.width=width;buffer.height=height;}
      const target=buffer.getContext("2d")!,sx=request.width/data.width,sy=request.height/data.height;
      target.clearRect(0,0,buffer.width,buffer.height);
      for(const level of contourLevels){
        const lines=contourSegments(data.values,data.width,data.height,level);
        const color=heatColor(level).map((c,i)=>Math.round(c*(i===0?.72:.62)));
        target.strokeStyle=`rgb(${color.join(",")})`;target.lineWidth=level>=.54?1.5:1;
        target.lineCap="round";target.lineJoin="round";target.beginPath();
        for(let i=0;i<lines.length;i+=4){target.moveTo((lines[i]+.5)*sx,(lines[i+1]+.5)*sy);target.lineTo((lines[i+2]+.5)*sx,(lines[i+3]+.5)*sy);}
        target.stroke();
      }
      key=data.key;
    }
    request.ctx.drawImage(buffer,0,0,request.width,request.height);
  };
}
