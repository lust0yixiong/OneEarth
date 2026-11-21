import {geoDistance,type GeoProjection} from 'd3-geo';
import {cellAt,cellNeighbors,cellShape,overviewCells} from '../data/evidence/research-grid.mjs';
import type {Coordinate,GridSpec} from '../domain/types';
import type {Polygon} from 'geojson';
export type ViewportCell={id:string;geometry:Polygon;center:Coordinate};
export type ViewportPool={key:string;center:Coordinate;cap:number;cells:ViewportCell[]};
type Vector=[number,number,number];
const radii=new WeakMap<object,number>(),vectors=new WeakMap<object,Vector>();
export function unitVector([lon,lat]:Coordinate):Vector {
  const lambda=lon*Math.PI/180,phi=lat*Math.PI/180,cos=Math.cos(phi);
  return [cos*Math.cos(lambda),cos*Math.sin(lambda),Math.sin(phi)];
}
export function centerDot(cell:ViewportCell,view:Vector) {
  let v=vectors.get(cell.geometry);if(!v){v=unitVector(cell.center);vectors.set(cell.geometry,v);}
  return v[0]*view[0]+v[1]*view[1]+v[2]*view[2];
}
function angularRadius(cell:ViewportCell) {
  let value=radii.get(cell.geometry);
  if(value===undefined){value=Math.max(...cell.geometry.coordinates[0].map(p=>geoDistance(cell.center,p as Coordinate)));radii.set(cell.geometry,value);}
  return value;
}
export function inViewport(cell:ViewportCell,projection:GeoProjection,view:Vector,w:number,h:number) {
  const radius=angularRadius(cell);if(centerDot(cell,view)<-Math.sin(radius)-1e-12)return false;
  const point=projection(cell.center);if(!point)return false;
  const padding=projection.scale()*radius;
  return point[0]-padding<=w && point[0]+padding>=0 && point[1]-padding<=h && point[1]+padding>=0;
}
export function viewportCap(projection:GeoProjection,w:number,h:number) {
  const [x,y]=projection.translate();
  return Math.asin(Math.min(1,Math.hypot(Math.max(Math.abs(x),Math.abs(w-x)),Math.max(Math.abs(y),Math.abs(h-y)))/projection.scale()));
}
export function poolContains(pool:ViewportPool|undefined,g:GridSpec,center:Coordinate,cap:number) {
  return !!pool && pool.key===g.key && geoDistance(pool.center,center)+cap<=pool.cap;
}
export function createCoverageViewport() {
  const pools=new Map<string,ViewportPool>();
  function prepare(g:GridSpec,center:Coordinate,cap:number):ViewportPool {
    const old=pools.get(g.key);if(poolContains(old,g,center,cap))return old!;
    const view=unitVector(center),padded=Math.min(Math.PI,cap*1.4),todo=[cellAt(center,g)],seen=new Set<string>(),cells:ViewportCell[]=[];
    for(let i=0;i<todo.length;i++){
      const id=todo[i];if(seen.has(id))continue;seen.add(id);const cell=cellShape(id,g) as ViewportCell;
      if(centerDot(cell,view)<Math.cos(Math.min(Math.PI,padded+angularRadius(cell)))-1e-12)continue;
      cells.push(cell);for(const neighbor of cellNeighbors(id,g))if(!seen.has(neighbor))todo.push(neighbor);
    }
    const pool={key:g.key,center:[...center] as Coordinate,cap:padded,cells};pools.set(g.key,pool);
    if(pools.size>8)pools.delete(pools.keys().next().value!);
    return pool;
  }
  return {prepare,read(g:GridSpec,projection:GeoProjection,center:Coordinate,w:number,h:number,zoom:number):ViewportCell[]{
    if(zoom<2){const view=unitVector(center),limit=Math.cos(Math.PI*.52);return overviewCells(g).filter((c:ViewportCell)=>centerDot(c,view)>limit);}
    const view=unitVector(center),pool=prepare(g,center,viewportCap(projection,w,h));
    return pool.cells.filter(cell=>inViewport(cell,projection,view,w,h));
  }};
}
