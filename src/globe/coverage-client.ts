import type { CoverageResponse } from "../domain/coverage";
import {coverageBatchKey} from "../domain/coverage";
import type { CandidateSet, Filters, GridSpec } from "../domain/types";

type GridCache={grid:GridSpec;ready:Set<string>;counts:Map<string,number>};
type Scope={key:string;id?:string;revision?:string;grids:Map<string,GridCache>};
class ExpiredCoverageScope extends Error {}
/** The rendering path only reads counts. Intersections and persistent caches belong to the server. */
export function createCoverageClient(changed:()=>void,fetcher:typeof fetch=fetch) {
  const scopes=new Map<string,Scope>();
  let scope:Scope|undefined,filters:Filters,batch:CandidateSet|null|undefined,revision:number|string=-1;
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
    if (!response.ok) {
      if (path === "cells" && [404, 410].includes(response.status)) throw new ExpiredCoverageScope();
      throw Error("覆盖未知，暂时无法读取网格分布。");
    }
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
      if (!request.scope.id) {
        const issued=await post("scopes",{filters:requestFilters,batch:requestBatch});
        request.scope.id=issued.id;
        request.scope.revision=typeof issued.revision==="string"?issued.revision:undefined;
      }
      if(disposed)return;
      const result:CoverageResponse & {revision?:string}=await post("cells",{id:request.scope.id,revision:request.scope.revision,grid:request.cache.grid,cells});
      if (request.scope.revision && result.revision !== request.scope.revision) throw new ExpiredCoverageScope();
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
      if (cause instanceof ExpiredCoverageScope) {
        request.scope.id=undefined;
        request.scope.revision=undefined;
        for (const cache of request.scope.grids.values()) {
          cache.ready.clear();
          cache.counts.clear();
        }
        if (!disposed && wanted?.scope===request.scope) error="覆盖数据已更新，正在重新读取…";
        delay=120;
      } else {
        if(!disposed && wanted?.scope===request.scope) error=cause instanceof Error?cause.message:"覆盖未知，暂时无法读取网格分布。";
        delay=2500;
      }
    } finally {
      running=false;
      if(!disposed){changed();schedule(wanted?.scope===request.scope?delay:0);}
    }
  }
  return {
    read(grid:GridSpec,cells:string[],nextFilters:Filters,nextBatch:CandidateSet|null|undefined,nextRevision:number|string,defer=false) {
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
      return {cells:new Map(cells.flatMap(cell=>cache!.counts.has(cell)?[[cell,cache!.counts.get(cell)!] as const]:[])),ready:cache.ready,pending,error,revision:scope.revision};
    },
    invalidate() {
      scopes.clear();
      scope=undefined;
      wanted=undefined;
      error="覆盖数据已更新，正在重新读取…";
      changed();
    },
    dispose(){disposed=true;clearTimeout(timer);controller.abort();scopes.clear();},
  };
}
