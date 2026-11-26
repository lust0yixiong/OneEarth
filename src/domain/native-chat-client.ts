import {HttpAgent, type AgentSubscriber} from "@ag-ui/client";
import {ChatResponseError} from "./chat-response";
import {nativeAgUiPath, nativeAgUiProtocolVersion, oneEarthAgUiVersion, readOneEarthAgUiResult,
  type OneEarthAgUiForwardedProps} from "./native-ag-ui";
import {loadResearchRecord} from "./runtime-client";
import {matchesTaskIdentity, readTaskLifecycle, type TaskLifecycle} from "./task-lifecycle-client";
import type {DiscoveryResponse} from "./types";

type ChatRun = {threadId: string; runId: string; turnId: string};
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
  abortController: AbortController, progress: ChatProgress,
): Promise<DiscoveryResponse | undefined> {
  const forwardedProps: OneEarthAgUiForwardedProps<T> = {oneearth: {version: oneEarthAgUiVersion, submission}};
  const url = new URL(nativeAgUiPath, location.origin).href;
  let posted = false;
  let httpStatus: number | undefined;
  let started = false;
  let assistant = false;
  let textEnded = false;
  let draft = "";
  let result: DiscoveryResponse | undefined;
  let failure: ChatResponseError | undefined;
  const agent = new HttpAgent({
    url, threadId, initialMessages: [{id: turnId, role: "user", content: question}],
    fetch: async (target, options) => {
      if (posted || target !== url || options?.method !== "POST")
        throw Error("本轮只允许一次原生 Chat 提交。");
      posted = true;
      const response = await fetch(target, {...options, redirect: "error", cache: "no-store"});
      httpStatus = response.status;
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
      if (terminal.outcome !== "success") return;
      const response = readOneEarthAgUiResult(terminal.result, runId);
      if (textEnded && response?.message === draft) result = response;
    },
    onRunErrorEvent: ({event}) => {
      if (started) failure = new ChatResponseError(event.message, event.code);
    },
  };
  try {
    await agent.runAgent({runId, forwardedProps, abortController}, subscriber);
  } catch {
    // A transport or verifier failure can still leave a durable run to recover.
    result = undefined;
  }
  abortController.signal.throwIfAborted();
  if (failure) throw failure;
  if (result) return result;
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

export async function recoverNativeChat(
  {threadId, runId, turnId}: ChatRun, signal: AbortSignal, progress: Pick<ChatProgress, "onAccepted" | "onLifecycle">,
): Promise<DiscoveryResponse> {
  const until = Date.now() + 60_000;
  const identity = {id:runId, conversationId:threadId, turnId};
  const path = "/api/tasks/" + encodeURIComponent(runId);
  let delay = 350;
  do {
    signal.throwIfAborted();
    const response = await fetch(path, {signal: AbortSignal.any([signal, AbortSignal.timeout(5_000)]),
      cache: "no-store", redirect: "error"}).catch(() => undefined);
    if (response?.ok) {
      const task = await response.json().catch(() => undefined);
      if (matchesTaskIdentity(task, identity) && taskStates.has(task.status)) {
        progress.onAccepted();
        const facts = readTaskLifecycle(task);
        if (facts) progress.onLifecycle(facts);
        if (task.status === "cancelled") throw new ChatResponseError("本地任务已取消。", "cancelled");
        if (task.status === "failed") throw new ChatResponseError("本轮任务未完成。", "run_failed");
        if (task.status === "complete") {
          const record = await loadResearchRecord(runId, signal).catch(() => undefined);
          signal.throwIfAborted();
          if (record) {
            if (!matchesTaskIdentity(record, identity))
              throw Error("归档与原问题的会话或轮次不匹配。");
            return record.result;
          }
        }
      }
    }
    await waitForTaskRead(delay, signal);
    delay = Math.min(2000, delay * 2);
  } while (Date.now() < until);
  throw Error("暂时无法读取原任务的终态。");
}
