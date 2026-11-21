import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const directory = await mkdtemp(join(tmpdir(), "oneearth-push-ui-"));
const token = randomBytes(32).toString("hex");
const base = "http://127.0.0.1:5176";
const child = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
  stdio: ["ignore", "pipe", "inherit"],
  env: {
    ...process.env,
    NODE_ENV: "production",
    PORT: "5176",
    ONEEARTH_OBSERVATION_DB: join(directory, "obs.sqlite"),
    ONEEARTH_PUSH_SOURCES: JSON.stringify({
      test: { name: "隔离验收星座", token, test: false },
    }),
  },
});
const done = once(child, "exit");
let browser;
try {
  await Promise.race([
    new Promise((resolve) =>
      child.stdout.on("data", (c) => {
        if (c.toString().includes(base)) resolve();
      }),
    ),
    done.then(() => {
      throw Error("无法启动独立验收服务");
    }),
  ]);
  browser = await chromium.launch({
    executablePath:
      process.env.CHROME_PATH ||
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
  });
  const errors = [];
  async function workspace() {
    const ctx = await browser.newContext({
      viewport: { width: 1500, height: 950 },
    });
    const p = await ctx.newPage();
    p.setDefaultTimeout(10000);
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(base + "/?view=discover&source=constellation");
    return p;
  }
  const p = await workspace();
  await p.getByText("接收端已就绪，等待首条星座观测。").waitFor();
  const body = {
    schemaVersion: 1,
    collection: "lake-water",
    id: "DEMO-01",
    revision: 1,
    title: "联调湖泊水色",
    satellite: "TEST-01",
    observedAt: "2026-01-03T10:00:00Z",
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [120, 30],
          [121, 30],
          [121, 31],
          [120, 31],
          [120, 30],
        ],
      ],
    },
    measurements: [{ variable: "模拟浓度", value: 2.1, unit: "mg/m³" }],
    file: {
      name: "reading.csv",
      base64: Buffer.from("value\n2.1\n").toString("base64"),
    },
  };
  async function send(revision) {
    const res = await fetch(base + "/api/constellations/test/observations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify({ ...body, revision }),
    });
    assert.equal(res.status, 201);
    return (await res.json()).key;
  }
  const key = await send(1);
  await p
    .getByRole("button", { name: "数据速览：联调湖泊水色" })
    .waitFor({ timeout: 6000 });
  const q = p.getByRole("textbox", { name: "向 OneEarth 提问" });
  await q.fill("查看星座最新推送的观测");
  await p.getByRole("button", { name: "发送消息" }).click();
  await p.locator("canvas[data-painted]").waitFor();
  await p.getByRole("button", { name: "联调湖泊水色 · 数据速览" }).click();
  const inspector = p.getByRole("region", { name: "数据速览" });
  assert.match(await inspector.innerText(), /联调数据/);
  const downloading = p.waitForEvent("download");
  await inspector.getByRole("link", { name: /下载原文件/ }).click();
  const file = await downloading;
  assert.equal(await readFile(await file.path(), "utf8"), "value\n2.1\n");
  await inspector.getByRole("button", { name: "预览表格" }).click();
  assert.match(await p.locator(".evidence-body").innerText(), /模拟浓度/);
  await p.getByRole("button", { name: "关闭预览" }).click();
  await p.getByRole("button", { name: /在数据触达查看本次结果/ }).click();
  await p.getByRole("button", { name: "保存研究清单", exact: true }).click();
  await p.getByRole("button", { name: "研究清单", exact: true }).click();
  const downloadingList = p.waitForEvent("download");
  await p.getByRole("button", { name: "导出 JSON" }).click();
  const listPath = await (await downloadingList).path();
  const list = JSON.parse(await readFile(listPath, "utf8"));
  assert.equal(list.items[0].id, "constellation:" + key);
  assert.equal(list.items[0].version, "r1");
  await send(2);
  const fresh = await workspace();
  await fresh.getByRole("button", { name: "研究清单", exact: true }).click();
  await fresh.getByLabel("导入研究清单").setInputFiles(listPath);
  await fresh.getByRole("button", { name: "恢复这份清单" }).click();
  await fresh.getByRole("button", { name: "数据速览：联调湖泊水色" }).click();
  assert.match(
    await fresh.getByRole("region", { name: "数据速览" }).innerText(),
    /修订 1/,
  );
  assert.deepEqual(errors, []);
  console.log(
    "通过 · 已打开页面收到推送、Chat 与地球、原文件字节、预览实测值、升版后跨浏览器恢复旧版",
  );
} finally {
  await browser?.close();
  if (child.exitCode === null && child.signalCode === null)
    child.kill("SIGTERM");
  await done;
  await rm(directory, { recursive: true, force: true });
}
