export interface ObservationMaterial {
  artifactId: string;
  version: string;
  title: string;
  variables: string[];
}

export type ObservationAttachment = {kind:"observation"} & Pick<ObservationMaterial,"artifactId"|"version"|"title">;

export function observationMaterialId(value:unknown):value is string {
  return typeof value==="string" && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,79}$/.test(value);
}

function title(value:unknown):value is string {
  return typeof value==="string" && value.length>0 && value.length<=200 && value.trim()===value &&
    !/[\x00-\x1f\x7f]/.test(value);
}

export function validObservationMaterial(value:unknown):value is ObservationMaterial {
  if(!value||typeof value!=="object"||Array.isArray(value))return false;
  const material=value as Record<string,unknown>;
  return Object.keys(material).length===4 && observationMaterialId(material.artifactId) &&
    observationMaterialId(material.version) && title(material.title) && Array.isArray(material.variables) &&
    material.variables.length>0 && material.variables.length<=50 && material.variables.every(observationMaterialId) &&
    new Set(material.variables).size===material.variables.length;
}

export function validObservationAttachment(value:unknown):value is ObservationAttachment {
  if(!value||typeof value!=="object"||Array.isArray(value))return false;
  const item=value as Record<string,unknown>;
  return Object.keys(item).length===4 && item.kind==="observation" &&
    observationMaterialId(item.artifactId) && observationMaterialId(item.version) && title(item.title);
}
