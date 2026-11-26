import { chromium } from "playwright-core";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import {isNativeChatSubmission,nativeChatSubmission,readNativeChatRecord} from "./read-native-chat.mjs";

const targets = [
  ["baseline",process.env.ONEEARTH_BASELINE_URL || "http://127.0.0.1:5294"],
  ["next",process.env.ONEEARTH_URL || "http://127.0.0.1:5274"],
].filter(([name])=>!process.env.ONEEARTH_MEASURE || process.env.ONEEARTH_MEASURE===name);
const output=process.env.ONEEARTH_EVIDENCE_DIR || "evidence/a3-performance";
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH ||
  (process.platform==="darwin"?"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome":undefined)});
const viewport={width:1512,height:859};
const question="研究川西地区2020—2023年的地表形变，想找GNSS位移、InSAR产品和相关误差资料。有哪些已有数据与论文用法？";
const results={browser:browser.version(),viewport,dpr:1,condition:"Mac mini 本机无头 Chrome。每种状态三次相同手势。热缓存仅指同一浏览器内图层复用。",question,systems:[]};
try {
  for(const [name,url] of targets){
    const base=new URL(url);
    assert.notEqual(base.port,"5174");
    const context=await browser.newContext({viewport,deviceScaleFactor:1});
    const page=await context.newPage();
    const transfers=[];
    let submission;
    page.on("response",async r=>{
      if(!r.url().includes("/precip-data/"))return;
      const fromSpatial=r.headers()["x-oneearth-service"]==="spatial";
      const timing=r.request().timing();
      const bytes=await r.request().sizes().then(s=>Math.max(0,s.responseBodySize)).catch(()=>0);
      transfers.push({route:new URL(r.url()).pathname,status:r.status(),fromSpatial,ms:Math.round(timing.responseEnd),bytes});
    });
    page.on("request",request=>{
      const url=new URL(request.url());
      assert.notEqual(url.port,"5174");
      if(isNativeChatSubmission(request))submission=nativeChatSubmission(request);
    });
    const canvas=page.locator("canvas[data-painted]");
    const pending=page.locator(".live-search.pending");
    const open=async()=>{
      await page.goto(new URL("/?viz=rain&rainYear=2024&rainMonth=7",base).href);
      await canvas.waitFor({timeout:30000});
      const reopen=page.getByLabel("打开 Chat",{exact:true});
      if(await reopen.isVisible())await reopen.click();
      await page.waitForFunction(()=>document.querySelector("canvas[data-painted]")?.dataset.rainLoading==="false",{},{timeout:30000});
    };
    const coldStart=Date.now();
    await open();
    const initialLayerReadyMs=Date.now()-coldStart;
    const health=await page.request.get(new URL("/api/health",base).href).then(r=>r.json());
    const summary={name,entry:base.origin,version:health.version || "prototype / index-DpY_7JXa.js",
      initialLayerReadyMs,rows:[],coldTiles:transfers.slice()};
    const cdp=await context.newCDPSession(page);
    await cdp.send("Performance.enable");
    async function measure(state,trial){
      const b=await canvas.boundingBox();
      const focus=Number(await canvas.getAttribute("data-focus-width")) || b.width;
      const x=b.x+focus*.48,y=b.y+b.height*.46;
      const count=transfers.length;
      const activeBefore=await pending.isVisible();
      await page.evaluate(()=>{
        const frames=[];
        let last=performance.now(),handle=0;
        function tick(now){frames.push(now-last);last=now;handle=requestAnimationFrame(tick);}
        handle=requestAnimationFrame(tick);
        window.__oneEarthMeasure={finish(){cancelAnimationFrame(handle);return frames;}};
      });
      const before=await cdp.send("Performance.getMetrics");
      await page.mouse.move(x,y);
      await page.mouse.down();
      await page.mouse.move(x+135,y+36,{steps:18});
      await page.mouse.move(x,y,{steps:18});
      await page.mouse.up();
      await page.mouse.wheel(0,-210);
      await page.waitForTimeout(250);
      await page.mouse.wheel(0,210);
      await page.waitForTimeout(350);
      const intervals=await page.evaluate(()=>window.__oneEarthMeasure.finish());
      const after=await cdp.send("Performance.getMetrics");
      const sorted=intervals.slice().sort((a,b)=>a-b);
      const taskMetric=m=>m.metrics.find(v=>v.name==="TaskDuration")?.value ?? 0;
      summary.rows.push({state,trial,activeBefore,activeAfter:await pending.isVisible(),frames:sorted.length,
        p95Ms:Number(sorted[Math.max(0,Math.ceil(sorted.length*.95)-1)]?.toFixed(2)),
        slowFramesOver33ms:sorted.filter(t=>t>33.4).length,mainThreadMs:Math.round(1000*(taskMetric(after)-taskMetric(before))),
        tileRequests:transfers.length-count,tileBytes:transfers.slice(count).reduce((sum,item)=>sum+item.bytes,0)});
    }
    for(let i=1;i<=3;i++)await measure("idle",i);
    await page.screenshot({path:output+"/"+name+"-imerg.png"});
    await open();
    const started=Date.now();
    await page.getByLabel("向 OneEarth 提问",{exact:true}).fill(question);
    await page.getByLabel("发送消息",{exact:true}).click();
    await page.waitForFunction(()=>/论文|检索|海纳/.test(document.querySelector(".live-search.pending")?.innerText ?? ""),{},{timeout:160000});
    summary.firstRetrievalShownMs=Date.now()-started;
    for(let i=1;i<=3;i++)await measure("background-search",i);
    await page.screenshot({path:output+"/"+name+"-imerg-during-search.png"});
    if(name==="next" && process.env.ONEEARTH_EXTENDED_MAP==="1"){
      const activeBefore=await pending.isVisible();
      const year=page.getByLabel("降水年份",{exact:true});
      await year.selectOption("2023");
      await page.waitForFunction(()=>document.querySelector("canvas[data-painted]")?.dataset.rainLoading==="false",{},{timeout:30000});
      const measuredYear=await year.inputValue();
      await page.getByRole("button",{name:"返回数据分布",exact:true}).click();
      await page.waitForFunction(()=>document.querySelector("canvas[data-painted]")?.dataset.coveragePending==="false",{},{timeout:30000});
      const b=await canvas.boundingBox();
      const focus=Number(await canvas.getAttribute("data-focus-width"))||b.width;
      await page.mouse.click(b.x+focus*.43,b.y+b.height*.42);
      const fly=page.getByRole("button",{name:"定位此网格"});
      await fly.waitFor({timeout:15000});
      await fly.click();
      await page.waitForFunction(()=>document.querySelector("canvas[data-painted]")?.dataset.flying==="true",{},{timeout:3500});
      await page.waitForFunction(()=>document.querySelector("canvas[data-painted]")?.dataset.flying==="false",{},{timeout:10000});
      summary.extendedMap={activeBefore,activeAfter:await pending.isVisible(),year:measuredYear,
        selected:await fly.isVisible(),flew:true};
      assert.ok(summary.extendedMap.activeAfter && summary.extendedMap.activeBefore,"年份和飞行必须发生在真实任务期间");
      assert.ok(transfers.some(r=>r.route.includes("/2023/") && r.fromSpatial && r.status===200));
      await page.screenshot({path:output+"/next-active-selection.png"});
    }
    await page.locator(".message.assistant").last().waitFor({timeout:300000});
    summary.answerShownMs=Date.now()-started;
    if(name==="next"){
      assert.ok(submission,"The workbench used the native AG-UI route");
      const {state,record}=await readNativeChatRecord(base,submission,{timeout:60000});
      assert.ok(record?.result);
      const traces=record.result.runTrace;
      const discovery=traces?.calls.find(call=>call.name==="独立数据发现服务");
      assert.equal(discovery?.status,"done");
      summary.research={taskId:submission.runId,terminalPersistedMs:state.updated-state.created,
        synthesisRetainedSources:traces.calls.some(call=>call.id==="answer-generation"&&call.status==="failed"),
        actualExecutors:traces.timings.map(timing=>({executor:timing.executor,model:timing.model,elapsedMs:timing.elapsedMs}))};
    }
    summary.visibleTiles=transfers.length;
    summary.noPrototypeRequests=true;
    results.systems.push(summary);
    await writeFile(output+"/results.json",JSON.stringify(results,null,2)+"\n");
    await context.close();
  }
} finally {await browser.close();}
