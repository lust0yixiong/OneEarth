import assert from "node:assert/strict";

export function catalogQueryUrl(address, query) {
  const url = new URL(address);
  url.searchParams.set("view", "discover");
  if (query) url.searchParams.set("q", query);
  else url.searchParams.delete("q");
  return url.href;
}

export async function openDataAccessNavigation(page) {
  const nav = page.getByRole("navigation", { name: "主导航" });
  const entry = nav.getByRole("button", { name: "数据触达", exact: true });
  if (!(await entry.count())) {
    await nav.getByRole("button", { name: "设置", exact: true }).click();
    await page.getByRole("checkbox", { name: "在主导航显示「数据触达」", exact: true }).check();
    await page.getByRole("button", { name: "返回工作区", exact: true }).click();
  }
  await entry.click();
}

export async function filterLinkedCatalog(page, query) {
  await page.waitForURL(url => url.searchParams.has("result"));
  const url = catalogQueryUrl(page.url(), query);
  const id = new URL(url).searchParams.get("result");
  await page.waitForFunction(async resultId =>
    (await fetch("/api/results/" + resultId)).ok, id);
  await page.goto(url);
}

// Keep case-scoped UI checks on the supported save and restore path.
export async function restoreInspectedBatchInCatalog(page) {
  const dock = page.getByRole("region", { name: "数据速览", exact: true });
  const title = await dock.getByRole("heading", { level: 2 }).innerText();
  const keys = () => page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith("oneearth.research-list.")));
  const previous = await keys();
  const save = dock.getByRole("button", { name: "保存研究清单", exact: true });
  await save.click();
  await dock.getByRole("button", { name: "已保存到研究清单", exact: true }).waitFor();
  const saved = (await keys()).filter(key => !previous.includes(key));
  assert.equal(saved.length, 1, "应仅临时保存当前批次一份");
  await openDataAccessNavigation(page);
  const toggle = page.getByRole("button", { name: "研究清单", exact: true });
  if ((await toggle.getAttribute("aria-pressed")) !== "true") await toggle.click();
  const library = page.getByRole("region", { name: "研究清单", exact: true });
  await library.locator("details.saved-batches > summary").click();
  const entry = library.locator(".research-list-item").filter({
    has: page.getByRole("heading", { name: title, exact: true }),
  });
  await entry.getByRole("button", { name: "恢复这份清单", exact: true }).click();
  await page.locator(".result-context").waitFor();
  await page.evaluate(key => {
    localStorage.removeItem(key);
    window.dispatchEvent(new Event("oneearth-list-changed"));
  }, saved[0]);
  if ((await toggle.getAttribute("aria-pressed")) === "true") await toggle.click();
}
