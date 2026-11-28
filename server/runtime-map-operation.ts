import {randomUUID} from "node:crypto";
import type {PoolClient} from "pg";
import {flightCatalogueIntent,validFlightMapReceipt,type FlightMapReceipt} from "../src/domain/flight-catalogue";
import type {ResearchRangeInput} from "../src/domain/research-range";
import type {DiscoveryResponse} from "../src/domain/types";
import {readWorkspaceEffectReceipt,type WorkspaceActionEffect,type WorkspaceEffectCommand,type WorkspaceEffectReceipt} from "../src/domain/workspace-action-effect";
import {workspacePageHash} from "./ag-ui-input";
import {finishAgUi,writeAgUiWorkspaceEffect} from "./ag-ui-persistence";
import {mergeWorkspaceEffectReceipt,retainedWorkspaceEffectResult,workspaceEffectCommand} from "./postgres-workspace-effects";
import type {RuntimeOperation,RuntimeOperationBody,RuntimeOperationsStore,RuntimeOperationStep} from "./runtime-operations";
import {presentationMessage,readFlightCatalogue} from "./runtime-workspace-effect";
import type {RuntimeServices,RuntimeTurnInput} from "./runtime-turn";
import {TaskParked,type Payload} from "./task-store";

const kind="workspace-map";
const waitMs=45_000;
type MapInput={body:RuntimeTurnInput;retained:DiscoveryResponse;pageHash:string};
type Checkpoint={stepId:string;scope?:ResearchRangeInput["scope"]};
type BrowserRequest={command:WorkspaceEffectCommand;startedAt:number};
type CatalogueRequest={flight:Extract<FlightMapReceipt,{state:"arrived"}>;place:string;present:boolean};
type MapOperation=RuntimeOperationBody&{runId:string;turnId:string;input:MapInput};

function mapOperation(op:RuntimeOperationBody|undefined): op is MapOperation {
  return op?.kind===kind&&typeof op.runId==="string"&&typeof op.turnId==="string";
}
function browserWait(command:WorkspaceEffectCommand,owner:string){
  const startedAt=Date.now();
  return {stepId:randomUUID(),kind:"browser" as const,request:{command,startedAt},owner,expiresAt:startedAt+waitMs};
}
function effectFor(op:MapOperation,step:RuntimeOperationStep,includeCommand=false):WorkspaceActionEffect|undefined {
  if(step.kind!=="browser"||step.expiresAt===undefined)return;
  const {command}=step.request as BrowserRequest;
  const receipt=readWorkspaceEffectReceipt(step.receipt?.payload);
  const status=step.state==="failed"?"cancelled":step.state;
  return {version:1,conversationId:op.conversationId,runId:op.runId,turnId:op.turnId,
    actionId:op.operationId,operationId:op.operationId,effectId:step.stepId,stepId:step.stepId,stepOrder:step.ordinal,
    kind:command.kind,status,expiresAt:step.expiresAt,...(receipt?{receipt}:{}),
    ...(includeCommand&&status==="waiting"&&step.expiresAt>Date.now()?{command}:{})};
}
async function projectEffect(db:PoolClient,op:MapOperation,step:RuntimeOperationStep,command=false){
  const effect=effectFor(op,step);
  if(effect)await writeAgUiWorkspaceEffect(db,op.runId,effect,command?(step.request as BrowserRequest).command:undefined);
}
async function finishRun(db:PoolClient,op:MapOperation,status:"complete"|"failed"|"cancelled",result:Payload){
  const now=Date.now();
  const changed=await db.query("UPDATE runtime_chat_messages SET status=$2,terminal=$3,updated=$4 WHERE id=$1 AND status='handed_off'",
    [op.runId,status,result,now]);
  if(!changed.rowCount)throw Error("原工作台运行无法完成。");
  await finishAgUi(db,op.runId,status,result);
  await db.query("INSERT INTO runtime_chat_events(id,at,payload) VALUES ($1,$2,$3)",
    [op.runId,now,{...result,runtimePhase:{phase:status}}]);
}

export function runtimeMapOperations(operations:RuntimeOperationsStore){
  return {
    start:(runId:string,body:RuntimeTurnInput,pageHash:string,command:WorkspaceEffectCommand,result:DiscoveryResponse)=>
      operations.transaction(async db=>{
        const {rows:[message]}=await db.query<{body:string}>(
          "SELECT body FROM runtime_chat_messages WHERE id=$1 AND status='planning' FOR UPDATE",[runId]);
        if(!message)return false;
        const original=JSON.parse(message.body) as RuntimeTurnInput;
        if(original.conversationId!==body.conversationId||original.turnId!==body.turnId)throw Error("原工作台运行归属不一致。");
        const retained=retainedWorkspaceEffectResult(result);
        if(command.kind==="flight")retained.message="已保存本轮飞行目标，等待原页面的实际到达回执。";
        const wait=browserWait(command,pageHash),operationId=randomUUID();
        const op=await operations.createInTransaction(db,{operationId,runId,
          conversationId:body.conversationId,turnId:body.turnId,kind,input:{body:original,retained,pageHash},wait,
          checkpoint:{stepId:wait.stepId,cancelledResult:retained,failedResult:retained}});
        if(!mapOperation(op))throw Error("未能接收原工作台操作。");
        const step=await operations.readStepInTransaction(db,operationId,wait.stepId);
        if(!step)throw Error("未能保存原工作台待办。");
        await db.query("UPDATE runtime_chat_messages SET status='handed_off',updated=$2 WHERE id=$1",[runId,Date.now()]);
        await projectEffect(db,op,step,true);
        return true;
      }),
    async read(runId:string,token?:string){
      const op=await operations.readForRun(runId);
      if(!mapOperation(op)||op.runId!==runId)return;
      const steps=(await operations.steps(op.operationId)).filter(step=>step.kind==="browser");
      const current=steps.at(-1);
      return current&&effectFor(op,current,op.currentStepId===current.stepId&&workspacePageHash(token)===current.owner);
    },
    async history(runId:string){
      const op=await operations.readForRun(runId);
      if(!mapOperation(op)||op.runId!==runId)return;
      return (await operations.steps(op.operationId)).flatMap(step=>{
        const view=effectFor(op,step);
        return view?[view]:[];
      });
    },
    receipt:(conversationId:string,operationId:string,stepId:string,token:string,receipt:WorkspaceEffectReceipt)=>
      operations.transaction(async db=>{
        const step=await operations.readStepInTransaction(db,operationId,stepId,true);
        if(!step||step.kind!=="browser"||workspacePageHash(token)!==step.owner)return;
        const op=await operations.readInTransaction(db,operationId);
        if(!mapOperation(op)||op.conversationId!==conversationId)return {status:404 as const};
        const effect=effectFor(op,step);
        if(!effect)return {status:404 as const};
        const {command,startedAt}=step.request as BrowserRequest;
        const fact=mergeWorkspaceEffectReceipt({...effect,command},receipt,startedAt,Date.now());
        if(!fact||fact.kind==="catalogue-presentation"&&(command.kind!=="catalogue-presentation"||
          fact.presentation.items.length!==command.target.items.length))return {status:409 as const};
        const accepted=await operations.receiptInTransaction(db,{operationId,stepId,kind:"browser",owner:step.owner,
          receiptId:stepId,payload:fact});
        if(!accepted.step||accepted.status==="missing")return {status:404 as const};
        if(accepted.status==="conflict")return {status:409 as const};
        if(accepted.status==="accepted"||accepted.status==="late"&&accepted.step.state==="expired")
          await projectEffect(db,op,accepted.step);
        const saved=effectFor(op,accepted.step);
        if(!saved)throw Error("已保存的工作台回执无法读取。");
        return {status:200 as const,effect:saved};
      }),
    async cancelRun(runId:string,payload:Payload){
      const op=await operations.readForRun(runId);
      if(!mapOperation(op)||op.runId!==runId)return;
      return operations.transaction(async db=>{
        const locked=await operations.readInTransaction(db,op.operationId,true);
        if(!mapOperation(locked))return false;
        const result={...payload,result:retainedResult(locked,await operations.stepsInTransaction(db,op.operationId))};
        if(!await operations.cancelInTransaction(db,op.operationId,result))return false;
        await finishRun(db,op,"cancelled",result);
        return true;
      });
    },
  };
}

function retainedResult(op:MapOperation,steps:RuntimeOperationStep[]){
  const query=steps.filter(step=>step.kind==="service"&&step.state==="received").at(-1)?.receipt?.payload.result;
  return query as DiscoveryResponse|undefined??op.input.retained;
}

export async function failWorkspaceMapOperation(operations:RuntimeOperationsStore,op:RuntimeOperation){
  if(!mapOperation(op))return false;
  return operations.transaction(async db=>{
    const original=await operations.readInTransaction(db,op.operationId,true);
    if(!mapOperation(original))return false;
    const result={error:"工作台操作未完成，已保存的结果仍可查看。",code:"operation_failed",
      result:retainedResult(original,await operations.stepsInTransaction(db,op.operationId))};
    return operations.finishInTransaction(db,op.operationId,"failed",result,tx=>finishRun(tx,original,"failed",result));
  });
}

export async function runWorkspaceMapOperation(services:RuntimeServices,operations:RuntimeOperationsStore,op:RuntimeOperation,
  checkpoint:Payload|undefined,signal:AbortSignal,emit:(event:Payload)=>void){
  if(!mapOperation(op))return {error:"工作台操作身份无效。",code:"operation_invalid"};
  const origin=op;
  const {operationId,runId,input:{body,retained,pageHash}}=op;
  const saved=checkpoint as Checkpoint|undefined;
  let step=saved&&await operations.readStep(operationId,saved.stepId);
  async function finish(result:Payload){
    const status=result.error?"failed":"complete";
    const changed=await operations.transaction(db=>operations.finishInTransaction(db,operationId,status,result,
      tx=>finishRun(tx,origin,status,result)));
    if(!changed)signal.throwIfAborted();
    return new TaskParked();
  }
  if(!step||!saved)return finish({error:"原操作检查点不可用。",code:"operation_checkpoint_unavailable",result:retained});
  if(step.state==="waiting"&&step.expiresAt!==undefined&&step.expiresAt<=Date.now()){
    step=await operations.transaction(async db=>{
      const expired=await operations.expireInTransaction(db,operationId,saved.stepId);
      if(expired)await projectEffect(db,op,expired);
      return expired;
    })??await operations.readStep(operationId,saved.stepId);
    if(!step)return new TaskParked();
  }
  if(step.state==="expired"){
    const prior=retainedResult(op,await operations.steps(operationId));
    return finish({result:{...prior,message:step.kind==="service"?"目录步骤已超时。已保存的操作记录仍可查看。":
      (step.request as BrowserRequest).command.kind==="flight"?"等待原页面的飞行到达回执已超时，本轮未查询目录。":
      prior.message+"\n\n等待原页面绘制已超时。未确认的条目未计作已绘制。"}});
  }
  if(step.state==="cancelled"||step.state==="failed")return new TaskParked();
  signal.throwIfAborted();
  if(step.kind==="browser"){
    if(step.state!=="received")return new TaskParked();
    const receipt=readWorkspaceEffectReceipt(step.receipt?.payload);
    if(!receipt)return finish({error:"原页面回执不可用。",code:"operation_receipt_unavailable",result:retained});
    if(receipt.kind==="catalogue-presentation"){
      const prior=retainedResult(op,await operations.steps(operationId));
      return finish({result:{...prior,message:prior.message+"\n\n"+presentationMessage(receipt.presentation.items)}});
    }
    const flight=receipt.flight;
    if(!validFlightMapReceipt(flight)||flight.state!=="arrived")return finish({result:{...retained,message:
      flight.state==="superseded"?"飞行已被后续地图操作替代，本轮未查询目录。":
      "原页面未能确认飞行到达和地面范围，本轮未查询目录。"}});
    const {command}=step.request as BrowserRequest;
    const request:CatalogueRequest={flight,place:command.kind==="flight"?command.placeLabel:"",
      present:flightCatalogueIntent(body.query)?.present===true};
    const stepId=randomUUID();
    await operations.wait(operationId,{stepId,kind:"service",request,expiresAt:Date.now()+waitMs},
      {stepId,cancelledResult:retained,failedResult:retained},{wakeAt:Date.now()});
    return new TaskParked();
  }
  if(step.kind!=="service")return finish({error:"原工作台步骤类型无效。",code:"operation_step_invalid",result:retained});
  if(step.state==="waiting"){
    const dispatch=await operations.prepareDispatch(operationId,step.stepId);
    if(!dispatch){
      await operations.reschedule(operationId,step.stepId,Date.now());
      return new TaskParked();
    }
    const request=step.request as CatalogueRequest;
    // Coverage and catalogue are versioned read operations. The frozen scope in
    // the checkpoint and stable request ID keep retries on the same result batch.
    const result=await readFlightCatalogue(services,{...request,body,runId,retained,batchId:dispatch.requestId,scope:saved.scope,
      saveScope:scope=>services.tasks.saveStep?.(operationId,{...saved,scope,cancelledResult:retained,failedResult:retained})},
      signal,emit);
    if(result instanceof TaskParked)return result;
    signal.throwIfAborted();
    await operations.receipt({operationId,stepId:step.stepId,kind:"service",requestId:dispatch.requestId,
      receiptId:dispatch.requestId,payload:result},{requireLease:true});
    return new TaskParked();
  }
  const result=step.receipt?.payload;
  if(!result)return finish({error:"原目录结果不可用。",code:"operation_result_unavailable",result:retained});
  const response=result.result as DiscoveryResponse|undefined;
  const command=response&&workspaceEffectCommand(response,{runId,conversationId:op.conversationId,turnId:op.turnId});
  if(command?.kind!=="catalogue-presentation")return finish(result);
  const wait=browserWait(command,pageHash);
  await operations.transaction(async db=>{
    const next=await operations.waitInTransaction(db,operationId,wait,
      {stepId:wait.stepId,cancelledResult:response,failedResult:response});
    if(next)await projectEffect(db,op,next,true);
  });
  return new TaskParked();
}
