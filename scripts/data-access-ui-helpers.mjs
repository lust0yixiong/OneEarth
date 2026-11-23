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
