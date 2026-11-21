import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { mkdir,writeFile } from "node:fs/promises";

const base=new URL(process.env.ONEEARTH_URL || "http://127.0.0.1:5304");
assert.notEqual(base.port,"5174");
const [firstId,followId]=process.argv.slice(2);
assert.ok(firstId && followId);
const evidence=process.env.ONEEARTH_EVIDENCE_DIR || "evidence/a4-restore";
await mkdir(evidence,{recursive:true});
async function restored(id){
  const res=await fetch(new URL("/api/tasks/"+id+"/events",base));
  assert.ok(res.ok);
  const done=(await res.text()).split("\n").filter(line=>line.trim()).map(JSON.parse).at(-1);
  assert.ok(done.result);
  return done.result;
}
const first=await restored(firstId),follow=await restored(followId);
const refs=first.answerNotes.references.filter(r=>r.sourceChannel==="assertion");
const second=follow.answerNotes.references.find(r=>r.sourceChannel==="assertion");
assert.equal(refs[1].id,second.id);
const live=new URL("/api/paper-records?ids="+encodeURIComponent(second.id),base);
const papers=await fetch(live).then(res=>res.json());
assert.equal(papers[0].id,second.id);
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH ||
 (process.platform==="darwin"?"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome":undefined)});
const page=await browser.newPage({viewport:{width:1512,height:859},deviceScaleFactor:1});
try {
  await page.addInitScript(({firstId,followId,first,follow})=>{
    if(sessionStorage.getItem("sample-imported"))return;
    localStorage.setItem("oneearth.workspace.v1",JSON.stringify({messages:[
      {id:"sample-1",role:"user",time:1,text:"西北太平洋海表温度、叶绿素和海色的资料有哪些？"},
      {id:firstId,role:"assistant",time:2,text:first.message,answerNotes:first.answerNotes},
      {id:"sample-2",role:"user",time:3,text:"第二篇论文用了什么数据？"},
      {id:followId,role:"assistant",time:4,text:follow.message,answerNotes:follow.answerNotes},
    ]}));
    sessionStorage.setItem("sample-imported","1");
  },{firstId,followId,first,follow});
  await page.goto(base.href);
  await page.getByText("第二篇论文用了什么数据？",{exact:true}).waitFor({timeout:30000});
  const citation=page.locator("button[data-asset-id]").filter({hasText:"〔1〕"}).last();
  await citation.waitFor({timeout:20000});
  await citation.click();
  await page.locator(".dataset-inspector, .data-inspector").first().waitFor({timeout:20000});
  await page.screenshot({path:evidence+"/legacy-citation.png"});
  const transfers=[];
  page.on("response",r=>{
    if(r.url().includes("/visualizations/haina/1846764/") && r.headers()["x-oneearth-service"]==="spatial")
      transfers.push({name:new URL(r.url()).pathname.split("/").pop(),status:r.status()});
  });
  await page.goto(new URL("/?viz=forest",base).href);
  await page.locator("canvas[data-painted]").waitFor({timeout:30000});
  await page.waitForFunction(()=>document.body.innerText.includes("大兴安岭森林"),{},{timeout:30000});
  await page.waitForTimeout(1500);
  assert.ok(transfers.some(r=>r.name==="20230715.webp"&&r.status===200),"恢复后的时空服务必须交付实际森林图层");
  await page.screenshot({path:evidence+"/restored-forest.png"});
  await writeFile(evidence+"/results.json",JSON.stringify({entry:base.origin,version:"0.1.0",firstId,followId,citation:second.id,
    legacySampleOpened:true,spatialObjects:transfers},null,2)+"\n");
} finally {await browser.close();}
