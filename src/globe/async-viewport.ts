import type {GeoProjection} from 'd3-geo';
import {cacheCellShapes} from '../data/evidence/research-grid.mjs';
import {createCoverageViewport,inViewport,poolContains,unitVector,viewportCap,type ViewportPool,type ViewportCell} from './viewport-pool';
import type {GridSpec,Coordinate} from '../domain/types';
/** Topology walks run away from pointer events. Replies carry padded spherical
 * caps, so small camera changes reuse exact cells without another worker trip. */
export function createAsyncCoverageViewport(changed:()=>void) {
  const fallback=createCoverageViewport(),pools=new Map<string,ViewportPool>();
  let worker:Worker|undefined,failed=false,busy=false,id=0,pending=false,disposed=false;
  let wanted:{grid:GridSpec;center:Coordinate;cap:number}|undefined;
  function fail(){worker?.terminate();worker=undefined;failed=true;busy=false;pending=false;changed();}
  function request(){
    if(disposed||busy||!wanted||!worker)return;
    if(poolContains(pools.get(wanted.grid.key),wanted.grid,wanted.center,wanted.cap))return;
    busy=true;worker.postMessage({id:++id,...wanted});
  }
  try{
    worker=new Worker(new URL('./viewport.worker.ts',import.meta.url),{type:'module'});
    worker.onerror=fail;
    worker.onmessage=event=>{
      if(disposed)return;busy=false;
      if(event.data.error){fail();return;}
      const pool=event.data.pool as ViewportPool;
      pools.set(pool.key,pool);cacheCellShapes(pool.cells);
      if(pools.size>8)pools.delete(pools.keys().next().value!);
      request();changed();
    };
  }catch{failed=true;}
  return {
    get pending(){return pending;},
    read(g:GridSpec,projection:GeoProjection,center:Coordinate,w:number,h:number,zoom:number):ViewportCell[]{
      if(zoom<2 || failed){pending=false;return fallback.read(g,projection,center,w,h,zoom);}
      const cap=viewportCap(projection,w,h),pool=pools.get(g.key);
      wanted={grid:g,center:[...center],cap};pending=!poolContains(pool,g,center,cap);if(pending)request();
      // Retain only same-grid cells while refining; counts stay explicitly pending.
      const view=unitVector(center);
      return pool?.cells.filter(cell=>inViewport(cell,projection,view,w,h))||[];
    },
    dispose(){disposed=true;worker?.terminate();pools.clear();},
  };
}
