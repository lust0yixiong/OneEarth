import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { mkdir,writeFile } from "node:fs/promises";

const origin=new URL(process.env.ONEEARTH_URL || "http://127.0.0.1:5274");
assert.notEqual(origin.port,"5174");
const output=process.env.ONEEARTH_EVIDENCE_DIR || "evidence/a3-spatial";
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH ||
 (process.platform==="darwin"?"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome":undefined)});
const page=await browser.newPage({viewport:{width:1512,height:859},deviceScaleFactor:1});
const network=[];
page.on("response",r=>{
  const url=new URL(r.url());
  if(url.port==="5174")throw Error("验收触及原型端口。");
  if(url.pathname.startsWith("/precip-data/") || url.pathname.startsWith("/api/coverage/"))
    network.push({path:url.pathname,status:r.status(),service:r.headers()["x-oneearth-service"]});
});
try {
  await page.goto(origin.href);
  const canvas=page.locator("canvas[data-painted]");
  await canvas.waitFor({timeout:30000});
  await page.waitForFunction(()=>document.querySelector("canvas[data-painted]")?.dataset.coveragePending==="false",{},{timeout:30000});
  const b=await canvas.boundingBox(),focus=Number(await canvas.getAttribute("data-focus-width"));
  await page.mouse.click(b.x+focus*.44,b.y+b.height*.42);
  const locator=page.getByRole("button",{name:"定位此网格"});
  await locator.waitFor({timeout:20000});
  await page.screenshot({path:output+"/selected-grid.png"});
  await locator.click();
  await page.waitForFunction(()=>document.querySelector("canvas[data-painted]")?.dataset.flying==="true",{},{timeout:3000});
  await page.waitForFunction(()=>document.querySelector("canvas[data-painted]")?.dataset.flying==="false",{},{timeout:15000});
  await locator.waitFor();
  await page.screenshot({path:output+"/fly-to-selected-grid.png"});
  await page.goto(new URL("/?viz=rain&rainYear=2024&rainMonth=7",origin).href);
  const year=page.getByLabel("降水年份",{exact:true});
  await year.waitFor({timeout:30000});
  assert.equal(await year.inputValue(),"2024");
  await page.waitForFunction(()=>document.querySelector("canvas[data-painted]")?.dataset.rainLoading==="false",{},{timeout:30000});
  await year.selectOption("2023");
  await page.waitForFunction(()=>document.querySelector("canvas[data-painted]")?.dataset.rainLoading==="false",{},{timeout:30000});
  assert.equal(await year.inputValue(),"2023");
  await page.screenshot({path:output+"/imerg-2023.png"});
  const tiles=network.filter(r=>r.path.endsWith(".bin.gz") && r.status===200);
  const expectsSpatial=!process.env.ONEEARTH_BASELINE;
  assert.ok(tiles.some(r=>r.path.includes("/2023/")));
  assert.ok(tiles.some(r=>r.path.includes("/2024/")));
  if(expectsSpatial)assert.ok(tiles.every(r=>r.service==="spatial"));
  const bboxResult=expectsSpatial ? await fetch(new URL("/api/spatial/layers/imerg/chunks?bbox=102,26,111,35&start=2024-07-01&end=2024-07-31&level=2",origin)).then(r=>r.json()) : null;
  if(expectsSpatial)assert.ok(bboxResult.chunks.length>0 && bboxResult.chunks.every(c=>c.route.includes("/2024/07-")));
  await writeFile(output+"/verification.json",JSON.stringify({entry:origin.origin,gridSelected:true,flyTo:true,years:[2024,2023],tileCount:tiles.length,
    tileService:expectsSpatial?"spatial":"prototype snapshot",bboxResult},null,2)+"\n");
} finally {await browser.close();}
