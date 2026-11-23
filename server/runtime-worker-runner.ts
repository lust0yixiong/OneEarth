import {executeTurn,resumePlannedTurn,type RuntimeServices} from "./runtime-turn";
import {runtimeObservation,type RuntimeObservationEngine} from "./runtime-observation";
import {runtimeObservationResearch,ObservationGeneral} from "./runtime-observation-research";
import {observationOrdinaryInput,type ObservationAuthority} from "./runtime-observation-authority";
import {TaskParked,type Payload} from "./task-store";
import {readChatResearchHandoff} from "./runtime-chat-turn";

/** Both explicit capabilities and ordinary research use this production worker. */
export function runtimeWorkerRunner(services:RuntimeServices,engine?:RuntimeObservationEngine,options:Omit<Parameters<typeof runtimeObservation>[0],"tasks"|"engine">&{
  authority?:ObservationAuthority;chatHandoff?:(id:string)=>Promise<Payload|undefined>;
}={}){
  const {chatHandoff,...observationOptions}=options;
  const observation=runtimeObservation({tasks:services.tasks,engine,...observationOptions});
  const research=runtimeObservationResearch({tasks:services.tasks,engine,...observationOptions});
  return {maintenance:engine||process.env.ONEEARTH_SKILL_SERVICE_TOKEN?async()=>{await observation.reconcileCancelled();await research.reconcileCancelled();}:undefined,
    run:async(task:{id:string;body:any;checkpoint?:Payload},signal:AbortSignal,emit:(payload:Payload)=>void)=>{
      if(task.body.observationCheck!==undefined)return observation.run(task,signal);
      if(task.checkpoint?.kind==="observation-research-step.v1"){
        const result=await research.run(task,signal);if(!(result instanceof ObservationGeneral))return result;
        signal.throwIfAborted();
        // After this atomic transition, a process interruption must follow the
        // ordinary turn's policy instead of replaying arbitrary normal work.
        if(!await services.tasks.clearStep?.(task.id))return new TaskParked();
        signal.throwIfAborted();
        if(await chatHandoff?.(task.id))return {result:{message:result.unavailable
          ?"本轮引用的观测资料目前不可用，请重新选择可以读取的版本。"
          :"发现服务未将本轮请求判为可用该观测资料回答。请说明要核对的变量或另选来源。",clarification:true}};
        const body=observationOrdinaryInput(task.body,result.unavailable,result.observationParent);
        return executeTurn(services,task.id,body,signal,emit,{observationUnavailable:result.unavailable});
      }
      const handoff=await chatHandoff?.(task.id);
      if(handoff){
        const {body,plan}=readChatResearchHandoff(handoff);
        return resumePlannedTurn(services,task.id,body,plan,signal,emit);
      }
      return executeTurn(services,task.id,task.body,signal,emit);
    }};
}
