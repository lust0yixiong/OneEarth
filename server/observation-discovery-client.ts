import {skillRequestKind,skillResultKind,parseObservationRequest,validObservationResult,observationResultMatchesRequest,
  type ObservationCheck,type ObservationRequest,type ObservationCheckResult,type SkillDemand,type SkillResultSubmission} from "./observation-check-contract";
import {observationResearchKind,parseObservationResearchRequest,parseObservationResearchResult,type ObservationResearchRequest,type ObservationResearchResult} from "./observation-research-contract";
import {isDeepStrictEqual} from "node:util";
import {lookupDiscoveryDelegation,type DiscoverySubmissionIdentity} from "./discovery-delegation-recovery";

export type ObservationBinding={taskId:string;contextId:string};
export type ObservationTask=ObservationBinding&{state:string;events:{seq:number;artifactId:string;skillDemand?:SkillDemand;result?:ObservationCheckResult;researchResult?:ObservationResearchResult}[]};
const states=new Set(["SUBMITTED","WORKING","COMPLETED","FAILED","CANCELED","INPUT_REQUIRED","REJECTED","AUTH_REQUIRED"].map(s=>"TASK_STATE_"+s));
export const observationTerminal=(state:string)=>["TASK_STATE_COMPLETED","TASK_STATE_FAILED","TASK_STATE_CANCELED","TASK_STATE_REJECTED"].includes(state);
const object=(v:unknown):v is Record<string,any>=>!!v&&typeof v==="object"&&!Array.isArray(v);
const id=(v:unknown):v is string=>typeof v==="string"&&!!v.trim()&&v.length<=1200;
export class ObservationProtocolError extends Error {}

/** Short, authenticated handshakes only. Waiting lives in the task checkpoint. */
export function observationDiscoveryClient(options:{base?:string;token?:string;recoveryToken?:string;fetch?:typeof fetch;timeoutMs?:number}={}){
  const base=options.base??process.env.ONEEARTH_DISCOVERY_URL??"http://127.0.0.1:5275";
  const token=options.token??process.env.ONEEARTH_SKILL_SERVICE_TOKEN;
  const transport=options.fetch??fetch;
  async function request(path:string,method:string,body:unknown,signal:AbortSignal){
    if(!token||token.length<32)throw new ObservationProtocolError("Skill 服务授权未配置。");
    const response=await transport(new URL(path,base),{method,headers:{"A2A-Version":"1.0","Content-Type":"application/a2a+json",Accept:"application/a2a+json",Authorization:"Bearer "+token},
      ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.any([signal,AbortSignal.timeout(options.timeoutMs??2000)]),redirect:"error"});
    if(!response.ok){
      if(response.status>=500||response.status===429)throw Error("Skill 发现接口暂时不可用。");
      throw new ObservationProtocolError("Skill 发现接口未完成请求（HTTP "+response.status+"）。");
    }
    const value:unknown=await response.json();return value;
  }
  function task(value:unknown,expected?:ObservationBinding):ObservationTask{
    if(!object(value)||!id(value.id)||!id(value.contextId)||!object(value.status)||!states.has(value.status.state)||
      (expected&&(value.id!==expected.taskId||value.contextId!==expected.contextId))||
      value.artifacts!==undefined&&!Array.isArray(value.artifacts))throw new ObservationProtocolError("Skill 发现任务归属或快照无效。");
    const events:ObservationTask["events"]=[],seen=new Map<number,string>();
    for(const artifact of value.artifacts||[]){
      if(!object(artifact)||!id(artifact.artifactId)||!Array.isArray(artifact.parts))throw new ObservationProtocolError("Skill 发现产物身份无效。");
      for(const part of artifact.parts){
        if(part?.data?.kind!=="oneearth.discovery.event.v1")continue;
        const event=part.data.event;
        if(!object(event)||!Number.isSafeInteger(event.seq)||event.seq<0)throw new ObservationProtocolError("Skill 发现事件水位无效。");
        const fingerprint=JSON.stringify([artifact.artifactId,event]);
        if(seen.has(event.seq)){if(seen.get(event.seq)!==fingerprint)throw new ObservationProtocolError("Skill 发现事件发生冲突。");continue;}
        seen.set(event.seq,fingerprint);
        let demand:SkillDemand|undefined,result:ObservationCheckResult|undefined,researchResult:ObservationResearchResult|undefined;
        if(event.skillDemand!==undefined){
          const d=event.skillDemand,check=parseObservationRequest(d?.check);
          if(!object(d)||!id(d.requestId)||!id(d.researchTaskId)||!check)throw new ObservationProtocolError("Skill 机器需求无效。");
          demand={requestId:d.requestId,researchTaskId:d.researchTaskId,check};
        }
        if(event.result?.observationCheckResult!==undefined){
          if(!validObservationResult(event.result.observationCheckResult))throw new ObservationProtocolError("Skill 发现结果无效。");
          result=event.result.observationCheckResult;
        }
        if(event.result?.observationResearchResult!==undefined){
          researchResult=parseObservationResearchResult(event.result.observationResearchResult);
          if(!researchResult||result)throw new ObservationProtocolError("自然观测研究结果种类或结构无效。");
        }
        events.push({seq:event.seq,artifactId:artifact.artifactId,...(demand?{skillDemand:demand}:{}),...(result?{result}:{}),...(researchResult?{researchResult}:{})});
      }
    }
    return {taskId:value.id,contextId:value.contextId,state:value.status.state,events:events.sort((a,b)=>a.seq-b.seq)};
  }
  async function lookup(identity:DiscoverySubmissionIdentity,signal:AbortSignal){
    return lookupDiscoveryDelegation(base,identity,signal,{token:options.recoveryToken,fetcher:transport,timeoutMs:options.timeoutMs});
  }
  async function readAccepted(taskId:string,signal:AbortSignal,expected?:ObservationBinding){
    const recovered=task(await request("/tasks/"+encodeURIComponent(taskId),"GET",undefined,signal),expected);
    if(recovered.taskId!==taskId)throw new ObservationProtocolError("Skill 恢复任务身份与原受理不符。");
    return recovered;
  }
  async function readAcceptance(identity:DiscoverySubmissionIdentity,signal:AbortSignal){
    const input=identity.kind===observationResearchKind?parseObservationResearchRequest(identity.input):identity.input;
    if(!input)return;
    const receipt=await lookup({...identity,input},signal);
    return receipt.state==="accepted"?readAccepted(receipt.taskId,signal):undefined;
  }
  async function send(identity:DiscoverySubmissionIdentity,signal:AbortSignal,recover:boolean,expected?:ObservationBinding){
    if(recover){
      const receipt=await lookup(identity,signal);
      if(receipt.state==="unknown")throw Error("Skill 原委托受理暂无法确认。");
      if(receipt.state==="accepted")return readAccepted(receipt.taskId,signal,expected);
    }
    const {taskId,messageId,kind,input}=identity;
    const receipt=await request("/message:send","POST",{message:{messageId,role:"ROLE_USER",parts:[{data:{kind,input}}],
      ...(taskId&&expected?{taskId,contextId:expected.contextId}:{})},configuration:{returnImmediately:true}},signal);
    if(!object(receipt)||!receipt.task||receipt.message||receipt.error)throw new ObservationProtocolError("Skill 发现受理回执无效。");
    return task(receipt.task,expected);
  }
  const client = {
    async submitResearch(messageId:string,input:ObservationResearchRequest,signal:AbortSignal,recover=false){
      const clean=parseObservationResearchRequest(input);if(!clean)throw new ObservationProtocolError("自然观测委托缺少受权资料范围。");
      return send({messageId,kind:observationResearchKind,input:clean},signal,recover);
    },
    async submit(messageId:string,researchTaskId:string,check:ObservationCheck,signal:AbortSignal,recover=false){
      return send({messageId,kind:skillRequestKind,input:{researchTaskId,check}},signal,recover);
    },
    async snapshot(binding:ObservationBinding,signal:AbortSignal){return task(await request("/tasks/"+encodeURIComponent(binding.taskId),"GET",undefined,signal),binding);},
    async deliver(binding:ObservationBinding,messageId:string,input:SkillResultSubmission,signal:AbortSignal,recover=false){
      return send({messageId,taskId:binding.taskId,kind:skillResultKind,input},signal,recover,binding);
    },
    async cancel(binding:ObservationBinding,signal:AbortSignal){
      const before=await this.snapshot(binding,signal);
      if(observationTerminal(before.state))return before.state;
      const cancelled=task(await request("/tasks/"+encodeURIComponent(binding.taskId)+":cancel","POST",{},signal),binding);
      if(!observationTerminal(cancelled.state))throw new ObservationProtocolError("Skill 取消尚未确认。");
      return cancelled.state;
    },
  };
  return {...client,readAcceptance} as typeof client & {readAcceptance?:typeof readAcceptance};
}

export function validateObservationEvents(task:ObservationTask,researchTaskId:string,check:ObservationRequest){
  for(const event of task.events){
    if(event.skillDemand&&(event.skillDemand.researchTaskId!==researchTaskId||!isDeepStrictEqual(event.skillDemand.check,check)))
      throw new ObservationProtocolError("Skill 机器需求不属于本研究和已授权条件。");
    if(event.result&&!observationResultMatchesRequest(event.result,check))throw new ObservationProtocolError("Skill 结果不属于已授权条件。");
  }
}
