import {observationMaterialId} from "./observation-material";

export type ObservationArtifactSource = {
  dataUrl:string;
  catalogUrl:string;
  versionLabel:string;
};

export type ObservationSourceBinding = ObservationArtifactSource & {
  artifactId:string;
  version:string;
  referenceUrls:string[];
};

export function provenanceForBinding(binding?:ObservationSourceBinding):ObservationArtifactSource|undefined {
  if(!binding)return;
  const {dataUrl,catalogUrl,versionLabel}=binding;
  return {dataUrl,catalogUrl,versionLabel};
}

export function observationSourceUrl(value:unknown):string|undefined {
  if(typeof value!=="string"||value.length>2000||value.trim()!==value)return;
  try{
    const url=new URL(value);
    if(url.protocol!=="https:"||url.username||url.password)return;
    url.hash="";
    return url.href;
  }catch{return;}
}

function object(value:unknown):value is Record<string,unknown>{
  return !!value&&typeof value==="object"&&!Array.isArray(value);
}

export function validObservationArtifactSource(value:unknown):value is ObservationArtifactSource {
  return object(value)&&Object.keys(value).length===3&&
    !!observationSourceUrl(value.dataUrl)&&!!observationSourceUrl(value.catalogUrl)&&
    typeof value.versionLabel==="string"&&value.versionLabel.length>0&&value.versionLabel.length<=160&&
    value.versionLabel.trim()===value.versionLabel&&!/[\x00-\x1f\x7f]/.test(value.versionLabel);
}

export function validObservationSourceBinding(value:unknown):value is ObservationSourceBinding {
  if(!object(value)||Object.keys(value).length!==6)return false;
  const {artifactId,version,referenceUrls,...source}=value;
  if(!observationMaterialId(artifactId)||!observationMaterialId(version)||!validObservationArtifactSource(source)||
    !Array.isArray(referenceUrls)||referenceUrls.length<1||referenceUrls.length>12)return false;
  const normalized=referenceUrls.map(observationSourceUrl);
  return normalized.every(Boolean)&&new Set(normalized).size===normalized.length;
}
