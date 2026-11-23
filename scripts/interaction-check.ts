import { openDataAccessNavigation } from "./data-access-ui-helpers.mjs";
import { chromium } from "playwright-core";
import assert from "node:assert/strict";
import { geoOrthographic } from "d3-geo";
import { fitCamera, emptyFilters } from "../src/domain/spatial";
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
try {
  const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors: string[] = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto("http://127.0.0.1:5274/?task=Q02", { waitUntil: "networkidle" });
  await p.getByRole("button", { name: "阿尔卑斯", exact: false }).click();
  const camera = fitCamera(
    "Q02",
    { ...emptyFilters(), place: "Hintereisferner" },
    "all",
  )!;
  const box = (await p.locator("canvas[data-painted]").boundingBox())!;
  const focusWidth = Number(
    await p.locator("canvas[data-painted]").getAttribute("data-focus-width"),
  );
  const projection = geoOrthographic()
    .rotate(camera.center.map((n) => -n) as [number, number])
    .translate([focusWidth / 2, box.height / 2])
    .scale(Math.min(focusWidth, box.height) * 0.455 * camera.zoom);
  const location = projection([10.7516666667, 46.8022222222])!;
  for (const system of ["h3", "s2"]) {
    await p.getByLabel("网格体系").selectOption(system);
    await p.waitForTimeout(120);
    await p.mouse.click(box.x + location[0], box.y + location[1]);
    await p.locator(".map-popover").waitFor();
    assert.match(await p.locator(".map-popover").innerText(), /2 条定位依据/);
    const mapBounds = await p.locator("canvas[data-painted]").boundingBox();
    await p.getByRole("button", { name: "查看数据" }).click();
    const details = p.getByRole("region", { name: "格内数据列表" });
    await details.waitFor();
    const card = (await p.locator(".map-popover").boundingBox())!;
    const popup = (await details.boundingBox())!;
    assert(popup.y >= card.y + card.height && popup.y - card.y - card.height < 12);
    assert.deepEqual(await p.locator("canvas[data-painted]").boundingBox(), mapBounds);
    assert.equal(popup.width,card.width);
    await details.getByRole("button",{name:/Copernicus.*GLO|DEM/}).first().click();
    await p.locator(".material-row").filter({hasText:/真实像元实读/}).getByRole("button",{name:"预览表格",exact:true}).click();
    assert.match(await p.locator(".evidence-body").innerText(), /3234.75/);
    await p.getByRole("button", { name: "引用到 Chat" }).click();
    assert(await p.locator(".citation-attachment").isVisible());
    await p
      .getByRole("textbox", { name: "向 OneEarth 提问" })
      .fill("这张表的依据是什么？");
    await p.getByRole("button", { name: "发送消息" }).click();
    await p.waitForFunction(
      () =>
        document.querySelectorAll(".message.assistant p").length > 0 &&
        Array.from(document.querySelectorAll(".message.assistant p"))
          .at(-1)!
          .textContent!.includes("3234.75"),
    );
    const close = p.locator(".overview-inspector").getByRole("button", {name:/关闭/}).first();
    if (await close.isVisible()) await close.click();
    await p.getByRole("button", { name: "放大地球" }).click();
    await p.waitForTimeout(100);
    assert.match(
      await p.locator(".map-popover").innerText(),
      new RegExp(system === "h3" ? "H3 R7" : "S2 L12"),
    );
  }
  await openDataAccessNavigation(p);
  await p.getByRole("button", { name: "数据地球", exact: true }).click();
  await p.locator("canvas[data-painted]").waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "PASS actual clicks in H3/S2, local evidence, row citation, scope lock, renderer unmount/remount",
  );
} finally {
  await browser.close();
}
