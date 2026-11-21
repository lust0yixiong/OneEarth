import type { CoverageResponse } from "../domain/coverage";
import {coverageBatchKey} from "../domain/coverage";
import type { CandidateSet, Filters, GridSpec } from "../domain/types";

type GridCache={grid:GridSpec;ready:Set<string>;counts:Map<string,number>};
type Scope={key:string;id?:string;grids:Map<string,GridCache>};
/** The rendering path only reads counts. Intersections and persistent caches belong to the server. */
export function createCoverageClient(changed:()=>void,fetcher:typeof fetch=fetch) {
  const scopes=new Map<string,Scope>();
  let scope:Scope|undefined,filters:Filters,batch:CandidateSet|null|undefined,revision=-1;
  let wanted:{scope:Scope;cache:GridCache;cells:string[]}|undefined;
  let timer:ReturnType<typeof setTimeout>|undefined,running=false,disposed=false,deferred=false,error="";
  const controller=new AbortController();
  function schedule(delay=80) {
    if(disposed || deferred || running || timer)return;
    timer=setTimeout(()=>{timer=undefined;void work();},delay);
  }
  async function post(path:string,body:unknown) {
    const response=await fetcher("/api/coverage/"+path,{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify(body),signal:controller.signal});
    if(!response.ok){if(response.status===404 && wanted)wanted.scope.id=undefined;throw Error("网格分布暂时无法读取，正在重试…");}
    return response.json();
  }
  async function work() {
    if(!wanted || disposed || deferred)return;
    const request=wanted,requestFilters=filters,requestBatch=batch;
    const cells=request.cells.filter(cell=>!request.cache.ready.has(cell)).slice(0,512);
    if(!cells.length)return;
    running=true;
    let delay=0;
    try {
      request.scope.id ??= (await post("scopes",{filters:requestFilters,batch:requestBatch})).id;
      if(disposed)return;
      const result:CoverageResponse=await post("cells",{id:request.scope.id,grid:request.cache.grid,cells});
      if(!Array.isArray(result.ready) || !Array.isArray(result.cells) || !Number.isSafeInteger(result.pending))throw Error("网格分布返回格式有误。");
      for(const cell of result.ready)request.cache.ready.add(cell);
      for(const [cell,count] of result.cells)request.cache.counts.set(cell,count);
      // Bound memory per layer; persistent server entries survive client eviction.
      while(request.cache.ready.size>30000) {
        const cell=request.cache.ready.values().next().value!;
        request.cache.ready.delete(cell);request.cache.counts.delete(cell);
      }
      if(wanted?.scope===request.scope)error="";
      delay=result.pending?120:0;
    } catch(cause) {
      if(!disposed && wanted?.scope===request.scope)error=cause instanceof Error?cause.message:"网格分布暂时无法读取。";
      delay=2500;
    } finally {
      running=false;
      if(!disposed){changed();schedule(wanted?.scope===request.scope?delay:0);}
    }
  }
  return {
    read(grid:GridSpec,cells:string[],nextFilters:Filters,nextBatch:CandidateSet|null|undefined,nextRevision:number,defer=false) {
      if(!scope || filters!==nextFilters || batch!==nextBatch || revision!==nextRevision) {
        filters=nextFilters;batch=nextBatch;revision=nextRevision;
        const key=JSON.stringify([revision,filters,coverageBatchKey(batch)]);
        scope=scopes.get(key) || {key,grids:new Map()};scopes.set(key,scope);
        if(scopes.size>8)scopes.delete(scopes.keys().next().value!);
        error="";
      }
      let cache=scope.grids.get(grid.key);
      if(!cache){cache={grid,ready:new Set(),counts:new Map()};scope.grids.set(grid.key,cache);}
      wanted={scope,cache,cells};deferred=defer;
      const pending=cells.some(cell=>!cache!.ready.has(cell));
      if(defer && timer){clearTimeout(timer);timer=undefined;}
      else if(pending)schedule();
      return {cells:new Map(cells.flatMap(cell=>cache!.counts.has(cell)?[[cell,cache!.counts.get(cell)!] as const]:[])),ready:cache.ready,pending,error};
    },
    dispose(){disposed=true;clearTimeout(timer);controller.abort();scopes.clear();},
  };
}
