import { once } from "node:events";
import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { agUiWorkspaceInventory } from "./ag-ui-workspace-inventory";
import { openTaskStore, taskStatusRoutes } from "./task-store";
import { readPendingWorkspaceTools, readWorkspaceToolRecord, unverifiedWorkspaceToolResult, workspaceToolCall,
  workspaceToolCallsPath, workspaceToolCallId } from "../src/domain/native-workspace-tool";
import type { DiscoveryResponse } from "../src/domain/types";

test("the anchored native tool inventory lists only original call identities and links to immutable records", async t => {
  const threadId = "5bb3920e-1c21-42e2-8621-72dfd08952a5";
  const runId = "2048f023-fcd4-4eba-9088-1a57e2e41859";
  const turnId = "976edf4c-8788-4ca8-8516-e5f86dccf6fe";
  const otherId = "60272fa0-f3de-447a-b401-ca02a3ca4915";
  const workspace: DiscoveryResponse = { message: "打开原图层。", view: "earth",
    workspaceEffect: { effectId: workspaceToolCallId(runId), state: "proposed", fields: ["view"] } };
  const call = workspaceToolCall(runId, workspace);
  assert.ok(call);
  const stored = { call, result: unverifiedWorkspaceToolResult(runId), consumedBy: otherId };
  const tasks = openTaskStore(":memory:");
  const app = express();
  const queries: string[] = [];
  agUiWorkspaceInventory(app, tasks, async thread => {
    queries.push(thread);
    return [{ runId, toolCallId: call.id }];
  }, async id => id === runId);
  taskStatusRoutes(app, "/api/tasks", tasks, { researchRecords: true, readWorkspaceTool: async id => id === runId ? stored : undefined });
  tasks.submit(runId, { conversationId: threadId, turnId, query: "打开图层" });
  tasks.claim();
  tasks.finish(runId, "complete", { result: workspace });
  tasks.submit(otherId, { conversationId: threadId, turnId: otherId, query: "旧任务" });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = "http://127.0.0.1:" + address.port;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    tasks.close();
  });
  const get = (route: string) => fetch(origin + route, { redirect: "error", signal: AbortSignal.timeout(2000) });
  assert.equal((await get(workspaceToolCallsPath(threadId, otherId))).status, 404);
  assert.equal((await get(workspaceToolCallsPath(otherId, runId))).status, 404);
  assert.equal((await get(workspaceToolCallsPath(threadId, "malformed"))).status, 400);
  assert.deepEqual(queries, []);
  const inventory = await get(workspaceToolCallsPath(threadId, runId));
  assert.equal(inventory.status, 200);
  assert.equal(inventory.headers.get("cache-control"), "no-store");
  const data = await inventory.json();
  assert.deepEqual(readPendingWorkspaceTools(data, threadId, runId), [{ runId, toolCallId: call.id }]);
  assert.equal(readPendingWorkspaceTools(data, otherId, runId), undefined);
  assert.equal(readPendingWorkspaceTools({ ...data, pending: [...data.pending, ...data.pending] }, threadId, runId), undefined);
  const original = await (await get("/api/tasks/" + runId + "/record")).json();
  assert.equal(original.result.message, workspace.message);
  assert.deepEqual(readWorkspaceToolRecord(original.workspaceTool, runId, original.result), stored);
  assert.equal(readWorkspaceToolRecord({ ...stored, consumedBy: runId }, runId, original.result), undefined);
  assert.equal(readWorkspaceToolRecord({ call, result: stored.result }, runId, original.result), undefined);
});
