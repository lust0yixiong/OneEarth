import {HttpAgent, type AgentSubscriber} from "@ag-ui/client";
import type {ResumeEntry} from "@ag-ui/core";
import {ChatResponseError} from "./chat-response";
import {nativeAgUiPath, nativeAgUiProtocolVersion, oneEarthAgUiVersion, readOneEarthAgUiInterruptRecord, readOneEarthAgUiResult,
  type OneEarthAgUiForwardedProps, type OneEarthAgUiInterruptRecord} from "./native-ag-ui";
import {loadResearchRecord,researchRecordId,type ResearchRecord} from "./runtime-client";
import {matchesTaskIdentity, readTaskLifecycle, type TaskLifecycle} from "./task-lifecycle-client";
import type {DiscoveryResponse} from "./types";

export type ChatRun = {threadId: string; runId: string; turnId: string};
type CompletedChat = {response: DiscoveryResponse; interrupt?: OneEarthAgUiInterruptRecord; record?: ResearchRecord};
type ResumeConflict = {conflict: true; locationId?: string};
type ChatProgress = {
  onAccepted: () => void;
  onDraft: (text: string) => void;
  onStep: (step: string) => void;
  onLifecycle: (lifecycle: TaskLifecycle) => void;
};

const refusedStatuses = new Set([400, 401, 403, 404, 413, 415, 422, 429]);
const taskStates = new Set(["queued", "running", "complete", "failed", "cancelled"]);

export async function submitNativeChat<T extends object>(
  {threadId, runId, turnId}: ChatRun, question: string, submission: T,
  abortController: AbortController, progress: ChatProgress, resume?: ResumeEntry,
): Promise<CompletedChat | ResumeConflict | undefined> {
  const forwardedProps: OneEarthAgUiForwardedProps<T> = {oneearth: {version: oneEarthAgUiVersion, submission}};
  const url = new URL(nativeAgUiPath, location.origin).href;
  let posted = false;
  let httpStatus: number | undefined;
  let conflictLocation: string | undefined;
  let started = false;
  let assistant = false;
  let textEnded = false;
  let draft = "";
  let result: CompletedChat | undefined;
  let failure: ChatResponseError | undefined;
  const agent = new HttpAgent({
    url, threadId, initialMessages: [{id: turnId, role: "user", content: question}],
    fetch: async (target, options) => {
      if (posted || target !== url || options?.method !== "POST")
        throw Error("本轮只允许一次原生 Chat 提交。");
      posted = true;
      const response = await fetch(target, {...options, redirect: "error", cache: "no-store"});
      httpStatus = response.status;
      const locationHeader=response.headers.get("Location");
      if (resume && httpStatus===409 && locationHeader) {
        const match=/^\/api\/tasks\/([^/?#]+)$/u.exec(locationHeader);
        if(match && researchRecordId.test(match[1])) conflictLocation=match[1];
      }
      return response;
    },
  });
  const subscriber: AgentSubscriber = {
    onRunStartedEvent: ({event}) => {
      started = event.threadId === threadId && event.runId === runId && event.protocolVersion === nativeAgUiProtocolVersion;
      if (started) {
        progress.onAccepted();
        progress.onLifecycle({runtimePhase: {phase: "executing"}});
      }
    },
    onStepStartedEvent: ({event}) => {
      if (started && event.stepName) progress.onStep(event.stepName);
    },
    onTextMessageStartEvent: ({event}) => {
      if (started && event.messageId === runId && event.role === "assistant") {
        assistant = true;
        textEnded = false;
      }
    },
    onTextMessageContentEvent: ({event}) => {
      if (!started || !assistant || event.messageId !== runId) return;
      draft += event.delta;
      if (draft.length <= 8000) progress.onDraft(draft);
    },
    onTextMessageEndEvent: ({event}) => {
      if (started && assistant && event.messageId === runId) textEnded = true;
    },
    onRunFinishedEvent: terminal => {
      if (!started || terminal.event.threadId !== threadId || terminal.event.runId !== runId) return;
      if (terminal.outcome === "cancelled") failure = new ChatResponseError("本地任务已取消。", "cancelled");
      if (terminal.outcome === "interrupt") {
        const [item]=terminal.interrupts;
        const response=readOneEarthAgUiResult(terminal.event.result,runId);
        if(!response || !item || terminal.interrupts.length!==1)return;
        const identity={id:item.id,status:"pending"};
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
      if (textEnded && response?.message === draft) result = {response};
    },
    onRunErrorEvent: ({event}) => {
      if (started) failure = new ChatResponseError(event.message, event.code);
    },
  };
  try {
    await agent.runAgent({runId, forwardedProps, abortController, ...(resume ? {resume:[resume]} : {})}, subscriber);
  } catch {
    // A transport or verifier failure can still leave a durable run to recover.
    result = undefined;
  }
  abortController.signal.throwIfAborted();
  if (failure) throw failure;
  if (result) return result;
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

async function readNativeTask(runId:string,signal:AbortSignal) {
  if(!researchRecordId.test(runId))return;
  const response=await fetch("/api/tasks/"+runId,{signal:AbortSignal.any([signal,AbortSignal.timeout(5000)]),
    cache:"no-store",redirect:"error"}).catch(()=>undefined);
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

export async function readNativeInterrupt(run:ChatRun,signal:AbortSignal,expectedKind?:OneEarthAgUiInterruptRecord["kind"]) {
  const task=await readNativeTask(run.runId,signal);
  if(!matchesTaskIdentity(task,identityOf(run)) || task.status!=="complete")
    throw Error("暂时无法核对原追问状态。");
  const interrupt=(await readNativeArchive(run,signal))?.interrupt;
  if(!interrupt || (interrupt.kind==="question-check")!==(expectedKind==="question-check"))
    throw Error("原任务没有可核验的原生追问。");
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
  run:ChatRun, signal:AbortSignal, progress:Pick<ChatProgress,"onAccepted"|"onLifecycle">,
):Promise<CompletedChat> {
  const until=Date.now()+60_000;
  const identity=identityOf(run);
  let delay=350;
  do {
    signal.throwIfAborted();
    const task=await readNativeTask(run.runId,signal);
    if(matchesTaskIdentity(task,identity) && taskStates.has(task.status)){
      progress.onAccepted();
      const facts=readTaskLifecycle(task);
      if(facts)progress.onLifecycle(facts);
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
