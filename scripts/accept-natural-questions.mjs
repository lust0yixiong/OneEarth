import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { mkdir, writeFile } from "node:fs/promises";
import {isNativeChatSubmission,nativeChatSubmission,readNativeChatRecord} from "./read-native-chat.mjs";

const base = new URL(process.env.ONEEARTH_URL || "http://127.0.0.1:5474");
assert.notEqual(base.port, "5174");
const output = process.env.ONEEARTH_EVIDENCE_DIR || "evidence/product/natural-questions";
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH ||
  (process.platform==="darwin"?"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome":undefined)});
const scenarios=[
  {kind:"method",question:"我想比较干旱区和湿润区的闪旱发生率。用土壤湿度百分位做阈值时，怎么避免把气候差异误判成闪旱差异？先讲比较方法，不需要找资料。",action:"respond",discoveries:0,check:/百分位|基准期|季节/},
  {kind:"ambiguity",question:"把它们的空间分辨率比较一下，哪一个更适合我这里？",action:"clarify",discoveries:0},
  {kind:"discovery",question:"想知道川西滑坡的缓慢变形能不能和降雨对应起来。我想先比较过去几年的 InSAR 时序和降水产品，有哪些研究资料能用？最好说明范围和出处。",action:"search",discoveries:1},
];
const results=[];
try{
  for(const scenario of scenarios){
    const ctx=await browser.newContext({viewport:{width:1512,height:859},deviceScaleFactor:1});
    try{
      const page=await ctx.newPage();
      const calls=[];
      page.on("request",request=>{if(new URL(request.url()).port==="5174")calls.push(request.url());});
      await page.goto(base.href);
      await page.getByLabel("向 OneEarth 提问",{exact:true}).fill(scenario.question);
      const submitted=page.waitForRequest(isNativeChatSubmission);
      const started=Date.now();
      await page.getByLabel("发送消息",{exact:true}).click();
      const input=nativeChatSubmission(await submitted),id=input.runId;
      const {state,record}=await readNativeChatRecord(base,input);
      const answer=record?.result;
      const traces=answer?.runTrace;
      const plan=traces?.calls?.find(call=>call.id==="turn-action"&&call.status==="done");
      const action=plan ? JSON.parse(plan.output).action : undefined;
      const discoveries=traces?.calls?.filter(call=>call.name==="独立数据发现服务"&&call.status==="done").length || 0;
      const refs=answer?.answerNotes?.references || [];
      const result={kind:scenario.kind,question:scenario.question,id,status:state.status,
        action,discoveries,proofCount:refs.length,channels:[...new Set(refs.map(ref=>ref.sourceChannel).filter(Boolean))],
        actualExecutors:(traces?.timings || []).map(t=>({executor:t.executor,model:t.model,elapsedMs:t.elapsedMs})),
        elapsedMs:Date.now()-started,prototypeRequests:calls.length};
      results.push(result);
      await writeFile(output+"/results.json",JSON.stringify({entry:base.origin,browser:browser.version(),results},null,2)+"\n");
      console.log(JSON.stringify(result));
      assert.ok(answer,scenario.kind+" 要得到答复或澄清。");
      assert.equal(action,scenario.action,scenario.kind+" 要走适当动作。");
      assert.equal(discoveries,scenario.discoveries);
      assert.ok(result.actualExecutors.length,scenario.kind+" 要经过真实执行器。");
      assert.deepEqual(calls,[]);
      if(scenario.check)assert.match(answer.message,scenario.check);
      if(scenario.kind==="ambiguity")assert.ok(answer.clarification);
      if(scenario.kind==="discovery")assert.ok(refs.some(ref=>ref.sourceChannel==="assertion"||ref.sourceChannel==="web"));
      await page.locator(".message.assistant").first().waitFor();
      await page.screenshot({path:output+"/"+scenario.kind+".png"});
    }finally{await ctx.close();}
  }
} finally {await browser.close();}
