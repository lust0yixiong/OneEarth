import type {GeoProjection} from "d3-geo";
import type {GeoImageFrame} from "./geo-image-layer";
import {tileColumns,type HainaTile} from "./haina-viewport";

export type ViirsRaster={level:number;revision:string;tiles:(HainaTile & {image:GeoImageFrame})[]};

/** Invert the actual orthographic canvas once, then compose available geographic levels. */
export function createViirsPainter() {
  const buffer=document.createElement("canvas");
  const ctx=buffer.getContext("2d")!;
  let geometry="",addressesX=new Int32Array(0),addressesY=new Int32Array(0);
  let output:ImageData|undefined;
  let lastRaster:ViirsRaster|undefined;
  let planes:{zoom:number;columns:number;tiles:Map<number,Uint8ClampedArray>}[]=[];
  const tileSize=256;
  return (target:CanvasRenderingContext2D,projection:GeoProjection,raster:ViirsRaster,width:number,height:number,moving:boolean)=>{
    const [cx,cy]=projection.translate(),radius=projection.scale();
    const left=Math.max(0,Math.floor(cx-radius)),top=Math.max(0,Math.floor(cy-radius));
    const right=Math.min(width,Math.ceil(cx+radius)),bottom=Math.min(height,Math.ceil(cy+radius));
    const sw=right-left,sh=bottom-top;
    if(sw<=0||sh<=0)return;
    const limit=moving?475:1050;
    const factor=Math.min(moving?1:Math.min(devicePixelRatio,1.5),limit/Math.max(sw,sh));
    const w=Math.max(1,Math.ceil(sw*factor)),h=Math.max(1,Math.ceil(sh*factor));
    const key=[...projection.rotate(),cx,cy,radius,left,top,sw,sh,w,h,raster.level].join("/");
    const needsProjection=key!==geometry;
    if(needsProjection){
      geometry=key;
      if(buffer.width!==w||buffer.height!==h||!output){
        buffer.width=w;
        buffer.height=h;
        addressesX=new Int32Array(w*h);
        addressesY=new Int32Array(w*h);
        output=ctx.createImageData(w,h);
      }
      addressesX.fill(-1);
      const worldWidth=tileColumns(raster.level)*tileSize, worldHeight=worldWidth/2;
      for(let row=0;row<h;row++)for(let col=0;col<w;col++){
        const x=left+(col+.5)*sw/w,y=top+(row+.5)*sh/h;
        if((x-cx)**2+(y-cy)**2>=radius*radius)continue;
        const point=projection.invert!([x,y]);
        if(!point)continue;
        const [lon,lat]=point;
        const offset=row*w+col;
        addressesX[offset]=Math.floor((lon+180)/360*worldWidth+worldWidth)%worldWidth;
        addressesY[offset]=Math.min(worldHeight-1,Math.max(0,Math.floor((90-lat)/180*worldHeight)));
      }
    }
    const needsTiles=lastRaster!==raster;
    if(needsTiles){
      lastRaster=raster;
      const byZoom=new Map<number,Map<number,Uint8ClampedArray>>();
      for(const tile of raster.tiles){
        let plane=byZoom.get(tile.z);
        if(!plane){plane=new Map();byZoom.set(tile.z,plane);}
        plane.set(tile.y*tileColumns(tile.z)+tile.x,tile.image.pixels);
      }
      planes=[...byZoom].sort(([a],[b])=>b-a).map(([zoom,tiles])=>({zoom,tiles,columns:tileColumns(zoom)}));
    }
    if(needsProjection||needsTiles){
      const rgba=output!.data;
      for(let i=0;i<addressesX.length;i++){
        const offset=i*4;
        rgba[offset+3]=0;
        if(addressesX[i]<0)continue;
        for(const plane of planes){
          const shift=raster.level-plane.zoom;
          const x=addressesX[i]>>shift,y=addressesY[i]>>shift;
          const tile=plane.tiles.get((y>>8)*plane.columns+(x>>8));
          if(!tile)continue;
          const source=((y&255)*tileSize+(x&255))*4;
          rgba[offset]=tile[source];
          rgba[offset+1]=tile[source+1];
          rgba[offset+2]=tile[source+2];
          rgba[offset+3]=tile[source+3];
          break;
        }
      }
      ctx.putImageData(output!,0,0);
    }
    target.drawImage(buffer,left,top,sw,sh);
  };
}
