import {executeTurn,type RuntimeServices} from "./runtime-turn";
import {runtimeObservation,type RuntimeObservationEngine} from "./runtime-observation";
import {runtimeObservationResearch,ObservationGeneral} from "./runtime-observation-research";
import {observationOrdinaryInput,type ObservationAuthority} from "./runtime-observation-authority";
import {TaskParked,type Payload} from "./task-store";

/** Both explicit capabilities and ordinary research use this production worker. */
export function runtimeWorkerRunner(services:RuntimeServices,engine?:RuntimeObservationEngine,options:Omit<Parameters<typeof runtimeObservation>[0],"tasks"|"engine">&{authority?:ObservationAuthority}={}){
  const observation=runtimeObservation({tasks:services.tasks,engine,...options});
  const research=runtimeObservationResearch({tasks:services.tasks,engine,...options});
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
        const body=observationOrdinaryInput(task.body,result.unavailable,result.observationParent);
        return executeTurn(services,task.id,body,signal,emit,{observationUnavailable:result.unavailable});
      }
      return executeTurn(services,task.id,task.body,signal,emit);
    }};
}
