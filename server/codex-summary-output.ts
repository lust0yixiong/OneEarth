import {randomUUID} from "node:crypto";
import {StringDecoder} from "node:string_decoder";
import {providerReasoningLimits, type ProviderReasoningSink} from "./provider-reasoning";

const maxStreamBytes = 1024 * 1024;

/** codex exec --json maps the provider's reasoning summary to a completed
 * reasoning item. Agent answers remain separate from that item. */
export class CodexSummaryOutput {
  private readonly decoder = new StringDecoder("utf8");
  private readonly seen = new Set<string>();
  private readonly executionId = randomUUID();
  private pending = "";
  private bytes = 0;
  private answer = "";
  private completed = false;
  private failed = false;

  constructor(private readonly sink: ProviderReasoningSink) {}

  feed(chunk: Buffer): boolean {
    this.bytes += chunk.length;
    if (this.bytes > maxStreamBytes) return false;
    this.pending += this.decoder.write(chunk);
    let end: number;
    while ((end = this.pending.indexOf("\n")) >= 0) {
      this.read(this.pending.slice(0, end));
      this.pending = this.pending.slice(end + 1);
    }
    return this.answer.length <= 150000;
  }

  finish(): string {
    this.read(this.pending + this.decoder.end());
    return this.completed && !this.failed && this.answer.length <= 150000 ? this.answer.trim() : "";
  }

  private read(line: string) {
    if (this.completed || this.failed) return;
    let event;
    try { event = JSON.parse(line); } catch { return; }
    if (event?.type === "turn.completed") {
      this.completed = true;
      return;
    }
    if (event?.type === "turn.failed") {
      this.failed = true;
      return;
    }
    if (event?.type !== "item.completed" || typeof event.item?.text !== "string") return;
    const {type, id, text} = event.item;
    if (type === "agent_message") {
      this.answer = text;
      return;
    }
    if (type !== "reasoning" || typeof id !== "string" || !id || this.seen.has(id) ||
      this.seen.size >= providerReasoningLimits.snapshots || !text.trim() ||
      Buffer.byteLength(text) > providerReasoningLimits.textBytes) return;
    this.seen.add(id);
    try {
      this.sink.onSnapshot({id: `${this.sink.taskId}:${this.executionId}:${this.seen.size}`,
        kind: "summary", text, revision: 1, complete: true});
    } catch { /* Summary delivery cannot change the model answer. */ }
  }
}
