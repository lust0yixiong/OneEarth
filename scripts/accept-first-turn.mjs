import { chromium } from "playwright-core";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import {isNativeChatSubmission,nativeChatSubmission,readNativeChatRecord} from "./read-native-chat.mjs";

const base = new URL(process.env.ONEEARTH_URL || "http://127.0.0.1:5274");
if (["5174","5474"].includes(base.port) || !["localhost","127.0.0.1","[::1]"].includes(base.hostname)) throw Error("验收必须使用独立本机入口。");
const output = process.env.ONEEARTH_EVIDENCE_DIR || "evidence/a2";
await mkdir(output,{recursive:true});
const browser = await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH ||
  (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : undefined)});
const page = await browser.newPage({viewport:{width:1512,height:859},deviceScaleFactor:1});
const submissions = [];
const requests = [];
const notes = {entry:base.origin,browser:browser.version(),viewport:[1512,859],dpr:1,turns:[]};
page.on("request",req=>{
  const url = new URL(req.url());
  if (url.port === "5174") requests.push(url.origin);
  if(isNativeChatSubmission(req)) submissions.push(nativeChatSubmission(req));
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
    const sent = page.waitForRequest(isNativeChatSubmission);
    await page.getByLabel("发送消息",{exact:true}).click();
    const activeId = nativeChatSubmission(await sent).runId;
    assert.equal(submissions[number-1]?.runId,activeId);
    await page.locator("#message-"+activeId+'[data-chat-phase="research"][data-runtime-phase="waiting-discovery"]')
      .waitFor({timeout:145000});
    const active = await page.request.get(new URL("/api/tasks/"+activeId,base).href);
    const activeStatus = (await active.json()).status;
    await page.screenshot({path:output+"/before-refresh.png"});
    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll(".message.assistant").length > 0 || document.querySelector(".chat-error"),{},{timeout:300000});
    const result = await collect(number, started);
    notes.refresh = {taskId:activeId, statusBefore:activeStatus, submissions:submissions.filter(input=>input.runId===activeId).length,
      uniqueTaskIds:new Set(submissions.map(input=>input.runId)).size};
    await writeFile(output+"/task-evidence.json",JSON.stringify(notes,null,2)+"\n");
    assert.equal(activeStatus,"running","刷新必须发生在实际任务运行中");
    assert.equal(notes.refresh.uniqueTaskIds,1,"刷新继续同一个任务");
    assert.equal(notes.refresh.submissions,1,"刷新不重新提交原运行");
    return result;
  }
  async function collect(number, started) {
    await page.waitForTimeout(500);
    const input = submissions[number-1];
    assert.ok(input,"网页提交了标准 AG-UI 运行");
    const {runId:id} = input;
    const {state,record} = await readNativeChatRecord(base,input);
    const result = record?.result;
    const trace = result?.runTrace;
    const evidence = {
      id, elapsedMs:Date.now()-started, status:state.status, executor:result?.modelExecutor,
      channelCalls:(trace?.calls??[]).filter(call=>call.status!=="running").map(({name,status,id})=>({name,status,id})),
      finishedAt:state.updated, createdAt:state.created, startedAt:trace?.started,
      referenceCount:result?.answerNotes?.references?.length || 0,
      paperIds:result?.answerNotes?.references?.filter(ref=>ref.kind==="asset"&&ref.sourceChannel==="assertion").map(ref=>ref.id) || [],
      timings:trace?.timings?.map(t=>({kind:t.kind,model:t.model,executor:t.executor,elapsedMs:t.elapsedMs,firstStdoutMs:t.firstStdoutMs})),
    };
    notes.turns.push(evidence);
    await writeFile(output+"/task-evidence.json",JSON.stringify(notes,null,2)+"\n");
    console.log(JSON.stringify({turn:number,id,status:evidence.status,referenceCount:evidence.referenceCount,paperIds:evidence.paperIds,discovery:evidence.channelCalls.filter(c=>c.name==="独立数据发现服务")}));
    assert.ok(result, "同一运行的归档应有结果");
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
