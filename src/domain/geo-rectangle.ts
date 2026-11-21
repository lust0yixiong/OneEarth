import type { MultiPolygon, Polygon } from "geojson";
import { geoBounds } from "d3-geo";
// Densify parallels so the spherical polygon follows latitude. Split full-longitude
// bands into sectors; a single ring from -180 to 180 collapses at the date line.
export function rectangle(w:number,s:number,e:number,n:number):MultiPolygon {
  const sectors:number[][][][]=[];
  const pieces=Math.ceil((e-w)/90);
  for(let i=0;i<pieces;i++){
    const left=w+(e-w)*i/pieces,right=w+(e-w)*(i+1)/pieces;
    const steps=Math.ceil((right-left)/3),ring:number[][]=[];
    for(let j=0;j<=steps;j++)ring.push([left+(right-left)*j/steps,n]);
    for(let j=steps;j>=0;j--)ring.push([left+(right-left)*j/steps,s]);
    ring.push(ring[0]);sectors.push([ring]);
  }
  return {type:"MultiPolygon",coordinates:sectors,bbox:[w,s,e,n]};
}

const interiors=new WeakMap<Polygon|MultiPolygon,number[][]>();
/** A numeric fast path only for the exact densified rectangles generated above.
 * Great-circle edges can bow beyond a parallel: derive conservative interior
 * latitudes from those arcs once, rather than treating a geographic bbox as a polygon. */
export function rectangleContainsVertex(area:Polygon|MultiPolygon,points:number[][]) {
  if(!interiors.has(area)) {
    const inner:number[][]=[];
    for(const rings of area.type==="MultiPolygon"?area.coordinates:[area.coordinates]) {
      if(rings.length!==1)continue;
      const ring=rings[0],xs=ring.map(point=>point[0]),ys=ring.map(point=>point[1]);
      const bbox=[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)];
      if(bbox[2]-bbox[0]>90 || bbox[0]===bbox[2] || bbox[1]===bbox[3])continue;
      const expected=rectangle(...bbox as [number,number,number,number]).coordinates[0][0];
      if(JSON.stringify(ring)!==JSON.stringify(expected) && JSON.stringify([...ring].reverse())!==JSON.stringify(expected))continue;
      let south=bbox[1],north=bbox[3];
      for(let i=1;i<ring.length;i++) {
        if(ring[i-1][1]===bbox[1] && ring[i][1]===bbox[1])south=Math.max(south,geoBounds({type:"LineString",coordinates:[ring[i-1],ring[i]]})[1][1]);
        if(ring[i-1][1]===bbox[3] && ring[i][1]===bbox[3])north=Math.min(north,geoBounds({type:"LineString",coordinates:[ring[i-1],ring[i]]})[0][1]);
      }
      inner.push([bbox[0],south,bbox[2],north]);
    }
    interiors.set(area,inner);
  }
  return interiors.get(area)!.some(box=>points.some(([x,y])=>x>box[0]+1e-10 && x<box[2]-1e-10 && y>box[1]+1e-10 && y<box[3]-1e-10));
}
