/** Public summary IDs belong to a run; they are separate from chat message IDs. */
export const nativeAgUiSummaryPrefix = (runId: string) => "oneearth:summary:" + runId + ":";

export function isNativeAgUiSummaryId(runId: string, messageId: string): boolean {
  const prefix = nativeAgUiSummaryPrefix(runId);
  return messageId.startsWith(prefix) && /^[a-f0-9]{24}$/u.test(messageId.slice(prefix.length));
}
