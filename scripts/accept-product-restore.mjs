import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir,writeFile } from "node:fs/promises";
import { chromium } from "playwright-core";

const source=new URL(process.env.ONEEARTH_SOURCE_URL || "http://127.0.0.1:5474");
const restored=new URL(process.env.ONEEARTH_URL || "http://127.0.0.1:5574");
for(const base of [source,restored])assert.notEqual(base.port,"5174");
assert.notEqual(source.origin,restored.origin);
const [taskId,followUpRecord]=process.argv.slice(2);
assert.match(taskId,/^[a-f0-9-]{36}$/);
if(followUpRecord)assert.match(followUpRecord,/^[a-f0-9-]{36}$/);
const output=process.env.ONEEARTH_EVIDENCE_DIR || "evidence/product/restore";
await mkdir(output,{recursive:true});
async function get(base,route){
  const res=await fetch(new URL(route,base),{signal:AbortSignal.timeout(15000)});
  assert.ok(res.ok,route+" status "+res.status);
  return res;
}
const runURL="/api/tasks/"+taskId+"/record";
const [first,loaded]=await Promise.all([source,restored].map(base=>get(base,runURL).then(res=>res.json())));
assert.equal(loaded.question,first.question);
assert.equal(loaded.result.message,first.result.message);
assert.deepEqual(loaded.result.answerNotes.references,first.result.answerNotes.references);
const version=await get(source,"/api/health").then(res=>res.json()).then(data=>data.version);
assert.equal((await get(restored,"/api/health").then(res=>res.json())).version,version);
const reference=loaded.result.answerNotes.references.find(item=>item.sourceChannel==="assertion"&&item.kind==="asset");
assert.ok(reference?.id,"需要一条实际文献引用");
const citation=await get(restored,"/api/paper-records?ids="+encodeURIComponent(reference.id)).then(res=>res.json());
assert.equal(citation[0]?.id,reference.id);
const evidenceRoute="/api/paper-records/"+encodeURIComponent(reference.id)+"/evidence";
const [originalEvidence,restoredEvidence]=await Promise.all([source,restored].map(base=>get(base,evidenceRoute).then(res=>res.json())));
assert.deepEqual(restoredEvidence,originalEvidence);
assert.ok(restoredEvidence.dataset || restoredEvidence.papers?.some(paper=>paper.abstract || paper.quotes?.length),
  "恢复后仍可读取原数据条目、论文摘要或原文摘录");
const forest="/visualizations/haina/1846764/20230715.webp";
const pixels=await Promise.all([source,restored].map(async base=>{
  const res=await get(base,forest);
  assert.equal(res.headers.get("x-oneearth-service"),"spatial");
  const bytes=Buffer.from(await res.arrayBuffer());
  return {size:bytes.length,sha256:createHash("sha256").update(bytes).digest("hex")};
}));
assert.deepEqual(pixels[0],pixels[1]);
assert.ok(pixels[0].size>0);

const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH ||
  (process.platform==="darwin"?"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome":undefined)});
const prototypeRequests=[];
let followUp;
try{
  const page=await browser.newPage({viewport:{width:1512,height:859},deviceScaleFactor:1});
  page.on("request",request=>{
    if(new URL(request.url()).port==="5174")prototypeRequests.push(request.url());
  });
  await page.goto(new URL("/?research="+taskId,restored).href);
  await page.getByText(loaded.question,{exact:true}).first().waitFor({timeout:25000});
  await page.locator(".message.assistant").first().waitFor();
  await page.screenshot({path:output+"/research-record.png"});
  const exact=page.locator('[data-asset-id="'+reference.id+'"]').first();
  await exact.click();
  await page.getByLabel("数据速览",{exact:true}).first().waitFor();
  await page.screenshot({path:output+"/research-source.png"});
  const forestArrival=page.waitForResponse(res=>new URL(res.url()).pathname===forest&&res.ok());
  await page.goto(new URL("/?viz=forest",restored).href);
  await forestArrival;
  await page.locator("canvas[data-painted]").waitFor();
  await page.getByText("大兴安岭森林 · 嵌入 PCA",{exact:true}).waitFor();
  await page.screenshot({path:output+"/forest-layer.png"});
  if(followUpRecord){
    const data=await get(restored,"/api/tasks/"+followUpRecord+"/record").then(res=>res.json());
    const selected=data.result.answerNotes.references[1];
    assert.equal(selected?.kind,"web");
    await page.goto(new URL("/?research="+followUpRecord,restored).href);
    await page.locator(".message.user").getByText(data.question,{exact:true}).waitFor({timeout:25000});
    const question="For source #2 in your previous answer, which observations did the authors use? Please stay with that source.";
    await page.getByLabel("向 OneEarth 提问",{exact:true}).fill(question);
    const submitted=page.waitForRequest(request=>request.method()==="POST"&&new URL(request.url()).pathname==="/api/tasks");
    await page.getByLabel("发送消息",{exact:true}).click();
    const {id,input:{previousTaskId}}=(await submitted).postDataJSON();
    assert.equal(previousTaskId,followUpRecord);
    const streamed=await page.request.get(new URL("/api/tasks/"+id+"/events",restored).href,{timeout:240000});
    assert.ok(streamed.ok());
    const events=(await streamed.text()).split("\n").filter(Boolean).map(JSON.parse);
    const result=events.at(-1).result;
    assert.ok(result?.runTrace.timings.some(timing=>timing.kind==="model-executor"));
    const ordinal=result.runTrace.calls.find(call=>call.id==="citation-ordinal");
    assert.equal(JSON.parse(ordinal.output).sourceId,selected.url);
    assert.equal(result.runTrace.calls.filter(call=>call.name==="独立数据发现服务").length,0);
    assert.ok(result.answerNotes?.references.some(item=>item.kind==="web"&&item.url===selected.url));
    await page.locator(".message.assistant").nth(1).waitFor();
    await page.screenshot({path:output+"/follow-up-after-restore.png"});
    followUp={id,previousTaskId,source:selected.url,independentDiscoveryCalls:0,
      actualExecutors:result.runTrace.timings.map(timing=>({executor:timing.executor,model:timing.model,elapsedMs:timing.elapsedMs}))};
  }
  assert.deepEqual(prototypeRequests,[]);
}finally{await browser.close();}
await writeFile(output+"/verification.json",JSON.stringify({source:source.origin,restored:restored.origin,version,taskId,
  sameResearchRecord:true,sourceId:reference.id,assertionEvidenceReadable:true,forest:pixels[1],browserReopened:true,prototypeRequests:prototypeRequests.length,followUp},null,2)+"\n");
