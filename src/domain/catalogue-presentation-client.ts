import {
  readCataloguePresentation,type CatalogueFrameObservation,type CataloguePresentation,
  type CataloguePresentationItem,type CataloguePresentationState,type CataloguePresentationTarget,
} from "./catalogue-presentation";

const receiptPath=(runId:string)=>"/api/tasks/"+encodeURIComponent(runId)+"/catalogue-presentation";

async function save(target:CataloguePresentationTarget,items:CataloguePresentationItem[]){
  const {runId,items:_expected,...owner}=target;
  const body=JSON.stringify({...owner,items});
  for(let attempt=0;attempt<3;attempt++){
    try{
      const response=await fetch(receiptPath(runId),{method:"PUT",cache:"no-store",redirect:"error",
        headers:{"Content-Type":"application/json"},body,signal:AbortSignal.timeout(4000),keepalive:true});
      if(response.ok)return readCataloguePresentation(await response.json(),target);
      if(response.status<500)return;
    }catch{/* A lost response can be retried using the original immutable observations. */}
    if(attempt<2)await new Promise<void>(resolve=>setTimeout(resolve,250*(attempt+1)));
  }
}

type Active = {
  target:CataloguePresentationTarget;
  revision:number;
  remaining:Map<string,string>;
  timer:ReturnType<typeof setTimeout>;
  pending:Promise<void>;
};

export function createCataloguePresentationObserver(onReceipt:(receipt:CataloguePresentation,target:CataloguePresentationTarget)=>Promise<void>){
  let current:Active|undefined;
  function finish(active:Active,state:CataloguePresentationState,keys:Iterable<string>,observedAt=Date.now()){
    const items:CataloguePresentationItem[]=[];
    for(const datasetId of keys){
      const version=active.remaining.get(datasetId);
      if(version===undefined)continue;
      active.remaining.delete(datasetId);
      items.push({datasetId,version,state,observedAt});
    }
    if(!items.length)return;
    if(!active.remaining.size){
      clearTimeout(active.timer);
      if(current===active)current=undefined;
    }
    active.pending=active.pending.catch(()=>{}).then(async()=>{
      const receipt=await save(active.target,items);
      if(receipt)await onReceipt(receipt,active.target);
    }).catch(()=>{});
  }
  const supersede=()=>{
    if(current)finish(current,"superseded",current.remaining.keys());
  };
  return {
    start(target:CataloguePresentationTarget,revision:number){
      if(current?.target.runId===target.runId)return;
      supersede();
      const active:Active={target,revision,remaining:new Map(target.items.map(item=>[item.datasetId,item.version])),
        pending:Promise.resolve(),timer:setTimeout(()=>finish(active,"failed",active.remaining.keys()),8000)};
      current=active;
    },
    invalidateUnless(runId:string|undefined,batchId:string|undefined,revision:number){
      if(current&&(current.target.runId!==runId||current.target.batchId!==batchId||current.revision!==revision))supersede();
    },
    observe(frame:CatalogueFrameObservation,revision:number,versionOf:(id:string)=>string|undefined){
      const active=current;
      if(!active||frame.renderer!=="cesium"||active.target.runId!==frame.runId||
        active.target.batchId!==frame.batchId||active.revision!==revision)return;
      finish(active,"rendered",frame.datasetIds.filter(id=>active.remaining.get(id)===versionOf(id)),frame.observedAt);
    },
    dispose(){
      if(current)clearTimeout(current.timer);
      current=undefined;
    },
  };
}
