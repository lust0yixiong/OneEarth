import { chromium } from "playwright-core";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

const base = new URL(process.env.ONEEARTH_URL || "http://127.0.0.1:5274");
if (base.port === "5174" || !["localhost","127.0.0.1","[::1]"].includes(base.hostname)) throw Error("验收必须使用独立本机入口。");
const output = process.env.ONEEARTH_EVIDENCE_DIR || "evidence/a2";
await mkdir(output,{recursive:true});
const browser = await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH ||
  (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : undefined)});
const page = await browser.newPage({viewport:{width:1512,height:859},deviceScaleFactor:1});
let ids = [];
const requests = [];
const notes = {entry:base.origin,browser:browser.version(),viewport:[1512,859],dpr:1,turns:[]};
page.on("request",req=>{
  const url = new URL(req.url());
  if (url.port === "5174") requests.push(url.origin);
  if(url.pathname === "/api/tasks" && req.method() === "POST") ids.push(req.postDataJSON().id);
});
try {
  await page.goto(base.href);
  await page.getByRole("heading",{name:"你想研究什么问题？"}).waitFor({timeout:30000});
  await page.evaluate(() => document.fonts.ready);
  await page.locator("canvas[data-painted]").waitFor({timeout:30000});
  await page.waitForFunction(() => document.querySelector("canvas[data-painted]")?.dataset.coveragePending === "false",{},{timeout:30000});
  await page.screenshot({path:output+"/home.png"});
  await page.getByLabel("收起 Chat",{exact:true}).click();
  await page.screenshot({path:output+"/globe.png"});
  await page.getByRole("button",{name:"打开 Chat",exact:true}).click();
  const initial = process.env.ONEEARTH_SAMPLE_QUESTION ||
    "研究西北太平洋2020—2023年的海表温度、叶绿素和海色变化，可以找到哪些卫星与其他资料？说明变量、版本和入口。请按顺序列出至少两篇有可读用法的论文。";
  async function ask(query, number) {
    const started = Date.now();
    await page.getByLabel("向 OneEarth 提问",{exact:true}).fill(query);
    await page.getByLabel("发送消息",{exact:true}).click();
    await page.locator(".oe-findings").first().waitFor({timeout:100000}).catch(async () => {
      // Some source configurations report the first partial result only in the task stream.
      await page.waitForFunction(() => /找到|返回|已取得/.test(document.querySelector(".chat-scroll")?.innerText || ""),{},{timeout:45000});
    });
    const activeId = [...new Set(ids)][number-1];
    const active = await page.request.get(new URL("/api/tasks/"+activeId,base).href);
    const activeStatus = (await active.json()).status;
    await page.screenshot({path:output+"/before-refresh.png"});
    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll(".message.assistant").length > 0 || document.querySelector(".chat-error"),{},{timeout:300000});
    const result = await collect(number, started);
    notes.refresh = {taskId:activeId, statusBefore:activeStatus, submissions:ids.filter(id=>id===activeId).length,
      uniqueTaskIds:new Set(ids).size};
    await writeFile(output+"/task-evidence.json",JSON.stringify(notes,null,2)+"\n");
    assert.equal(activeStatus,"running","刷新必须发生在实际任务运行中");
    assert.equal(notes.refresh.uniqueTaskIds,1,"刷新继续同一个任务");
    return result;
  }
  async function collect(number, started) {
    await page.waitForTimeout(500);
    const id = [...new Set(ids)][number-1];
    assert.ok(id,"网页提交了新版任务");
    const res = await page.request.get(new URL("/api/tasks/"+id+"/events",base).href,{timeout:300000});
    assert.ok(res.ok());
    const events = (await res.text()).split("\n").filter(line=>line.trim()).map(JSON.parse);
    const last = events.at(-1);
    const evidence = {
      id, elapsedMs:Date.now()-started, status:last.result ? "complete" : "failed",
      errorCode:last.code, executor:last.result?.modelExecutor,
      channelCalls:events.filter(e=>e.call && e.call.status!=="running")
        .map(e=>({name:e.call.name,status:e.call.status,id:e.call.id,at:e.at})),
      firstFindingAt:events.find(e=>e.finding?.items?.length)?.at,
      finishedAt:last.at, createdAt:events[0].at, startedAt:events.find(e=>e.started)?.at,
      referenceCount:last.result?.answerNotes?.references?.length || 0,
      paperIds:last.result?.answerNotes?.references?.filter(ref=>ref.kind==="asset"&&ref.sourceChannel==="assertion").map(ref=>ref.id) || [],
      timings:last.result?.runTrace?.timings?.map(t=>({kind:t.kind,model:t.model,executor:t.executor,elapsedMs:t.elapsedMs,firstStdoutMs:t.firstStdoutMs})),
    };
    notes.turns.push(evidence);
    await writeFile(output+"/task-evidence.json",JSON.stringify(notes,null,2)+"\n");
    console.log(JSON.stringify({turn:number,id,status:evidence.status,errorCode:evidence.errorCode,referenceCount:evidence.referenceCount,paperIds:evidence.paperIds,discovery:evidence.channelCalls.filter(c=>c.name==="独立数据发现服务")}));
    assert.ok(last.result, "任务终态应返回结果");
    await page.waitForTimeout(700);
    return evidence;
  }
  const first = await ask(initial,1);
  await page.screenshot({path:output+"/first-turn.png"});
  assert.ok(first.channelCalls.some(c=>c.name==="独立数据发现服务" && c.status==="done"));
  assert.ok(first.referenceCount>=2,"首次回答至少引用两份来源");
  if(first.paperIds.length < 2) throw Error("此次首答没有至少两篇带稳定引用的论文，需选另一真实样本。");
  const followStarted = Date.now();
  await page.getByLabel("向 OneEarth 提问",{exact:true}).fill(process.env.ONEEARTH_FOLLOWUP_QUESTION || "第二篇论文用了什么数据？请只用刚才已读到的内容。");
  await page.getByLabel("发送消息",{exact:true}).click();
  await page.waitForFunction(() => document.querySelectorAll(".message.assistant").length > 1 || document.querySelector(".chat-error"),{},{timeout:300000});
  const follow = await collect(2,followStarted);
  await page.screenshot({path:output+"/follow-up.png"});
  assert.equal(follow.channelCalls.filter(c=>c.name==="独立数据发现服务").length,0,"追问没有新发现调用");
  assert.ok(follow.paperIds.includes(first.paperIds[1]),"追问仍引用同一论文");
  assert.deepEqual(requests,[],"浏览器没有访问 5174");
} finally {
  await browser.close();
}
