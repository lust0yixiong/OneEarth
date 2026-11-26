import type { Router } from "express";
import type { PendingWorkspaceToolCall } from "../src/domain/native-workspace-tool";
import { taskIdPattern, type TaskStore } from "./task-store";

const isNativeId = (value: unknown): value is string =>
  typeof value === "string" && taskIdPattern.test(value) && value === value.toLowerCase();

/** A read-only identity index. Call arguments and receipts stay on each original record. */
export function agUiWorkspaceInventory(
  router: Router,
  tasks: Pick<TaskStore, "get">,
  pending: (threadId: string) => Promise<PendingWorkspaceToolCall[]>,
  hasNativeRun: (id: string) => Promise<boolean>,
) {
  router.get("/api/ag-ui/threads/:threadId/tool-calls", async (req, res) => {
    const { threadId } = req.params;
    const anchorRunId = req.query.anchorRunId;
    if (!isNativeId(threadId) || !isNativeId(anchorRunId)) {
      res.status(400).json({ error: "工作台工具会话或锚定运行编号无效。" });
      return;
    }
    const anchor = await tasks.get(anchorRunId);
    if (!anchor || JSON.parse(anchor.body).conversationId !== threadId || !await hasNativeRun(anchorRunId)) {
      res.status(404).json({ error: "没有找到该会话的原运行。" });
      return;
    }
    res.set("Cache-Control", "no-store").json({ threadId, anchorRunId, pending: await pending(threadId) });
  });
}
