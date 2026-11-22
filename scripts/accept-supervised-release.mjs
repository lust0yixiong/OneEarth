import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {mkdir,writeFile} from "node:fs/promises";
import {setTimeout as wait} from "node:timers/promises";
import {chromium} from "playwright-core";

const [taskId="6ed96dd3-e724-43ab-b8f8-5ed873960b8e"]=process.argv.slice(2);
assert.match(taskId,/^[a-f0-9-]{36}$/);
const base=new URL("http://127.0.0.1:5474");
const output=process.env.ONEEARTH_EVIDENCE_DIR||"evidence/product/candidate/supervision";
await mkdir(output,{recursive:true});
const service=command=>execFileSync(process.execPath,["scripts/macos-product-service.mjs",command],{encoding:"utf8"})
  .trim().split("\n").map(JSON.parse);
const route="/api/tasks/"+taskId+"/record";
const layer="/visualizations/haina/1846764/20230715.webp";
async function get(endpoint){
  const res=await fetch(new URL(endpoint,base),{signal:AbortSignal.timeout(2500)});
  assert.ok(res.ok,endpoint+" returned "+res.status);
  return res;
}
async function health(){
  const services=await Promise.all([5474,5475,5476,5477].map(async port=>{
    const result=await fetch("http://127.0.0.1:"+port+"/api/health",{signal:AbortSignal.timeout(2200)});
    return {port,...await result.json()};
  }));
  assert.ok(services.every(item=>item.status==="ok"));
  return services.map(({port,status,version,service,engine,postgis,objects})=>({port,status,version,service,engine,postgis,objects}));
}
async function inspect(phase){
  const jobs=service("status");
  assert.ok(jobs.every(job=>job.state==="running"&&job.pid));
  const app=jobs.find(job=>job.label==="org.oneearth.next");
  const [ppid,tty]=execFileSync("/bin/ps",["-p",String(app.pid),"-o","ppid=","-o","tty="],{encoding:"utf8"}).trim().split(/\s+/);
  assert.equal(ppid,"1");
  assert.equal(tty,"??");
  const checks=await health();
  const record=await get(route).then(res=>res.json());
  const ref=record.result.answerNotes.references.find(item=>item.kind==="asset"&&item.sourceChannel==="assertion");
  assert.ok(ref?.id,"需要一条可实际核验的论文资料引用。");
  const lookup=await get("/api/paper-records/"+encodeURIComponent(ref.id)+"/evidence").then(res=>res.json());
  assert.ok(lookup.dataset&&lookup.papers.length);
  const object=await get(layer);
  assert.equal(object.headers.get("x-oneearth-service"),"spatial");
  const bytes=Buffer.from(await object.arrayBuffer());
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"});
  try{
    const page=await browser.newPage({viewport:{width:1512,height:859},deviceScaleFactor:1});
    page.on("request",req=>assert.notEqual(new URL(req.url()).port,"5174"));
    await page.goto(new URL("/?research="+taskId,base).href);
    await page.locator(".message.user").getByText(record.question,{exact:true}).waitFor();
    await page.locator(".message.assistant").first().waitFor();
    await page.screenshot({path:output+"/"+phase+"-record.png"});
    await page.locator('[data-asset-id="'+ref.id+'"]').first().click();
    await page.getByLabel("数据速览",{exact:true}).first().waitFor();
    await page.screenshot({path:output+"/"+phase+"-source.png"});
    const seen=page.waitForResponse(res=>new URL(res.url()).pathname===layer&&res.ok());
    await page.goto(new URL("/?viz=forest",base).href);
    await seen;
    await page.locator("canvas[data-painted]").waitFor();
    await page.getByText("大兴安岭森林 · 嵌入 PCA",{exact:true}).waitFor();
    await page.screenshot({path:output+"/"+phase+"-layer.png"});
  }finally{await browser.close();}
  return {jobs,appParent:Number(ppid),appTty:tty,checks,sourceId:ref.id,layerBytes:bytes.length,
    layerSha256:createHash("sha256").update(bytes).digest("hex"),
    researchSha256:createHash("sha256").update(JSON.stringify(record)).digest("hex")};
}

const before=await inspect("before");
service("restart");
const initialPid=before.jobs.find(job=>job.label==="org.oneearth.next").pid;
let restarted=false;
for(let i=0;i<60;i++){
  const pid=service("status").find(job=>job.label==="org.oneearth.next")?.pid;
  if(pid&&pid!==initialPid&&await health().then(()=>true,()=>false)){restarted=true;break;}
  await wait(400);
}
assert.ok(restarted,"受控重启后应用必须更换 PID 并恢复所有健康接口。");
const after=await inspect("after");
for(const key of ["checks","sourceId","layerBytes","layerSha256","researchSha256"])assert.deepEqual(before[key],after[key],key);
for(const job of before.jobs.filter(job=>job.label!=="org.oneearth.next"))
  assert.equal(after.jobs.find(row=>row.label===job.label).pid,job.pid);
const original=await fetch("http://127.0.0.1:5174/api/health",{signal:AbortSignal.timeout(2000)});
assert.ok(original.ok);
await writeFile(output+"/verification.json",JSON.stringify({entry:base.origin,taskId,checkedAt:new Date().toISOString(),
  before,after,prototypeHealthOutsidePolicy:original.status},null,2)+"\n");
console.log("OneEarth launchd restart verified",initialPid,after.jobs.find(job=>job.label==="org.oneearth.next").pid,taskId);
