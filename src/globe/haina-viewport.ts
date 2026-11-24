import type {PublicBounds} from "../domain/haina-public-layer";
import type {Coordinate} from "../domain/types";

export type HainaViewport={datasetId:1835833|1846104;center:Coordinate;radius:number;width:number;height:number};
export type HainaTile={z:number;x:number;y:number;bounds:PublicBounds};
const radians=Math.PI/180;
const clamp=(value:number,min:number,max:number)=>Math.min(max,Math.max(min,value));
const lon180=(lon:number)=>((lon+180)%360+360)%360-180;
export const tileKey=({z,x,y}:HainaTile)=>z+"/"+x+"/"+y;
export const tileColumns=(zoom:number)=>2**(zoom+1);

export function tileBounds(z:number,x:number,y:number):PublicBounds {
  const span=180/2**z;
  return [-180+x*span,90-(y+1)*span,-180+(x+1)*span,90-y*span];
}

/** Envelope of the front orthographic disk clipped by the actual map rectangle.
 *  The rectangle is centered at the renderer's projection origin.
 */
export function hainaViewportBounds({center:[longitude,latitude],radius,width,height}:HainaViewport):PublicBounds[] {
  const x=Math.min(1,width/(2*radius)), y=Math.min(1,height/(2*radius));
  const phi=Math.abs(latitude)*radians, cos=Math.cos(phi), sin=Math.sin(phi);
  const poleY=Math.min(y,cos), oppositeZ=Math.sqrt(Math.max(0,1-x*x-y*y));
  const same=Math.asin(clamp(poleY*cos+Math.sqrt(Math.max(0,1-poleY*poleY))*sin,-1,1))/radians;
  const opposite=Math.asin(clamp(-y*cos+oppositeZ*sin,-1,1))/radians;
  const south=Math.max(-90,(latitude<0?-same:opposite)-1e-8);
  const north=Math.min(90,(latitude<0?-opposite:same)+1e-8);
  if(phi>1e-10 && y>=cos-1e-10)return [[-180,south,180,north]];

  const edgeX=Math.min(x,Math.sqrt(Math.max(0,1-y*y)));
  const edgeZ=Math.sqrt(Math.max(0,1-edgeX*edgeX-y*y));
  const delta=y>=1-1e-10?90:Math.atan2(edgeX,edgeZ*cos-y*sin)/radians;
  const center=lon180(longitude),west=center-delta-1e-8,east=center+delta+1e-8;
  if(west < -180)return [[west+360,south,180,north],[-180,south,east,north]];
  if(east > 180)return [[west,south,180,north],[-180,south,east-360,north]];
  return [[west,south,east,north]];
}

export function hainaBoundsIntersect(a:PublicBounds,b:PublicBounds) {
  return a[0]<b[2]&&a[2]>b[0]&&a[1]<b[3]&&a[3]>b[1];
}

export function hainaBoundsOnScreen([west,south,east,north]:PublicBounds,viewport:HainaViewport) {
  const [lon,lat]=viewport.center, phi=lat*radians;
  const dlon=((west+east)/2-lon)*radians, tileLat=(south+north)/2*radians;
  // A meridian leg plus a parallel leg bounds this rectangle's spherical radius.
  const cap=(east-west+north-south)*radians/2;
  const cosTile=Math.cos(tileLat),sinTile=Math.sin(tileLat),sin=Math.sin(phi),cos=Math.cos(phi);
  if(cap<Math.PI/2 && sin*sinTile+cos*cosTile*Math.cos(dlon)<-Math.sin(cap))return false;
  const x=viewport.radius*cosTile*Math.sin(dlon), y=viewport.radius*(cos*sinTile-sin*cosTile*Math.cos(dlon));
  const padding=viewport.radius*cap;
  return Math.abs(x)<=viewport.width/2+padding&&Math.abs(y)<=viewport.height/2+padding;
}

function tilesAtLevel(bands:PublicBounds[],z:number,viewport:HainaViewport):HainaTile[] {
  const unique=new Map<string,HainaTile>();
  const span=180/2**z,cols=tileColumns(z),rows=2**z;
  for(const [west,south,east,north] of bands){
    const startX=clamp(Math.floor((west+180)/span),0,cols-1);
    const endX=clamp(Math.ceil((east+180)/span)-1,0,cols-1);
    const startY=clamp(Math.floor((90-north)/span),0,rows-1);
    const endY=clamp(Math.ceil((90-south)/span)-1,0,rows-1);
    for(let y=startY;y<=endY;y++)for(let x=startX;x<=endX;x++){
      const bounds=tileBounds(z,x,y);
      if(hainaBoundsOnScreen(bounds,viewport))unique.set(z+"/"+x+"/"+y,{z,x,y,bounds});
    }
  }
  return [...unique.values()];
}

export function viirsViewportPlan(viewport:HainaViewport,sourceBounds:PublicBounds,tileSize:number,maxZoom:number) {
  const [west,south,east,north]=sourceBounds;
  const span=east-west,start=lon180(west),end=start+span;
  const sourceBands:PublicBounds[]=span>=360 ? [[-180,south,180,north]] :
    end>180 ? [[start,south,180,north],[-180,south,end-360,north]] : [[start,south,end,north]];
  const bands=hainaViewportBounds(viewport).flatMap(band=>sourceBands
    .filter(source=>hainaBoundsIntersect(band,source))
    .map(([w,s,e,n]):PublicBounds=>[Math.max(w,band[0]),Math.max(s,band[1]),Math.min(e,band[2]),Math.min(n,band[3])]));

  const coarse=tilesAtLevel(bands,0,viewport);
  const desired=clamp(Math.round(Math.log2(Math.PI*viewport.radius/tileSize)),0,maxZoom);
  for(let z=desired;z>0;z--){
    const target=tilesAtLevel(bands,z,viewport);
    if(target.length<=48)return {level:z,target,queue:[...coarse,...target]};
  }
  return {level:0,target:coarse,queue:coarse};
}
