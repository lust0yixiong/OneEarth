import assert from "node:assert/strict";
import {mkdir,writeFile} from "node:fs/promises";
import {chromium} from "playwright-core";
import {setTimeout as wait} from "node:timers/promises";

const origin=new URL(process.env.ONEEARTH_URL||"http://127.0.0.1:5474");
assert.notEqual(origin.port,"5174");
const cases={
  direct:"有哪些开放卫星降水产品可以先拿来做中国的月降水对比？给我两个产品名称和官方入口，能确认有月尺度产品就行。",
  additional:"我想核对 NASA IMERG V07 Final Run 的月降水产品。请查清 precipitation 和 randomError 两个字段的单位，以及月产品提供的是平均降水率还是累计量。请给对应的数据字典或产品说明，只有产品首页不能算核实。",
};
const kind=process.argv[2];
assert.ok(Object.hasOwn(cases,kind),"用法 accept-research-decisions.mjs direct|additional");
const question=process.env.ONEEARTH_QUESTION||cases[kind];
const out=process.env.ONEEARTH_EVIDENCE_DIR||"evidence/product/candidate";
await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||
  (process.platform==="darwin"?"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome":undefined)});
const page=await browser.newPage({viewport:{width:1512,height:859},deviceScaleFactor:1});
const submits=[],prototype=[];
const millis=Date.now();
const record={kind,question,entry:origin.origin,browser:browser.version(),startedAt:new Date(millis).toISOString()};
function json(raw){try{return JSON.parse(raw);}catch{return undefined;}}
function publicAddress(value){
  if(!value)return;
  try{const url=new URL(value);return url.origin+url.pathname;}catch{return;}
}
function materials(data){
  return data?{papers:data.papers,haina:data.haina,web:data.web?.map(publicAddress).filter(Boolean)}:undefined;
}
async function save(){await writeFile(out+"/"+kind+".json",JSON.stringify(record,null,2)+"\n");}
page.on("request",request=>{
  const url=new URL(request.url());
  if(url.port==="5174")prototype.push(url.origin);
  if(["/api/chat/messages","/api/tasks"].includes(url.pathname)&&request.method()==="POST")submits.push(request.postDataJSON().id);
});
try{
  const existing=process.env.ONEEARTH_REOPEN_TASK;
  await page.goto(existing?new URL("/?research="+existing,origin).href:origin.href);
  record.version=(await fetch(new URL("/api/health",origin)).then(response=>response.json())).version;
  if(existing){
    assert.match(existing,/^[a-f0-9-]{36}$/);
    record.taskId=existing;
    record.reopenedFromOriginalSubmission=true;
    const stored=await fetch(new URL("/api/tasks/"+existing+"/record",origin)).then(response=>response.json());
    assert.equal(stored.question,question);
  }else{
    await page.getByLabel("向 OneEarth 提问",{exact:true}).fill(question);
    const submitted=page.waitForRequest(request=>request.method()==="POST"&&["/api/chat/messages","/api/tasks"].includes(new URL(request.url()).pathname));
    await page.getByLabel("发送消息",{exact:true}).click();
    record.taskId=(await submitted).postDataJSON().id;
  }
  const route="/api/tasks/"+record.taskId;
  let accepted=false;
  for(let n=0;n<50;n++){
    const status=await fetch(new URL(route,origin)).then(response=>response.status);
    if(status===200){accepted=true;break;}
    assert.equal(status,404,"任务提交状态");
    await wait(100);
  }
  assert.ok(accepted,"网页提交的任务应持久化后再读取事件。");
  await save();
  console.log(JSON.stringify({kind,taskId:record.taskId,accepted}));
  if(!existing&&kind==="additional"&&process.env.ONEEARTH_REFRESH!=="0"){
    await page.locator(".oe-findings").first().waitFor({timeout:160000});
    const pending=await page.request.get(new URL(route,origin).href).then(response=>response.json());
    record.beforeRefresh=pending.status;
    await page.screenshot({path:out+"/"+kind+"-before-refresh.png"});
    assert.equal(pending.status,"running");
    await page.reload();
  }
  const response=await page.request.get(new URL(route+"/events",origin).href,{timeout:420000});
  assert.ok(response.ok());
  const events=(await response.text()).split("\n").filter(Boolean).map(JSON.parse);
  const last=events.at(-1),result=last.result,traces=result?.runTrace||last.runTrace;
  const entries=[];
  for(const event of events){
    const c=event.call;
    if(!c||c.status==="running")continue;
    const common={seq:event.seq,at:event.at,id:c.id,status:c.status};
    const input=json(c.input),output=json(c.output);
    if(c.id==="turn-action")entries.push({...common,type:"initial-decision",action:output?.action});
    if(c.id.startsWith("research-decision-"))entries.push({...common,type:"evidence-decision",
      action:output?.action,reason:output?.reason,gap:output?.gap,targets:output?.targets?.map(publicAddress),fallback:output?.fallback,
      visibleMaterials:{papers:input?.papers,haina:input?.haina,web:input?.web?.map(item=>({...item,url:publicAddress(item.url)})),
        channels:input?.channels,reads:input?.exactReads?.map(r=>({...r,query:publicAddress(r.query)}))}});
    if(c.name==="独立数据发现服务")entries.push({...common,type:"discovery",
      childId:output?.discoveryId||input?.discoveryId||(input?.messageId?null:record.taskId),
      previousId:input?.previousId,channels:output?.channels,materials:materials(output?.materials)});
    if(c.id.startsWith("research-read-"))entries.push({...common,type:"exact-read",source:publicAddress(c.input),returnedHits:output?.hits||0});
    if(c.id==="answer-generation")entries.push({...common,type:"retained-sources-fallback"});
  }
  if(existing)record.browserReopenedAt=record.startedAt;
  record.startedAt=new Date(events[0].at).toISOString();
  Object.assign(record,{result:result?"complete":last.code||"failed",elapsedMs:last.at-events[0].at,entries,
    prototypeRequests:prototype.length,distinctBrowserTaskIds:[...new Set(submits)],findings:events.filter(e=>e.finding?.items?.length).map(e=>({seq:e.seq,
      channel:e.finding.source,identities:e.finding.items.map(item=>item.assetId||publicAddress(item.url)).filter(Boolean)})),
    executors:traces?.timings?.map(({model,executor,elapsedMs,startedAt})=>({model,executor,elapsedMs,startedAt})),
    references:result?.answerNotes?.references?.map(ref=>ref.kind==="asset"?{channel:ref.sourceChannel,id:ref.id}:{channel:ref.sourceChannel,url:publicAddress(ref.url)})});
  await save();
  console.log(JSON.stringify({kind,id:record.taskId,outcomes:entries.filter(e=>["evidence-decision","discovery","exact-read"].includes(e.type))
    .map(({type,status,action,returnedHits})=>({type,status,action,returnedHits})),references:record.references?.length,result:record.result}));
  assert.ok(result?.answerNotes?.references?.length,"真实研究答复需要可打开的最终引用。");
  assert.ok(!entries.some(e=>e.type==="retained-sources-fallback"),"本组验收需要有证据支撑的实际答复。");
  assert.deepEqual(record.distinctBrowserTaskIds,existing?[]:[record.taskId]);
  assert.deepEqual(prototype,[]);
  assert.ok(record.executors?.length>=3);
  const firstDiscovery=entries.find(e=>e.type==="discovery"&&e.status==="done");
  assert.ok(firstDiscovery?.materials&&(firstDiscovery.materials.papers.length||firstDiscovery.materials.haina.length||firstDiscovery.materials.web.length));
  const decisions=entries.filter(e=>e.type==="evidence-decision");
  assert.ok(decisions[0].seq>firstDiscovery.seq);
  assert.equal(decisions.at(-1).action,"answer");
  if(kind==="direct"){
    assert.equal(decisions.length,1);
    assert.equal(entries.filter(e=>e.type==="discovery").length,1);
    assert.ok(!entries.some(e=>e.type==="exact-read"));
  }else{
    const additional=decisions.find(e=>["read","discover"].includes(e.action));
    assert.ok(additional,"材料不足必须由模型实际选出下一次调用。");
    assert.ok(entries.some(e=>e.seq>additional.seq&&e.seq<decisions.at(-1).seq&&e.status==="done"&&
      (additional.action==="read"?e.type==="exact-read"&&e.returnedHits>0:e.type==="discovery"&&e.previousId===firstDiscovery.childId)));
  }
  await page.locator(".message.assistant").waitFor({timeout:30000});
  await page.screenshot({path:out+"/"+kind+".png"});
}finally{await browser.close();}
