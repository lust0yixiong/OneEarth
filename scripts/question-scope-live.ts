// Exercises the deployed UI and its real retrieval endpoints. No intercepted responses.
import {chromium,type Page} from "playwright-core";
import assert from "node:assert/strict";
import {geoOrthographic} from "d3-geo";
import {emptyFilters,fitCamera} from "../src/domain/spatial";
import {mkdir,writeFile} from "node:fs/promises";

const base=process.env.ONEEARTH_URL || "http://127.0.0.1:5274", out="output/question-scope-live";
await mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",headless:true});
async function ask(page:Page,query:string){
  await page.getByLabel("向 OneEarth 提问",{exact:true}).fill(query);
  const request=page.waitForRequest(r=>r.url().endsWith("/api/chat") && r.method()==="POST");
  await page.getByLabel("发送消息",{exact:true}).click();
  const r=await request;const body=r.postDataJSON();
  const response=await r.response();assert.ok(response?.ok());
  const line=(await response.text()).trim().split("\n").at(-1)!;
  const terminal=JSON.parse(line);assert.ok(terminal.result,terminal.error);
  await page.locator(".message.assistant").last().waitFor();
  return {question:body.query,scope:body.context.attachedScope,context:{selection:body.context.selection,period:body.context.filters.period,candidateIds:body.context.candidateIds},
    answer:terminal.result.message,confirmation:terminal.result.questionCheck,calls:terminal.result.runTrace?.calls?.map((c:any)=>({id:c.id,status:c.status,...(c.id==="question-grid"?{output:c.output}:{})}))};
}
async function setup(){const p=await browser.newPage({viewport:{width:1500,height:980},reducedMotion:"reduce"});p.setDefaultTimeout(25000);return p;}
async function direct(){
  const p=await setup();await p.goto(base+"/?task=Q02",{waitUntil:"networkidle"});
  await p.getByRole("button",{name:/阿尔卑斯/}).first().click();
  const camera=fitCamera("Q02",{...emptyFilters(),place:"Hintereisferner"},"all")!;
  const canvas=p.locator("canvas[data-painted]"),box=(await canvas.boundingBox())!,w=Number(await canvas.getAttribute("data-focus-width"));
  const projection=geoOrthographic().rotate(camera.center.map(n=>-n) as [number,number]).translate([w/2,box.height/2]).scale(Math.min(w,box.height)*0.455*camera.zoom);
  const [x,y]=projection([10.7516666667,46.8022222222])!;
  await p.mouse.click(box.x+x,box.y+y);
  await p.getByRole("button",{name:"用此范围提问",exact:true}).click();
  const draft=p.getByRole("group",{name:"本轮提问引用"});
  await draft.waitFor();
  await p.getByRole("button",{name:"查看数据",exact:true}).click();
  await p.getByRole("region",{name:"格内数据列表"}).getByRole("button",{name:/Copernicus.*GLO|DEM/}).first().click();
  await p.getByRole("button",{name:"用此数据集提问"}).click();
  await p.getByLabel("清除选格",{exact:true}).click();
  await p.getByRole("button",{name:/时间轴/}).click();
  await p.getByLabel("起始时段").fill("2020");await p.getByLabel("结束时段").fill("2023");
  await p.getByRole("button",{name:"应用时段"}).click();
  await p.getByRole("button",{name:"用此时段提问"}).click();
  assert.equal(await draft.locator("details").count(),3);
  await p.screenshot({path:out+"/composer.png"});
  await draft.getByRole("button",{name:/移除2020/}).click();
  const q="这个网格内，这个数据集能提供什么地形变量？有实际读到的像元值吗？请区分产品覆盖说明和实读证据。";
  const result=await ask(p,q);
  assert.equal(result.question,q);assert.deepEqual(result.scope.map((i:any)=>i.kind),["grid","dataset"]);
  assert.equal(result.context.period,null);assert.equal(result.context.candidateIds.length,1);
  assert.ok(result.calls?.some((c:any)=>c.id==="question-grid" && c.status==="done"));
  assert.ok(!result.confirmation);
  await writeFile(out+"/direct.json",JSON.stringify(result,null,2));
  const sid=await p.evaluate(()=>history.state.oneearthSession);
  await p.getByLabel("开始新对话",{exact:true}).click();
  await p.getByRole("button",{name:"历史会话",exact:true}).click();
  await p.locator('[data-session-id="'+sid+'"]').click();
  await p.getByRole("group",{name:"提问时引用"}).first().waitFor();
  await p.waitForFunction(id=>history.state.oneearthSession===id,sid);
  await p.reload();
  const old=p.getByRole("group",{name:"提问时引用"}).first();
  await old.locator("summary").first().click();
  assert.ok((await old.innerText()).includes(result.context.selection.id));
  assert.equal(await old.locator("details").count(),2);
  await p.screenshot({path:out+"/history.png"});await p.close();console.log("PASS direct, evidence, removed time, restored history");
}
async function reframe(){
  const p=await setup();await p.goto(base+"/",{waitUntil:"networkidle"});
  await p.getByRole("button",{name:/时间轴/}).click();
  await p.getByLabel("起始时段").fill("2023-01");await p.getByLabel("结束时段").fill("2023-12");
  await p.getByRole("button",{name:"应用时段"}).click();await p.getByRole("button",{name:"用此时段提问"}).click();
  const q="我感觉家乡的夏天变得难熬了。能先帮我把这个感受转成一个可用数据核对的问题，让我确认以后再查吗？";
  const result=await ask(p,q);await writeFile(out+"/confirmation.json",JSON.stringify(result,null,2));
  assert.ok(result.confirmation);
  assert.equal(result.confirmation.originalQuestion,q);assert.ok(result.calls.every((c:any)=>c.id==="data-question"));
  await p.reload();await p.getByRole("region",{name:"确认问题理解"}).waitFor();
  assert.equal(await p.getByRole("group",{name:"提问时引用"}).locator("details").count(),1);
  await p.screenshot({path:out+"/confirmation.png"});await p.close();console.log("PASS genuine confirmation before search, restored after reload");
}
try{const results=await Promise.allSettled([direct(),reframe()]);for(const r of results)if(r.status==="rejected")console.error(r.reason);if(results.some(r=>r.status==="rejected"))process.exitCode=1;}finally{await browser.close();}
