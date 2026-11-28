import {randomUUID} from "node:crypto";
import type {PoolClient} from "pg";
import {validClarificationPrompt} from "../src/domain/clarification";
import type {OneEarthOperationReply} from "../src/domain/native-ag-ui";
import type {DiscoveryResponse} from "../src/domain/types";
import type {AgUiResume} from "./ag-ui-interrupt";
import type {DiscoveryBinding} from "./discovery-a2a-client";
import {runtimeOperationTransactions as operations} from "./runtime-operations";
import type {RuntimeTurnInput} from "./runtime-turn-handoff";
import {TaskConflict,type Payload} from "./task-store";

const discoveryOperationKind="discovery-continuation";
type DiscoveryWait=DiscoveryBinding&{lastSeq:number;state:"TASK_STATE_INPUT_REQUIRED"};

function readDiscoveryWait(value:unknown):DiscoveryWait|undefined{
 if(!value||typeof value!=="object")return;
 const binding=value as Partial<DiscoveryWait>;
 if(binding.transport!=="a2a"||binding.state!=="TASK_STATE_INPUT_REQUIRED"||
   typeof binding.discoveryId!=="string"||!binding.discoveryId||binding.discoveryId.length>1200||
   typeof binding.messageId!=="string"||!binding.messageId||binding.messageId.length>1200||
   binding.contextId!==undefined&&(typeof binding.contextId!=="string"||!binding.contextId||binding.contextId.length>1200)||
   typeof binding.lastSeq!=="number"||!Number.isSafeInteger(binding.lastSeq)||binding.lastSeq<0)return;
 return {transport:"a2a",state:"TASK_STATE_INPUT_REQUIRED",discoveryId:binding.discoveryId,messageId:binding.messageId,
   ...(binding.contextId!==undefined?{contextId:binding.contextId}:{}),lastSeq:binding.lastSeq};
}

async function latestDiscoveryWait(db:PoolClient,runId:string){
 const {rows}=await db.query<{binding:unknown}>(`
  SELECT binding FROM (
   SELECT DISTINCT ON (binding->>'messageId') binding FROM (
    SELECT seq,payload->'discoveryBinding' AS binding FROM runtime_events WHERE id=$1 AND payload ? 'discoveryBinding'
    UNION ALL
    SELECT seq,payload->'discoveryBinding' AS binding FROM runtime_chat_events WHERE id=$1 AND payload ? 'discoveryBinding'
   ) events ORDER BY binding->>'messageId',seq DESC
  ) latest WHERE binding->>'state'='TASK_STATE_INPUT_REQUIRED' LIMIT 2`,[runId]);
 return rows.length===1?readDiscoveryWait(rows[0].binding):undefined;
}

async function inheritedDiscoveryWait(db:PoolClient,runId:string,operationId:string){
 const {rows:[parent]}=await db.query<{operation_step_id:string}>(
   "SELECT operation_step_id FROM runtime_agui_interrupts WHERE consumed_by=$1 AND operation_id=$2",[runId,operationId]);
 if(!parent)return;
 const previous=await operations.readStepInTransaction(db,operationId,parent.operation_step_id);
 if(previous?.kind==="human"&&previous.state==="received")return readDiscoveryWait(previous.request.binding);
}

/** End the existing native run and enroll a real upstream wait in the same
 * transaction. A second card gets a fresh step under the same operation. */
export async function projectDiscoveryOperationEnding(db:PoolClient,runId:string,threadId:string,turnId:string,
  status:"complete"|"failed"|"cancelled",payload:Payload):Promise<OneEarthOperationReply|undefined>{
 const operation=await operations.readForRunInTransaction(db,runId);
 if(operation&&operation.kind!==discoveryOperationKind)return;
 const result=payload.result as (DiscoveryResponse&{runtimeQuestionCheck?:boolean})|undefined;
 const researchPrompt=validClarificationPrompt(result?.clarificationPrompt)&&result.clarificationPrompt.kind==="research"&&
  result.discoveryClarification===true&&!result.questionCheck;
 const discoveryQuestion=!!result?.questionCheck&&result.runtimeQuestionCheck!==true;
 if(status==="complete"&&(researchPrompt||discoveryQuestion)){
  const prior=operation&&await inheritedDiscoveryWait(db,runId,operation.operationId);
  const persisted=await latestDiscoveryWait(db,runId);
  const binding=operation&&prior&&payload.clarificationContinuation===true&&!persisted?prior:persisted;
  if(binding&&(!discoveryQuestion||binding.messageId===runId)&&(!operation||prior&&sameDiscoveryTask(prior,binding)&&
       (payload.clarificationContinuation===true||binding.lastSeq>prior.lastSeq))){
   const operationId=operation?.operationId??randomUUID(),stepId=randomUUID();
   const checkpoint={kind:discoveryOperationKind,phase:"awaiting-human",runId,stepId};
   const wait={stepId,kind:"human" as const,request:{runId,threadId,turnId,binding}};
   if(operation){
    if(!await operations.waitInTransaction(db,operationId,wait,checkpoint,{runId}))
      throw new TaskConflict("无法登记原发现委托的下一追问。");
   }else await operations.createInTransaction(db,{operationId,runId,conversationId:threadId,turnId,kind:discoveryOperationKind,
    input:{originalRunId:runId,discoveryId:binding.discoveryId},checkpoint,wait});
   return {operationId,stepId};
  }
 }
 if(operation&&operation.activeRunId===runId&&operation.status!=="complete"&&operation.status!=="failed"&&operation.status!=="cancelled"){
  if(!await operations.completeFromRunInTransaction(db,operation.operationId,runId,{runId},status))
   throw new TaskConflict("原发现操作无法保存本轮终态。");
 }
}

function sameDiscoveryTask(first:DiscoveryWait,second:DiscoveryWait){
 return first.discoveryId===second.discoveryId&&first.contextId===second.contextId;
}

/** Claim the human step and advance the operation to the admitted child run
 * without waking a second executor. The caller queues the native child here. */
export async function receiveDiscoveryOperationReply(db:PoolClient,id:string,body:RuntimeTurnInput,resume:AgUiResume){
 if(!resume.operation)return;
 const {operationId,stepId}=resume.operation;
 const step=await operations.readStepInTransaction(db,operationId,stepId,true);
 const operation=await operations.readForRunInTransaction(db,resume.interruptId);
 const binding=readDiscoveryWait(step?.request.binding);
 if(operation?.kind!==discoveryOperationKind||operation.operationId!==operationId||
  operation.activeRunId!==resume.interruptId||operation.currentStepId!==stepId||operation.conversationId!==body.conversationId||
  step?.kind!=="human"||step.state!=="waiting"||!binding||step.request.runId!==resume.interruptId||
  step.request.threadId!==body.conversationId||step.request.turnId!==operation.activeTurnId)
   throw new TaskConflict("该发现操作不再等待这份答复。");

 const answer=body.clarificationAnswer;
 const decision=body.questionDecision;
 if(resume.status==="resolved"&&!(answer||decision))throw new TaskConflict("原问题缺少已校验的答复。");
 const receipt=await operations.receiptInTransaction(db,{
  operationId,stepId,kind:"human",receiptId:id,
  payload:{runId:id,status:resume.status,...(answer?{answer}:{}),...(decision?{decision}:{})},
  checkpoint:{kind:discoveryOperationKind,phase:"continuing",runId:id,previousRunId:resume.interruptId,stepId},
 },{wake:false,resumeRun:{runId:id,conversationId:body.conversationId,turnId:body.turnId}});
 if(receipt.status!=="accepted")throw new TaskConflict("该发现操作已有答复或不再等待答复。");
}
