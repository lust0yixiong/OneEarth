import type { DataSearchResult, DataSearchPlan } from "./data-search";
import type { ChatModel } from "../src/domain/chat-model";
import type { DeepSeekTools } from "../src/domain/deepseek-tools";
import type { ResearchIntent } from "../src/domain/research-intent";
import type { TurnHistory } from "./turn-planning";
import type { AnswerReference, DiscoveryContext, QuestionDecision, SearchFinding, SearchRun, ToolCall, ReadEvidence } from "../src/domain/types";

export interface DiscoveryInput {
  query: string;
  config: ChatModel;
  deepseekTools?: DeepSeekTools;
  decision?: QuestionDecision;
  continuedFrom?: string;
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

export async function discoverThroughService(taskId: string, input: DiscoveryInput, signal: AbortSignal, emit: (event: DiscoveryEvent) => void) {
  const base = process.env.ONEEARTH_DISCOVERY_URL || "http://127.0.0.1:5275";
  const url = new URL("/v1/discoveries", base);
  const created = await fetch(url, {method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({id: taskId, input}), signal});
  if (!created.ok) throw Error("数据发现服务提交失败（HTTP " + created.status + "）。");
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
            if (event.result) return event.result;
            if (event.error) { terminalError = event.error; throw Error(event.error); }
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
}
