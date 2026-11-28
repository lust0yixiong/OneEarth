import type {RemoteStop,RuntimePhase} from "./runtime-status";

export type TaskLifecycle={runtimePhase?:RuntimePhase;remoteStops?:RemoteStop[]};
type TaskIdentity={id:string;conversationId:string;turnId:string};

export function matchesTaskIdentity(value:unknown, expected:TaskIdentity):boolean {
  if(!value || typeof value!=="object")return false;
  const task=value as Partial<TaskIdentity>;
  return task.id===expected.id && task.conversationId===expected.conversationId && task.turnId===expected.turnId;
}

const phases=new Set<RuntimePhase["phase"]>([
  "queued","executing","waiting-discovery","waiting-workspace","resuming","cancel-pending","complete","failed","cancelled",
]);
const terminal=new Set<RuntimePhase["phase"]>(["complete","failed","cancelled"]);
const stopOrder={pending:0,unconfirmed:1,confirmed:2} as const;

function readPhase(value:unknown):RuntimePhase|undefined {
  if(!value || typeof value!=="object")return;
  const {phase,operation}=value as RuntimePhase;
  if(!phases.has(phase))return;
  return {phase,...(operation==="discover" || operation==="read"?{operation}:{})};
}

function readStop(value:unknown):RemoteStop|undefined {
  if(!value || typeof value!=="object")return;
  const {discoveryTaskId,state,remoteState}=value as RemoteStop;
  if(typeof discoveryTaskId!=="string" || !discoveryTaskId || !Object.hasOwn(stopOrder,state))return;
  return {discoveryTaskId,state,...(typeof remoteState==="string"?{remoteState}:{})};
}

export function readTaskLifecycle(value:unknown):TaskLifecycle|undefined {
  if(!value || typeof value!=="object")return;
  const wire=value as {runtimePhase?:unknown;remoteStop?:unknown;remoteStops?:unknown};
  const runtimePhase=readPhase(wire.runtimePhase);
  const raw=Array.isArray(wire.remoteStops)?wire.remoteStops:[wire.remoteStop];
  const remoteStops=raw.flatMap(value=>readStop(value)??[]);
  if(!runtimePhase && !remoteStops.length)return;
  return {...(runtimePhase?{runtimePhase}:{}),...(remoteStops.length?{remoteStops}:{})};
}

/** A local terminal phase and a confirmed stop are irreversible for the same task. */
export function mergeTaskLifecycle(current:TaskLifecycle|undefined,incoming:TaskLifecycle):TaskLifecycle {
  const priorPhase=current?.runtimePhase,nextPhase=incoming.runtimePhase;
  const runtimePhase=priorPhase && (terminal.has(priorPhase.phase) || !nextPhase
    || priorPhase.phase===nextPhase.phase && priorPhase.operation===nextPhase.operation) ? priorPhase : nextPhase;
  const stops=new Map(current?.remoteStops?.map(receipt=>[receipt.discoveryTaskId,receipt]));
  let changed=false;
  for(const stop of incoming.remoteStops??[]){
    const previous=stops.get(stop.discoveryTaskId);
    if(previous && stopOrder[previous.state]>=stopOrder[stop.state])continue;
    stops.set(stop.discoveryTaskId,stop);
    changed=true;
  }
  if(current && runtimePhase===priorPhase && !changed)return current;
  return {...(runtimePhase?{runtimePhase}:{}),...(stops.size?{remoteStops:[...stops.values()]}:{})};
}

export async function readCancelledTaskLifecycle(task:TaskIdentity,signal:AbortSignal):Promise<TaskLifecycle|undefined> {
  const response=await fetch("/api/tasks/"+encodeURIComponent(task.id),{signal,cache:"no-store"});
  if(!response.ok)throw Error("原任务状态暂不可读。");
  const data=await response.json();
  if(!matchesTaskIdentity(data,task) || data.status!=="cancelled")return;
  const facts=readTaskLifecycle(data);
  return {runtimePhase:{phase:"cancelled"},remoteStops:facts?.remoteStops};
}
