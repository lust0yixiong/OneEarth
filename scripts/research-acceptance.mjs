import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const csv = fileURLToPath(
  new URL("../../数据/数据发现智能体评测问题汇总-20题.csv", import.meta.url),
);
const questions = JSON.parse(
  execFileSync(
    "python3",
    [
      "-c",
      "import sys,json,csv;print(json.dumps(list(csv.DictReader(open(sys.argv[1],encoding='utf-8-sig')))))",
      csv,
    ],
    { encoding: "utf8" },
  ),
);
const criteria = JSON.parse(
  await readFile(
    new URL("./fixtures/research-acceptance.json", import.meta.url),
  ),
);
const base = process.env.ONEEARTH_URL || "http://127.0.0.1:5274";
assert.equal(questions.length, 20);
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const reports = [];
async function send(page, value) {
  const output = page.locator(".message.assistant");
  const count = await output.count();
  await page.getByLabel("向 OneEarth 提问").fill(value);
  await page.getByLabel("发送消息").click();
  await output.nth(count).waitFor();
  return output.nth(count);
}
async function audit(question) {
  const id = "Q" + question.id.padStart(2, "0"),
    spec = criteria[id];
  const report = { id, candidates: [], roles: [], errors: [] };
  reports.push(report);
  const page = await browser.newPage({
    viewport: { width: 1512, height: 982 },
  });
  page.setDefaultTimeout(6500);
  page.on("pageerror", (err) => report.errors.push(err.message));
  try {
    await page.goto(base);
    const answer = await send(page, question.question);
    assert.equal(new URL(page.url()).searchParams.get("task"), id);
    await answer.locator(".candidate-link").last().click();
    await page.locator(".result-context").waitFor();
    const cards = page.locator(".catalog-card");
    const total = await cards.count();
    assert(total > 0, "目录缺少候选");
    let reviewed = "";
    for (let i = 0; i < total; i++) {
      const card = cards.nth(i);
      await card.getByRole("button", { name: /数据速览/ }).click();
      const dock = page.locator(".overview-inspector");
      const title = await dock.locator("h2").innerText();
      const body = await dock.locator(".overview-body").innerText();
      const source = await dock
        .locator(".inspector-links a[href]")
        .first()
        .getAttribute("href");
      assert.match(source, /^https?:\/\//);
      assert(!body.includes("待检索原始资料"), title);
      reviewed += "\n" + body + "\n" + title;
      report.candidates.push({ title, source });
      await page
        .getByRole("button", { name: "关闭数据速览", exact: true })
        .click();
    }
    for (const [role, patterns] of Object.entries(spec.roles)) {
      if (patterns.some((r) => new RegExp(r, "i").test(reviewed)))
        report.roles.push(role);
      else report.errors.push("候选材料缺少 " + role);
    }
    await page.getByRole("button", { name: "返回之前的球面" }).click();
    const follow = await send(page, spec.probe);
    const reply = await follow.innerText();
    report.reply = reply;
    if (
      !spec.guard.some((r) => new RegExp(r, "i").test(reply)) ||
      /^(?:可以|是的|当然可以|完全可以)[，,。！!\s]/.test(
        await follow.locator(":scope > p").first().innerText(),
      )
    )
      report.errors.push("须核对追问 " + spec.redline);
    assert.equal(
      new URL(page.url()).searchParams.get("task"),
      id,
      "追问改变了研究问题",
    );
    // Start a fresh workspace so a previous case ID cannot mask an unrecognized paraphrase.
    await page.goto(base);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    assert.equal(new URL(page.url()).searchParams.get("task"), null);
    const again = await send(page, spec.paraphrase);
    assert.equal(
      new URL(page.url()).searchParams.get("task"),
      id,
      "改写问题识别错误",
    );
    assert((await again.innerText()).trim().length > 20);
    assert((await again.locator(".chat-role").count()) > 0, "改写没有候选角色");
  } catch (e) {
    report.errors.push(String(e).slice(0, 450));
  } finally {
    await page.close();
  }
  console.log(
    id,
    report.candidates.length + "项",
    report.errors.length ? report.errors.join(" / ") : "PASS",
  );
}
try {
  for (const question of questions) await audit(question);
} finally {
  await browser.close();
}
const destination =
  process.env.ONEEARTH_AUDIT_REPORT || "/tmp/oneearth-20-question-audit.json";
await writeFile(destination, JSON.stringify(reports, null, 2));
assert.equal(
  reports.filter((r) => !r.errors.length).length,
  20,
  "研究问题验收未全部通过",
);
