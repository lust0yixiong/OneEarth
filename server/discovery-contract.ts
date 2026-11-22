import type { DataSearchResult, DataSearchPlan } from "./data-search";
import type { ChatModel } from "../src/domain/chat-model";
import type { DeepSeekTools } from "../src/domain/deepseek-tools";
import type { ResearchIntent } from "../src/domain/research-intent";
import type { TurnHistory } from "./turn-planning";
import type { AnswerReference, DiscoveryContext, QuestionDecision, SearchFinding, SearchRun, ToolCall, ReadEvidence } from "../src/domain/types";
import { setTimeout as delay } from "node:timers/promises";
import { TaskCancelled } from "./task-cancellation";

export interface DiscoveryInput {
  query: string;
  config: ChatModel;
  deepseekTools?: DeepSeekTools;
  decision?: QuestionDecision;
  continuedFrom?: string;
  continuation?: {previousId:string;focus:string};
  researchGoal?: string;
  evidenceGap?: string;
  initialPlan?: string;
  conversationContext?: string;
  previousResearchIntent?: ResearchIntent;
  history: TurnHistory;
  references: AnswerReference[];
  scope: Pick<DiscoveryContext, "filters" | "selection" | "caseId" | "citation" | "attachedScope">;
  currentDatasets: {id: string; title: string; source: string}[];
  conversationEvidence?: ReadEvidence[];
}

export interface DiscoveryEvent {
  stage?: string;
  searches?: SearchRun[];
  call?: ToolCall;
  finding?: SearchFinding;
  planned?: DataSearchPlan;
  result?: DataSearchResult;
  error?: string;
  seq?: number;
}

async function cancelDiscovery(taskId: string, base: string) {
  // Only a positively acknowledged submission reaches here. The turn's signal
  // is already aborted, so cancellation has its own bounded transport lifetime.
  const deadline = AbortSignal.timeout(3000);
  let last = "unreachable";
  for (let attempt = 0; !deadline.aborted; attempt++) {
    try {
      const response = await fetch(new URL("/v1/discoveries/" + taskId, base), {method:"DELETE", signal:deadline});
      await response.body?.cancel();
      if (response.status === 204 || response.status === 409) return;
      last = "HTTP " + response.status;
    } catch { /* A lost response may already have applied the cancellation. */ }
    try { await delay(Math.min(100 * 2 ** attempt, 500), undefined, {signal:deadline}); }
    catch { break; }
  }
  console.error("OneEarth discovery cancellation unconfirmed: " + taskId + " (" + last + ")");
}

/** An attempted ID is not ownership proof; only this POST's valid 202 is. */
export function discoveryCancellation(signal: AbortSignal) {
  const unfinished = new Map<string, {base:string; acknowledged:boolean}>();
  let cancellation: Promise<void> | undefined;
  const cancel = () => {
    if (signal.reason instanceof TaskCancelled)
      cancellation ??= Promise.all([...unfinished].map(([id, entry]) => {
        if (entry.acknowledged) return cancelDiscovery(id, entry.base);
        console.error("OneEarth discovery cancellation unconfirmed: " + id + " (submission not acknowledged)");
      })).then(() => {});
  };
  signal.addEventListener("abort", cancel, {once:true});
  return {
    track(id: string, base: string) {
      signal.throwIfAborted();
      const entry = {base, acknowledged:false};
      unfinished.set(id, entry);
      return {
        acknowledge() { signal.throwIfAborted(); entry.acknowledged = true; },
        terminal() { unfinished.delete(id); },
      };
    },
    async settled() { await cancellation; },
    async close() {
      signal.removeEventListener("abort", cancel);
      await cancellation;
      unfinished.clear();
    },
  };
}

export async function discoverThroughService(taskId: string, input: DiscoveryInput, signal: AbortSignal, emit: (event: DiscoveryEvent) => void,
  cancellation?: ReturnType<typeof discoveryCancellation>) {
  signal.throwIfAborted();
  const base = process.env.ONEEARTH_DISCOVERY_URL || "http://127.0.0.1:5275";
  const url = new URL("/v1/discoveries", base);
  const delegations = cancellation ?? discoveryCancellation(signal);
  const submission = delegations.track(taskId, base);
  try {
    const created = await fetch(url, {method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({id: taskId, input}), signal});
    if (created.status !== 202) {
      // A rejected ID may belong to another input. Never cancel it as our work.
      if (created.status >= 400 && created.status < 500) submission.terminal();
      throw Error("数据发现服务提交失败（HTTP " + created.status + "）。");
    }
    const receipt = await created.json();
    if (!receipt || receipt.id !== taskId || !["queued","running","complete","failed","cancelled"].includes(receipt.status) ||
      typeof receipt.created !== "number" || !Number.isFinite(receipt.created))
      throw Error("数据发现服务没有返回有效的任务受理确认。");
    submission.acknowledge();
    if (!["queued","running"].includes(receipt.status)) submission.terminal();
    let after = 0;
    // Preserve the task and cursor across transport failures.
    for (let attempt = 0; attempt < 3; attempt++) {
      signal.throwIfAborted();
      let terminalError: string | undefined;
      try {
        const stream = await fetch(new URL("/v1/discoveries/" + taskId + "/events?after=" + after, base), {signal});
        if (!stream.ok || !stream.body) throw Error("数据发现服务未返回进展。");
        const reader = stream.body.pipeThrough(new TextDecoderStream()).getReader();
        try {
          let pending = "";
          for (;;) {
            const {value, done} = await reader.read();
            if (done) break;
            const lines = (pending + value).split("\n");
            pending = lines.pop()!;
            for (const line of lines) {
              if (!line.trim()) continue;
              const event: DiscoveryEvent = JSON.parse(line);
              if (event.result) { submission.terminal(); return event.result; }
              if (event.error) { submission.terminal(); terminalError = event.error; throw Error(event.error); }
              emit(event);
              after = event.seq ?? after;
            }
          }
        } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      } catch (error) {
        signal.throwIfAborted();
        if (terminalError || attempt === 2) throw error;
      }
    }
    throw Error("数据发现服务在交付结果前关闭了连接。");
  } finally {
    if (cancellation) await delegations.settled();
    else await delegations.close();
  }
}
