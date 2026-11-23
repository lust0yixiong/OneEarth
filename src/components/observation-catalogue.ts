import {createContext,useContext,useEffect,useState} from "react";
import {validObservationMaterial,type ObservationAttachment,type ObservationMaterial} from "../domain/observation-material";
import {observationSourceUrl,validObservationSourceBinding} from "../domain/observation-source";

const identity=(item:Pick<ObservationMaterial,"artifactId"|"version">)=>JSON.stringify([item.artifactId,item.version]);

type LinkedObservationFile = {material:ObservationMaterial;dataUrl:string;catalogUrl:string;versionLabel:string};
type ObservationCatalogue = {byReferenceUrl:Map<string,Map<string,LinkedObservationFile>>};
const emptyCatalogue:ObservationCatalogue={byReferenceUrl:new Map()};
export const ObservationCatalogueContext=createContext(emptyCatalogue);
export const useObservationCatalogue=()=>useContext(ObservationCatalogueContext);

function parseCatalogue(value:{materials?:unknown;sourceBindings?:unknown}|null):ObservationCatalogue {
  if (!Array.isArray(value?.materials)) return emptyCatalogue;
  const byId=new Map(value.materials.filter(validObservationMaterial).map(item=>[identity(item),item]));
  const byReferenceUrl:ObservationCatalogue["byReferenceUrl"]=new Map();
  for (const raw of Array.isArray(value.sourceBindings)?value.sourceBindings:[]) {
    if (!validObservationSourceBinding(raw)) continue;
    const key=identity(raw),material=byId.get(key);
    const dataUrl=observationSourceUrl(raw.dataUrl),catalogUrl=observationSourceUrl(raw.catalogUrl);
    if (!material || !dataUrl || !catalogUrl) continue;
    // Use the published reference verbatim. URL parsing above is only for link safety.
    for (const reference of raw.referenceUrls) {
      const matches=byReferenceUrl.get(reference) ?? new Map<string,LinkedObservationFile>();
      matches.set(key,{material,dataUrl,catalogUrl,versionLabel:raw.versionLabel});
      byReferenceUrl.set(reference,matches);
    }
  }
  return {byReferenceUrl};
}

export function usePublishedObservationCatalogue(active:boolean) {
  const [catalogue,setCatalogue]=useState(emptyCatalogue);
  useEffect(()=>{
    if (!active) {setCatalogue(emptyCatalogue);return;}
    const controller=new AbortController();
    void fetch("/api/observation-materials",{
      cache:"no-store",signal:AbortSignal.any([controller.signal,AbortSignal.timeout(8000)]),
    }).then(async response=>{
      if (!response.ok) return;
      const value=await response.json() as {materials?:unknown;sourceBindings?:unknown}|null;
      if (!controller.signal.aborted) setCatalogue(parseCatalogue(value));
    }).catch(()=>{});
    return ()=>controller.abort();
  },[active]);
  return catalogue;
}

export function observationAttachment({artifactId,version,title}:ObservationMaterial):ObservationAttachment {
  return {kind:"observation",artifactId,version,title};
}
