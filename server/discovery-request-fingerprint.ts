import { createHash } from "node:crypto";
import { sourceReadKind } from "./discovery-materials-contract";
import { skillRequestKind, skillResultKind } from "./observation-check-contract";
import { observationResearchKind } from "./observation-research-contract";

export const discoveryDelegationLookupPath = "/internal/discovery-delegations";

export function discoveryRequestFingerprint(kind: string, input: Record<string, unknown>, taskId?: string) {
  const observation = kind === skillRequestKind || kind === skillResultKind || kind === observationResearchKind;
  // Match the fingerprints stored on accepted jobs before recovery was introduced.
  const value = observation ? {kind, taskId, input} : kind === sourceReadKind ? {kind, input} : {taskId, input};
  const canonical = JSON.stringify(value, (_key, part) => part && typeof part === "object" && !Array.isArray(part)
    ? Object.fromEntries(Object.keys(part).sort().map(key => [key, part[key]]))
    : part);
  return createHash("sha256").update(canonical).digest("hex");
}
