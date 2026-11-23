import {loadRainTiles,type RainTiles} from "./rain-tiles";
import type {RainCatalog} from "../domain/rainfall";
import {geoEquirectangular,geoPath,type GeoProjection} from "d3-geo";
import {feature} from "topojson-client";
import atlas from "world-atlas/land-110m.json";
import {globeCases,hainaC40Manifest,hainaForestManifest,type C40City,type C40Manifest,type HainaForestManifest,type RegionalId,type RegionalData,type XY} from "../domain/regional-cases";
const radians=Math.PI/180;
const land=feature(atlas as any,(atlas as any).objects.land);
export const palettes={
  rain:[[239,236,200],[158,219,184],[58,179,174],[31,119,162],[54,58,125]],
  rivers:[[126,192,176],[63,178,187],[37,141,175],[15,99,158],[21,60,115]],
  lightning:[[241,206,152],[246,164,90],[230,102,76],[177,56,91],[101,34,110]],
  forest:[[225,238,246],[180,214,232],[120,184,212],[64,142,180],[31,94,140]],
  c40:[[225,238,246],[180,214,232],[120,184,212],[64,142,180],[31,94,140]]
};
function shade(id:RegionalId,value:number){
  const scale=Math.min(4,4*Math.sqrt(value/globeCases[id].max)),lo=Math.floor(scale),a=palettes[id][lo],b=palettes[id][Math.min(4,lo+1)];
  return a.map((c,i)=>Math.round(c+(b[i]-c)*(scale-lo)));
}
const textureWidth=1440,textureHeight=720;
function basemap(){
  const c=document.createElement("canvas");c.width=textureWidth;c.height=textureHeight;
  const ctx=c.getContext("2d")!;
  ctx.fillStyle="#c9e1e7";ctx.fillRect(0,0,c.width,c.height);
  const projection=geoEquirectangular().translate([c.width/2,c.height/2]).scale(c.width/(2*Math.PI));
  ctx.beginPath();geoPath(projection,ctx)(land as any);ctx.fillStyle="#e5e6e4";ctx.fill();ctx.strokeStyle="#8da9a1";ctx.lineWidth=.8;ctx.stroke();
  return c;
}

export type ForestImage={pixels:Uint8ClampedArray;width:number;height:number;bounds:[number,number,number,number]};
export type FieldData={rain:RainTiles|null;data:RegionalData|null;forest?:{manifest:HainaForestManifest;images:ForestImage[]};raster?:{manifest:C40Manifest;images:{city:C40City;image:ForestImage}[]}};
export async function fetchField(id:RegionalId,signal:AbortSignal,year?:number,catalog?:RainCatalog):Promise<FieldData>{
  if(id==="rain"){
    if(!catalog || year===undefined)throw Error("降水发布年月未确定");
    return {rain:await loadRainTiles(signal,year,catalog),data:null};
  }
  if(id==="c40"){
    const manifest=hainaC40Manifest as unknown as C40Manifest;
    const images=await Promise.all(manifest.cities.map(async city=>{
      const response=await fetch(city.image,{signal});
      if(!response.ok)throw Error("C40 嵌入切片暂时无法读取");
      const bitmap=await createImageBitmap(await response.blob());
      const canvas=document.createElement("canvas");
      canvas.width=bitmap.width;canvas.height=bitmap.height;
      const context=canvas.getContext("2d")!;
      context.drawImage(bitmap,0,0);bitmap.close();
      const data=context.getImageData(0,0,canvas.width,canvas.height);
      return {city,image:{pixels:data.data,width:data.width,height:data.height,bounds:city.bounds}};
    }));
    signal.throwIfAborted();
    return {rain:null,data:null,raster:{manifest,images}};
  }
  if(id==="forest"){
    const manifest=hainaForestManifest as HainaForestManifest;
    const images=await Promise.all(manifest.frames.map(async frame=>{
      const res=await fetch(frame.image,{signal});
      if(!res.ok)throw Error("森林嵌入切片暂时无法读取");
      const bitmap=await createImageBitmap(await res.blob());
      const canvas=document.createElement("canvas");
      canvas.width=bitmap.width;canvas.height=bitmap.height;
      const context=canvas.getContext("2d")!;
      context.drawImage(bitmap,0,0);bitmap.close();
      const data=context.getImageData(0,0,canvas.width,canvas.height);
      return {pixels:data.data,width:data.width,height:data.height,bounds:manifest.grid.bounds};
    }));
    signal.throwIfAborted();
    return {rain:null,data:null,forest:{manifest,images}};
  }
  const res=await fetch("/visualizations/regional/"+(id==="lightning"?"lightning-year":id)+".json",{signal});
  if(!res.ok)throw Error("数据暂时无法读取");
  return {rain:null,data:await res.json()};
}
let baseCanvas:HTMLCanvasElement|undefined;
export function fieldTexture(id:RegionalId,frame:number,{rain,data}:FieldData){
    if(id==="forest"||id==="c40")return null;
    const base=baseCanvas??=basemap(),info=globeCases[id];
    if(rain)return null;
    const c=document.createElement("canvas");c.width=base.width;c.height=base.height;
    const ctx=c.getContext("2d")!;ctx.drawImage(base,0,0);
    if(data){
      if(data.network){ctx.strokeStyle="#a2c8c7";ctx.lineWidth=.65;ctx.beginPath();for(const line of data.network)line.forEach(([x,y],i)=>i?ctx.lineTo((x+180)*4,(90-y)*4):ctx.moveTo((x+180)*4,(90-y)*4));ctx.stroke();}
      data.points.forEach((p,i)=>{const v=data.frames[frame][i];if(v===null||v<=0)return;
        const color="rgb("+shade(id,v)+")";
        if(p.line){ctx.beginPath();p.line.forEach(([x,y],j)=>j?ctx.lineTo((x+180)*4,(90-y)*4):ctx.moveTo((x+180)*4,(90-y)*4));ctx.lineWidth=1.8+5*Math.sqrt(v/info.max);ctx.lineCap="round";ctx.strokeStyle=color;ctx.stroke();}
        else {ctx.fillStyle=color;ctx.fillRect((p.xy[0]+179.75)*4,(89.75-p.xy[1])*4,2,2);}
      });
    }
    return ctx.getImageData(0,0,c.width,c.height).data;
 }
export function sampleField(id:RegionalId,frame:number,field:FieldData,[lon,lat]:XY,zoom:number){
  if(field.rain){
    const value=field.rain.series([lon,lat])[frame];
    return value==null?null:{value,name:""};
  }
  if(!field.data)return null;
  const d=field.data;
  let nearest=-1,dist=(1/zoom)**2;
  d.points.forEach((p,i)=>{
    if(id==="lightning"){if(Math.floor(lon*2)===Math.floor(p.xy[0]*2)&&Math.floor(lat*2)===Math.floor(p.xy[1]*2))nearest=i;}
    else for(const [x,y] of p.line || [p.xy]){const q=((x-lon)*Math.cos(lat*radians))**2+(y-lat)**2;if(q<dist){nearest=i;dist=q;}}
  });
  const value=nearest<0?null:d.frames[frame][nearest];return value==null?null:{value,name:d.points[nearest].name||""};
}
// Use the main globe's projection, including its camera, zoom and reserved Chat inset.
export function createFieldPainter(){
  const buffer=document.createElement("canvas");
  let cacheKey="",indices=new Int32Array(),shading=new Float32Array();
  return (ctx:CanvasRenderingContext2D,p:GeoProjection,texture:Uint8ClampedArray,width:number,height:number,moving:boolean)=>{
    const [cx,cy]=p.translate(),radius=p.scale();
    const left=Math.max(0,Math.floor(cx-radius)),top=Math.max(0,Math.floor(cy-radius));
    const dw=Math.min(width,cx+radius)-left,dh=Math.min(height,cy+radius)-top;
    if(dw<=0||dh<=0)return;
    // Keep drag renders light, then redraw the settled viewport at display resolution.
    const k=moving?Math.min(1,640/Math.max(dw,dh)):Math.min(devicePixelRatio,2,1600/Math.max(dw,dh));
    const w=Math.ceil(dw*k),h=Math.ceil(dh*k);
    const key=[width,height,w,h,cx,cy,radius,...p.rotate()].join("/");
    if(key!==cacheKey){
      cacheKey=key;buffer.width=w;buffer.height=h;indices=new Int32Array(w*h).fill(-1);shading=new Float32Array(w*h);
      for(let y=0;y<h;y++)for(let x=0;x<w;x++){
        const px=left+(x+.5)*dw/w,py=top+(y+.5)*dh/h;
        const a=(px-cx)/radius,b=(py-cy)/radius,z=1-a*a-b*b;if(z<=0)continue;
        const [lon,lat]=p.invert!([px,py])!,i=y*w+x;
        indices[i]=4*(Math.min(719,Math.max(0,Math.floor((90-lat)*4)))*1440+Math.min(1439,Math.max(0,Math.floor((lon+180)*4))));
        shading[i]=.87+.13*Math.sqrt(z)-.055*a-.05*b;
      }
    }
    const target=buffer.getContext("2d")!,image=target.createImageData(w,h);
    for(let i=0;i<indices.length;i++){const j=indices[i];if(j<0)continue;for(let c=0;c<3;c++)image.data[4*i+c]=texture[j+c]*shading[i];image.data[4*i+3]=255;}
    target.putImageData(image,0,0);ctx.drawImage(buffer,left,top,dw,dh);
  };
}
