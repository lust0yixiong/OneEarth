import test from 'node:test';
import assert from 'node:assert/strict';
import {geoDistance,geoOrthographic,geoPath} from 'd3-geo';
import {gridMesh,drawGrid,cellNeighbors,cellShape,cellAt} from '../data/evidence/research-grid.mjs';
import {gridSpec} from './spatial';
import {createCoverageViewport,visibleCoverageCells} from '../globe/coverage-grid';
import type {Coordinate,GridSpec} from './types';
import s2 from 's2-geometry';
import {s2KeyToId,s2IdToKey} from '../data/evidence/s2-cell-id.mjs';
const cell=(id:string,ring:number[][])=>({id,geometry:{type:'Polygon',coordinates:[ring]},center:[0,0]});

test('native S2 ids match the original library on every face and through all 30 levels',()=>{
 for(let face=0;face<6;face++)for(let level=1;level<=30;level++)for(const digits of ['0','3','0123','3210']){
  const key=face+'/'+digits.repeat(level).slice(0,level),id=s2.S2.keyToId(key);
  assert.equal(s2KeyToId(key),id);assert.equal(s2IdToKey(id),key);
  assert.equal(s2IdToKey(id),s2.S2.idToKey(id));
 }
 for(const point of [[180,0],[-180,80],[20,89.9],[120.13,30.27]] as Coordinate[])for(const band of [2,3,4,5,6,7]){
  const grid=gridSpec('s2',band),key=s2.S2.latLngToKey(point[1],point[0],grid.n),id=s2.S2.keyToId(key);
  assert.equal(cellAt(point,grid),id);
  const expected=s2.S2.S2Cell.FromHilbertQuadKey(key).getNeighbors().map((n:{toHilbertQuadkey():string})=>s2.S2.keyToId(n.toHilbertQuadkey()));
  assert.deepEqual(cellNeighbors(id,grid),expected);
 }
});

test('mesh drawing preserves shared internal edges once and never alters cell boundaries',()=>{
 const cells=[cell('a',[[0,0],[1,0],[1,1],[0,1],[0,0]]),cell('b',[[1,0],[2,0],[2,1],[1,1],[1,0]])];
 const before=structuredClone(cells),mesh=gridMesh(cells);
 assert.equal(mesh.type,'MultiLineString');assert.equal(mesh.coordinates.length,7);assert.deepEqual(cells,before);
 assert.equal(mesh.coordinates.filter((line:number[][])=>line.every(point=>point[0]===1)).length,1);
});
test('grid edges use one identity on both sides of the dateline',()=>{
 const mesh=gridMesh([cell('west',[[179,0],[180,0],[180,1],[179,1],[179,0]]),cell('east',[[-180,0],[-179,0],[-179,1],[-180,1],[-180,0]])]);
 assert.equal(mesh.coordinates.length,7);
 assert.equal(mesh.coordinates.filter((line:number[][])=>line.every(point=>Math.abs(point[0])===180)).length,1);
});
function referenceCells(grid:GridSpec,projection:ReturnType<typeof geoOrthographic>,center:Coordinate,w:number,h:number){
 const todo=[cellAt(center,grid)],seen=new Set<string>(),out=new Set<string>(),path=geoPath(projection);
 for(let i=0;i<todo.length;i++){
  const id=todo[i];if(seen.has(id))continue;seen.add(id);const cell=cellShape(id,grid);
  if(geoDistance(center,cell.center)>Math.PI*.52)continue;
  const [[left,top],[right,bottom]]=path.bounds(cell.geometry);
  if(left>w || right<0 || top>h || bottom<0)continue;
  out.add(id);for(const neighbour of cellNeighbors(id,grid))if(!seen.has(neighbour))todo.push(neighbour);
 }
 return out;
}
test('fast viewport bounds retain every polygon-visible H3 and S2 cell at the poles, dateline and local scales',()=>{
 const w=780,h=720;
 for(const system of ['h3','s2'] as const)for(const [band,zoom,center] of [[2,2.1,[105,25]],[3,4,[179,50]],[5,25,[20,82]],[7,200,[179.98,-10]]] as [number,number,Coordinate][]){
  const grid=gridSpec(system,band),projection=geoOrthographic().rotate([-center[0],-center[1]]).translate([w/2,h/2]).scale(Math.min(w,h)*.455*zoom).clipExtent([[0,0],[w,h]]);
  const expected=referenceCells(grid,projection,center,w,h),actual=new Set(visibleCoverageCells(grid,projection,center,w,h,zoom).map(cell=>cell.id));
  assert.ok(expected.size>0);
  for(const id of expected)assert.ok(actual.has(id),system+' '+grid.label+' lost visible cell '+id);
 }
});
test('moving the overview draws the same mesh without closing thousands of canvas polygons',()=>{
 let lines=0,closes=0,strokes=0;
 const ctx={beginPath(){},moveTo(){},lineTo(){lines++;},arc(){},closePath(){closes++;},stroke(){strokes++;}};
 const projection=geoOrthographic().rotate([-105,-25]).translate([400,360]).scale(320).clipExtent([[0,0],[800,720]]);
 drawGrid(ctx,projection,[105,25],gridSpec('h3',2),800,720,1);
 assert.ok(lines>1000);assert.equal(closes,0);assert.equal(strokes,1);
});
test('buffered viewports keep all visible cells across a small pan and a fresh cap across a long pan',()=>{
 const w=780,h=720;
 for(const system of ['h3','s2'] as const)for(const offset of [0,.24]){
  const viewport=createCoverageViewport(),g=gridSpec(system,4),zoom=8;
  for(const center of [[179,25],[-179.5,25],[80,70],[80.4,70.1]] as Coordinate[]){
   const projection=geoOrthographic().rotate([-center[0],-center[1]]).translate([w*(.5+offset),h/2]).scale(360*zoom).clipExtent([[0,0],[w,h]]);
   const actual=new Set(viewport.read(g,projection,center,w,h,zoom).map(cell=>cell.id));
   for(const id of referenceCells(g,projection,center,w,h))assert.ok(actual.has(id),system+' lost buffered cell '+id);
  }
 }
});
