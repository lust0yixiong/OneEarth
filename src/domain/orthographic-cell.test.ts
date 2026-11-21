import test from "node:test";
import assert from "node:assert/strict";
import {geoOrthographic,geoPath} from "d3-geo";
import {orthographicCellPath} from "../globe/orthographic-cell";
import {cellAt,cellShape,gridSpec} from "./spatial";

function recorder(){
  const points:number[][]=[];
  const ctx={moveTo:(x:number,y:number)=>points.push([x,y]),lineTo:(x:number,y:number)=>points.push([x,y]),closePath:()=>{},arc:()=>{}};
  return {points,ctx:ctx as unknown as CanvasRenderingContext2D};
}
test("cached orthographic cell vertices agree with D3 across camera directions and the date line",()=>{
  for(const system of ["h3","s2"] as const)for(const point of [[105,25],[-179,40],[179,-60],[0,85]] as [number,number][])for(const band of [2,4,7]){
    const grid=gridSpec(system,band),shape=cellShape(cellAt(point,grid),grid),projection=geoOrthographic().rotate([-point[0],-point[1]]).translate([421,318]).scale(500);
    const {points,ctx}=recorder();orthographicCellPath(projection,ctx)(shape.geometry as GeoJSON.Polygon);
    for(const [x,y] of points)assert.ok(Number.isFinite(x)&&Number.isFinite(y));
    const projected=shape.geometry.coordinates[0].map((p:number[])=>projection(p as [number,number])!);
    // Fine cells take the fast path; coarse cells may require D3 resampling.
    if(band>=4){assert.equal(points.length,projected.length);points.forEach((p,i)=>p.forEach((v,n)=>assert.ok(Math.abs(v-projected[i][n])<1e-9)));}
  }
});
test("horizon clipping and projection transforms retain the original D3 path",()=>{
  const grid=gridSpec("h3",2),shape=cellShape(cellAt([89,0],grid),grid).geometry as GeoJSON.Polygon;
  for(const angle of [0,17]){
    const projection=geoOrthographic().translate([300,300]).scale(250).angle(angle),a=recorder(),b=recorder();
    orthographicCellPath(projection,a.ctx)(shape);geoPath(projection,b.ctx)(shape);
    assert.deepEqual(a.points,b.points);
  }
});
