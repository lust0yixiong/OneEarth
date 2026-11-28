import {HttpAgent, type AgentSubscriber} from "@ag-ui/client";
import type {Message as AgUiMessage,ResumeEntry,ToolCall} from "@ag-ui/core";
import {ChatResponseError,type ChatPhase} from "./chat-response";
import {readResearchProgress,readResearchProgressState,type ResearchProgress} from "./native-agui-research-progress";
import {nativeAgUiStepLabel,type NativeAgUiStep} from "./native-agui-progress";
import type {RuntimePhase} from "./runtime-status";
import {nativeAgUiPath, nativeAgUiProtocolVersion, oneEarthAgUiVersion, readOneEarthAgUiInterruptRecord, readOneEarthAgUiResult,
  type OneEarthAgUiForwardedProps, type OneEarthAgUiInterruptRecord} from "./native-ag-ui";
import {loadResearchRecord,readRecordWorkspaceReceipt,researchRecordId,type ResearchRecord} from "./runtime-client";
import {matchesWorkspaceToolCall,nativeWorkspaceTool,nativeWorkspaceToolName,readPendingWorkspaceTools,readWorkspaceToolRecord,
  unverifiedWorkspaceToolResult,workspaceToolCall,workspaceToolCallId,workspaceToolCallsPath,workspaceToolResult} from "./native-workspace-tool";
import {workspaceObservationTarget} from "./workspace-published-layer";
import type {WorkspaceReceipt} from "./turn-context";
import {matchesTaskIdentity, readTaskLifecycle, type TaskLifecycle} from "./task-lifecycle-client";
import type {DiscoveryResponse,ProviderReasoningSnapshot} from "./types";
import {nativeSummaryReader} from "./native-summary-client";
import {readWorkspaceActionEffect,workspacePageHeader,type WorkspaceActionEffect} from "./workspace-action-effect";

function boundWorkspaceActionEffect(value:unknown,run:ChatRun) {
  const effect=readWorkspaceActionEffect(value,run.runId);
  return effect?.conversationId===run.threadId && effect.turnId===run.turnId ? effect : undefined;
}

function effectFromSnapshot(snapshot:unknown,run:ChatRun) {
  return boundWorkspaceActionEffect((snapshot as {oneearth?:{workspaceEffect?:unknown}}|undefined)?.oneearth?.workspaceEffect,run);
}


export type ChatRun = {threadId: string; runId: string; turnId: string};
type CompletedChat = {response: DiscoveryResponse; interrupt?: OneEarthAgUiInterruptRecord; record?: ResearchRecord; workspaceCall?:ToolCall};
type ResumeConflict = {conflict: true; locationId?: string};
type WorkspaceConflict = {workspaceConflict:true; pendingRuns:string[]};
type PublicStepProgress = {phase:ChatPhase;runtimePhase:RuntimePhase};
const publicStepProgress:Record<NativeAgUiStep,PublicStepProgress> = {
  foreground:{phase:"foreground",runtimePhase:{phase:"executing"}},
  "research-queued":{phase:"research",runtimePhase:{phase:"queued"}},
  "research-executing":{phase:"research",runtimePhase:{phase:"executing"}},
  "discovery-wait":{phase:"research",runtimePhase:{phase:"waiting-discovery",operation:"discover"}},
  "source-read-wait":{phase:"research",runtimePhase:{phase:"waiting-discovery",operation:"read"}},
  "research-resuming":{phase:"research",runtimePhase:{phase:"resuming"}},
  "workspace-wait":{phase:"research",runtimePhase:{phase:"waiting-workspace"}},
};
type ChatProgress = {
  onAccepted: () => void;
  onDraft: (text: string) => void;
  onSummary: (snapshot: ProviderReasoningSnapshot) => void;
  onResearchProgress: (progress:ResearchProgress) => void;
  onWorkspaceEffect?: (effect:WorkspaceActionEffect) => void;
  onStep: (step:PublicStepProgress & {stage:string}) => void;
  onLifecycle: (lifecycle: TaskLifecycle) => void;
};

const refusedStatuses = new Set([400, 401, 403, 404, 413, 415, 422, 429]);
const taskStates = new Set(["queued", "running", "complete", "failed", "cancelled"]);

export async function submitNativeChat<T extends object>(
  {threadId, runId, turnId}: ChatRun, question: string, submission: T,
  abortController: AbortController, progress: ChatProgress, resume?: ResumeEntry, toolMessages:AgUiMessage[]=[], workspacePageToken?:string,
): Promise<CompletedChat | ResumeConflict | WorkspaceConflict | undefined> {
  const forwardedProps: OneEarthAgUiForwardedProps<T> = {oneearth: {version: oneEarthAgUiVersion,
    submission:workspacePageToken ? {...submission,workspacePage:{token:workspacePageToken}} : submission}};
  const url = new URL(nativeAgUiPath, location.origin).href;
  let posted = false;
  let httpStatus: number | undefined;
  let conflictLocation: string | undefined;
  let workspaceConflict: WorkspaceConflict | undefined;
  let researchConflict: ChatResponseError | undefined;
  let startSeen = false;
  let started = false;
  let sealed = false;
  let openStep: string | undefined;
  let assistant = false;
  let textEnded = false;
  let draft = "";
  let tool: {id:string;args:string;ended:boolean}|undefined;
  let invalidTool=false;
  let result: CompletedChat | undefined;
  let failure: ChatResponseError | undefined;
  const agent = new HttpAgent({
    url, threadId, initialMessages: [...toolMessages,{id: turnId, role: "user", content: question}],
    fetch: async (target, options) => {
      if (posted || target !== url || options?.method !== "POST")
        throw Error("本轮只允许一次原生 Chat 提交。");
      posted = true;
      const response = await fetch(target, {...options, redirect: "error", cache: "no-store"});
      httpStatus = response.status;
      if(httpStatus===409 || httpStatus===503){
        const detail=await response.clone().json().catch(()=>undefined);
        if(detail?.code==="WORKSPACE_TOOL_RESULTS_REQUIRED"){
          const pendingRuns=(Array.isArray(detail.pendingToolCallIds) ? detail.pendingToolCallIds.slice(0,64) : [])
            .flatMap((id:unknown)=>{
              if(typeof id!=="string")return [];
              const run=id.slice("workspace:".length);
              return researchRecordId.test(run) && id===workspaceToolCallId(run) ? [run] : [];
            });
          workspaceConflict={workspaceConflict:true,pendingRuns};
        }else if(detail?.code==="WORKSPACE_REVISION_CONFLICT" || detail?.code==="WORKSPACE_STATE_UNAVAILABLE"){
          researchConflict=new ChatResponseError(
            detail.code==="WORKSPACE_REVISION_CONFLICT"
              ? "会话研究范围已变化，请核对后重新提交。" : "暂时无法核对会话研究范围，请重新提交。",
            detail.code,
          );
        }else if(resume && httpStatus===409){
          const match=/^\/api\/tasks\/([^/?#]+)$/u.exec(response.headers.get("Location")??"");
          if(match && researchRecordId.test(match[1])) conflictLocation=match[1];
        }
      }
      return response;
    },
  });
  const readSummary=nativeSummaryReader(runId);
  const subscriber: AgentSubscriber = {
    // Read the whole event sequence so an intervening raw or foreign event breaks a partial group.
    onEvent: ({event})=>{
      if(!started || sealed || abortController.signal.aborted)return;
      const summary=readSummary(event);
      if(summary)progress.onSummary(summary);
    },
    onRunStartedEvent: ({event}) => {
      // OneEarth binds this HTTP response to a single run.
      if(startSeen){
        started=false;
        result=undefined;
        return;
      }
      startSeen=true;
      started = event.threadId === threadId && event.runId === runId && event.protocolVersion === nativeAgUiProtocolVersion;
      if (started) {
        progress.onAccepted();
        progress.onLifecycle({runtimePhase: {phase: "executing"}});
      }
    },
    onStateSnapshotEvent: ({event})=>{
      if(!started || sealed || abortController.signal.aborted ||
        ("subagentRunId" in event && event.subagentRunId!==undefined))return;
      const activity=readResearchProgressState(event.snapshot,runId);
      if(activity)progress.onResearchProgress(activity);
      const effect=effectFromSnapshot(event.snapshot,{threadId,runId,turnId});
      if(effect)progress.onWorkspaceEffect?.(effect);
    },
    onStepStartedEvent: ({event}) => {
      if(!started || sealed || openStep)return;
      const stage=nativeAgUiStepLabel(event.stepName);
      if(!stage)return;
      openStep=event.stepName;
      progress.onStep({...publicStepProgress[event.stepName as NativeAgUiStep],stage});
    },
    onStepFinishedEvent: ({event})=>{
      if(started && !sealed && event.stepName===openStep)openStep=undefined;
    },
    onTextMessageStartEvent: ({event}) => {
      if (started && !sealed && event.messageId === runId && event.role === "assistant") {
        assistant = true;
        textEnded = false;
      }
    },
    onTextMessageContentEvent: ({event}) => {
      if (!started || sealed || !assistant || event.messageId !== runId) return;
      draft += event.delta;
      if (draft.length <= 8000) progress.onDraft(draft);
    },
    onTextMessageEndEvent: ({event}) => {
      if (started && !sealed && assistant && event.messageId === runId) textEnded = true;
    },
    onToolCallStartEvent: ({event})=>{
      if(sealed)return;
      if(!started || !assistant || tool || event.parentMessageId!==runId ||
        event.toolCallId!==workspaceToolCallId(runId) || event.toolCallName!==nativeWorkspaceToolName){
        invalidTool=true;
        return;
      }
      tool={id:event.toolCallId,args:"",ended:false};
    },
    onToolCallArgsEvent: ({event})=>{
      if(sealed)return;
      if(!tool || tool.ended || tool.id!==event.toolCallId || tool.args.length+event.delta.length>32768){
        invalidTool=true;
        return;
      }
      tool.args+=event.delta;
    },
    onToolCallEndEvent: ({event})=>{
      if(sealed)return;
      if(!tool || tool.ended || tool.id!==event.toolCallId){
        invalidTool=true;
        return;
      }
      tool.ended=true;
    },
    onToolCallResultEvent: ()=>{
      // This tool has no browser result on the original response stream.
      if(!sealed)invalidTool=true;
    },
    onRunFinishedEvent: terminal => {
      if (!started || sealed || terminal.event.threadId !== threadId || terminal.event.runId !== runId) return;
      sealed=true;
      if (terminal.outcome === "cancelled") failure = new ChatResponseError("本地任务已取消。", "cancelled");
      if (terminal.outcome === "interrupt") {
        const [item]=terminal.interrupts;
        const response=readOneEarthAgUiResult(terminal.event.result,runId);
        if(!response || !item || terminal.interrupts.length!==1)return;
        const operation=(item as {metadata?:{oneearth?:{operation?:unknown}}}).metadata?.oneearth?.operation;
        const identity={id:item.id,status:"pending",...(operation===undefined ? {} : {operation})};
        if(item.reason==="oneearth.question-check" && item.message===response.message && !response.clarificationPrompt){
          const interrupt=readOneEarthAgUiInterruptRecord({...identity,kind:"question-check",questionCheck:response.questionCheck},runId);
          if(interrupt?.kind==="question-check" && interrupt.questionCheck.originalQuestion===question)
            result={response,interrupt};
        }else if(item.reason==="oneearth.clarification" && !response.questionCheck && response.clarification===true){
          const interrupt=readOneEarthAgUiInterruptRecord({...identity,prompt:response.clarificationPrompt},runId);
          if(interrupt && interrupt.kind!=="question-check" && item.message===interrupt.prompt.question)
            result={response,interrupt};
        }
        return;
      }
      if (terminal.outcome !== "success") return;
      const response = readOneEarthAgUiResult(terminal.result, runId);
      if(!textEnded || !response || response.message!==draft)return;
      const outcome=terminal.event.outcome;
      const offered=outcome?.type==="success" ? outcome.pendingToolCallIds : undefined;
      const expected=workspaceToolCall(runId,response);
      const actual:ToolCall|undefined=tool?.ended
        ? {id:tool.id,type:"function",function:{name:nativeWorkspaceToolName,arguments:tool.args}} : undefined;
      const workspaceCall=!invalidTool && offered?.length===1 && offered[0]===expected?.id &&
        actual && expected && matchesWorkspaceToolCall(actual,expected) ? expected : undefined;
      result={response,workspaceCall};
    },
    onRunErrorEvent: ({event}) => {
      if(!started)return;
      // An attributed late error invalidates the provisional result before it reaches the store.
      sealed=true;
      result=undefined;
      failure=new ChatResponseError(event.message,event.code);
    },
  };
  try {
    await agent.runAgent({runId, forwardedProps, abortController, tools:[nativeWorkspaceTool], ...(resume ? {resume:[resume]} : {})}, subscriber);
  } catch {
    // A transport or verifier failure can still leave a durable run to recover.
    result = undefined;
  }
  abortController.signal.throwIfAborted();
  if (failure) throw failure;
  if (result) return result;
  if (workspaceConflict) return workspaceConflict;
  if (researchConflict) throw researchConflict;
  if (resume && httpStatus===409) return {conflict:true,locationId:conflictLocation};
  if (httpStatus !== undefined && refusedStatuses.has(httpStatus))
    throw new ChatResponseError("运行时未受理本轮请求。", "submission_rejected");
}

function waitForTaskRead(delay: number, signal: AbortSignal) {
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, delay);
    signal.addEventListener("abort", abort, {once: true});
  });
}

const identityOf = ({threadId,runId,turnId}:ChatRun)=>({id:runId,conversationId:threadId,turnId});

async function readNativeTask(runId:string,signal:AbortSignal,workspacePageToken?:string) {
  if(!researchRecordId.test(runId))return;
  const response=await fetch("/api/tasks/"+runId,{signal:AbortSignal.any([signal,AbortSignal.timeout(5000)]),
    cache:"no-store",redirect:"error",...(workspacePageToken?{headers:{[workspacePageHeader]:workspacePageToken}}:{})}).catch(()=>undefined);
  if(!response?.ok)return;
  return response.json().catch(()=>undefined);
}

async function readNativeArchive(run:ChatRun,signal:AbortSignal):Promise<CompletedChat|undefined> {
  const record=await loadResearchRecord(run.runId,signal).catch(()=>undefined);
  signal.throwIfAborted();
  if(!record)return;
  if(!matchesTaskIdentity(record,identityOf(run)))throw Error("归档与原问题的会话或轮次不匹配。");
  const interrupt=readOneEarthAgUiInterruptRecord(record.interrupt,run.runId);
  if((record.interrupt!==undefined && !interrupt) ||
    (interrupt?.kind==="question-check" && interrupt.questionCheck.originalQuestion!==record.question))
    throw Error("原任务的追问记录无效。");
  return {response:record.result,interrupt,record};
}

export async function loadNativeWorkspaceMessages(threadId:string,anchors:(string|undefined)[],signal:AbortSignal) {
  for(const candidate of new Set(anchors)){
    if(!candidate || !researchRecordId.test(candidate))continue;
    const response=await fetch(workspaceToolCallsPath(threadId,candidate),{
      cache:"no-store",redirect:"error",signal:AbortSignal.any([signal,AbortSignal.timeout(5000)]),
    });
    // A history entry from before AG-UI is not an inventory anchor.
    if(response.status===404)continue;
    if(!response.ok)throw Error("原工作台回执目录暂不可读。");
    const pending=readPendingWorkspaceTools(await response.json(),threadId,candidate);
    if(!pending || pending.length>64)throw Error("原工作台回执目录无效。");
    const receipts:{id:string;receipt:WorkspaceReceipt}[]=[];
    const pairs=await Promise.all(pending.map(async ({runId,toolCallId}):Promise<AgUiMessage[]>=>{
      const task=await readNativeTask(runId,signal);
      if(task?.id!==runId || task.conversationId!==threadId || task.status!=="complete" ||
        typeof task.turnId!=="string" || !researchRecordId.test(task.turnId))
        throw Error("原工作台调用不属于当前会话。");
      const archive=(await readNativeArchive({runId,threadId,turnId:task.turnId},signal))?.record;
      const tool=archive && readWorkspaceToolRecord(archive.workspaceTool,runId,archive.result);
      if(!archive || !tool || tool.call.id!==toolCallId)throw Error("原工作台工具调用暂不可核对。");
      const target=workspaceObservationTarget(archive.result);
      const receipt=readRecordWorkspaceReceipt(archive);
      if(receipt)receipts.push({id:runId,receipt});
      const result=tool.result ?? (receipt && workspaceToolResult(receipt,!!target)) ?? unverifiedWorkspaceToolResult(runId);
      return [{id:runId,role:"assistant",content:archive.result.message,toolCalls:[tool.call]},result];
    }));
    return {anchor:candidate,messages:pairs.flat(),receipts};
  }
  return {anchor:undefined,messages:[],receipts:[]};
}

export async function readNativeInterrupt(run:ChatRun,signal:AbortSignal,expectedKind?:OneEarthAgUiInterruptRecord["kind"],
  onRecord?:(record:ResearchRecord)=>void) {
  const task=await readNativeTask(run.runId,signal);
  if(!matchesTaskIdentity(task,identityOf(run)) || task.status!=="complete")
    throw Error("暂时无法核对原追问状态。");
  const archive=await readNativeArchive(run,signal);
  const interrupt=archive?.interrupt;
  if(!interrupt || (interrupt.kind==="question-check")!==(expectedKind==="question-check"))
    throw Error("原任务没有可核验的原生追问。");
  if(archive?.record)onRecord?.(archive.record);
  return interrupt;
}

export async function readClaimedNativeTurn(parent:ChatRun,claim:OneEarthAgUiInterruptRecord,signal:AbortSignal,
  attempted?:ChatRun,locationId?:string):Promise<ChatRun|undefined> {
  const runId=claim.resumedBy;
  if(!runId || (locationId && locationId!==runId) ||
    (claim.status!=="resolved" && !(claim.kind==="question-check" && claim.status==="cancelled")))return;
  const task=await readNativeTask(runId,signal);
  const turnId=task?.turnId;
  const child={runId,threadId:parent.threadId,turnId};
  if(typeof turnId!=="string" || !researchRecordId.test(turnId) || turnId===parent.turnId ||
    !matchesTaskIdentity(task,identityOf(child)) || !taskStates.has(task.status) ||
    (runId===attempted?.runId && turnId!==attempted.turnId))return;
  return child;
}

export async function recoverNativeChat(
  run:ChatRun, signal:AbortSignal, progress:Pick<ChatProgress,"onAccepted"|"onLifecycle"> &
    Pick<Partial<ChatProgress>,"onResearchProgress"|"onWorkspaceEffect">, workspacePageToken?:string,
):Promise<CompletedChat> {
  const unavailableTimeout=60_000;
  let until=Date.now()+unavailableTimeout;
  const identity=identityOf(run);
  let delay=350;
  do {
    signal.throwIfAborted();
    const task=await readNativeTask(run.runId,signal,workspacePageToken);
    if(matchesTaskIdentity(task,identity) && taskStates.has(task.status)){
      if(task.status==="queued" || task.status==="running"){
        const effect=boundWorkspaceActionEffect(task.workspaceEffect,run);
        if(effect)progress.onWorkspaceEffect?.(effect);
      }
      // Only missing or inconsistent results time out. A confirmed active
      // research run can outlast the recovery window after a page reload.
      if(task.status==="queued" || task.status==="running")until=Date.now()+unavailableTimeout;
      progress.onAccepted();
      const facts=readTaskLifecycle(task);
      if(facts)progress.onLifecycle(facts);
      if(task.status==="queued" || task.status==="running"){
        const activity=readResearchProgress(task.researchProgress,run.runId);
        if(activity)progress.onResearchProgress?.(activity);
      }
      if(task.status==="cancelled")throw new ChatResponseError("本地任务已取消。","cancelled");
      if(task.status==="failed")throw new ChatResponseError("本轮任务未完成。","run_failed");
      if(task.status==="complete"){
        const completed=await readNativeArchive(run,signal);
        if(completed)return completed;
      }
    }
    await waitForTaskRead(delay,signal);
    delay=Math.min(2000,delay*2);
  }while(Date.now()<until);
  throw Error("暂时无法读取原任务的终态。");
}
