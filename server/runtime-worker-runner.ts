import {executeTurn,type RuntimeServices} from "./runtime-turn";
import {runtimeObservation,type RuntimeObservationEngine} from "./runtime-observation";
import type {Payload} from "./task-store";

/** Both explicit capabilities and ordinary research use this production worker. */
export function runtimeWorkerRunner(services:RuntimeServices,engine?:RuntimeObservationEngine,options:Omit<Parameters<typeof runtimeObservation>[0],"tasks"|"engine">={}){
  const observation=runtimeObservation({tasks:services.tasks,engine,...options});
  return {maintenance:engine||process.env.ONEEARTH_SKILL_SERVICE_TOKEN?()=>observation.reconcileCancelled():undefined,
    run:(task:{id:string;body:any;checkpoint?:Payload},signal:AbortSignal,emit:(payload:Payload)=>void)=>
      task.body.observationCheck!==undefined?observation.run(task,signal):executeTurn(services,task.id,task.body,signal,emit)};
}
