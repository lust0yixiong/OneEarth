import {strokeMovingGrid} from "./moving-grid.mjs";
import s2 from 's2-geometry';
import {gridDisk,latLngToCell,cellToBoundary,cellToLatLng,getRes0Cells,cellToChildren} from 'h3-js';
import {geoArea,geoDistance,geoPath} from 'd3-geo';
import {s2KeyToId,s2IdToKey} from './s2-cell-id.mjs';

export const s2Levels=[5,6,8,9,11,12];
const {S2}=s2;
const geometryCache=new Map();
const neighborCache=new Map();
// Trusted viewport-worker results share the same immutable geometry cache.
export function cacheCellShapes(cells){
  for(const cell of cells)if(!geometryCache.has(cell.id))geometryCache.set(cell.id,cell);
  if(geometryCache.size>40000){const keep=new Set(cells.map(c=>c.id));for(const id of geometryCache.keys()){if(!keep.has(id))geometryCache.delete(id);if(geometryCache.size<=30000)break;}}
}
export function gridSpec(system,band){
  const n=system==='s2'?s2Levels[band-2]:band;
  return {system,n,label:system==='s2'?'S2 L'+n:'H3 R'+n,key:(system==='s2'?'s':'h')+n};
}
export function cellAt([lon,lat],g){
  return g.system==='s2'?s2KeyToId(S2.latLngToKey(lat,lon,g.n)):latLngToCell(lat,lon,g.n);
}
export function cellNeighbors(id,g){
  const key=g.key+'/'+id,cached=neighborCache.get(key);if(cached)return cached;
  let neighbors;
  if(g.system==="h3")neighbors=gridDisk(id,1).filter(c=>c!==id);
  else{const cell=S2.S2Cell.FromHilbertQuadKey(s2IdToKey(id));neighbors=cell.getNeighbors().map(n=>s2KeyToId(n.toHilbertQuadkey()));}
  if(neighborCache.size>=40000)for(let i=0;i<8000;i++)neighborCache.delete(neighborCache.keys().next().value);
  neighborCache.set(key,neighbors);return neighbors;
}
export function cellShape(id,g){
  if(geometryCache.has(id))return geometryCache.get(id);
  let ring,center;
  if(g.system==='s2'){
    const c=S2.S2Cell.FromHilbertQuadKey(s2IdToKey(id));
    ring=c.getCornerLatLngs().map(p=>[p.lng,p.lat]);ring.push(ring[0]);
    const mid=c.getLatLng();center=[mid.lng,mid.lat];
  }else{ring=cellToBoundary(id,true);center=cellToLatLng(id).reverse();}
  const geometry={type:'Polygon',coordinates:[ring]};
  if(geoArea(geometry)>2*Math.PI)ring.reverse();
  const result={id,geometry,center};
  if(geometryCache.size>=40000)for(let i=0;i<8000;i++)geometryCache.delete(geometryCache.keys().next().value);
  geometryCache.set(id,result);return result;
}
// Draw the visible grid at the current scale. Cell counts are computed separately
// from the original evidence geometries, independent of this screen sampling.
const globalCells=new Map();
const globalMeshes=new Map(),localMeshes=new Map(),projectedMeshes=new WeakMap();
const cellEdges=new WeakMap();

/** Shared edges are stroked once as lines, without per-cell polygon clipping/closure. */
export function gridMesh(cells){
  const edges=new Map();
  const vertex=([lon,lat])=>Math.round((((lon+180)%360+360)%360-180)*1e8)+','+Math.round(lat*1e8);
  for(const cell of cells){
    let prepared=cellEdges.get(cell.geometry);
    if(!prepared){
      prepared=[];const ring=cell.geometry.coordinates[0];
      for(let i=1;i<ring.length;i++){
        const a=vertex(ring[i-1]),b=vertex(ring[i]);
        if(a!==b)prepared.push([a<b?a+'|'+b:b+'|'+a,[ring[i-1],ring[i]]]);
      }
      cellEdges.set(cell.geometry,prepared);
    }
    for(const [key,line] of prepared)if(!edges.has(key))edges.set(key,line);
  }
  return {type:'MultiLineString',coordinates:[...edges.values()]};
}
function strokeGrid(ctx,projection,mesh){
  if(typeof Path2D==='function'){
    const key=JSON.stringify([projection.rotate(),projection.translate(),projection.scale(),projection.clipExtent(),projection.precision()]);
    let cached=projectedMeshes.get(projection);
    if(cached?.mesh!==mesh || cached.key!==key){const path=new Path2D();geoPath(projection,path)(mesh);cached={mesh,key,path};projectedMeshes.set(projection,cached);}
    ctx.stroke(cached.path);
  }else{ctx.beginPath();geoPath(projection,ctx)(mesh);ctx.stroke();}
}
export function overviewCells(g){
  if(globalCells.has(g.key))return globalCells.get(g.key);
  let ids;
  if(g.system==='h3')ids=getRes0Cells().flatMap(root=>cellToChildren(root,g.n));
  else{
    ids=[];const side=2**g.n;
    for(let f=0;f<6;f++)for(let i=0;i<side;i++)for(let j=0;j<side;j++){
      const cell=S2.S2Cell.FromFaceIJ(f,[i,j],g.n);
      ids.push(s2KeyToId(cell.toHilbertQuadkey()));
    }
  }
  const cells=ids.map(id=>cellShape(id,g));globalCells.set(g.key,cells);return cells;
}
export function drawGrid(ctx,projection,camera,g,w,h,z,visibleCells,moving=false){
  if(z<2){
    if(!globalMeshes.has(g.key))globalMeshes.set(g.key,gridMesh(overviewCells(g)));
    ctx.lineWidth=.48;
    ctx.strokeStyle='rgba(59,98,88,.11)';
    const mesh=globalMeshes.get(g.key);
    if (moving) strokeMovingGrid(ctx,projection,mesh,camera);
    else strokeGrid(ctx,projection,mesh);
    return;
  }
  if(visibleCells){
    const key=visibleCells.map(cell=>cell.id).join(',');
    let cached=localMeshes.get(g.key);
    if(cached?.key!==key){cached={key,mesh:gridMesh(visibleCells)};localMeshes.set(g.key,cached);if(localMeshes.size>8)localMeshes.delete(localMeshes.keys().next().value);}
    ctx.lineWidth=.6;ctx.strokeStyle='rgba(54,99,97,.20)';
    if(moving)strokeMovingGrid(ctx,projection,cached.mesh,camera);else strokeGrid(ctx,projection,cached.mesh);return;
  }
  const rad=projection.scale();
  const edge=g.system==='s2'?Math.sqrt(510065621/(6*4**g.n)):[182.5,69,26,9.9,3.7,1.4][g.n-2];
  const step=Math.max(13,Math.min(100,rad*edge/6371*.58));
  const seen=new Set(),cells=[];
  for(let y=-step;y<h+step;y+=step)for(let x=-step;x<w+step;x+=step){
    if(Math.hypot(x-w/2,y-h/2)>=rad)continue;
    const id=cellAt(projection.invert([x,y]),g);
    if(seen.has(id))continue;
    seen.add(id);const cell=cellShape(id,g);
    if(geoDistance(camera,cell.center)<Math.PI*.52)cells.push(cell);
  }
  drawGrid(ctx,projection,camera,g,w,h,z,cells);
}
