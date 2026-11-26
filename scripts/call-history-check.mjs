import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { nativeChatFixture } from "./native-chat-fixture.mjs";
import { nativeChatSubmission } from "./read-native-chat.mjs";

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const origin = new URL(process.env.ONEEARTH_URL || "http://127.0.0.1:5274");
const question = "查找海表温度观测资料";
const answer = { message: "已核对资料。" };
const calls = Array.from({ length: 185 }, (_, i) => ({
  id: String(i), kind: i < 163 ? "MCP" : "tool", name: "get_evidence_" + i,
  status: i < 177 ? "done" : i === 177 ? "partial" : "failed",
  input: "原档资料查询 " + i, output: i < 178 ? "已取得原文" : undefined,
  error: i >= 178 ? "验证用来源失败" : undefined,
}));
const started = Date.now();
const runTrace = { started, stages: ["通过 MCP 查询论文断言库"], calls };
try {
  const errors = [], reads = [];
  let input, submissions = 0;
  const setup = async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
    page.setDefaultTimeout(12_000);
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/api/ag-ui", route => {
      submissions++;
      input = nativeChatSubmission(route.request());
      return nativeChatFixture(route, { response: answer });
    });
    await page.route("**/api/tasks/*/record", route => {
      assert.ok(input);
      assert.equal(new URL(route.request().url()).pathname, "/api/tasks/" + input.runId + "/record");
      assert.equal(route.request().method(), "GET");
      reads.push(input.runId);
      return route.fulfill({ json: { id: input.runId, conversationId: input.threadId, turnId: input.messages.at(-1).id,
        question, created: started, updated: started + 100, result: { ...answer, runTrace } } });
    });
    return page;
  };
  let page = await setup();
  await page.goto(origin.href);
  await page.getByRole("button", { name: /^(?:打开|收起) Chat$/u }).waitFor();
  if (await page.getByLabel("打开 Chat", { exact: true }).isVisible()) await page.getByLabel("打开 Chat", { exact: true }).click();
  await page.getByLabel("向 OneEarth 提问", { exact: true }).fill(question);
  await page.getByLabel("发送消息", { exact: true }).click();
  let row = page.locator('.message.assistant');
  await row.getByText(answer.message, { exact: true }).waitFor();
  await row.locator(".oe-run > summary").click();
  let viewport = row.getByRole("region", { name: "工具调用记录", exact: true });
  const bottom = () => page.waitForFunction(() => {
    const el = document.querySelector(".oe-calls");
    return el && el.clientHeight > 0 && el.scrollHeight - el.clientHeight - el.scrollTop < 2;
  });
  const checkCompact = async () => {
    await bottom();
    assert((await viewport.boundingBox()).height <= 30);
    assert.equal(await viewport.locator("details").count(), calls.length);
    assert.match(await row.locator(".oe-call-summary").innerText(), /185 次调用 · Skill 0 · MCP 163 · 177 成功 · 1 部分完成 · 7 失败/u);
    assert.equal(await row.locator(".oe-call-group > summary,.oe-call-summary svg,.oe-call-group > .oe-call-expand").count(), 0);
    const summary = await row.locator(".oe-call-summary").boundingBox();
    const button = await row.locator(".oe-call-heading > .oe-call-expand").boundingBox();
    assert(summary && button && button.x >= summary.x + summary.width && button.y < summary.y + 24);
  };
  await checkCompact();
  assert.deepEqual(reads, [input.runId], "Online completion fetches only the original run process");
  assert.equal(await viewport.getByText("原档资料查询 184", { exact: true }).count(), 0);
  await row.getByRole("button", { name: "展开调用", exact: true }).click();
  await bottom();
  await row.getByRole("button", { name: "收起调用", exact: true }).click();
  await checkCompact();
  await page.screenshot({ path: "/tmp/oneearth-calls-compact-desktop.png" });

  await page.close();
  page = await setup();
  await page.goto(new URL("/?research=" + input.runId, origin).href);
  row = page.locator("#message-" + input.runId);
  viewport = row.getByRole("region", { name: "工具调用记录", exact: true });
  await row.getByText(answer.message, { exact: true }).waitFor();
  await row.locator(".oe-run > summary").click();
  const openLastCall = async () => {
    await bottom();
    const detail = viewport.locator("details").last();
    await detail.locator("summary > svg").click();
    await detail.getByText("原档资料查询 184", { exact: true }).waitFor();
    assert(await detail.getByLabel("复制输入", { exact: true }).isVisible());
    await row.getByRole("button", { name: "收起调用", exact: true }).click();
    await bottom();
    assert.equal(await viewport.locator("details[open]").count(), 0);
  };
  await openLastCall();
  await page.setViewportSize({ width: 390, height: 844 });
  await checkCompact();
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await openLastCall();
  await page.screenshot({ path: "/tmp/oneearth-calls-compact-mobile.png" });
  assert.equal(submissions, 1, "Reopening a saved process must not submit a run");
  assert(reads.length >= 2 && reads.every(id => id === input.runId));
  assert.deepEqual(errors, []);
  console.log("PASS same-run archived process after native completion, safe call summaries, original details on reopen, desktop/mobile controls and one submission.");
} finally {
  await browser.close();
}
