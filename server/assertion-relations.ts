import {validResearchPath,type ResearchPath,type AssertionEvidenceLinks} from "../src/domain/assertion-relations";
type Row=Record<string,unknown>;
const obj=(v:unknown):Row=>v&&typeof v==="object"&&!Array.isArray(v)?v as Row:{};
const rows=(v:unknown):Row[]=>Array.isArray(v)?v.map(obj):[];
const text=(v:unknown)=>typeof v==="string"?v:"";
const strings=(v:unknown)=>Array.isArray(v)?v.filter((x):x is string=>typeof x==="string"):[];

export function recipeUsages(recipe:Row,usages:Row[],dsKey:string) {
  const paper=usages.filter(u=>u.paper_id===recipe.paper_id);
  const members=rows(recipe.members).filter(m=>m.ds_key===dsKey);
  const instanceIds=members.map(m=>text(m.dataset_id)).filter(Boolean);
  if(instanceIds.length)return paper.filter(u=>instanceIds.includes(text(u.dataset_id)));
  return paper.length===1&&members.length?paper:[];
}
export function readResearchPath(data:Row,paperId:string,rqId:string,dsKey:string,usages:Row[]):ResearchPath|undefined {
  const r=obj(data.recipe);
  if(r.paper_id!==paperId||r.rq_id!==rqId||
    !rows(r.members).some(m=>m.ds_key===dsKey&&usages.some(u=>u.paper_id===paperId&&u.dataset_id===m.dataset_id)))return;
  const members=rows(r.members).map(m=>({
    dsKey:text(m.ds_key),datasetId:text(m.dataset_id),name:text(m.display_name)||text(m.name),stepIds:strings(m.enters_steps),
  }));
  const steps=rows(r.steps).map(s=>({
    stepId:text(s.step_id),order:s.order,type:text(s.type),name:text(s.name),purpose:text(s.purpose),method:text(s.method),
  }));
  const ids=new Set(steps.map(s=>s.stepId));
  const path={paperId,rqId,paperTitle:text(r.paper_title),question:text(r.task),members,steps,
    complete:r.n_members===members.length&&r.n_steps===steps.length&&members.every(m=>m.stepIds.every(id=>ids.has(id)))};
  return validResearchPath(path)?path:undefined;
}
export function readEvidenceLinks(data:Row,paperId:string,datasetId:string):AssertionEvidenceLinks {
  const blocks=rows(data.evidence);
  return {paperId,datasetId,
    claims:rows(data.claims).map(c=>({kind:text(c.kind),ref:text(c.ref),blockIds:strings(c.evidence_blocks)})),
    blocks:blocks.map(b=>({blockId:text(b.block_id),supports:rows(b.supports).map(c=>({kind:text(c.kind),ref:text(c.ref)}))})),
    totalBlocks:typeof obj(data.pagination).total_hits==="number"?obj(data.pagination).total_hits as number:blocks.length,
    hasMore:obj(data.pagination).has_more===true,
  };
}
