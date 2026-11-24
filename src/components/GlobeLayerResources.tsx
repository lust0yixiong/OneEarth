import {memo,useCallback,useLayoutEffect,useMemo,useState} from "react";
import type {GlobeDatasetLayer} from "../domain/globe-dataset-layers";
import {publishedRainPeriod} from "../domain/rain-catalog";
import type {HainaViewport} from "../globe/haina-viewport";
import {useHainaPublicLayer,type HainaPublicLayer} from "./use-haina-public-layer";
import {useHainaViirsTiles} from "./use-haina-viirs";
import {useRainCatalog} from "./use-rain-catalog";
import {useFieldData} from "./use-field-data";
import {useForestLayer} from "./use-forest-layer";
import {useC40Layer} from "./use-c40-layer";
import type {PublishedFieldCatalogues} from "./published-field-layer";

type PublicEntry=Extract<GlobeDatasetLayer,{kind:"public"}>;
type FieldEntry=Extract<GlobeDatasetLayer,{kind:"field"}>;
type LayerResource=
  | {kind:"public";selection:PublicEntry["selection"];haina:HainaPublicLayer;viirs:ReturnType<typeof useHainaViirsTiles>}
  | {kind:"field";selection:FieldEntry["selection"];layer:FieldEntry["selection"];publication:ReturnType<typeof useRainCatalog>;
    fieldData:ReturnType<typeof useFieldData>;forest:ReturnType<typeof useForestLayer>;c40:ReturnType<typeof useC40Layer>};
type UpdateResource=(id:string,owner:symbol,payload:LayerResource|null)=>void;

export function useGlobeLayerResources() {
  const [resources,setResources]=useState(()=>new Map<string,{owner:symbol;resource:LayerResource}>());
  const report=useCallback<UpdateResource>((id,owner,resource)=>{
    setResources(previous=>{
      const old=previous.get(id);
      if(resource){
        if(old?.owner===owner && old.resource===resource)return previous;
        return new Map(previous).set(id,{owner,resource});
      }
      if(old?.owner!==owner)return previous;
      const next=new Map(previous);
      next.delete(id);
      return next;
    });
  },[]);
  return {resources,report};
}

function useResourceReport(id:string,resource:LayerResource,report:UpdateResource) {
  const [owner]=useState(()=>Symbol(id));
  useLayoutEffect(()=>()=>report(id,owner,null),[id,owner,report]);
  useLayoutEffect(()=>report(id,owner,resource),[id,owner,resource,report]);
}

const PublicResource=memo(function PublicResource({entry,viewport,report}:{
  entry:PublicEntry;viewport?:HainaViewport;report:UpdateResource;
}) {
  const haina=useHainaPublicLayer(entry.selection);
  const publication=haina.catalogue.manifest;
  const viirs=useHainaViirsTiles(publication?.mode==="viirs"?publication:undefined,viewport);
  const resource=useMemo(()=>({kind:"public" as const,selection:entry.selection,haina,viirs}),[entry.selection,haina,viirs]);
  useResourceReport(entry.id,resource,report);
  return null;
});

const FieldResource=memo(function FieldResource({entry,playing,report,catalogues}:{
  entry:FieldEntry;playing:boolean;report:UpdateResource;catalogues?:PublishedFieldCatalogues;
}) {
  const {selection}=entry;
  const publication=useRainCatalog(selection.id==="rain");
  const catalog=publication.status==="ready"&&selection.id==="rain"?publication.catalog:undefined;
  const period=catalog?publishedRainPeriod(catalog,selection.year,selection.frame):null;
  const layer=period?{...selection,...period}:selection;
  const fieldData=useFieldData(layer,catalog,true);
  const forest=useForestLayer(layer.id==="forest"?layer:null,playing,layer.id==="forest"?catalogues?.forest:undefined);
  const c40=useC40Layer(layer.id==="c40"?layer:null,layer.id==="c40"?catalogues?.c40:undefined);
  useResourceReport(entry.id,{kind:"field",selection,layer,publication,fieldData,forest,c40},report);
  return null;
});

export function GlobeLayerResources({layers,focus,playing,viewport,report,catalogues}:{
  layers:GlobeDatasetLayer[];focus:string|null;playing:boolean;viewport?:HainaViewport;report:UpdateResource;
  catalogues?:PublishedFieldCatalogues;
}) {
  return layers.map(entry=>{
    if(entry.kind==="public")return <PublicResource key={entry.id} entry={entry} report={report}
      viewport={entry.selection.id===1835833?viewport:undefined}/>;
    if(entry.kind==="field")return <FieldResource key={entry.id} entry={entry} report={report} playing={playing&&entry.id===focus}
      catalogues={entry.selection.id==="c40" || entry.selection.id==="forest" ? catalogues : undefined}/>;
    return null;
  });
}
