import {randomUUID,createHash} from "node:crypto";
import {isDeepStrictEqual} from "node:util";
import {TaskParked,type TaskStore,type Payload,type Task} from "./task-store";
import {validateTurnStructure} from "./runtime-input";
import {parseObservationCheck,observationSha256,validObservationResult,observationResultMatchesRequest,
  type ObservationCheck,type ObservationRequest,type ObservationCheckResult,type SkillExecutionRequest} from "./observation-check-contract";
import {observationDiscoveryClient,observationTerminal,validateObservationEvents,ObservationProtocolError,
  type ObservationBinding,type ObservationTask} from "./observation-discovery-client";

export interface RuntimeObservationEngine {
  submit(request:SkillExecutionRequest):Promise<unknown>;
  result(requestId:string):Promise<ObservationCheckResult|undefined>;
  cancel(requestId:string):Promise<unknown>;
}
type Step=Payload&{kind:"observation-check-step.v1";phase:"submit"|"discovery"|"engine"|"deliver";
  expectedSha256:string;
  initialMessageId:string;replyMessageId:string;binding?:ObservationBinding;requestId?:string;afterSeq?:number;
  result?:ObservationCheckResult;attempts:number;completedResult?:Payload;cancelledResult?:Payload;failedResult?:Payload;
  cancellation?:{binding?:ObservationBinding;reconciled?:boolean;retryAt?:number}};

/** This state is stored in the same transaction as the initial task submission. */
export function hasObservationCheck(input:unknown){return !!input&&typeof input==="object"&&(input as {observationCheck?:unknown}).observationCheck!==undefined;}
export function initialObservationCheckpoint(_id:string,input:unknown,expectedSha256?:string):Step|undefined{
  const check=parseObservationCheck((input as {observationCheck?:unknown})?.observationCheck);
  if(!check)return;
  if(!observationSha256(expectedSha256))throw Error("初次受理缺少已授权文件摘要。");
  return {kind:"observation-check-step.v1",phase:"submit",expectedSha256,initialMessageId:randomUUID(),replyMessageId:randomUUID(),attempts:0};
}

export async function prepareObservationInput(tasks:TaskStore,id:string,input:unknown,authorizeDigest:(check:ObservationCheck)=>Promise<string|undefined>){
  const issue=await validateTurnStructure(tasks,input);if(issue)return {error:issue};
  const check=parseObservationCheck((input as {observationCheck?:unknown}).observationCheck);
  if(!check)return {error:"观测核对请求无效。"};
  try{
    const digest=await authorizeDigest(check);
    if(!observationSha256(digest))return {error:"当前未获准对该资料版本执行观测核对。"};
    return {checkpoint:initialObservationCheckpoint(id,input,digest)};
  }catch{return {error:"观测核对授权暂时无法确认。"};}
}

export function observationResponse(result:ObservationCheckResult,check:ObservationRequest,elapsedMs:number,provenance:"read"|"archive"="read"){
  let message:string;
  const references=result.status==="verified"?[{
    kind:"asset" as const,id:"observation:"+createHash("sha256").update(JSON.stringify([result.evidence.artifactId,result.evidence.version,result.evidence.variable,result.evidence.sha256])).digest("hex"),
    title:result.evidence.artifactId+" · "+result.evidence.version+" · "+result.evidence.variable,source:"已授权观测文件",sourceChannel:"local" as const,referenceType:"data" as const,
    evidenceLevel:"observation-file" as const,observationEvidence:result.evidence,
  }]:[];
  if(result.status==="verified"){
    const e=result.evidence;
    message=(provenance==="archive"?"此前保存的读据显示：「":"已核对「")+e.artifactId+"」的指定版本「"+e.version+"」。变量「"+e.variable+"」的单位为「"+e.unit+"」，"+
      (e.count?(e.netcdf?"非缺测记录共 ":"非空记录共 ")+e.count+" 条，起止日期为 "+e.first+" 至 "+e.last+"。":e.netcdf?"没有具有有效时间的非缺测记录。":"没有非空记录。")+
      ("purpose" in check?"":result.matches?"符合本次指定的单位和记录起止边界要求。":"不满足本次指定的单位「"+check.unit+"」及记录起止边界 "+check.start+" 至 "+check.end+" 的要求。");
    message+="〔1〕";
    if(e.netcdf){
      const n=e.netcdf;
      if(e.artifactSource)message+="\n\n受信发布版本："+e.artifactSource.versionLabel+"。";
      const roles=[n.standardName?"standard_name="+n.standardName:null,n.longName?"long_name="+n.longName:null].filter(Boolean);
      if(roles.length)message+="\n文件变量角色："+roles.join("；")+"。";
      if(n.firstUtc)message+="\n非缺测记录最早 UTC："+n.firstUtc+"；最晚 UTC："+n.lastUtc+"。以上日期来自这些记录，不是文件的全局覆盖。";
      message+="\n本次填充值标记：["+n.fillValues.join(", ")+"]；missing_value 标记：["+n.missingValues.join(", ")+"]。";
      message+="\n逐值检查 "+n.totalSamples+" 条：填充值/缺测标记剔除 "+n.excluded.missingValue+" 条，非有限值剔除 "+n.excluded.nonFinite+" 条，文件声明有效范围外剔除 "+n.excluded.outsideValidRange+" 条，时间无效剔除 "+n.excluded.invalidTime+" 条。";
      if(n.relatedVariables.length)message+="\n同一原件的已登记关联变量（仅元数据，未统计这些变量的记录时段）："+n.relatedVariables.map(v=>v.name+"："+[v.standardName,v.longName,v.unit?"units="+v.unit:null].filter(Boolean).join("；")).join("；\n")+"。";
    }
  }else if(result.status==="not_started"&&result.reason==="artifact_version_changed")message="受理时固定的观测文件版本已变更，未启动读取。";
  else if(result.status==="not_started"&&result.reason==="artifact_not_authorized")message="受理时的观测文件现已无授权，未启动读取。";
  else message=({not_started:"指定观测核对尚未启动。",failed:"指定观测核对未能完成。",cancelled:"指定观测核对已取消。",unknown:"指定观测核对的结果暂时无法确认。"})[result.status];
  return {result:{message,observationCheckResult:result,observationCheck:check,
    answerNotes:{references,sources:references.map(ref=>({id:ref.id,reason:"实际取得的指定版本观测文件读据"})),researchNotes:[],searches:[],webSources:[],
      limitation:result.status==="verified"?(provenance==="archive"?"沿用此前实际取得的原版本读据，本轮未重新读取文件。":"")+"本次只核对单位和非空记录起止边界，不代表时段内连续有效或逐小时齐全。"+
        (result.evidence.netcdf?"NetCDF 统计只保留具有有效时间的非缺测值；先按原始存储值剔除 _FillValue/missing_value、非有限值及文件声明 valid_min/valid_max/valid_range 外值，再应用 scale_factor/add_offset。未按关联 QC 标志筛选，不能称为质量控制后有效观测；按文件 CF 时间单位/历法换算 UTC，未另行修正闰秒。"+(result.evidence.netcdf.relatedVariablesTruncated?"关联变量元数据仅列前20项。":""):""):"本轮尚无可核对的观测文件读据。",
      followUp:"",reviewed:references.length,elapsedMs,executor:"运行时受权执行器"}}};
}
const response=observationResponse;

export function observationRetainedRecords(result:ObservationCheckResult,check:ObservationRequest,elapsedMs:number,provenance:"read"|"archive"="read"){
  if(result.status!=="verified")return {};
  const saved=response(result,check,elapsedMs,provenance).result;
  const notice="以下保留此前实际取得的执行材料，不代表原发现委托已完成。\n\n"+saved.message;
  return {cancelledResult:{...saved,message:"研究已取消。"+notice,observationDelivery:"retained-after-interruption"},
    failedResult:{...saved,message:"研究推进已中断。"+notice,observationDelivery:"retained-after-interruption"}};
}
const retainedRecords=observationRetainedRecords;

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
  async function adopt(id:string,check:ObservationCheck,state:Step,snapshot:ObservationTask,created:number){
    validateObservationEvents(snapshot,id,check);
    const final=snapshot.events.filter(event=>event.result).at(-1);
    if(final?.result){
      if(final.result.status==="verified"&&final.result.evidence.sha256!==state.expectedSha256)throw new ObservationProtocolError("发现结果摘要与初次受理授权不一致。");
      if(final.result.status==="verified"&&!state.result)throw new ObservationProtocolError("发现结果缺少本研究已归档的实际执行回执。");
      if(state.result&&!isDeepStrictEqual(state.result,final.result))throw new ObservationProtocolError("原发现返回的 Skill 结果与已归档执行结果冲突。");
      if(snapshot.state!=="TASK_STATE_COMPLETED"){
        if(observationTerminal(snapshot.state))throw new ObservationProtocolError("Skill 结果未由原发现任务确认完成。");
        return park(id,{...state,phase:"discovery",attempts:0});
      }
      const completedResult=state.completedResult??response(final.result,check,Math.max(0,now()-created)).result;
      if(!await tasks.saveStep!(id,{...state,result:final.result,completedResult},{observationCheckResult:final.result,observationDiscovery:{taskId:snapshot.taskId,state:snapshot.state}}))return new TaskParked();
      return {result:completedResult};
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
      const root=await tasks.get(task.id);
      if(root?.status!=="running")return new TaskParked();
      const elapsed=()=>Math.max(0,now()-root.created);
      if(!observationSha256(state.expectedSha256)){
        if(state.requestId&&engine)try{await engine.cancel(state.requestId);}catch{/* stop remains unconfirmed */}
        if(state.binding)try{await client.cancel(state.binding,AbortSignal.timeout(2500));}catch{/* no new ownership is manufactured */}
        const stopped=response({status:state.requestId||state.binding?"unknown":"not_started",reason:"initial_digest_unbound"},check,elapsed());
        stopped.result.message="初次受理未冻结已授权文件摘要，已停止继续执行；请重新提交明确请求。"+stopped.result.message;
        return {...stopped,error:"初次受理缺少文件摘要，不能按当前登记回填。",code:"OBSERVATION_DIGEST_UNBOUND"};
      }
      if(state.result?.status==="verified"&&state.result.evidence.sha256!==state.expectedSha256)
        return {...response({status:"unknown",reason:"digest_mismatch"},check,elapsed()),error:"已存执行结果不符合初次受理摘要。",code:"OBSERVATION_DIGEST_MISMATCH"};
      if(state.completedResult)return {result:state.completedResult};
      if(!engine&&state.phase==="submit")return response({status:"not_started",reason:"execution_unconfigured"},check,elapsed());
      try{
        signal.throwIfAborted();
        if(state.phase==="submit"){
          const accepted=await client.submit(state.initialMessageId,task.id,check,signal);
          validateObservationEvents(accepted,task.id,check);
          const next:Step={...state,phase:"discovery",binding:{taskId:accepted.taskId,contextId:accepted.contextId},attempts:0};
          if(!await tasks.saveStep!(task.id,next,{observationDiscovery:{messageId:state.initialMessageId,taskId:accepted.taskId,state:accepted.state}})){
            await tasks.cancelStep!(task.id,{binding:next.binding});return new TaskParked();
          }
          return await adopt(task.id,check,next,accepted,root.created);
        }
        if(!state.binding)throw new ObservationProtocolError("Skill 委托缺少已验证受理身份。");
        if(state.phase==="discovery")return await adopt(task.id,check,state,await client.snapshot(state.binding,signal),root.created);
        if(!state.requestId||state.afterSeq===undefined)throw new ObservationProtocolError("Skill 执行缺少已归档需求身份和水位。");
        if(state.phase==="engine"){
          if(!engine)return park(task.id,{...state,phase:"deliver",result:{status:"not_started",reason:"execution_unconfigured"},attempts:0},
            {stage:"本轮执行能力未配置，已保存未启动结果。",workerReleased:true},0);
          await engine.submit({researchTaskId:task.id,discoveryTaskId:state.binding.taskId,requestId:state.requestId,check,expectedSha256:state.expectedSha256});
          const result=await engine.result(state.requestId);
          if(!result)return park(task.id,state);
          if(!validObservationResult(result)||!observationResultMatchesRequest(result,check))throw new ObservationProtocolError("执行器结果不属于本次受权核对。");
          if(result.status==="verified"&&result.evidence.sha256!==state.expectedSha256)throw new ObservationProtocolError("执行器返回的文件摘要不符合初次受理授权。");
          const next:Step={...state,phase:"deliver",result,...retainedRecords(result,check,elapsed()),attempts:0};
          return park(task.id,next,{stage:"执行结果已归档，等待原发现任务采纳。",observationCheckResult:result,workerReleased:true},0);
        }
        if(!state.result)throw new ObservationProtocolError("Skill 回送缺少已归档结果。");
        const before=await client.snapshot(state.binding,signal);
        validateObservationEvents(before,task.id,check);
        if(before.events.some(event=>event.result))return await adopt(task.id,check,state,before,root.created);
        const demand=before.events.filter(event=>event.skillDemand).at(-1);
        if(!demand?.skillDemand||demand.skillDemand.requestId!==state.requestId||demand.seq!==state.afterSeq)
          throw new ObservationProtocolError("原发现已不在该 Skill 等待点，不能回送过期结果。");
        const delivered=await client.deliver(state.binding,state.replyMessageId,{requestId:state.requestId,afterSeq:state.afterSeq,result:state.result},signal);
        return await adopt(task.id,check,state,delivered,root.created);
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
