import { chromium } from "playwright-core";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { isNativeChatSubmission, nativeChatSubmission, readNativeChatRecord } from "./read-native-chat.mjs";

const base = new URL(process.env.ONEEARTH_URL || "http://127.0.0.1:5284");
const discovery = new URL(process.env.ONEEARTH_DISCOVERY_URL || "http://127.0.0.1:5285");
const protectedPorts = ["5174", "5274", "5275", "5474", "5475", "5476", "5477"];
const loopback = ["localhost", "127.0.0.1", "[::1]"];
if ([base, discovery].some(url => protectedPorts.includes(url.port) || !loopback.includes(url.hostname))) {
  throw Error("故障验收须使用单独的新系统实例。");
}
const output = process.env.ONEEARTH_EVIDENCE_DIR || "evidence/a3-fault";
const injected = process.env.ONEEARTH_LIVE_CONFIRMATION !== "1";

async function readOriginalDiscovery(record) {
  const call = record.result.runTrace?.calls?.find(row => row.id === record.id + ":discovery" &&
    row.name === "独立数据发现服务" && row.status === "done");
  if (!call) return;
  const { messageId, discoveryId } = JSON.parse(call.output);
  assert.equal(messageId, record.id);
  assert.ok(discoveryId, "原运行归档应保留发现任务身份");
  const response = await fetch(new URL("/tasks/" + encodeURIComponent(discoveryId), discovery), {
    headers: { "A2A-Version": "1.0" }, signal: AbortSignal.timeout(10000), redirect: "error",
  });
  assert.equal(response.status, 200);
  const task = await response.json();
  assert.equal(task.id, discoveryId);
  const events = (task.artifacts ?? []).flatMap(artifact => artifact.parts
    .filter(part => part.data?.kind === "oneearth.discovery.event.v1").map(part => part.data.event))
    .sort((left, right) => left.seq - right.seq);
  return { id: task.id, contextId: task.contextId, state: task.status.state, events };
}

await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH ||
  (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : undefined) });
try {
  const page = await browser.newPage({ viewport: { width: 1512, height: 859 }, deviceScaleFactor: 1 });
  const submissions = [];
  page.on("request", request => {
    if (isNativeChatSubmission(request)) submissions.push(nativeChatSubmission(request));
  });
  await page.goto(base.href);
  const query = "我想研究川西地区地表形变的成因。请先提议把这个研究问题转换成检索2020—2023年川西 InSAR 与 GNSS 数据及论文用法的问题，并等我确认后才检索。";
  await page.getByLabel("向 OneEarth 提问", { exact: true }).fill(query);
  await page.getByLabel("发送消息", { exact: true }).click();
  await page.getByRole("region", { name: "确认问题理解" }).waitFor({ timeout: 180000 });
  assert.equal(submissions.length, 1);
  const [parent] = submissions;
  const { record: card } = await readNativeChatRecord(base, parent);
  assert.equal(card.interrupt.id, parent.runId);
  assert.equal(card.interrupt.kind, "question-check");
  assert.equal(card.interrupt.status, "pending");
  assert.equal(card.interrupt.questionCheck.originalQuestion, query);
  assert.ok(!card.result.runTrace?.findings?.some(finding => finding.items.length));
  const before = await readOriginalDiscovery(card);
  if (before) {
    assert.equal(before.state, "TASK_STATE_INPUT_REQUIRED");
    assert.ok(before.events.at(-1)?.result?.questionCheck);
    assert.equal(before.events.at(-1).result.sourceStatus.length, 0);
    assert.ok(!before.events.some(event => event.finding));
  }
  await page.screenshot({ path: output + "/awaiting-confirmation.png" });
  const next = page.waitForRequest(isNativeChatSubmission);
  await page.getByRole("button", { name: "按这个理解继续" }).click();
  const child = nativeChatSubmission(await next);
  assert.notEqual(child.runId, parent.runId);
  assert.equal(child.threadId, parent.threadId);
  assert.equal(child.forwardedProps.oneearth.submission.previousTaskId, parent.runId);
  assert.deepEqual(child.resume, [{ interruptId: parent.runId, status: "resolved", payload: { choice: "proposed" } }]);
  const { record } = await readNativeChatRecord(base, child);
  assert.ok(record, "续答应结束并保留原资料");
  const after = await readOriginalDiscovery(record);
  assert.ok(after);
  if (before) {
    assert.equal(after.id, before.id);
    assert.equal(after.contextId, before.contextId);
  }
  const afterSeq = before?.events.at(-1)?.seq ?? 0;
  const completed = after.events.filter(event => event.seq > afterSeq);
  const terminal = completed.at(-1)?.result;
  assert.ok(terminal);
  const failed = terminal.sourceStatus.find(channel => channel.source === "网络检索");
  if (injected) {
    assert.equal(failed?.status, "failed");
    assert.match(failed.detail, /故障注入/u);
  }
  const savedFindings = completed.filter(event => event.finding?.items.some(item => item.assetId)).length;
  assert.ok(savedFindings);
  assert.ok(terminal.papers.length || terminal.haina.length);
  const { record: resolved } = await readNativeChatRecord(base, parent);
  assert.equal(resolved.interrupt.status, "resolved");
  assert.equal(resolved.interrupt.resumedBy, child.runId);
  assert.equal(resolved.result.message, card.result.message);
  assert.equal(submissions.length, 2);
  await page.locator("#message-" + child.runId + "[data-runtime-phase=complete]").waitFor({ timeout: 180000 });
  await page.screenshot({ path: output + "/result-after-fault.png" });
  await writeFile(output + "/results.json", JSON.stringify({ confirmationId: parent.runId, discoveryId: child.runId,
    providerTaskId: after.id, reusedWaitingProviderTask: !!before, searchCallsBeforeDecision: 0,
    injection: injected ? "web" : null, channels: terminal.sourceStatus, savedFindings }, null, 2) + "\n");
} finally {
  await browser.close();
}
