export interface ResearchPath {
  paperId:string;
  rqId:string;
  paperTitle:string;
  question:string;
  members:{dsKey:string;datasetId:string;name:string;stepIds:string[]}[];
  steps:{stepId:string;order:number;type:string;name:string;purpose:string;method:string}[];
  complete:boolean;
}
export interface AssertionEvidenceLinks {
  paperId:string;
  datasetId:string;
  claims:{kind:string;ref:string;blockIds:string[]}[];
  blocks:{blockId:string;supports:{kind:string;ref:string}[]}[];
  totalBlocks:number;
  hasMore:boolean;
}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==="object"&&!Array.isArray(v);
const strings=(v:unknown):v is string[]=>Array.isArray(v)&&v.every(x=>typeof x==="string");
export function validResearchPath(v:unknown):v is ResearchPath {
  if(!object(v)||![v.paperId,v.rqId,v.paperTitle,v.question].every(x=>typeof x==="string")||typeof v.complete!=="boolean")return false;
  return Array.isArray(v.members)&&v.members.every(m=>object(m)&&[m.dsKey,m.datasetId,m.name].every(x=>typeof x==="string")&&strings(m.stepIds))&&
    Array.isArray(v.steps)&&v.steps.every(s=>object(s)&&[s.stepId,s.type,s.name,s.purpose,s.method].every(x=>typeof x==="string")&&Number.isInteger(s.order));
}
export function validAssertionEvidenceLinks(v:unknown):v is AssertionEvidenceLinks {
  return object(v)&&typeof v.paperId==="string"&&typeof v.datasetId==="string"&&Number.isInteger(v.totalBlocks)&&typeof v.hasMore==="boolean"&&
    Array.isArray(v.claims)&&v.claims.every(c=>object(c)&&typeof c.kind==="string"&&typeof c.ref==="string"&&strings(c.blockIds))&&
    Array.isArray(v.blocks)&&v.blocks.every(b=>object(b)&&typeof b.blockId==="string"&&Array.isArray(b.supports)&&b.supports.every(c=>object(c)&&typeof c.kind==="string"&&typeof c.ref==="string"));
}
