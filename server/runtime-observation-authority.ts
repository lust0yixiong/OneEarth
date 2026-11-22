import {randomUUID} from "node:crypto";
import {Router} from "express";
import {validateTurnStructure} from "./runtime-input";
import {taskIdPattern,type TaskStore,type Payload} from "./task-store";
import {observationModelMaterials,type PinnedObservationMaterial} from "./observation-artifacts";
import {validObservationEvidence,observationSha256,type ObservationEvidence} from "./observation-check-contract";
import type {ObservationAttachment} from "../src/domain/observation-material";

export type ObservationAuthority=()=>Promise<PinnedObservationMaterial[]>;
export function observationAttachments(input:unknown):ObservationAttachment[]{
  const items=(input as {context?:{attachedScope?:unknown}})?.context?.attachedScope;
  return Array.isArray(items)?items.filter(item=>item&&typeof item==="object"&&item.kind==="observation"):[];
}
export async function hasObservationResearch(tasks:TaskStore,input:unknown){
  if(!input||typeof input!=="object"||(input as {observationCheck?:unknown}).observationCheck!==undefined)return false;
  return observationAttachments(input).length>0||(await trustedObservationHistory(tasks,input)).length>0;
}
export const observationKey=(value:{artifactId:string;version:string})=>JSON.stringify([value.artifactId,value.version]);

/** Read only persisted server records belonging to the explicitly bound conversation. */
export async function trustedObservationHistory(tasks:TaskStore,input:unknown):Promise<ObservationEvidence[]>{
  const body=input as {conversationId:string;previousTaskId?:string};
  if(!body.previousTaskId||!taskIdPattern.test(body.previousTaskId))return [];
  const parent=await tasks.get(body.previousTaskId);
  if(!parent||JSON.parse(parent.body).conversationId!==body.conversationId)return [];
  const result=(await tasks.terminal(parent.id))?.result as {observationCheckResult?:{status?:string;evidence?:unknown};answerNotes?:{references?:{evidenceLevel?:string;observationEvidence?:unknown}[]}}|undefined;
  const refs=result?.answerNotes?.references;
  const candidates=[...(result?.observationCheckResult?.status==="verified"?[result.observationCheckResult.evidence]:[]),
    ...(Array.isArray(refs)?refs.filter(ref=>ref?.evidenceLevel==="observation-file").map(ref=>ref.observationEvidence):[])];
  return candidates.filter(validObservationEvidence).slice(0,20);
}
export async function observationHistory(tasks:TaskStore,input:unknown,materials:PinnedObservationMaterial[]):Promise<ObservationEvidence[]>{
  return filterObservationHistory(await trustedObservationHistory(tasks,input),materials);
}
function filterObservationHistory(candidates:ObservationEvidence[],materials:PinnedObservationMaterial[]){
  const seen=new Set<string>();
  return candidates.filter((value):value is ObservationEvidence=>{
    if(!validObservationEvidence(value))return false;
    const grant=materials.find(m=>observationKey(m)===observationKey(value));
    const key=JSON.stringify([value.artifactId,value.version,value.variable,value.sha256]);
    if(!grant||grant.sha256!==value.sha256||!grant.variables.includes(value.variable)||seen.has(key))return false;
    seen.add(key);return true;
  }).slice(0,20);
}

export async function prepareObservationResearch(tasks:TaskStore,_id:string,input:unknown,authority:ObservationAuthority=observationModelMaterials){
  const issue=await validateTurnStructure(tasks,input);if(issue)return {error:issue};
  if((input as {expectedSha256?:unknown}).expectedSha256!==undefined)return {error:"观测文件授权摘要不能由客户端指定。"};
  const refs=observationAttachments(input);
  if(refs.length>10||new Set(refs.map(observationKey)).size!==refs.length)return {error:"请附上最多十份不同的观测资料版本。"};
  const ordinaryFallback=()=>({checkpoint:{kind:"observation-research-step.v1",phase:"general",ordinaryFallback:true,hasAttachments:false,
    materials:[],history:[],initialMessageId:randomUUID(),replyMessageId:randomUUID(),attempts:0} as Payload});
  try{
    const allowed=await authority(),materials:PinnedObservationMaterial[]=[],priorEvidence=await trustedObservationHistory(tasks,input);
    if(!refs.length){
      const prior=filterObservationHistory(priorEvidence,allowed),keys=new Set(prior.map(observationKey));
      materials.push(...allowed.filter(m=>keys.has(observationKey(m))).slice(0,10));
      if(!materials.length)return ordinaryFallback();
    }
    for(const ref of refs){
      const grant=allowed.find(m=>observationKey(m)===observationKey(ref));
      if(!grant||!observationSha256(grant.sha256))return {error:"所附观测资料目前未获准提供给发现模型。"};
      materials.push(structuredClone(grant));
    }
    const history=filterObservationHistory(priorEvidence,materials);
    const checkpoint:Payload={kind:"observation-research-step.v1",phase:"submit",materials,history,hasAttachments:refs.length>0,observationParent:priorEvidence.length>0,
      initialMessageId:randomUUID(),replyMessageId:randomUUID(),attempts:0};
    return {checkpoint};
  }catch{return refs.length?{error:"观测资料授权暂时无法确认。"}:ordinaryFallback();}
}

/** Browser history is an untrusted prose mirror and cannot be selectively
 * redacted by matching words. Drop it at this transition, together with the
 * server parent binding and untyped citation excerpt. Keep the current query. */
export function observationOrdinaryInput(body:any,unavailable:boolean,observationParent=false){
  const mirrored=body.history?.some((turn:any)=>turn.conversationReferences?.some((ref:any)=>ref.evidenceLevel==="observation-file"||ref.observationEvidence||ref.id?.startsWith("observation:")));
  const redact=unavailable||observationParent||mirrored;
  const attachedScope=body.context.attachedScope?.filter((scope:any)=>scope.kind!=="observation"&&
    !(scope.kind==="reference"&&(scope.reference?.evidenceLevel==="observation-file"||scope.reference?.observationEvidence||scope.reference?.id?.startsWith("observation:"))));
  if(!redact)return {...body,context:{...body.context,attachedScope}};
  return {...body,previousTaskId:undefined,clarificationReply:undefined,
    history:unavailable?[{role:"assistant" as const,text:"此前观测资料现在不可用。没有可供本轮使用的该文件事实或引用；需要该材料时请据实说明限制。"}]:[],
    context:{...body.context,citation:null,attachedScope,candidateIds:body.context.candidateIds?.filter((id:string)=>!id.startsWith("observation:"))}};
}

export function observationMaterialsRoutes(authority:ObservationAuthority=observationModelMaterials){
  const router=Router();
  router.get("/api/observation-materials",async(_req,res)=>{
    try{
      const entries=await authority();
      const materials=entries.map(({artifactId,version,title,variables})=>({artifactId,version,title,variables}));
      const sourceBindings=entries.flatMap(entry=>entry.sourceBinding?[entry.sourceBinding]:[]);
      res.set("Cache-Control","no-store").json({materials,...(sourceBindings.length?{sourceBindings}:{})});
    }
    catch{res.status(503).set("Cache-Control","no-store").json({error:"可供对话使用的观测资料暂时无法读取。"});}
  });return router;
}
