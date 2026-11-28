import {createHash} from "node:crypto";
import type {PoolClient} from "pg";
import {toolsOff} from "../src/domain/deepseek-tools";
import {paperId} from "../src/domain/paper-record";
import {scopedQuestionContext} from "../src/domain/question-scope";
import {readResearchRangeScope} from "../src/domain/research-range";
import {readWorkspaceDiscoveryResult,workspaceDiscoveryQuery,type WorkspaceDiscoveryResult} from "../src/domain/workspace-discovery";
import type {DataSearchResult} from "./data-search";
import {discoverThroughA2A,DiscoveryA2AError,type DiscoveryBinding,type DiscoveryBusinessInput} from "./discovery-a2a-client";
import {publicPage} from "./fetch-pages";
import {modelSafeText,modelUrlLocator} from "./model-context-safety";
import type {RuntimeOperation,RuntimeOperationsStore} from "./runtime-operations";
import {workspaceDiscoveryStepKind,type WorkspaceDiscoveryStepState} from "./runtime-step";
import type {RuntimeServices} from "./runtime-turn";
import {TaskParked} from "./task-store";
import {readWorkspaceResearchCoverage} from "./workspace-research-state";

const pollMs=1000, waitMs=5*60*1000;
const completeState="TASK_STATE_COMPLETED";
const inputStates=new Set(["TASK_STATE_INPUT_REQUIRED","TASK_STATE_AUTH_REQUIRED"]);
const interruptedLimitation="发现服务等待补充或授权。此操作保存了已经取得的资料，尚未完成发现。";
const partialLimitation="发现未覆盖全部渠道，以下是本轮已经取得的资料。";
const failedLimitation="发现服务未能完成本次操作。";
const scopeLimitation="原研究范围的覆盖修订无法核实，未向发现服务委托。";
const sizeLimitation="发现材料超出本次操作的恢复记录上限，已保留可展示的部分。";
const timeoutLimitation="在原操作等待期限内未取得完整发现结果。";

type DiscoveryCheckpoint=WorkspaceDiscoveryStepState & {
  phase:"discover";
  stepId:string;
  deadline:number;
  validatedResult?:WorkspaceDiscoveryResult;
};
export type WorkspaceDiscoveryProjection=(db:PoolClient,runId:string,status:"complete"|"failed",result?:WorkspaceDiscoveryResult)=>Promise<boolean>;

type Item=WorkspaceDiscoveryResult["items"][number];
function text(value:unknown,limit:number){
  return typeof value==="string"?modelSafeText(value).replace(/[\x00-\x1f\x7f]+/gu," ").trim().slice(0,limit):"";
}
function resultItem(kind:Item["kind"],id:unknown,title:unknown,source:unknown,url:unknown):Item|undefined{
  if(typeof id!=="string"||!id.trim()||id.length>240||id!==modelSafeText(id)||/[\x00-\x1f\x7f]/u.test(id))return;
  const titleText=text(title,240),sourceText=text(source,120);
  if(!titleText||!sourceText)return;
  const locator=typeof url==="string"&&url===modelUrlLocator(url)?publicPage(url):undefined;
  return {kind,id,title:titleText,source:sourceText,...(locator&&locator.length<=1200?{url:locator}:{})};
}

function resultFor(operation:RuntimeOperation,query:string,material?:DataSearchResult,limited?:string):WorkspaceDiscoveryResult {
  const items=new Map<string,Item>();
  let truncated=false;
  function add(item:Item|undefined){
    if(!item)return;
    const identity=item.kind+":"+item.id;
    if(items.has(identity))return;
    if(items.size>=24){truncated=true;return;}
    items.set(identity,item);
  }
  for(const paper of material?.papers??[]){
    if(typeof paper?.id!=="string"||!paperId(paper.id))continue;
    const metadata=paper.assertionCatalogKind==="metadata-only";
    add(resultItem(metadata?"dataset":"paper",paper.id,metadata?paper.need?.product:paper.paperTitle,
      paper.need?.source,metadata?paper.need?.url:paper.need?.paperSource?.url));
  }
  for(const dataset of material?.haina??[]){
    if(dataset?.kind==="dataset")add(resultItem("dataset",dataset.id,dataset.title,dataset.source,dataset.url));
  }
  const requested=material?.sourceStatus.filter(channel=>channel?.status!=="not_requested")??[];
  const complete=!limited&&!truncated&&!!requested.length&&requested.every(channel=>channel?.status==="done")&&!material?.issues.length&&
    !material?.clarification&&!material?.questionCheck&&!material?.searches.some(search=>!!search?.hits?.length);
  const result=readWorkspaceDiscoveryResult({batchId:operation.operationId,query,items:[...items.values()],complete,
    ...(!complete?{limitation:limited??(truncated?"本次记录保留了前 24 项资料。":partialLimitation)}:{})});
  if(!result)throw Error("发现资料未通过公共结果校验。");
  return result;
}

/** Under the same operation lease, persist the A2A envelope before submit, body/watermark before polling, and
 * commit its final service receipt with the operation result and any real Chat projection. */
export async function runWorkspaceDiscoveryOperation({tasks,coverage}:Pick<RuntimeServices,"tasks"|"coverage">,
  operations:RuntimeOperationsStore,operation:RuntimeOperation,signal:AbortSignal,project?:WorkspaceDiscoveryProjection):Promise<TaskParked>{
  const operationId=operation.operationId;
  const checkpoint=operation.checkpoint;
  const stepId=typeof checkpoint?.stepId==="string"?checkpoint.stepId:undefined;
  const query=workspaceDiscoveryQuery(operation.input.query);
  const finish=(status:"complete"|"failed",result?:WorkspaceDiscoveryResult,dispatch?:{stepId:string;requestId:string;owner?:string},
    binding?:DiscoveryBinding)=>operations.transaction(async db=>{
    signal.throwIfAborted();
    if(dispatch){
      const receipt=await operations.receiptInTransaction(db,{operationId,stepId:dispatch.stepId,kind:"service",
        ...(dispatch.owner!==undefined?{owner:dispatch.owner}:{}),requestId:dispatch.requestId,receiptId:dispatch.requestId,
        payload:{...(binding?{binding}:{}),...(result?{batchId:result.batchId}:{})}}, {requireLease:true});
      if(receipt.status!=="accepted"&&receipt.status!=="late")return;
      if(receipt.status==="late"){
        status="failed";
        if(result)result={...result,complete:false,limitation:timeoutLimitation};
      }
    }
    await operations.finishInTransaction(db,operationId,status,result?{result}:undefined,async(tx,final)=>{
      if(final.activeRunId&&!(await project?.(tx,final.activeRunId,status,result)))throw Error("原发现答复未能归档。");
    });
  });
  let deadline=Date.now()+waitMs;
  const schedule=()=>stepId?operations.reschedule(operationId,stepId,Math.min(Date.now()+pollMs,deadline)):Promise.resolve(false);
  const park=async():Promise<never>=>{
    signal.throwIfAborted();
    await schedule();
    throw new TaskParked();
  };
  try{
    const scope=operation.input.scope===undefined?undefined:readResearchRangeScope(operation.input.scope);
    if(!query||operation.input.scope!==undefined&&!scope||!stepId||checkpoint?.phase!=="discover"||operation.currentStepId!==stepId){
      await finish("failed",query?resultFor(operation,query,undefined,failedLimitation):undefined);
      return new TaskParked();
    }
    const step=await operations.readStep(operationId,stepId);
    if(step?.kind!=="service"||step.state!=="waiting"){
      await finish("failed",resultFor(operation,query,undefined,failedLimitation));
      return new TaskParked();
    }
    const prior=checkpoint.kind===workspaceDiscoveryStepKind?checkpoint as DiscoveryCheckpoint:undefined;
    deadline=prior?.deadline??step.expiresAt??deadline;
    if(deadline<=Date.now()){
      const saved=readWorkspaceDiscoveryResult(prior?.validatedResult);
      await finish("failed",saved?{...saved,complete:false,limitation:timeoutLimitation}:resultFor(operation,query,undefined,timeoutLimitation));
      return new TaskParked();
    }
    const dispatch=await operations.prepareDispatch(operationId,stepId);
    if(!dispatch)return new TaskParked();
    // Discovery uses the selected cells and filters for planning. Only the coverage client uses the
    // opaque handle, so a same-publication rebind verifies authority without changing the frozen A2A input.
    const {filters,selection,caseId,citation,attachedScope}=scopedQuestionContext(scope?[scope]:[],null);
    const input:DiscoveryBusinessInput={query:modelSafeText(query),history:[],references:[],currentDatasets:[],deepseekTools:toolsOff,
      scope:{filters,selection,caseId,citation,attachedScope}};
    const inputHash=createHash("sha256").update(JSON.stringify(input)).digest("hex");
    if(prior&&(prior.delegation?.messageId!==dispatch.requestId||prior.delegation.inputHash!==inputHash)){
      await finish("failed",resultFor(operation,query,undefined,failedLimitation));
      return new TaskParked();
    }
    const saved:DiscoveryCheckpoint=prior??{kind:workspaceDiscoveryStepKind,phase:"discover",stepId,deadline,
      delegation:{operation:"discover",messageId:dispatch.requestId,inputHash,events:[]}};
    const entry=saved.delegation;
    let lastAttempts=entry.submissionAttempts??0;
    let tooLarge=false;
    const persist=async()=>{
      signal.throwIfAborted();
      if((entry.submissionAttempts??0)>lastAttempts){entry.submittedAt=Date.now();lastAttempts=entry.submissionAttempts!;}
      if(Buffer.byteLength(JSON.stringify(saved))>8*1024*1024){tooLarge=true;throw Error(sizeLimitation);}
      if(!await tasks.saveStep?.(operationId,saved))throw Error("原发现操作已结束或失去执行所有权。");
    };
    if(!prior){
      if(scope&&(await readWorkspaceResearchCoverage(scope,coverage,signal,true)).status!=="ready"){
        await finish("failed",resultFor(operation,query,undefined,scopeLimitation));
        return new TaskParked();
      }
      await persist();
    }
    let material:DataSearchResult;
    try{
      material=await discoverThroughA2A(dispatch.requestId,input,signal,()=>{}, {
        durable:entry,persist,park,authorizeReplay:async()=>{await persist();return true;},
        onAccepted:async binding=>{entry.binding=binding;await persist();},
        onCheckpoint:async binding=>{entry.binding=binding;await persist();},
        onEvent:async event=>{
          if(event.seq!==undefined)entry.lastSeq=Math.max(entry.lastSeq??0,event.seq);
          if(event.result){
            entry.result=event.result;
            saved.validatedResult=resultFor(operation,query,event.result,partialLimitation);
          }
          await persist();
        },
      });
    }catch(error){
      if(!tooLarge&&(!(error instanceof DiscoveryA2AError)||error.reason==="RUNTIME_PERSISTENCE_FAILED"))throw error;
      const savedResult=readWorkspaceDiscoveryResult(saved.validatedResult);
      const limitation=tooLarge?sizeLimitation:failedLimitation;
      await finish("failed",savedResult?{...savedResult,complete:false,limitation}:resultFor(operation,query,undefined,limitation));
      return new TaskParked();
    }
    const binding=entry.binding;
    const wantsInput=!!binding&&inputStates.has(binding.state);
    const status=binding?.state===completeState||wantsInput?"complete":"failed";
    const result=resultFor(operation,query,material,wantsInput?interruptedLimitation:status==="failed"?failedLimitation:undefined);
    await finish(status,result,{stepId,requestId:dispatch.requestId,owner:step.owner},binding);
    return new TaskParked();
  }catch(error){
    if(error instanceof TaskParked)return error;
    signal.throwIfAborted();
    // A failed DB write or transient transport interruption leaves the same work ready for the next lease.
    // Recovery reads the last durable snapshot, including the original message ID and any receipt watermark.
    await schedule().catch(()=>{});
    return new TaskParked();
  }
}
