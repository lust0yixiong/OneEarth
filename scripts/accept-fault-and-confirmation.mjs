import { chromium } from "playwright-core";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

const base=new URL(process.env.ONEEARTH_URL || "http://127.0.0.1:5284");
const discovery=new URL(process.env.ONEEARTH_DISCOVERY_URL || "http://127.0.0.1:5285");
if([base.port,discovery.port].some(p=>["5174","5274","5275"].includes(p)))throw Error("故障验收须使用单独的新系统实例。");
const output=process.env.ONEEARTH_EVIDENCE_DIR || "evidence/a3-fault";
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH ||
  (process.platform==="darwin"?"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome":undefined)});
const page=await browser.newPage({viewport:{width:1512,height:859},deviceScaleFactor:1});
const tasks=new Set();
page.on("request",r=>{
  if(new URL(r.url()).pathname==="/api/tasks" && r.method()==="POST")tasks.add(r.postDataJSON().id);
});
const events=async(id)=>{
  const r=await fetch(new URL("/v1/discoveries/"+id+"/events",discovery),{signal:AbortSignal.timeout(240000)});
  assert.ok(r.ok);
  return (await r.text()).split("\n").filter(line=>line.trim()).map(JSON.parse);
};
try {
  await page.goto(base.href);
  const query="我想研究川西地区地表形变的成因。请先提议把这个研究问题转换成检索2020—2023年川西 InSAR 与 GNSS 数据及论文用法的问题，并等我确认后才检索。";
  await page.getByLabel("向 OneEarth 提问",{exact:true}).fill(query);
  await page.getByLabel("发送消息",{exact:true}).click();
  await page.getByRole("region",{name:"确认问题理解"}).waitFor({timeout:180000});
  const [confirmationId]=tasks;
  const planned=await events(confirmationId);
  assert.ok(planned.at(-1).result.questionCheck);
  assert.equal(planned.at(-1).result.sourceStatus.length,0);
  assert.equal(planned.filter(e=>e.finding).length,0);
  await page.screenshot({path:output+"/awaiting-confirmation.png"});
  await page.getByRole("button",{name:"按这个理解继续"}).click();
  await page.getByRole("region",{name:"阶段发现"}).first().waitFor({timeout:130000});
  const [,discoveryId]=tasks;
  assert.ok(discoveryId);
  const completed=await events(discoveryId);
  const terminal=completed.at(-1).result;
  const failed=terminal.sourceStatus.find(c=>c.source==="网络检索");
  assert.equal(failed?.status,"failed");
  assert.match(failed.detail,/故障注入/);
  assert.ok(completed.some(event=>event.finding?.items.some(item=>item.assetId)));
  assert.ok(terminal.papers.length || terminal.haina.length);
  await page.locator(".message.assistant").nth(1).waitFor({timeout:180000});
  await page.screenshot({path:output+"/result-after-fault.png"});
  await writeFile(output+"/results.json",JSON.stringify({confirmationId,discoveryId,searchCallsBeforeDecision:0,
    injection:"web",channels:terminal.sourceStatus,savedFindings:completed.filter(e=>e.finding?.items.length).length},null,2)+"\n");
} finally {await browser.close();}
