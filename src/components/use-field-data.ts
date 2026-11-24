import {useEffect,useMemo,useState} from "react";
import {fetchField,fieldTexture,type FieldData} from "../globe/regional-layer";
import type {RegionalId} from "../domain/regional-cases";
import type {RainCatalog} from "../domain/rainfall";

export function useFieldData(layer:{id:RegionalId;frame:number;year?:number}|null,catalog?:RainCatalog,overlay=false){
  const id=layer?.id,year=layer?.year;
  const key=id+"/"+year;
  const [loaded,setLoaded]=useState<{key:string;field:FieldData;catalog?:RainCatalog}|null>(null);
  const [revision,setRevision]=useState(0);
  const [error,setError]=useState(false),[attempt,retry]=useState(0);
  useEffect(()=>{
    setError(false);
    if(!id || id==="c40" || id==="forest" || (id==="rain" && (!catalog || year===undefined)))return;
    const controller=new AbortController();
    let data:FieldData|undefined;
    let unsubscribe:(()=>void)|undefined;
    fetchField(id,controller.signal,year,catalog).then(field=>{
      data=field;
      if(controller.signal.aborted){field.rain?.dispose();return;}
      if(field.rain)unsubscribe=field.rain.subscribe(()=>setRevision(n=>n+1));
      setLoaded({key,field,catalog});
    })
      .catch(()=>{if(!controller.signal.aborted)setError(true)});
    return ()=>{controller.abort();unsubscribe?.();data?.rain?.dispose();};
  },[id,year,attempt,catalog,key]);
  const field=id && loaded?.key===key && loaded.catalog===catalog?loaded.field:null;
  const texture=useMemo(()=>layer && field?fieldTexture(layer.id,layer.frame,field,overlay):null,[layer?.id,layer?.frame,field,overlay]);
  return {field,texture,revision,error,retry:()=>retry(n=>n+1)};
}
