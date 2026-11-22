import {useEffect,useState} from "react";
import type {ScopeItem} from "../domain/question-scope";

import {validObservationMaterial,type ObservationAttachment,type ObservationMaterial} from "../domain/observation-material";

const identity=(item:Pick<ObservationMaterial,"artifactId"|"version">)=>JSON.stringify([item.artifactId,item.version]);

export function ObservationMaterialPicker({attached,disabled,onAttach}:{
  attached:ScopeItem[];
  disabled:boolean;
  onAttach:(item:ObservationAttachment)=>void;
}){
  const [materials,setMaterials]=useState<ObservationMaterial[]>([]);
  useEffect(()=>{
    const controller=new AbortController();
    void fetch("/api/observation-materials",{
      cache:"no-store",signal:AbortSignal.any([controller.signal,AbortSignal.timeout(8000)]),
    }).then(async response=>{
      if (!response.ok) return;
      const value=await response.json() as {materials?:unknown}|null;
      if (controller.signal.aborted || !Array.isArray(value?.materials)) return;
      const options=value.materials.filter(validObservationMaterial);
      setMaterials([...new Map(options.map(item=>[identity(item),item])).values()]);
    }).catch(()=>{});
    return ()=>controller.abort();
  },[]);
  if (!materials.length) return null;

  const selected=new Set(attached.flatMap(item=>item.kind==="observation"?[identity(item)]:[]));
  return <select className="observation-material-picker" aria-label="选择观测资料" value="" disabled={disabled}
    onChange={event=>{
      const material=materials.find(item=>identity(item)===event.currentTarget.value);
      if (!material || selected.has(identity(material))) return;
      const {artifactId,version,title}=material;
      onAttach({kind:"observation",artifactId,version,title});
    }}>
    <option value="" disabled>选择观测资料</option>
    {materials.map(item=><option key={identity(item)} value={identity(item)} disabled={selected.has(identity(item))}>
      {item.title} · {item.version}{item.variables.length?" · "+item.variables.join("、"):""}
    </option>)}
  </select>;
}
