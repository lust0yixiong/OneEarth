import type {XY} from "./regional-cases";

export const rainGrid={step:0.1,columns:3600,rows:1800} as const;
const {step,columns,rows}=rainGrid;
export const rainFrameSize=columns*rows;

export function rainCell([lon,lat]:XY){
  const longitude=((lon+180)%360+360)%360;
  const column=Math.min(columns-1,Math.floor(longitude/step+1e-9));
  const row=Math.min(rows-1,Math.max(0,Math.floor((90-lat)/step+1e-9)));
  return {index:row*columns+column,column,row,
    west:Math.round((-180+column*step)*10)/10,north:Math.round((90-row*step)*10)/10};
}
export const rainTileSize=180;
export const rainFactors=[10,2,1] as const;
export interface RainSource {
  run:"Final"|"Late"|"Derived"; version:string; url:string; conversion:string; sha256:string;
  provider?:string; status?:string;
  through?:string; complete?:boolean; doi?:string;
}
export interface RainMonth {
  month:number; path:string; source:RainSource; complete:boolean; through:string;
}
export interface RainCatalog {
  id:string; defaultYear:number; years:{year:number;months:number[]}[];
}
export interface RainManifest {
  id:string; product:string; year:number; step:number; columns:number; rows:number;
  tileSize:number; factors:number[]; bands:(number|null)[][];
  source:string; unit:string; scale:number; missing:number; months:(RainMonth|null)[];
}
export function rainTileCell(point:XY,level=2){
  const cell=rainCell(point),factor=rainFactors[level];
  const column=Math.floor(cell.column/factor),row=Math.floor(cell.row/factor);
  const x=Math.floor(column/rainTileSize),y=Math.floor(row/rainTileSize);
  return {id:y*(columns/factor/rainTileSize)+x,
    offset:row%rainTileSize*rainTileSize+column%rainTileSize,x,y};
}
export function rainTileXY(level:number,id:number){
  const width=columns/rainFactors[level]/rainTileSize;
  return {x:id%width,y:Math.floor(id/width)};
}
export function rainLevel(radius:number){
  const pixels=radius*Math.PI/180*step;
  return pixels<.2?0:pixels<1?1:2;
}
// Conservative projected bounds include tiles crossing the limb and the dateline.
export function rainVisibleTiles(level:number,center:XY,radius:number,cx:number,cy:number,width:number,height:number){
  const factor=rainFactors[level],size=rainTileSize*step*factor;
  const nx=columns/factor/rainTileSize,ny=rows/factor/rainTileSize;
  const radians=Math.PI/180,latitude=center[1]*radians;
  const half=size*radians/2;
  const result:number[]=[];
  for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){
    const lat=(90-(y+.5)*size)*radians,lon=(-180+(x+.5)*size-center[0])*radians;
    const cornerDot=(edge:number)=>Math.sin(lat)*Math.sin(edge)+Math.cos(lat)*Math.cos(edge)*Math.cos(half);
    const delta=Math.acos(Math.max(-1,Math.min(1,Math.min(cornerDot(lat-half),cornerDot(lat+half)))));
    const padding=radius*delta;
    const z=Math.sin(latitude)*Math.sin(lat)+Math.cos(latitude)*Math.cos(lat)*Math.cos(lon);
    if(delta<Math.PI/2 && z < -Math.sin(delta))continue;
    const px=cx+radius*Math.cos(lat)*Math.sin(lon);
    const py=cy-radius*(Math.cos(latitude)*Math.sin(lat)-Math.sin(latitude)*Math.cos(lat)*Math.cos(lon));
    if(px+padding<0 || px-padding>width || py+padding<0 || py-padding>height)continue;
    result.push(y*nx+x);
  }
  return result;
}

export const rainColors=["#f5efce","#b6dec0","#56b7b1","#227fa4","#33417f"];
export const rainBreaks=[0,2,5,10,15];

export function rainColor(value:number){
  const upper=rainBreaks.findIndex(stop=>stop>value);
  if(upper<0)return rainColors.at(-1)!;
  const low=Math.max(0,upper-1);
  const mix=(value-rainBreaks[low])/(rainBreaks[upper]-rainBreaks[low] || 1);
  const channels=[1,3,5].map(pos=>{
    const a=parseInt(rainColors[low].slice(pos,pos+2),16),b=parseInt(rainColors[upper].slice(pos,pos+2),16);
    return Math.round(a+(b-a)*mix);
  });
  return "rgb("+channels.join(",")+")";
}

