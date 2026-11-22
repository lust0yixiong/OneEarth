import {isDeepStrictEqual} from "node:util";
import {TaskParked,type TaskStore,type Payload,type Task} from "./task-store";
import {observationModelMaterials,type PinnedObservationMaterial} from "./observation-artifacts";
import {observationKey,type ObservationAuthority} from "./runtime-observation-authority";
import {observationResponse,observationRetainedRecords,type RuntimeObservationEngine} from "./runtime-observation";
import {parseObservationRequest,observationResultMatchesRequest,validObservationResult,observationSha256,
  type ObservationRequest,type ObservationEvidence,type ObservationCheckResult} from "./observation-check-contract";
import {modelObservationEvidence,type ObservationResearchResult} from "./observation-research-contract";
import {observationDiscoveryClient,observationTerminal,ObservationProtocolError,type ObservationTask,type ObservationBinding} from "./observation-discovery-client";
import {provenanceForBinding} from "../src/domain/observation-source";

type Step=Payload&{kind:"observation-research-step.v1";phase:"submit"|"discovery"|"engine"|"deliver"|"general";
  ordinaryFallback?:boolean;hasAttachments?:boolean;observationParent?:boolean;
  materials:PinnedObservationMaterial[];history:ObservationEvidence[];initialMessageId:string;replyMessageId:string;attempts:number;
  binding?:ObservationBinding;requestId?:string;afterSeq?:number;check?:ObservationRequest;expectedSha256?:string;result?:ObservationCheckResult;
  completedResult?:Payload;cancelledResult?:Payload;failedResult?:Payload;cancellation?:{binding?:ObservationBinding;reconciled?:boolean;retryAt?:number}};
/** Trusted worker marker; never supplied by the browser or provider. */
export class ObservationGeneral {constructor(readonly unavailable=false,readonly observationParent=false){}}
export async function recoverObservationResearchRecord(tasks:TaskStore,task:Task){
  if(task.status!=="cancelled"&&task.status!=="failed")return;
  const state=await tasks.step?.(task.id);if(state?.kind!=="observation-research-step.v1")return;
  return task.status==="cancelled"?state.cancelledResult:state.failedResult;
}

/** Qualification and file identities are frozen at API acceptance. The provider
 * selects the action; the runtime validates it and parks between handshakes. */
export function runtimeObservationResearch(options:{tasks:TaskStore;engine?:RuntimeObservationEngine;client?:ReturnType<typeof observationDiscoveryClient>;authority?:ObservationAuthority;pollMs?:number;now?:()=>number}){
  const {tasks,engine}=options,client=options.client??observationDiscoveryClient(),authority=options.authority??observationModelMaterials,
    now=options.now??Date.now,pollMs=options.pollMs??500;
  const elapsed=(created:number)=>Math.max(0,now()-created);
  function requireStore(){if(!tasks.step||!tasks.saveStep||!tasks.park||!tasks.cancelStep||!tasks.cancelledSteps)throw Error("运行时未配置持久步骤存储。");}
  async function park(id:string,state:Step,event?:Payload,delay=pollMs){await tasks.park!(id,state,now()+delay,event);return new TaskParked();}
  async function authorized(state:Step){
    const current=await authority();
    return state.materials.length>0&&state.materials.every(m=>observationSha256(m.sha256)&&current.some(c=>
      observationKey(c)===observationKey(m)&&c.sha256===m.sha256&&m.variables.every(v=>c.variables.includes(v))&&
      isDeepStrictEqual(provenanceForBinding(c.sourceBinding),provenanceForBinding(m.sourceBinding))));
  }
  function grant(state:Step,check:ObservationRequest){
    const material=state.materials.find(m=>observationKey(m)===observationKey(check));
    if(!material||!material.variables.includes(check.variable)||!observationSha256(material.sha256))throw new ObservationProtocolError("发现需求超出受理时固定的资料或变量授权。");
    return material;
  }
  function validate(snapshot:ObservationTask,id:string,state:Step){
    for(const event of snapshot.events){
      if(event.result)throw new ObservationProtocolError("自然委托收到不相符的显式核对结果。");
      if(event.skillDemand){
        if(event.skillDemand.researchTaskId!==id)throw new ObservationProtocolError("发现需求不属于本研究。");
        grant(state,event.skillDemand.check);
        if(state.requestId&&(event.skillDemand.requestId!==state.requestId||event.seq!==state.afterSeq||!isDeepStrictEqual(event.skillDemand.check,state.check)))
          throw new ObservationProtocolError("原发现的执行身份、水位或条件已变化。");
      }
    }
  }
  function noEvidence(result:Exclude<ObservationResearchResult,{action:"answer"}>,created:number){
    const message=result.action==="clarify"?result.message:result.action==="unavailable"?"本轮没有取得可用于回答的观测读据（"+result.reason+"）。":"本题转回普通研究路径。";
    return {message,...(result.action==="clarify"?{clarification:true}:{}),observationResearchResult:result,
      answerNotes:{references:[],sources:[],researchNotes:[],searches:[],webSources:[],limitation:"本轮未采用新的观测文件读据。",followUp:"",reviewed:0,elapsedMs:elapsed(created),executor:"运行时受权执行器"}};
  }
  async function adopt(id:string,state:Step,snapshot:ObservationTask,created:number):Promise<Payload|TaskParked>{
    validate(snapshot,id,state);
    const final=snapshot.events.filter(e=>e.researchResult).at(-1)?.researchResult;
    if(final){
      if(snapshot.state!=="TASK_STATE_COMPLETED"){
        if(observationTerminal(snapshot.state))throw new ObservationProtocolError("原发现没有完成自然观测委托。");
        return park(id,{...state,phase:"discovery",attempts:0});
      }
      if(final.action==="general")return park(id,{...state,phase:"general",attempts:0},{observationResearchDecision:{action:"general"},workerReleased:true},0);
      let completedResult:Payload;
      if(final.action!=="answer")completedResult=noEvidence(final,created);
      else{
        if(!await authorized(state))throw new ObservationProtocolError("观测资料当前不再获准供模型使用，不能采用本轮结果。");
        let check:ObservationRequest,result:ObservationCheckResult;
        if(final.basedOn==="read"){
          if(!state.check||state.result?.status!=="verified"||state.result.evidence.sha256!==state.expectedSha256||
            !observationResultMatchesRequest(state.result,state.check)||!isDeepStrictEqual(modelObservationEvidence(state.result.evidence),final.evidence)||
            (final.matches!==undefined&&final.matches!==state.result.matches))throw new ObservationProtocolError("发现答复没有对应本研究实际取得的读据或核对条件。");
          check=state.check;result=state.result;
        }else{
          const evidence=state.history.find(e=>isDeepStrictEqual(modelObservationEvidence(e),final.evidence)&&grant(state,{skill:"oneearth.observation-check@1",artifactId:e.artifactId,version:e.version,variable:e.variable,purpose:"describe"}).sha256===e.sha256);
          if(!evidence)throw new ObservationProtocolError("发现答复没有同会话已授权的历史读据。");
          // Archive facts do not establish newly selected comparison conditions.
          check={skill:"oneearth.observation-check@1",artifactId:evidence.artifactId,version:evidence.version,variable:evidence.variable,purpose:"describe"};
          result={status:"verified",evidence};
        }
        const safeFinal=final.basedOn==="archive"?{action:"answer",basedOn:"archive",evidence:final.evidence}:final;
        completedResult={...observationResponse(result,check,elapsed(created),final.basedOn==="archive"?"archive":"read").result,observationResearchResult:safeFinal};
      }
      completedResult=state.completedResult??completedResult;
      if(!await tasks.saveStep!(id,{...state,completedResult},{observationResearchDecision:{action:final.action},observationDiscovery:{taskId:snapshot.taskId,state:snapshot.state}}))return new TaskParked();
      return {result:completedResult};
    }
    if(observationTerminal(snapshot.state))throw new ObservationProtocolError("自然观测委托已终止但未交付结果。");
    const demand=snapshot.events.filter(e=>e.skillDemand).at(-1);
    if(demand?.skillDemand){
      if(state.result)return park(id,{...state,phase:"discovery",attempts:0});
      const check=demand.skillDemand.check,material=grant(state,check);
      return park(id,{...state,phase:"engine",requestId:demand.skillDemand.requestId,afterSeq:demand.seq,check,expectedSha256:material.sha256,attempts:0},
        {stage:"发现服务已选择读取已授权的观测资料，研究步骤已让出。",observationWaiting:{kind:"skill",requestId:demand.skillDemand.requestId,afterSeq:demand.seq},workerReleased:true},0);
    }
    return park(id,{...state,phase:"discovery",attempts:0});
  }
  return {
    async run(task:{id:string;body:any;checkpoint?:Payload},signal:AbortSignal):Promise<Payload|TaskParked|ObservationGeneral>{
      requireStore();const state=task.checkpoint as Step|undefined,root=await tasks.get(task.id);
      if(root?.status!=="running")return new TaskParked();
      if(state?.kind!=="observation-research-step.v1"||!Array.isArray(state.materials)||!Array.isArray(state.history))return {error:"自然观测委托缺少已保存的授权范围。",code:"OBSERVATION_RESEARCH_CHECKPOINT_INVALID"};
      if(state.completedResult)return {result:state.completedResult};
      if(state.phase==="general"&&state.ordinaryFallback)return new ObservationGeneral(true);
      try{
        signal.throwIfAborted();
        if(!await authorized(state)){
          if(state.requestId&&engine)await engine.cancel(state.requestId);
          if(state.binding)await client.cancel(state.binding,signal);
          if(state.hasAttachments===false)return park(task.id,{...state,phase:"general",ordinaryFallback:true},
            {observationResearchDecision:{action:"general",materialsUnavailable:true},workerReleased:true},0);
          return {result:noEvidence({action:"unavailable",reason:"material_authorization_changed"},root.created)};
        }
        if(state.phase==="general")return new ObservationGeneral(false,state.observationParent);
        if(state.phase==="submit"){
          if((await tasks.get(task.id))?.status!=="running")return new TaskParked();
          const question=task.body.questionDecision?.dataQuestion??task.body.query;
          const accepted=await client.submitResearch(state.initialMessageId,{researchTaskId:task.id,question,
            materials:state.materials.map(({artifactId,version,title,variables})=>({artifactId,version,title,variables})),evidence:state.history.map(modelObservationEvidence)},signal);
          validate(accepted,task.id,state);
          const next:Step={...state,phase:"discovery",binding:{taskId:accepted.taskId,contextId:accepted.contextId},attempts:0};
          if(!await tasks.saveStep!(task.id,next,{observationDiscovery:{messageId:state.initialMessageId,taskId:accepted.taskId,state:accepted.state}})){
            await tasks.cancelStep!(task.id,{binding:next.binding});return new TaskParked();
          }
          return await adopt(task.id,next,accepted,root.created);
        }
        if(!state.binding)throw new ObservationProtocolError("自然委托缺少已验证受理身份。");
        if(state.phase==="discovery")return await adopt(task.id,state,await client.snapshot(state.binding,signal),root.created);
        const check=parseObservationRequest(state.check);
        if(!check||!state.requestId||state.afterSeq===undefined||grant(state,check).sha256!==state.expectedSha256)throw new ObservationProtocolError("自然委托缺少受权需求身份、水位或文件摘要。");
        const source=provenanceForBinding(grant(state,check).sourceBinding);
        if(state.phase==="engine"){
          if((await tasks.get(task.id))?.status!=="running")return new TaskParked();
          if(!engine)return park(task.id,{...state,phase:"deliver",result:{status:"not_started",reason:"execution_unconfigured"},attempts:0},undefined,0);
          await engine.submit({researchTaskId:task.id,discoveryTaskId:state.binding.taskId,requestId:state.requestId,check,expectedSha256:state.expectedSha256!,modelAuthorized:true});
          const result=await engine.result(state.requestId);if(!result)return park(task.id,state);
          if(!validObservationResult(result)||!observationResultMatchesRequest(result,check)||(result.status==="verified"&&result.evidence.sha256!==state.expectedSha256))throw new ObservationProtocolError("执行器结果不属于初次受理的观测需求和文件摘要。");
          if(result.status==="verified"&&!isDeepStrictEqual(source,result.evidence.artifactSource))
            throw new ObservationProtocolError("执行器返回的资料来源与初次受理记录不同。");
          // A grant can be revoked while this short query is in flight.
          if(!await authorized(state))return park(task.id,{...state,phase:"deliver",result:{status:"not_started",reason:"artifact_not_authorized"},attempts:0},undefined,0);
          return park(task.id,{...state,phase:"deliver",result,...observationRetainedRecords(result,check,elapsed(root.created)),attempts:0},
            {stage:"实际执行读据已保存，等待原发现任务采纳。",observationCheckResult:result,workerReleased:true},0);
        }
        if(!state.result||!observationResultMatchesRequest(state.result,check))throw new ObservationProtocolError("自然委托回送缺少可验证的执行结果。");
        const before=await client.snapshot(state.binding,signal);validate(before,task.id,state);
        if(before.events.some(e=>e.researchResult))return await adopt(task.id,state,before,root.created);
        const demand=before.events.filter(e=>e.skillDemand).at(-1);
        if(!demand?.skillDemand||demand.skillDemand.requestId!==state.requestId||demand.seq!==state.afterSeq)throw new ObservationProtocolError("原发现已不在该执行等待点。");
        if(!await authorized(state))return park(task.id,state,undefined,0);
        if((await tasks.get(task.id))?.status!=="running")return new TaskParked();
        const delivered=await client.deliver(state.binding,state.replyMessageId,{requestId:state.requestId,afterSeq:state.afterSeq,result:state.result},signal);
        return await adopt(task.id,state,delivered,root.created);
      }catch(error){
        if(signal.aborted)throw error;
        const attempts=state.attempts+1;
        if(error instanceof ObservationProtocolError||attempts>=20)return {error:error instanceof ObservationProtocolError?error.message:"自然观测委托暂时无法接回，已保存受理和实得材料。",code:"OBSERVATION_RESEARCH_HANDSHAKE_FAILED"};
        return park(task.id,{...state,attempts},{stage:"自然观测委托暂未接回，已保存等待点并让出。",workerReleased:true},Math.min(3000,attempts*pollMs));
      }
    },
    async reconcileCancelled(){
      requireStore();const pending=(await tasks.cancelledSteps!()).find(t=>t.checkpoint.kind==="observation-research-step.v1"&&Number((t.checkpoint.cancellation as Step["cancellation"])?.retryAt||0)<=now());if(!pending)return;
      const state=pending.checkpoint as Step;
      try{
        if(state.requestId&&engine)await engine.cancel(state.requestId);
        const binding=state.binding??state.cancellation?.binding;
        const cancellation=binding?await client.cancel(binding,AbortSignal.timeout(2500)):"acceptance_unconfirmed";
        await tasks.cancelStep!(pending.id,{reconciled:true},{observationCancellation:{state:cancellation,requestId:state.requestId,discoveryTaskId:binding?.taskId}});
      }catch{await tasks.cancelStep!(pending.id,{retryAt:now()+2000});}
    },
  };
}
