import {nativeWorkspaceReceiptRoutes} from "./ag-ui-workspace";
import {AgUiWorkspacePendingError} from "./postgres-ag-ui-workspace";
import {bindAgUiResume} from "./ag-ui-interrupt";
import {validateTurnStructure} from "./runtime-input";
import {authorizedFlashApi} from "./flash-api";
import type {Router,Response} from "express";
import {setTimeout as delay} from "node:timers/promises";
import type {TaskStore,Payload} from "./task-store";
import {TaskConflict} from "./task-store";
import type {PostgresChatMessages,DiscoveryChatAdmission} from "./postgres-chat-messages";
import type {ChatPreparation} from "./runtime-chat-channel";
import {TaskCancelled} from "./task-cancellation";
import {modelExecutionContext} from "./model-execution-context";
import {requestPerformance,type ExecutorTiming} from "./request-performance";
import {publicAnswerContext} from "./public-answer-stream";
import {workspaceDiscoveryReply} from "./ag-ui-persistence";
import {WorkspaceDiscoveryConflict,type WorkspaceDiscovery} from "./workspace-discovery-operations";
import {AgUiInputError,readAgUiInput} from "./ag-ui-input";
import {nativeAgUiPath} from "../src/domain/native-ag-ui";
import {bindCaseObservation,type CaseObservationBinding,type ResolveCaseObservation} from "./runtime-case-observation";
import {bindLayerObservation,type LayerObservationBinding,type ResolveLayerObservation} from "./runtime-layer-observation";
import {workspaceReply} from "./runtime-chat-channel";
import {hasExplicitTurnRange} from "../src/domain/research-range";
import {WorkspaceResearchConflict,type WorkspaceResearchStateStore} from "./workspace-research-state";
import {retainedWorkspaceEffectResult,workspaceEffectCommand} from "./postgres-workspace-effects";
import type {RuntimeTurnInput} from "./runtime-turn-handoff";
import type {DiscoveryResponse} from "../src/domain/types";
import type {runtimeMapOperations} from "./runtime-map-operation";

/** Native producer: standard frames are persisted directly by the original
 * acceptance/finish transactions, never reconstructed from NDJSON events. */
export async function agUiWorkbench(app:Router,tasks:TaskStore&{chat:PostgresChatMessages},prepare:(id:string,input:unknown,observation?:CaseObservationBinding,layerObservation?:LayerObservationBinding)=>Promise<ChatPreparation>,
 resolveObservation?:ResolveCaseObservation,resolveLayerObservation?:ResolveLayerObservation,workspaceResearch?:WorkspaceResearchStateStore,
 requireWorkspacePage=false,mapOperations?:Pick<ReturnType<typeof runtimeMapOperations>,"start">,
 workspaceDiscovery?:Pick<WorkspaceDiscovery,"admitInTransaction"|"readReference">){
 const {chat}=tasks;await chat.acquire();nativeWorkspaceReceiptRoutes(app,chat);let stopping=false;
 const active=new Map<string,{controller:AbortController;done:Promise<void>}>();
 function start(id:string,prepared:Exclude<ChatPreparation,{error:string}>,body:RuntimeTurnInput,pageHash:string|undefined){
  const controller=new AbortController(),signal=AbortSignal.any([controller.signal,AbortSignal.timeout(125000)]),timings:ExecutorTiming[]=[];
  let pending=Promise.resolve(),persistFailed=false,retained:Payload|undefined;
  const enqueue=(write:()=>Promise<unknown>)=>{pending=pending.then(async()=>{if(!persistFailed)await write();}).catch(()=>{persistFailed=true;controller.abort();});};
  const done=(async()=>{
   try{
    const outcome=await requestPerformance.run(timings,()=>modelExecutionContext.run({role:"foreground",taskId:id,tasks},()=>publicAnswerContext.run(authorizedFlashApi(body.config)?{onText:delta=>enqueue(async()=>{
     if(!await chat.appendAgUiText(id,delta))throw Error("公开正文未被原运行采纳。");
    })}:undefined,()=>{
     if(prepared.kind==="research")return Promise.resolve({kind:"research" as const,checkpoint:prepared.checkpoint});
     return prepared.run(id,signal,event=>enqueue(()=>chat.append(id,event)));
    })));
    await pending;signal.throwIfAborted();
    if(outcome.kind==="research")await chat.promote(id,"handoff" in outcome?outcome.handoff:undefined,outcome.checkpoint);
    else {
     retained=outcome.payload;
     const result=retained.result as DiscoveryResponse|undefined;
     const command=!retained.error&&workspaceEffectCommand(result,{runId:id,conversationId:body.conversationId,turnId:body.turnId});
     if(command&&result){
      if(pageHash){
       if(mapOperations)await mapOperations.start(id,body,pageHash,command,result);
       else await chat.waitForWorkspaceEffect(id,body,pageHash,command,result);
       return;
      }
      if(requireWorkspacePage){
       const original=retainedWorkspaceEffectResult(result);
       await chat.finish(id,"complete",{result:{...original,message:command.kind==="flight"?
        "飞行和目录查询须从具备当前页面凭据的工作台发起。未执行本轮操作。":
        original.message+"\n\n已保留目录结果。当前页面无法核对原窗口，未执行球面呈现。"}});
       return;
      }
     }
     await chat.finish(id,outcome.payload.error?"failed":"complete",workspaceReply(id,outcome.payload));
    }
   }catch{
    await pending;if(controller.signal.reason instanceof TaskCancelled)return;
    await chat.finish(id,"failed",{...retained,error:stopping?"服务中断了本轮运行。":signal.aborted?"本轮运行已超时或中断。":"本轮未形成经过核验的答复。",code:stopping?"chat_interrupted":persistFailed?"public_delivery_failed":"run_failed"});
   }
  })().catch(()=>console.error("OneEarth AG-UI could not persist the original run ending")).finally(()=>active.delete(id));
  active.set(id,{controller,done});
 }
 async function stream(id:string,res:Response){
  let cursor=0,closed=false,lastWrite=Date.now();const controller=new AbortController();
  const close=()=>{closed=true;controller.abort();};res.once("close",close);
  res.status(200).set({"Content-Type":"text/event-stream; charset=utf-8","Cache-Control":"no-store","X-Accel-Buffering":"no"});res.flushHeaders();
  try{while(!closed){
   const events=await chat.agUiEvents(id,cursor);
   for(const {seq,event} of events){
    if(closed)return;
    if(!res.write("data: "+JSON.stringify(event)+"\n\n")){
     await new Promise<void>(resolve=>{const done=()=>{res.off("drain",done);res.off("close",done);resolve();};res.once("drain",done);res.once("close",done);});
    }
    lastWrite=Date.now();cursor=seq;if(event.type==="RUN_FINISHED"||event.type==="RUN_ERROR"){res.end();return;}
   }
   if(!closed&&Date.now()-lastWrite>=10000){res.write(": keep-alive\n\n");lastWrite=Date.now();}
   if(!events.length&&!closed)await delay(40,undefined,{signal:controller.signal});
  }}catch{if(!closed)res.destroy();}finally{res.off("close",close);}
 }
 app.post(nativeAgUiPath,async(req,res)=>{
  if(!req.is("application/json")){res.status(415).json({error:"AG-UI 需要 application/json。"});return;}
  if(!req.accepts("text/event-stream")){res.status(406).json({error:"AG-UI 需要 text/event-stream。"});return;}
  if(stopping){res.status(503).json({error:"正在停止接收运行。"});return;}
  try{
   const decoded=readAgUiInput(req.body);
   const {id,fingerprint,resume}=decoded;
   const previous=await tasks.get(id);
   if(previous){
    const same=await chat.agUiFingerprint(id)===fingerprint;
    res.status(409).set("Location","/api/tasks/"+id).json({error:same?"该运行已受理，请只读原状态与归档。":"该运行编号已用于另一份提交。",code:same?"RUN_ALREADY_ACCEPTED":"RUN_ID_CONFLICT"});return;
   }
   const pendingWorkspaceToolCallIds=await chat.checkAgUiWorkspace(decoded.body.conversationId,decoded.body.previousTaskId,decoded.workspaceReplies);
   const body=await bindAgUiResume(tasks,decoded.body,resume);
   const agUiAdmission={threadId:body.conversationId,turnId:body.turnId,fingerprint,workspaceTool:decoded.workspaceTool,
    workspaceReplies:decoded.workspaceReplies,pendingWorkspaceToolCallIds,previousTaskId:decoded.body.previousTaskId,...(resume?{resume}:{})};
   const discovery=decoded.discovery;
   if(discovery){
    res.set("Cache-Control","no-store");
    if(!workspaceDiscovery){res.status(503).json({error:"会话发现暂时不可用。",code:"WORKSPACE_DISCOVERY_UNAVAILABLE"});return;}
    const issue=await validateTurnStructure(tasks,body);if(issue)throw new AgUiInputError(issue);
    let txAdmission:DiscoveryChatAdmission;
    if(discovery.kind==="action"){
     txAdmission={kind:"operation",admit:db=>workspaceDiscovery.admitInTransaction(
      db,body.conversationId,discovery.action,discovery.accessKey,{runId:id,turnId:body.turnId})};
    }else{
     const selected=await workspaceDiscovery.readReference(body.conversationId,discovery.reference);
     if(!selected){
      res.status(404).json({error:"找不到当前会话中选定的已保存资料批次。",code:"DISCOVERY_OPERATION_NOT_FOUND"});return;
     }
     txAdmission={kind:"reference",result:workspaceDiscoveryReply(discovery.reference.operationId,selected,true)};
    }
    const admitted=await chat.admit(id,body,4,{...agUiAdmission,workspaceTool:false},undefined,txAdmission);
    if(!admitted){res.status(429).set("Retry-After","2").json({error:"前台正在处理其他运行。"});return;}
    if(!admitted.started){res.status(409).set("Location","/api/tasks/"+id).json({error:"该运行已受理，请只读原状态与归档。",code:"RUN_ALREADY_ACCEPTED"});return;}
    await stream(id,res);return;
   }
   if((decoded.research||decoded.researchAction)&&!workspaceResearch){
    res.status(503).json({error:"会话研究范围暂时无法读取。",code:"WORKSPACE_STATE_UNAVAILABLE"});return;
   }
   const attachments=body.context?.attachedScope;
   const reference=decoded.research&&body.context&&
     (attachments===undefined||Array.isArray(attachments)&&attachments.every(item=>item&&typeof item==="object")&&!hasExplicitTurnRange(attachments))
     ?decoded.research:undefined;
   if(reference){
    const state=await workspaceResearch!.bind(body.conversationId,reference);
    const {scope}=state.range;
    body.context={...body.context,selection:scope.selection,gridSystem:scope.selection.grid.system,
      attachedScope:[...(attachments??[]),scope]};
    body.serverWorkspaceResearch=reference;
   }
   if(decoded.researchAction)body.serverWorkspaceResearchAction=decoded.researchAction;
   // Strictly validate the branch with an asynchronous source read before allowing it to start.
   if(body.context?.layerObservationRef!==undefined){
    const issue=await validateTurnStructure(tasks,body);if(issue)throw new AgUiInputError(issue);
   }
   const observation=resume?undefined:bindCaseObservation(body.context,resolveObservation);
   const layerObservation=resume?undefined:await bindLayerObservation(body.context,resolveLayerObservation);
   const prepared=resume?.status==="cancelled"?{kind:"research" as const}:await prepare(id,body,observation,layerObservation);
   if(resume?.status==="cancelled"){const issue=await validateTurnStructure(tasks,body);if(issue)throw new AgUiInputError(issue);}

   if("error" in prepared){res.status(resume?409:400).json({error:prepared.error});return;}
   if(resume?.operation&&resume.status==="resolved"&&(prepared.kind!=="research"||prepared.checkpoint!==undefined)){
    res.status(409).json({error:"原发现操作无法按保存的条件续行。",code:"OPERATION_RESUME_UNAVAILABLE"});return;
   }
   const admitted=await chat.admit(id,{...body,...(observation?{serverCaseObservation:observation}:{}),
    ...(layerObservation?{serverLayerObservation:layerObservation}:{})},4,agUiAdmission,reference);
   if(!admitted){res.status(429).set("Retry-After","2").json({error:"前台正在处理其他运行。"});return;}
   if(!admitted.started){res.status(409).set("Location","/api/tasks/"+id).json({error:"该运行已受理，请只读原状态与归档。",code:"RUN_ALREADY_ACCEPTED"});return;}
   if(!resume?.operation){
    if(resume?.status==="cancelled")await tasks.finish(id,"cancelled",{error:"研究者明确放弃原追问。",code:"cancelled"});
    else start(id,prepared,body,decoded.pageHash);
   }
   await stream(id,res);
  }catch(error){
   if(res.headersSent){res.destroy();return;}
   if(error instanceof AgUiWorkspacePendingError){res.status(409).json({error:error.message,code:"WORKSPACE_TOOL_RESULTS_REQUIRED",pendingToolCallIds:error.pendingToolCallIds});return;}
   if(error instanceof WorkspaceResearchConflict){res.status(409).json({error:error.message,code:error.code,state:error.state});return;}
   if(error instanceof WorkspaceDiscoveryConflict){res.status(error.status).json({error:error.message,code:error.code});return;}
   if(error instanceof AgUiInputError){res.status(error.status).json({error:error.message});return;}
   if(error instanceof TaskConflict){res.status(409).json({error:error.message});return;}
   res.status(503).json({error:"运行未能持久受理。"});
  }
 });
 return {cancel(id:string){active.get(id.toLowerCase())?.controller.abort(new TaskCancelled());},async close(){stopping=true;for(const row of active.values())row.controller.abort();await Promise.allSettled([...active.values()].map(row=>row.done));}};
}
