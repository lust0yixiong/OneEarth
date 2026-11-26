import assert from "node:assert/strict";
import test from "node:test";
import { EventSchema, ToolSchema, ToolMessageSchema } from "@ag-ui/core/schemas";
import { matchesWorkspaceToolCall, nativeWorkspaceTool, unverifiedWorkspaceToolResult, workspaceToolCall, workspaceToolReceiptPath, workspaceToolResult } from "./native-workspace-tool";
import { validBrowserWorkspaceReceipt, type WorkspaceReceipt } from "./turn-context";
import type { DiscoveryResponse } from "./types";

const runId = "2048f023-fcd4-4eba-9088-1a57e2e41859";
const threadId = "5bb3920e-1c21-42e2-8621-72dfd08952a5";
const turnId = "976edf4c-8788-4ca8-8516-e5f86dccf6fe";
const target = { datasetId: "haina:1846764", valueId: "2024-03-26", publicationRevision: "a".repeat(64) } as const;

test("the native tool call contains only fields in the original effective proposal", () => {
  assert.equal(ToolSchema.parse(nativeWorkspaceTool).name, "oneearth.apply_workspace");
  const response: DiscoveryResponse = {
    message: "打开指定日森林影像。",
    workspaceEffect: { effectId: "workspace:" + runId, state: "proposed", fields: ["workspaceLayerOpen"] },
    workspaceLayerOpen: { ...target, kind: "open-published-layer" },
  };
  const call = workspaceToolCall(runId, response);
  assert.ok(call);
  const args = JSON.parse(call.function.arguments);
  assert.deepEqual(args, { workspaceEffect: response.workspaceEffect, workspaceLayerOpen: response.workspaceLayerOpen });
  const reordered = { ...call, function: { ...call.function, arguments: JSON.stringify({ workspaceLayerOpen: args.workspaceLayerOpen, workspaceEffect: args.workspaceEffect }) } };
  assert.equal(matchesWorkspaceToolCall(reordered, call), true);
  assert.equal(matchesWorkspaceToolCall({ ...call, function: { ...call.function, arguments: '{"workspaceEffect":{}}' } }, call), false);
  assert.equal(workspaceToolCall(threadId, response), undefined);
  assert.equal(workspaceToolCall(runId, { ...response, camera: { center: [0, 0], zoom: 2, reason: "changed" } }), undefined);
  assert.equal(workspaceToolReceiptPath(runId, call.id), "/api/tasks/" + runId + "/tool-calls/workspace%3A" + runId + "/receipt");
  for (const event of [
    { type: "TOOL_CALL_START", toolCallId: call.id, toolCallName: call.function.name, parentMessageId: runId },
    { type: "TOOL_CALL_ARGS", toolCallId: call.id, delta: call.function.arguments },
    { type: "TOOL_CALL_END", toolCallId: call.id },
    { type: "RUN_FINISHED", threadId, runId, outcome: { type: "success", pendingToolCallIds: [call.id] } },
  ]) assert.equal(EventSchema.parse(event).type, event.type);
});

test("a saved application, observation, or explicit refusal projects its actual fact", () => {
  const receipt: WorkspaceReceipt = {
    taskId: runId, effectId: "workspace:" + runId, conversationId: threadId, turnId, state: "applied", reportedAt: 10,
  };
  assert.equal(JSON.parse(workspaceToolResult(receipt)!.content).status, "applied");
  assert.equal(workspaceToolResult(receipt, true), undefined);
  assert.equal(workspaceToolResult({ ...receipt, observation: { ...target, state: "loading", observedAt: 11 } }), undefined);
  for (const state of ["rendered", "load-failed", "superseded"] as const) {
    const observation = { ...target, state, observedAt: 11 };
    const message = ToolMessageSchema.parse(workspaceToolResult({ ...receipt, observation }, true));
    assert.equal(message.toolCallId, receipt.effectId);
    assert.equal(typeof message.content, "string");
    assert.deepEqual(JSON.parse(message.content as string), { version: 1, status: state, target });
    assert.equal(!!message.error, state !== "rendered");
  }
  const failure = ToolMessageSchema.parse(workspaceToolResult({ ...receipt, state: "failed" }));
  assert.equal(failure.error, "浏览器无法应用该操作。");
  const unverified = unverifiedWorkspaceToolResult(runId);
  assert.equal(unverified.id, failure.id);
  assert.equal(JSON.parse(unverified.content).status, "unverified");
  assert.ok(ToolMessageSchema.parse(unverified).error);
  const { taskId, reportedAt, ...wire } = receipt;
  const decline = { ...wire, state: "declined" as const };
  assert.equal(validBrowserWorkspaceReceipt(decline), true);
  assert.equal(validBrowserWorkspaceReceipt({ ...decline, observation: { ...target, state: "rendered", observedAt: 11 } }), false);
  const declined = workspaceToolResult({ ...decline, taskId, reportedAt });
  assert.ok(declined);
  assert.equal(JSON.parse(declined.content).status, "declined");
  assert.equal(declined.error, undefined);
});
