import {lookupDiscoveryDelegation} from "./discovery-delegation-recovery";
import {stopAcceptedDiscovery} from "./discovery-a2a-client";
import {AsyncLocalStorage} from "node:async_hooks";
import {createHash,randomUUID} from "node:crypto";
import {TaskParked,type TaskStore,type Payload} from "./task-store";
import {productDatabase} from "./product-database";
import {runtimeTurnFingerprint,type RuntimeTurnInput} from "./runtime-turn-handoff";
import {ModelCapacityUnavailable} from "./runtime-model-capacity";
import type {DiscoveryBinding,DiscoveryA2AOptions,MaterialEvent} from "./discovery-a2a-client";

const hash=(value:unknown)=>createHash("sha256").update(JSON.stringify(value,(_k,v)=>v&&typeof v==="object"&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v)).digest("hex");
export const workspaceDiscoveryStepKind="workspace-discovery-step.v1";
export type DurableDelegation={operation:"discover"|"read";messageId:string;inputHash:string;grant?:string;reserved?:boolean;submitted?:boolean;submittedAt?:number;submissionAttempts?:number;binding?:DiscoveryBinding;lastSeq?:number;result?:unknown;events:MaterialEvent[];seen?:Record<string,{id:string;fingerprint:string}>;request?:{kind:string;input:Record<string,unknown>;taskId?:string};polls?:number;envelope?:string};
export type WorkspaceDiscoveryStepState=Payload&{kind:typeof workspaceDiscoveryStepKind;delegation:DurableDelegation;cancellation?:{reconciled?:boolean}};
function isWorkspaceDiscoveryStep(value:Payload|undefined):value is WorkspaceDiscoveryStepState {
 return value?.kind===workspaceDiscoveryStepKind;
}
type SavedModel={schema:string;inputHash:string;semanticHash:string;clock?:number;started?:boolean;value?:string};
/** Only two server-owned countdown fields may decrease between folds. No
 * material, scope, target, receipt, historical state or timestamp is omitted. */
export function semanticModelInput(prompt:string){
 const marker=prompt.lastIndexOf("\n{");
 if(marker>=0)try{
  const value=JSON.parse(prompt.slice(marker+1));let clock:number|undefined;
  const resources=value.resources;
  if(resources&&Object.keys(resources).every(key=>["remainingModelCalls","remainingAcquisitions","remainingLocatorReads","remainingToolAttempts","remainingMs"].includes(key))&&Number.isFinite(resources.remainingMs)&&resources.remainingMs>=0){clock=resources.remainingMs;resources.remainingMs="server-countdown";}
  else if(value.readCorrection&&Number.isFinite(value.readCorrection.remainingMs)&&value.readCorrection.remainingMs>=0){clock=value.readCorrection.remainingMs;value.readCorrection.remainingMs="server-countdown";}
  if(clock!==undefined)return {semanticHash:hash({instructions:prompt.slice(0,marker+1),value}),clock};
 }catch{}
 return {semanticHash:hash(prompt)};
}
export type RuntimeStepState=Payload&{kind:"runtime-turn-step.v1";fingerprint:string;startedAt:number;models:SavedModel[];delegations:DurableDelegation[];ids:Record<string,string>;windows:number[];cancellation?:{reconciled?:boolean}};
export const runtimeStepContext=new AsyncLocalStorage<RuntimeStep>();
export class RuntimeStep{
 replaying=false;private collecting=false;private materialEvent:Payload|undefined;
 private modelIndex=0;private delegationIndex=0;private windowIndex=0;
 constructor(readonly tasks:TaskStore,readonly taskId:string,readonly state:RuntimeStepState,readonly signal:AbortSignal,private emit:(payload:Payload)=>void){}
 async save(){this.signal.throwIfAborted();if(Buffer.byteLength(JSON.stringify(this.state))>8*1024*1024)throw Error("研究步骤超过持久恢复范围；已取得材料仍保留在原档。");if(!await this.tasks.saveStep?.(this.taskId,this.state,this.materialEvent))throw Error("研究步骤已结束或失去执行所有权，未继续执行。");this.materialEvent=undefined;}
 stableId(key:string){return this.state.ids[key]??=randomUUID();}
 budget(milliseconds:number){const i=this.windowIndex++;return this.state.windows[i]??=Date.now()+milliseconds;}
 async model(prompt:string,schema:unknown,run:()=>Promise<string>){
  const i=this.modelIndex++,signature=hash(schema??null),semantic=semanticModelInput(prompt);let saved=this.state.models[i];
  if(saved){if(saved.schema!==signature||saved.semanticHash!==semantic.semanticHash||saved.clock!==undefined&&semantic.clock!==undefined&&semantic.clock>saved.clock)throw Error("恢复的模型语义输入与原调用不一致，未复用或重新执行。");if(saved.value!==undefined){this.emit({stepReceipt:{kind:"model",ordinal:i,reused:true,inputFingerprint:saved.inputHash}});return saved.value;}if(saved.started)throw Error("原模型调用结果尚未确认，未自动重新执行。");}
  else this.state.models[i]=saved={schema:signature,inputHash:hash(prompt),...semantic};
  saved.started=true;await this.save();
  try{const value=await run();this.signal.throwIfAborted();saved.value=value;await this.save();return value;}
  catch(error){if(error instanceof ModelCapacityUnavailable){saved.started=false;await this.park("queued");}throw error;}
 }
 async delegation(operation:DurableDelegation["operation"],messageId:string,input:unknown){
  const i=this.delegationIndex++,inputHash=hash(input);let entry=this.state.delegations[i];
  if(entry){if(entry.operation!==operation||entry.inputHash!==inputHash)throw Error("恢复的委托与原授权输入不一致，未重新发送。");}
  else{entry={operation,messageId,inputHash,events:[]};this.state.delegations[i]=entry;await this.save();}
  return entry;
 }
 async captureMaterial(material:NonNullable<MaterialEvent["sourceReadProgress"]>){if(this.replaying)return;this.retain({sourceReadProgress:material});this.materialEvent={researchMaterials:material};if(!this.collecting)await this.save();}
 async hydrate<T>(run:()=>Promise<T>){this.replaying=true;try{return await run();}finally{this.replaying=false;}}
 private retain(event:MaterialEvent){
  const material=event.sourceReadResult||event.sourceReadProgress||event.result;
  if(!material)return;
  const prior=this.state.cancelledResult as any||{},papers=new Map((prior.paperRecords||[]).map((p:any)=>[p.id,p]));
  for(const paper of material.papers||[])papers.set(paper.id,paper);
  const searches=[...(prior.runTrace?.searches||[])];for(const run of material.searches||[])if(!searches.some(old=>hash(old)===hash(run)))searches.push(run);
  const retained={message:"研究已取消；以下仅为取消前已保存的材料，本轮答复尚未完成。",paperRecords:[...papers.values()],runTrace:{started:this.state.startedAt,stages:["仅保留中断前实际材料"],calls:[],searches}};
  this.state.cancelledResult=retained;this.state.failedResult={...retained,message:"研究执行未完成；以下仅为已保存的材料。"};
 }
 options(entry:DurableDelegation,original:DiscoveryA2AOptions):DiscoveryA2AOptions{
  return {...original,durable:entry,persist:()=>this.save(),authorizeReplay:async()=>{await this.save();return original.authorizeReplay?original.authorizeReplay():true;},park:()=>this.park("waiting-discovery",entry.operation),
   onAccepted:async binding=>{if(entry.binding){await this.hydrate(async()=>{await original.onAccepted?.(binding);});return;}await original.onAccepted?.(binding);entry.binding={...binding};await this.save();},
   onCheckpoint:async binding=>{if(hash(entry.binding)===hash(binding)){await this.hydrate(async()=>{await original.onCheckpoint?.(binding);});return;}await original.onCheckpoint?.(binding);entry.binding={...binding};await this.save();},
   onReplay:async event=>{await this.hydrate(async()=>{await original.onEvent?.(event);});},
   onEvent:async event=>{this.collecting=true;try{await original.onEvent?.(event);}finally{this.collecting=false;}this.retain(event);
    if(event.result||event.sourceReadResult||event.sourceReadProgress||event.planned){if(!entry.events.some(old=>old.seq===event.seq))entry.events.push(event);if(entry.events.length>32)entry.events.shift();}
    if(event.result||event.sourceReadResult)entry.result=event.result??event.sourceReadResult;
    if(event.seq!==undefined)entry.lastSeq=Math.max(entry.lastSeq??0,event.seq);await this.save();},
  };
 }
 async park(phase:"waiting-discovery"|"queued",operation?:DurableDelegation["operation"]):Promise<never>{
  this.signal.throwIfAborted();if(!await this.tasks.park?.(this.taskId,this.state,Date.now()+1000,{workerReleased:true,runtimePhase:{phase,...(operation?{operation}:{})}}))throw Error("研究步骤未能安全让出。");throw new TaskParked();
 }
}
export function isRuntimeStep(value:unknown):value is RuntimeStepState{return !!value&&typeof value==="object"&&(value as RuntimeStepState).kind==="runtime-turn-step.v1";}
export async function createRuntimeStep(tasks:TaskStore,id:string,body:RuntimeTurnInput,checkpoint:Payload|undefined,signal:AbortSignal,emit:(payload:Payload)=>void){
 const fingerprint=runtimeTurnFingerprint(body);
 const state:RuntimeStepState=isRuntimeStep(checkpoint)?structuredClone(checkpoint):{kind:"runtime-turn-step.v1",fingerprint,startedAt:Date.now(),models:[],delegations:[],ids:{},windows:[]};
 if(state.fingerprint!==fingerprint)throw Error("研究恢复输入与原步骤不一致。");
 const step=new RuntimeStep(tasks,id,state,signal,emit);await step.save();return step;
}

const localStopLocks=new Set<string>();
/** A short, non-blocking reconciliation lock; no task transaction spans HTTP. */
async function withStopLock(id:string,run:()=>Promise<void>){
 if(!process.env.ONEEARTH_RUNTIME_DATABASE_URL){if(localStopLocks.has(id))return;localStopLocks.add(id);try{await run();}finally{localStopLocks.delete(id);}return;}
 const pool=productDatabase("RUNTIME"),client=await pool.connect().catch(async error=>{await pool.end();throw error;});let held=false;
 try{held=!!(await client.query("SELECT pg_try_advisory_lock(7142542,hashtext($1)) AS held",[id])).rows[0]?.held;if(held)await run();}
 finally{if(held)await client.query("SELECT pg_advisory_unlock(7142542,hashtext($1))",[id]).catch(()=>{});client.release();await pool.end();}
}
/** Cancellation is a new durable fact; it never resumes a cancelled fold. */
export async function reconcileRuntimeStops(tasks:TaskStore){
 const known=await tasks.pendingRemoteStops?.()??[],cancelled=await tasks.cancelledSteps?.()??[];
 const delegations=(checkpoint:Payload|undefined):DurableDelegation[]|undefined=>{
  if(isRuntimeStep(checkpoint))return checkpoint.delegations;
  if(isWorkspaceDiscoveryStep(checkpoint)&&checkpoint.delegation?.operation==="discover")return [checkpoint.delegation];
 };
 for(const id of new Set([...known.map(stop=>stop.id),...cancelled.filter(saved=>delegations(saved.checkpoint)).map(saved=>saved.id)]))await withStopLock(id,async()=>{
  if((await tasks.get(id))?.status!=="cancelled")return;
  const status=await tasks.runtimeStatus?.(id);
  for(const stop of status?.remoteStops?.filter(stop=>stop.state==="pending")??[]){
   const remoteState=await stopAcceptedDiscovery(stop.discoveryTaskId);await tasks.recordRemoteStop?.(id,{discoveryTaskId:stop.discoveryTaskId,state:remoteState?"confirmed":"unconfirmed",...(remoteState?{remoteState}:{})});
  }
  const checkpoint=await tasks.step?.(id),entries=delegations(checkpoint);
  if(!entries||(isRuntimeStep(checkpoint)||isWorkspaceDiscoveryStep(checkpoint))&&checkpoint.cancellation?.reconciled===true)return;
  let reconciled=true;
  for(const entry of entries){
   let binding=entry.binding;
   if(!binding&&entry.submitted&&entry.request){
    const found=await lookupDiscoveryDelegation(process.env.ONEEARTH_DISCOVERY_URL||"http://127.0.0.1:5275",{messageId:entry.messageId,...entry.request},AbortSignal.timeout(3000));
    if(found.state==="accepted")binding={transport:"a2a",messageId:entry.messageId,discoveryId:found.taskId,state:"TASK_STATE_WORKING"};
    else if(found.state==="unknown"||entry.submittedAt!==undefined&&Date.now()-entry.submittedAt<3500){reconciled=false;continue;}
   }
   if(binding){
    const latest=await tasks.runtimeStatus?.(id);if(latest?.remoteStops?.some(stop=>stop.discoveryTaskId===binding!.discoveryId))continue;
    await tasks.recordRemoteStop?.(id,{discoveryTaskId:binding.discoveryId,state:"pending"});
    const remoteState=await stopAcceptedDiscovery(binding.discoveryId,binding.contextId);
    await tasks.recordRemoteStop?.(id,{discoveryTaskId:binding.discoveryId,state:remoteState?"confirmed":"unconfirmed",...(remoteState?{remoteState}:{})});
   }
  }
  if(reconciled)await tasks.cancelStep?.(id,{reconciled:true});
 });
}
