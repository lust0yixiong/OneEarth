import {randomUUID,createHash} from "node:crypto";
import {isDeepStrictEqual} from "node:util";
import {TaskParked,type TaskStore,type Payload,type Task} from "./task-store";
import {parseObservationCheck,validObservationResult,observationResultMatchesRequest,
  type ObservationCheck,type ObservationCheckResult,type SkillExecutionRequest} from "./observation-check-contract";
import {observationDiscoveryClient,observationTerminal,validateObservationEvents,ObservationProtocolError,
  type ObservationBinding,type ObservationTask} from "./observation-discovery-client";

export interface RuntimeObservationEngine {
  submit(request:SkillExecutionRequest):Promise<unknown>;
  result(requestId:string):Promise<ObservationCheckResult|undefined>;
  cancel(requestId:string):Promise<unknown>;
}
type Step=Payload&{kind:"observation-check-step.v1";phase:"submit"|"discovery"|"engine"|"deliver";
  initialMessageId:string;replyMessageId:string;binding?:ObservationBinding;requestId?:string;afterSeq?:number;
  result?:ObservationCheckResult;attempts:number;cancelledResult?:Payload;failedResult?:Payload;
  cancellation?:{binding?:ObservationBinding;reconciled?:boolean;retryAt?:number}};

/** This state is stored in the same transaction as the initial task submission. */
export function initialObservationCheckpoint(_id:string,input:unknown):Step|undefined{
  const check=parseObservationCheck((input as {observationCheck?:unknown})?.observationCheck);
  return check?{kind:"observation-check-step.v1",phase:"submit",initialMessageId:randomUUID(),replyMessageId:randomUUID(),attempts:0}:undefined;
}

function response(result:ObservationCheckResult,check:ObservationCheck){
  let message:string;
  const references=result.status==="verified"?[{
    kind:"asset" as const,id:"observation:"+createHash("sha256").update(JSON.stringify([result.evidence.artifactId,result.evidence.version,result.evidence.variable,result.evidence.sha256])).digest("hex"),
    title:result.evidence.artifactId+" · "+result.evidence.version+" · "+result.evidence.variable,source:"已授权观测文件",sourceChannel:"local" as const,referenceType:"data" as const,
    evidenceLevel:"observation-file" as const,observationEvidence:result.evidence,
  }]:[];
  if(result.status==="verified"){
    const e=result.evidence;
    message="已核对「"+e.artifactId+"」的指定版本「"+e.version+"」。变量「"+e.variable+"」的单位为「"+e.unit+"」，"+
      (e.count?"非空记录共 "+e.count+" 条，起止日期为 "+e.first+" 至 "+e.last+"。":"没有非空记录。")+
      (result.matches?"符合本次指定的单位和记录起止边界要求。":"不满足本次指定的单位「"+check.unit+"」及记录起止边界 "+check.start+" 至 "+check.end+" 的要求。");
    message+="〔1〕";
  }else message=({not_started:"指定观测核对尚未启动。",failed:"指定观测核对未能完成。",cancelled:"指定观测核对已取消。",unknown:"指定观测核对的结果暂时无法确认。"})[result.status];
  return {result:{message,observationCheckResult:result,observationCheck:check,
    answerNotes:{references,sources:references.map(ref=>({id:ref.id,reason:"实际取得的指定版本观测文件读据"})),researchNotes:[],searches:[],webSources:[],
      limitation:result.status==="verified"?"本次只核对单位和非空记录起止边界，不代表时段内连续有效或逐小时齐全。":"本轮尚无可核对的观测文件读据。",
      followUp:"",reviewed:references.length,elapsedMs:0,executor:"运行时受权执行器"}}};
}

function retainedRecords(result:ObservationCheckResult,check:ObservationCheck){
  if(result.status!=="verified")return {};
  const saved=response(result,check).result;
  const notice="以下保留此前实际取得的执行材料，不代表原发现委托已完成。\n\n"+saved.message;
  return {cancelledResult:{...saved,message:"研究已取消。"+notice,observationDelivery:"retained-after-interruption"},
    failedResult:{...saved,message:"研究推进已中断。"+notice,observationDelivery:"retained-after-interruption"}};
}

export async function recoverObservationRecord(tasks:TaskStore,task:Task){
  if(task.status!=="cancelled"&&task.status!=="failed")return;
  const state=await tasks.step?.(task.id);
  if(state?.kind!=="observation-check-step.v1")return;
  return task.status==="cancelled"?state.cancelledResult:state.failedResult;
}

/** One invocation performs at most a short handshake or a non-waiting engine
 * query. The regular worker then releases its slot until the next durable step. */
export function runtimeObservation(options:{tasks:TaskStore;engine?:RuntimeObservationEngine;client?:ReturnType<typeof observationDiscoveryClient>;pollMs?:number;now?:()=>number}){
  const {tasks,engine}=options,client=options.client??observationDiscoveryClient(),now=options.now??Date.now,pollMs=options.pollMs??500;
  function requireStore(){if(!tasks.step||!tasks.saveStep||!tasks.park||!tasks.cancelStep||!tasks.cancelledSteps)throw Error("运行时未配置持久步骤存储。");}
  async function park(id:string,state:Step,event?:Payload,delay=pollMs){
    await tasks.park!(id,state,now()+delay,event);return new TaskParked();
  }
  async function adopt(id:string,check:ObservationCheck,state:Step,snapshot:ObservationTask){
    validateObservationEvents(snapshot,id,check);
    const final=snapshot.events.filter(event=>event.result).at(-1);
    if(final?.result){
      if(final.result.status==="verified"&&!state.result)throw new ObservationProtocolError("发现结果缺少本研究已归档的实际执行回执。");
      if(state.result&&!isDeepStrictEqual(state.result,final.result))throw new ObservationProtocolError("原发现返回的 Skill 结果与已归档执行结果冲突。");
      if(snapshot.state!=="TASK_STATE_COMPLETED"){
        if(observationTerminal(snapshot.state))throw new ObservationProtocolError("Skill 结果未由原发现任务确认完成。");
        return park(id,{...state,phase:"discovery",attempts:0});
      }
      if(!await tasks.saveStep!(id,{...state,result:final.result},{observationCheckResult:final.result,observationDiscovery:{taskId:snapshot.taskId,state:snapshot.state}}))return new TaskParked();
      return response(final.result,check);
    }
    if(observationTerminal(snapshot.state))throw new ObservationProtocolError("Skill 发现已终止但未交付可核对结果。");
    const demand=snapshot.events.filter(event=>event.skillDemand).at(-1);
    if(demand?.skillDemand){
      if(state.requestId&&(state.requestId!==demand.skillDemand.requestId||state.afterSeq!==demand.seq))throw new ObservationProtocolError("Skill 等待身份或水位已变化，不能猜测续行。");
      if(state.result)return park(id,{...state,phase:"discovery",attempts:0});
      const next:Step={...state,phase:"engine",requestId:demand.skillDemand.requestId,afterSeq:demand.seq,attempts:0};
      return park(id,next,{stage:"发现服务已提出观测核对需求，研究步骤已让出。",observationWaiting:{kind:"skill",requestId:next.requestId,afterSeq:next.afterSeq},workerReleased:true},0);
    }
    return park(id,{...state,phase:"discovery",attempts:0});
  }
  return {
    async run(task:{id:string;body:any;checkpoint?:Payload},signal:AbortSignal):Promise<Payload|TaskParked>{
      requireStore();
      const check=parseObservationCheck(task.body.observationCheck),state=task.checkpoint as Step|undefined;
      if(!check||state?.kind!=="observation-check-step.v1")return {error:"观测核对缺少已保存的能力请求或执行身份。",code:"OBSERVATION_CHECKPOINT_INVALID"};
      if(!engine&&state.phase==="submit")return response({status:"not_started",reason:"execution_unconfigured"},check);
      if((await tasks.get(task.id))?.status!=="running")return new TaskParked();
      try{
        signal.throwIfAborted();
        if(state.phase==="submit"){
          const accepted=await client.submit(state.initialMessageId,task.id,check,signal);
          validateObservationEvents(accepted,task.id,check);
          const next:Step={...state,phase:"discovery",binding:{taskId:accepted.taskId,contextId:accepted.contextId},attempts:0};
          if(!await tasks.saveStep!(task.id,next,{observationDiscovery:{messageId:state.initialMessageId,taskId:accepted.taskId,state:accepted.state}})){
            await tasks.cancelStep!(task.id,{binding:next.binding});return new TaskParked();
          }
          return await adopt(task.id,check,next,accepted);
        }
        if(!state.binding)throw new ObservationProtocolError("Skill 委托缺少已验证受理身份。");
        if(state.phase==="discovery")return await adopt(task.id,check,state,await client.snapshot(state.binding,signal));
        if(!state.requestId||state.afterSeq===undefined)throw new ObservationProtocolError("Skill 执行缺少已归档需求身份和水位。");
        if(state.phase==="engine"){
          if(!engine)return park(task.id,{...state,phase:"deliver",result:{status:"not_started",reason:"execution_unconfigured"},attempts:0},
            {stage:"本轮执行能力未配置，已保存未启动结果。",workerReleased:true},0);
          await engine.submit({researchTaskId:task.id,discoveryTaskId:state.binding.taskId,requestId:state.requestId,check});
          const result=await engine.result(state.requestId);
          if(!result)return park(task.id,state);
          if(!validObservationResult(result)||!observationResultMatchesRequest(result,check))throw new ObservationProtocolError("执行器结果不属于本次受权核对。");
          const next:Step={...state,phase:"deliver",result,...retainedRecords(result,check),attempts:0};
          return park(task.id,next,{stage:"执行结果已归档，等待原发现任务采纳。",observationCheckResult:result,workerReleased:true},0);
        }
        if(!state.result)throw new ObservationProtocolError("Skill 回送缺少已归档结果。");
        const before=await client.snapshot(state.binding,signal);
        validateObservationEvents(before,task.id,check);
        if(before.events.some(event=>event.result))return await adopt(task.id,check,state,before);
        const demand=before.events.filter(event=>event.skillDemand).at(-1);
        if(!demand?.skillDemand||demand.skillDemand.requestId!==state.requestId||demand.seq!==state.afterSeq)
          throw new ObservationProtocolError("原发现已不在该 Skill 等待点，不能回送过期结果。");
        const delivered=await client.deliver(state.binding,state.replyMessageId,{requestId:state.requestId,afterSeq:state.afterSeq,result:state.result},signal);
        return await adopt(task.id,check,state,delivered);
      }catch(error){
        if(signal.aborted)throw error;
        const attempts=state.attempts+1;
        if(error instanceof ObservationProtocolError||attempts>=20)return {error:error instanceof ObservationProtocolError?error.message:"观测委托暂时无法接回，已保存受理和执行材料。",code:"OBSERVATION_HANDSHAKE_FAILED"};
        return park(task.id,{...state,attempts},{stage:"观测委托暂未接回，已保存等待点并让出。",workerReleased:true},Math.min(3000,attempts*pollMs));
      }
    },
    async reconcileCancelled(){
      requireStore();
      const pending=(await tasks.cancelledSteps!()).find(task=>task.checkpoint.kind==="observation-check-step.v1"&&Number((task.checkpoint.cancellation as Step["cancellation"])?.retryAt||0)<=now());
      if(!pending)return;
      const state=pending.checkpoint as Step;
      try{
        if(state.requestId&&engine)await engine.cancel(state.requestId);
        let cancellation="acceptance_unconfirmed";
        const binding=state.binding??state.cancellation?.binding;
        if(binding)cancellation=await client.cancel(binding,AbortSignal.timeout(2500));
        await tasks.cancelStep!(pending.id,{reconciled:true},{observationCancellation:{state:cancellation,requestId:state.requestId,discoveryTaskId:binding?.taskId}});
      }catch{await tasks.cancelStep!(pending.id,{retryAt:now()+2000});}
    },
  };
}
