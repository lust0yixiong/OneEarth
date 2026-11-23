import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const address = (process.env.ONEEARTH_URL || "http://127.0.0.1:5274") + "/?view=discover&source=haina";
const queryLink = title => {
  const url = new URL(address);
  url.searchParams.set("q", title);
  return url.href;
};
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const find = async title => {
    await page.goto(queryLink(title), { waitUntil: "domcontentloaded" });
    const card = page.locator(".catalog-card").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
    await card.waitFor();
    await card.scrollIntoViewIfNeeded();
    return card;
  };
  const name = "OneEarth/大兴安岭森林时空嵌入数据集";
  const forest = await find(name);
  assert.equal(await page.getByLabel("筛选数据来源").inputValue(), "haina");
  const image = forest.locator(".catalog-cover img:not(.catalog-cover-pending)");
  await image.evaluate(img => img.decode());
  assert.match(await image.getAttribute("src"), /^\/thumbnails\/haina\/.+\.webp$/);
  assert.match(await forest.locator("footer").innerText(), /39.09\s*GB/);
  await forest.getByRole("button", { name: "收藏资料", exact: true }).click();
  assert.equal(await forest.getByRole("button", { name: "取消收藏", exact: true }).getAttribute("aria-pressed"), "true");
  await forest.getByRole("button", { name: "查看资料：" + name }).click();
  await page.locator(".data-inspector").getByText(name, { exact:false }).first().waitFor();
  await page.getByLabel("关闭数据速览").click();

  const corpus = await find("GeoGPT-CPT-DataPool");
  const placeholder = corpus.locator('.catalog-cover[data-default="true"] img');
  await placeholder.evaluate(img => img.decode());
  assert.equal(await placeholder.evaluate(img => img.getBoundingClientRect().width), 144);
  const fallback = await placeholder.getAttribute("src");
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await corpus.evaluate(el => el.getBoundingClientRect().right <= innerWidth));

  const failed = await browser.newPage();
  await failed.route("**/thumbnails/haina/*.webp", route => route.fulfill({ status: 404, body: "" }));
  await failed.goto(queryLink("EMAG2"), { waitUntil: "domcontentloaded" });
  const missing = failed.locator(".catalog-card").filter({ has: failed.getByRole("heading", { name: "EMAG2", exact: true }) });
  await missing.scrollIntoViewIfNeeded();
  const failedImage = missing.locator('.catalog-cover[data-default="true"] img');
  await failedImage.waitFor();
  assert.equal(await failedImage.getAttribute("src"), fallback);
  await failedImage.evaluate(img => img.decode());
  console.log("PASS 海纳来源筛选、原图、缺图、来源失败回退、144px 线稿、数据速览、收藏及窄屏。");
} finally {
  await browser.close();
}
