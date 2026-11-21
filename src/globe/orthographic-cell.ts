import {geoPath,type GeoProjection} from "d3-geo";
import type {Polygon} from "geojson";

type Prepared={vectors:Float64Array;sagitta:number};
const prepared=new WeakMap<Polygon,Prepared>();
function prepare(area:Polygon):Prepared {
  const ring=area.coordinates[0],vectors=new Float64Array(ring.length*3);let sagitta=0;
  for(let i=0;i<ring.length;i++){
    const lon=ring[i][0]*Math.PI/180,lat=ring[i][1]*Math.PI/180,c=Math.cos(lat);
    vectors.set([c*Math.cos(lon),c*Math.sin(lon),Math.sin(lat)],i*3);
    if(i){const a=(i-1)*3,b=i*3,dot=vectors[a]*vectors[b]+vectors[a+1]*vectors[b+1]+vectors[a+2]*vectors[b+2];sagitta=Math.max(sagitta,1-Math.sqrt(Math.max(0,(1+dot)/2)));}
  }
  const result={vectors,sagitta};prepared.set(area,result);return result;
}

/** Known H3/S2 convex cells need no spherical clipping when wholly in front.
 * Use cached unit vectors only when their chord error is below D3's tolerance;
 * horizon cells, large cells and other projection transforms keep the D3 path. */
export function orthographicCellPath(projection:GeoProjection,ctx:CanvasRenderingContext2D){
  const fallback=geoPath(projection,ctx),rotate=projection.rotate(),[cx,cy]=projection.translate(),r=projection.scale();
  const lon=-rotate[0]*Math.PI/180,lat=-rotate[1]*Math.PI/180;
  const cl=Math.cos(lon),sl=Math.sin(lon),cp=Math.cos(lat),sp=Math.sin(lat);
  const supported=!rotate[2] && !projection.angle() && !projection.reflectX() && !projection.reflectY() && projection.center().every(v=>v===0);
  let screen=new Float64Array(0);
  return (area:Polygon)=>{
    if(!supported || area.coordinates.length!==1){fallback(area);return;}
    const {vectors,sagitta}=prepared.get(area)||prepare(area);
    if(r*sagitta>Math.min(.25,projection.precision())){fallback(area);return;}
    if(screen.length<vectors.length)screen=new Float64Array(vectors.length);
    for(let i=0;i<vectors.length;i+=3){
      const x=vectors[i],y=vectors[i+1],z=vectors[i+2],h=x*cl+y*sl;
      if(h*cp+z*sp<=0){fallback(area);return;}
      screen[i]=cx+r*(y*cl-x*sl);screen[i+1]=cy-r*(z*cp-h*sp);
    }
    ctx.moveTo(screen[0],screen[1]);
    for(let i=3;i<vectors.length;i+=3)ctx.lineTo(screen[i],screen[i+1]);
    ctx.closePath();
  };
}
