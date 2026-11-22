import assert from "node:assert/strict";
import {mkdir,writeFile} from "node:fs/promises";
import {setTimeout as wait} from "node:timers/promises";
import {chromium} from "playwright-core";

const origin=new URL(process.env.ONEEARTH_URL||"http://127.0.0.1:5474");
assert.notEqual(origin.port,"5174");
const parent=process.env.ONEEARTH_PARENT_TASK||"c4036a5b-0444-4279-b9b0-d6283c9dd4f0";
assert.match(parent,/^[a-f0-9-]{36}$/);
const folder=process.env.ONEEARTH_EVIDENCE_DIR||"evidence/product/rc3/numbered";
await mkdir(folder,{recursive:true});
const cases={
  respond:"只用上一条答复中第 2 个来源已给出的信息，用一句话说它的降水产品是按什么时间尺度整理的。沿用已有摘录即可。",
  read:"回到上一条答复的第 2 个来源。NOAA 说明里有一句在 We do not distribute the 后截断了。能从原页面核对完整说法吗？请只核对这一页。",
  search:"把上一轮第 2 个来源的数据集作为线索。能不能另外推荐一篇用它分析长江流域降水的真实研究？我需要研究区、年份和 DOI 或发表页。",
};
const selected=process.argv.slice(2);
const kinds=selected.length?selected:Object.keys(cases);
assert.ok(kinds.every(kind=>Object.hasOwn(cases,kind)));
const get=async(route,timeout=4000)=>fetch(new URL(route,origin),{signal:AbortSignal.timeout(timeout)});
const health=await get("/api/health").then(response=>response.json());
const previous=await get("/api/tasks/"+parent+"/record").then(response=>response.json());
const ref=previous.result.answerNotes.references[1];
assert.equal(ref.kind,"web");
const priorRead=previous.result.conversationEvidence?.find(item=>item.url===ref.url);
assert.ok(priorRead?.excerptTruncated,"父任务需要保留真实、可核对的截断摘录。");
const publicAddress=value=>{try{const url=new URL(value);return url.origin+url.pathname;}catch{return undefined;}};
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||
  (process.platform==="darwin"?"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome":undefined)});
try{
  for(const kind of kinds){
    const question=process.env.ONEEARTH_QUESTION||cases[kind];
    const ctx=await browser.newContext({viewport:{width:1512,height:859},deviceScaleFactor:1});
    try{
      const page=await ctx.newPage(),prototypeRequests=[];
      page.on("request",r=>{if(new URL(r.url()).port==="5174")prototypeRequests.push(r.url());});
      await page.goto(new URL("/?research="+parent,origin).href);
      await page.locator(".message.assistant").first().waitFor({timeout:30000});
      await page.getByLabel("向 OneEarth 提问",{exact:true}).fill(question);
      const next=page.waitForRequest(request=>request.method()==="POST"&&new URL(request.url()).pathname==="/api/tasks");
      await page.getByLabel("发送消息",{exact:true}).click();
      const {id,input:{previousTaskId}}=(await next).postDataJSON();
      assert.equal(previousTaskId,parent);
      console.log(JSON.stringify({kind,taskId:id,previousTaskId}));
      const route="/api/tasks/"+id;
      let accepted=false;
      for(let n=0;n<50;n++){
        const res=await get(route);
        if(res.ok){accepted=true;break;}
        assert.equal(res.status,404);
        await wait(100);
      }
      assert.ok(accepted);
      const stream=await get(route+"/events",420000);
      assert.ok(stream.ok);
      const events=(await stream.text()).split("\n").filter(Boolean).map(JSON.parse);
      const terminal=events.at(-1),traces=terminal.result?.runTrace||terminal.runTrace;
      const calls=events.filter(e=>e.call).map(e=>({seq:e.seq,...e.call}));
      const parsed=(value)=>{try{return JSON.parse(value);}catch{return undefined;}};
      const ordinal=calls.find(c=>c.id==="citation-ordinal"&&c.status==="done");
      const plan=calls.find(c=>c.id==="turn-action"&&c.status==="done");
      const modelDecision=parsed(plan?.output);
      const reads=calls.filter(c=>/^(read-target|research-read)-/.test(c.id)).map(c=>({id:c.id,seq:c.seq,status:c.status,source:publicAddress(c.input),hits:parsed(c.output)?.hits||0}));
      const discoveries=calls.filter(c=>c.name==="独立数据发现服务").map(c=>({seq:c.seq,id:c.id,status:c.status,
        discoveryId:parsed(c.output)?.discoveryId,channels:parsed(c.output)?.channels}));
      const references=terminal.result?.answerNotes?.references?.map(item=>item.kind==="asset"?{channel:item.sourceChannel,id:item.id}:
        {channel:item.sourceChannel,url:publicAddress(item.url)});
      const data={kind,question,version:health.version,taskId:id,previousTaskId,
        originalCitation:publicAddress(ref.url),originalExcerptTruncated:priorRead.excerptTruncated,
        binding:{seq:ordinal?.seq,sourceId:publicAddress(parsed(ordinal?.output)?.sourceId)},
        decision:{seq:plan?.seq,action:modelDecision?.action,reason:modelDecision?.reason,
          restoredNumberedTarget:modelDecision?.restoredNumberedTarget===true,
          targets:modelDecision?.targets?.map(({key,url,basis})=>({key:publicAddress(url)||key,basis})),},
        reads,discoveries,references,terminal:terminal.result?"complete":terminal.code||"failed",
        executor:traces?.timings?.map(({model,executor,elapsedMs})=>({model,executor,elapsedMs})),
        followOn:traces?.calls?.filter(c=>c.id.startsWith("research-decision-")).map(c=>({status:c.status,action:parsed(c.output)?.action})),
        durationMs:terminal.at-events[0].at,prototypeRequests:prototypeRequests.length};
      await writeFile(folder+"/"+kind+".json",JSON.stringify(data,null,2)+"\n");
      console.log(JSON.stringify({kind,taskId:id,action:data.decision.action,terminal:data.terminal,reads:reads.filter(r=>r.status!=="running"),references}));
      assert.equal(data.terminal,"complete");
      assert.ok(!traces.calls.some(c=>c.id==="answer-generation"&&c.status==="failed"));
      assert.equal(data.binding.sourceId,publicAddress(ref.url));
      assert.equal(data.decision.action,kind);
      assert.ok(data.binding.seq<data.decision.seq);
      assert.ok(data.decision.targets.some(item=>item.basis==="numbered"&&item.key===publicAddress(ref.url)));
      assert.ok(data.executor.length>=2);
      assert.ok(references?.length);
      assert.deepEqual(prototypeRequests,[]);
      if(kind==="respond"){
        assert.equal(reads.length,0);
        assert.equal(discoveries.length,0);
        assert.ok(references.some(item=>item.url===publicAddress(ref.url)));
      }else if(kind==="read"){
        assert.equal(discoveries.length,0);
        assert.ok(reads.some(r=>r.seq>data.decision.seq&&r.status==="done"&&r.hits>0&&r.source===publicAddress(ref.url)));
        assert.ok(references.some(item=>item.url===publicAddress(ref.url)));
      }else{
        assert.ok(discoveries.some(c=>c.seq>data.decision.seq&&c.status==="done"&&c.channels.some(channel=>channel.count>0)));
        assert.ok(references.some(item=>item.id||item.url!==publicAddress(ref.url)));
      }
      await page.locator(".message.assistant").nth(1).waitFor({timeout:30000});
      await page.screenshot({path:folder+"/"+kind+".png"});
    }finally{await ctx.close();}
  }
}finally{await browser.close();}
