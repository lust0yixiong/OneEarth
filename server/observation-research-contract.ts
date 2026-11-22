import {validObservationMaterial,type ObservationMaterial} from "../src/domain/observation-material";
import {observationId,validObservationEvidence,type ObservationEvidence} from "./observation-check-contract";

export const observationResearchKind = "oneearth.observation.research.request.v1";
export type ModelObservationEvidence = Omit<ObservationEvidence,"sha256">;
export type ObservationResearchRequest = {
  researchTaskId:string;
  question:string;
  materials:ObservationMaterial[];
  evidence:ModelObservationEvidence[];
};
export type ObservationResearchResult =
  | {action:"answer";basedOn:"read"|"archive";evidence:ModelObservationEvidence;matches?:boolean}
  | {action:"unavailable";reason:string}
  | {action:"clarify";message:string}
  | {action:"general"};

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function object(value:unknown):value is Record<string,unknown> {
  return !!value&&typeof value==="object"&&!Array.isArray(value);
}

function fields(value:Record<string,unknown>, keys:string[]) {
  return Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
}

export function modelObservationEvidence(evidence:ObservationEvidence):ModelObservationEvidence {
  const {sha256:_,...safe}=evidence;
  return safe;
}

export function validModelObservationEvidence(value:unknown):value is ModelObservationEvidence {
  return object(value)&&!Object.hasOwn(value,"sha256")&&validObservationEvidence({...value,sha256:"0".repeat(64)});
}

export function parseObservationResearchRequest(value:unknown):ObservationResearchRequest|undefined {
  if(!object(value)||!fields(value,["researchTaskId","question","materials","evidence"]))return;
  const {researchTaskId,question,materials,evidence}=value;
  if(typeof researchTaskId!=="string"||!uuid.test(researchTaskId)||typeof question!=="string"||!question.trim()||
     question.length>4000||!Array.isArray(materials)||materials.length>10||!materials.length||
     !materials.every(validObservationMaterial)||!Array.isArray(evidence)||evidence.length>20||
     !evidence.every(validModelObservationEvidence))return;
  if(new Set(materials.map(m=>JSON.stringify([m.artifactId,m.version]))).size!==materials.length||
     evidence.some(e=>!materials.some(m=>m.artifactId===e.artifactId&&m.version===e.version&&m.variables.includes(e.variable))))return;
  return {researchTaskId,question,materials,evidence};
}

export function parseObservationResearchResult(value:unknown):ObservationResearchResult|undefined {
  if(!object(value))return;
  if(value.action==="general"&&fields(value,["action"]))return {action:"general"};
  if(value.action==="unavailable"&&fields(value,["action","reason"])&&observationId(value.reason))
    return {action:"unavailable",reason:value.reason};
  if(value.action==="clarify"&&fields(value,["action","message"])&&typeof value.message==="string"&&
     value.message.trim()&&value.message.length<=600)return {action:"clarify",message:value.message};
  if(value.action!=="answer"||(value.basedOn!=="read"&&value.basedOn!=="archive")||!validModelObservationEvidence(value.evidence))return;
  if(fields(value,["action","basedOn","evidence"]))
    return {action:"answer",basedOn:value.basedOn,evidence:value.evidence};
  if(fields(value,["action","basedOn","evidence","matches"])&&typeof value.matches==="boolean")
    return {action:"answer",basedOn:value.basedOn,evidence:value.evidence,matches:value.matches};
}
