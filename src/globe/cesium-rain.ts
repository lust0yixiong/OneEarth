import {Rectangle} from "cesium";
import {rainColor, rainFactors, rainGrid, rainLevel, rainTileSize, rainTileXY} from "../domain/rainfall";
import type {GeoImageFrame} from "./geo-image-layer";
import type {RainTiles} from "./rain-tiles";

const tileImages=new WeakMap<Uint16Array,GeoImageFrame>();
let palette:Uint8ClampedArray|undefined;

function colors(){
  if(palette)return palette;
  palette=new Uint8ClampedArray(1501*4);
  for(let code=0;code<=1500;code++){
    const color=rainColor(code/100);
    const channels=color.startsWith("#") ? [1,3,5].map(i=>parseInt(color.slice(i,i+2),16))
      : color.match(/\d+/g)!.map(Number);
    palette.set([...channels,255],code*4);
  }
  return palette;
}

function rainBounds(level:number,id:number):GeoImageFrame["bounds"] {
  const {x,y}=rainTileXY(level,id),size=rainTileSize*rainGrid.step*rainFactors[level];
  return [-180+x*size,90-(y+1)*size,-180+(x+1)*size,90-y*size];
}

function rainImage(values:Uint16Array,level:number,id:number):GeoImageFrame{
  const saved=tileImages.get(values);
  if(saved)return saved;
  const bounds=rainBounds(level,id),pixels=new Uint8ClampedArray(values.length*4),lookup=colors();
  for(let i=0;i<values.length;i++){
    const value=values[i];
    if(value===65535)continue;
    const offset=Math.min(value,1500)*4,at=i*4;
    pixels[at]=lookup[offset];pixels[at+1]=lookup[offset+1];pixels[at+2]=lookup[offset+2];pixels[at+3]=255;
  }
  const result={bounds,pixels,width:rainTileSize,height:rainTileSize};
  tileImages.set(values,result);
  return result;
}

export function visibleRainFrames(tiles:RainTiles,month:number,view:Rectangle|undefined,height:number,zoom:number){
  if(!tiles.available(month))return [];
  // Cesium switches LOD against the angular extent of the ground, rather than
  // using the legacy orthographic radius (the two cameras zoom differently).
  const level=view ? rainLevel(height/Math.max(.0001,view.height)) : 0;
  const renderLevel=Math.min(level,zoom<2?0:2);
  const tileCount=2*(10/rainFactors[renderLevel])**2;
  const ids=Array.from({length:tileCount},(_,id)=>id).filter(id=>
    !renderLevel || (view && Rectangle.intersection(Rectangle.fromDegrees(...rainBounds(renderLevel,id)),view)));
  tiles.setView(month,renderLevel,ids);
  const detail=renderLevel?ids.map(id=>tiles.get(month,renderLevel,id)):null;
  if(detail?.length&&detail.every((values):values is Uint16Array=>!!values))
    return detail.map((values,i)=>rainImage(values,renderLevel,ids[i]));

  // Replace the coarse scene atomically when the local tiles are complete.
  // Otherwise coarse imagery would show through valid native no-data pixels.
  return [0,1].flatMap(id=>{
    const values=tiles.get(month,0,id);
    return values?[rainImage(values,0,id)]:[];
  });
}
