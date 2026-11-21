import assert from "node:assert/strict";
import { readActiveWorkspace } from "./read-active-workspace.mjs";
import { chromium } from "playwright-core";

const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const panel = page.locator(".chat-panel");
const box = () => panel.boundingBox();
const closeTo = (actual, expected) =>
  assert(Math.abs(actual - expected) < 2, `${actual} ≈ ${expected}`);
const sameFrame = (actual, expected) => {
  for (const key of ["x", "y", "width", "height"])
    closeTo(actual[key], expected[key]);
};
async function drag(locator, dx, dy) {
  const b = await locator.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + dx, b.y + b.height / 2 + dy, {
    steps: 10,
  });
  await page.mouse.up();
}
const savedCamera = () =>
  page.evaluate(readActiveWorkspace).then(value => value.camera);
try {
  await page.goto("http://127.0.0.1:5274/?task=Q19&data=ctd", {
    waitUntil: "networkidle",
  });
  await page.locator("canvas[data-painted]").waitFor();
  const defaultFrame = await box();
  closeTo(defaultFrame.width, (1440 - 52) * 0.4 - 12);
  closeTo(defaultFrame.x + defaultFrame.width, 1428);
  closeTo(defaultFrame.y, 78);
  closeTo(defaultFrame.y + defaultFrame.height, 948);
  const camera = await savedCamera();
  const draft = page.getByRole("textbox", { name: "向 OneEarth 提问" });
  await draft.fill("保留这条研究追问");

  await drag(page.getByLabel("调整 Chat 下边缘", { exact: true }), 0, -180);
  closeTo((await box()).height, defaultFrame.height - 180);
  await drag(page.getByLabel("移动 Chat 窗口", { exact: true }), -130, 64);
  let frame = await box();
  closeTo(frame.x, defaultFrame.x - 130);
  closeTo(frame.y, defaultFrame.y + 64);
  await page.waitForFunction(
    () => Number(document.querySelector("canvas").dataset.focusWidth) > 1300,
  );
  const toggle = await page.locator(".chat-boundary-toggle").boundingBox();
  closeTo(toggle.x + toggle.width / 2, frame.x);
  closeTo(toggle.y + toggle.height / 2, frame.y + frame.height / 2);
  assert.equal(await page.getByLabel("收起 Chat", { exact: true }).count(), 1);
  await page.getByLabel("收起 Chat", { exact: true }).click();
  assert.equal(await panel.count(), 0);
  closeTo(
    (await page.locator(".chat-boundary-toggle").boundingBox()).y,
    toggle.y,
  );
  await page.getByLabel("打开 Chat", { exact: true }).click();
  sameFrame(await box(), frame);
  assert.equal(await draft.inputValue(), "保留这条研究追问");
  assert.equal(new URL(page.url()).searchParams.get("data"), "ctd");

  await drag(page.getByLabel("调整 Chat 右下角", { exact: true }), 100, 50);
  let resized = await box();
  closeTo(resized.width, frame.width + 100);
  closeTo(resized.height, frame.height + 50);
  closeTo(resized.x, frame.x);
  closeTo(resized.y, frame.y);
  frame = resized;
  await drag(page.getByLabel("调整 Chat 左上角", { exact: true }), 40, 30);
  resized = await box();
  closeTo(resized.x, frame.x + 40);
  closeTo(resized.y, frame.y + 30);
  closeTo(resized.width, frame.width - 40);
  closeTo(resized.height, frame.height - 30);
  assert.deepEqual(
    await savedCamera(),
    camera,
    "Moving and resizing Chat do not rotate the globe",
  );
  await page.reload({ waitUntil: "networkidle" });
  sameFrame(await box(), resized);
  const separator = page.getByRole("separator", { name: "调整 Chat 宽度" });
  await separator.focus();
  await page.keyboard.press("ArrowRight");
  closeTo((await box()).width, resized.width - 24);
  await page.getByLabel("移动 Chat 窗口", { exact: true }).focus();
  await page.keyboard.press("ArrowUp");
  closeTo((await box()).y, resized.y - 24);
  await page.screenshot({ path: "/tmp/oneearth-chat-floating-desktop.png" });

  await page.getByLabel("恢复 Chat 默认布局").click();
  sameFrame(await box(), defaultFrame);
  assert.equal(
    await page.evaluate(() => localStorage.getItem("oneearth.chat-frame.v1")),
    null,
  );
  assert.equal(
    await page.evaluate(() => localStorage.getItem("oneearth.chat-width.v1")),
    null,
  );
  await drag(
    page.getByLabel("调整 Chat 右下角", { exact: true }),
    -3000,
    -3000,
  );
  closeTo((await box()).width, 360);
  closeTo((await box()).height, 300);
  await drag(page.getByLabel("移动 Chat 窗口", { exact: true }), -3000, -3000);
  closeTo((await box()).x, 64);
  closeTo((await box()).y, 78);
  await drag(page.getByLabel("移动 Chat 窗口", { exact: true }), 3000, 3000);
  frame = await box();
  closeTo(frame.x + frame.width, 1428);
  closeTo(frame.y + frame.height, 948);
  assert.equal(
    await page.locator("html").getAttribute("data-panel-interaction"),
    null,
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: "networkidle" });
  assert.equal(await panel.count(), 1, "An existing session keeps Chat open after resizing and reloading");
  await page.getByLabel("收起 Chat", { exact: true }).click();
  await page.evaluate(readActiveWorkspace);
  await page.reload({ waitUntil: "networkidle" });
  assert.equal(await panel.count(), 0);
  await page.getByLabel("打开 Chat", { exact: true }).click();
  await page.getByLabel("恢复 Chat 默认布局").click();
  frame = await box();
  closeTo(frame.x, 60);
  closeTo(frame.width, 318);
  closeTo(frame.y, 68);
  closeTo(frame.y + frame.height, 832);
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.screenshot({ path: "/tmp/oneearth-chat-floating-mobile.png" });
  await page.getByLabel("收起 Chat", { exact: true }).click();
  assert.equal(await page.getByLabel("打开 Chat", { exact: true }).count(), 1);
  const fresh = await browser.newPage({ viewport: { width: 390, height: 844 } });
  try {
    await fresh.goto("http://127.0.0.1:5274/?task=Q19&data=ctd", { waitUntil: "networkidle" });
    await fresh.getByLabel("打开 Chat", { exact: true }).waitFor();
    assert.equal(await fresh.locator(".chat-panel").count(), 0, "A new narrow-screen session starts collapsed");
  } finally {
    await fresh.close();
  }
  assert.deepEqual(errors, []);
  console.log(
    "PASS default layout, free movement, 2D edge/corner resize, toggle anchoring, draft and CTD context, camera stability, keyboard, persistence, reset, viewport bounds, narrow screens.",
  );
} finally {
  await browser.close();
}
