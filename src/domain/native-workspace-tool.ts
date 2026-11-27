import type { Tool, ToolCall, ToolMessage } from "@ag-ui/core";
import { ToolCallSchema, ToolMessageSchema } from "@ag-ui/core/schemas";
import type { DiscoveryResponse } from "./types";
import type { WorkspaceEffect, WorkspaceReceipt } from "./turn-context";

export const nativeWorkspaceToolName = "oneearth.apply_workspace";
export const workspaceActionFields = [
  "workspaceAction", "workspaceLayerOpen", "workspaceOperation", "view", "catalogQuery", "inspectId", "camera",
  "filters", "caseId", "dataView", "visualization", "mesh", "gridSystem", "layer",
  "previewNeed", "previewCaseId", "visualizeNeed", "previewKind", "clearSelection", "selectCenter",
] as const satisfies readonly (keyof DiscoveryResponse)[];

export const nativeWorkspaceTool: Tool = {
  name: nativeWorkspaceToolName,
  description: "在原工作台视图应用 OneEarth 已核验的操作。浏览器独立记录应用与实际成像。",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["workspaceEffect"],
    properties: {
      workspaceEffect: {
        type: "object",
        additionalProperties: false,
        required: ["effectId", "state", "fields"],
        properties: {
          effectId: { type: "string" },
          state: { const: "proposed" },
          fields: { type: "array", minItems: 1, uniqueItems: true, items: { enum: workspaceActionFields } },
        },
      },
      ...Object.fromEntries(workspaceActionFields.map(field => [field, true])),
    },
  },
};

export type NativeWorkspaceToolRecord = {
  call: ToolCall;
  result?: ToolMessage;
  consumedBy?: string;
};

export type PendingWorkspaceToolCall = { runId: string; toolCallId: string };

const nativeId = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u;

export const workspaceToolCallId = (runId: string) => "workspace:" + runId;
export const workspaceToolCallsPath = (threadId: string, anchorRunId: string) =>
  "/api/ag-ui/threads/" + encodeURIComponent(threadId) + "/tool-calls?anchorRunId=" + encodeURIComponent(anchorRunId);
export const workspaceToolReceiptPath = (runId: string, toolCallId: string) =>
  "/api/tasks/" + encodeURIComponent(runId) + "/tool-calls/" + encodeURIComponent(toolCallId) + "/receipt";

export type NativeWorkspaceArguments = {
  workspaceEffect: WorkspaceEffect;
} & Pick<DiscoveryResponse, typeof workspaceActionFields[number]>;

export function workspaceToolCall(runId: string, response: DiscoveryResponse): ToolCall | undefined {
  const effect = response.workspaceEffect;
  const id = workspaceToolCallId(runId);
  if (effect?.effectId !== id || effect.state !== "proposed" || !Array.isArray(effect.fields)) return;
  const fields = workspaceActionFields.filter(field => response[field] !== undefined);
  if (!fields.length || fields.length !== effect.fields.length || fields.some((field, index) => field !== effect.fields[index]))
    return;
  const args: NativeWorkspaceArguments = {
    workspaceEffect: { effectId: id, state: "proposed", fields },
    ...Object.fromEntries(fields.map(field => [field, response[field]])),
  };
  return { id, type: "function", function: { name: nativeWorkspaceToolName, arguments: JSON.stringify(args) } };
}

type WorkspaceToolMessage = ToolMessage & { content: string };

export function workspaceToolResult(receipt: WorkspaceReceipt, expectsRendering = false): WorkspaceToolMessage | undefined {
  const { taskId, state, observation, reason, flight } = receipt;
  if (observation?.state === "loading" || (expectsRendering && state === "applied" && !observation)) return;
  const status = observation?.state ?? state;
  const error = status === "failed" ? "浏览器无法应用该操作。"
    : status === "load-failed" ? "图层图像载入失败。"
    : status === "stale" || status === "superseded" ? "工作台视图已变化，无法确认该操作成像。"
    : undefined;
  return toolResult(taskId, {
    version: 1,
    status,
    ...(reason ? { reason } : {}),
    ...(flight ? { flight } : {}),
    ...(observation ? { target: {
      datasetId: observation.datasetId,
      valueId: observation.valueId,
      publicationRevision: observation.publicationRevision,
    } } : {}),
  }, error);
}

export function unverifiedWorkspaceToolResult(runId: string): WorkspaceToolMessage {
  return toolResult(runId, { version: 1, status: "unverified" }, "原操作的结果未能核实。");
}

function toolResult(runId: string, content: object, error?: string): WorkspaceToolMessage {
  return {
    id: "workspace-result:" + runId,
    role: "tool",
    toolCallId: workspaceToolCallId(runId),
    content: JSON.stringify(content),
    ...(error ? { error } : {}),
  };
}

function canonicalJson(value: unknown) {
  return JSON.stringify(value, (_key, entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry;
    return Object.fromEntries(Object.keys(entry).sort().map(key => [key, entry[key]]));
  });
}

export function matchesWorkspaceToolCall(actual: ToolCall, expected: ToolCall) {
  if (actual.id !== expected.id || actual.type !== expected.type || actual.function.name !== expected.function.name) return false;
  try {
    return canonicalJson(JSON.parse(actual.function.arguments)) === canonicalJson(JSON.parse(expected.function.arguments));
  } catch {
    return false;
  }
}

export function readWorkspaceToolRecord(value: unknown, runId: string, response: DiscoveryResponse): NativeWorkspaceToolRecord | undefined {
  const expected = workspaceToolCall(runId, response);
  if (!expected || !value || typeof value !== "object" || Array.isArray(value)) return;
  const { call, result, consumedBy } = value as Record<string, unknown>;
  const parsedCall = ToolCallSchema.safeParse(call);
  if (!parsedCall.success || !matchesWorkspaceToolCall(parsedCall.data, expected)) return;
  if (result === undefined && consumedBy === undefined) return { call: expected };
  if (typeof consumedBy !== "string" || consumedBy === runId || !nativeId.test(consumedBy)) return;
  const parsedResult = ToolMessageSchema.safeParse(result);
  if (!parsedResult.success || parsedResult.data.id !== "workspace-result:" + runId ||
    parsedResult.data.toolCallId !== expected.id || typeof parsedResult.data.content !== "string") return;
  return { call: expected, result: parsedResult.data, consumedBy };
}

export function readPendingWorkspaceTools(value: unknown, threadId: string, anchorRunId: string): PendingWorkspaceToolCall[] | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const input = value as Record<string, unknown>;
  if (input.threadId !== threadId || input.anchorRunId !== anchorRunId || !Array.isArray(input.pending)) return;
  const pending = new Map<string, PendingWorkspaceToolCall>();
  for (const entry of input.pending) {
    const runId: unknown = entry?.runId;
    if (typeof runId !== "string" || !nativeId.test(runId) || entry.toolCallId !== workspaceToolCallId(runId) || pending.has(runId)) return;
    pending.set(runId, { runId, toolCallId: entry.toolCallId });
  }
  return [...pending.values()];
}
