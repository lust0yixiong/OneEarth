import fs from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';import {chromium} from 'playwright-core';
const base='http://127.0.0.1:5180',out=path.resolve('output/research-intent-update');
const turns=await Promise.all([1,2].map(async n=>JSON.parse(await fs.readFile(out+'/live-turn-'+n+'.json','utf8'))));
for(const t of turns)assert(t.result.researchIntent && !t.result.error);
const ids=turns.map(t=>t.result.answerNotes.references.find(r=>r.kind==='asset' && /Aqua.*MODIS|MODIS.*Aqua/i.test(r.title))?.id);
assert(ids.every(Boolean),'both answers should retain the identified Aqua product');
const b=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--enable-unsafe-swiftshader']});
const ctx=await b.newContext({viewport:{width:1430,height:960},reducedMotion:'reduce',storageState:out+'/live-browser-state.json'});
const p=await ctx.newPage();p.setDefaultTimeout(20000);
try{
 await p.goto(base+'/?view=chat');await p.waitForFunction(()=>!!document.querySelector('.chat-panel'));
 const sid=await p.evaluate(()=>new Promise((resolve,reject)=>{const r=indexedDB.open('oneearth.sessions.v1');r.onsuccess=()=>{const db=r.result;const q=db.transaction('sessions').objectStore('sessions').getAll();q.onsuccess=()=>{resolve(q.result[0]?.id);db.close();};};r.onerror=reject;}));
 await ctx.addInitScript(sid=>history.replaceState({...history.state,oneearthSession:sid,oneearthPath:location.pathname+location.search},''),sid);
 await p.goto(base+'/?view=chat');await p.locator('.message.assistant').nth(1).waitFor();
 for(let n=0;n<2;n++){
  const a=p.locator('.message.assistant').nth(n);
  await a.locator('button.answer-citation[data-asset-id="'+ids[n]+'"]').first().click();
  await p.getByRole('button',{name:'保存这份资料到研究清单',exact:true}).click();
  await p.getByRole('button',{name:'已保存到研究清单',exact:true}).waitFor();await p.getByLabel('关闭数据速览',{exact:true}).click();
 }
 const saved=await p.evaluate(()=>Object.entries(localStorage).filter(([k])=>k.startsWith('oneearth.research-list.v1.')).map(([,v])=>JSON.parse(v)));
 assert.equal(saved.length,2);assert.equal(saved[0].items[0].identity,saved[1].items[0].identity);
 const summer=saved.find(s=>s.question==='只看夏季呢？');assert.deepEqual(summer.researchRecord.intent.months,[6,7,8]);
 const input=p.getByLabel('向 OneEarth 提问',{exact:true});await input.fill('打开研究清单');await p.getByLabel('发送消息',{exact:true}).click();
 const product=p.locator('.research-product');await product.waitFor();assert.equal(await product.count(),1);await product.locator('summary').click();assert.equal(await p.locator('.research-record').count(),2);
 await p.screenshot({path:out+'/live-saved-library.png'});
 await fs.writeFile(out+'/live-saved-check.json',JSON.stringify({passed:true,source:'real two-turn conversation and actual saved products',productIds:ids,records:saved.map(s=>({question:s.question,intent:s.researchRecord.intent,note:s.researchRecord.notes.find(n=>n.id===s.items[0].id)?.note}))},null,2));
 console.log('PASS real answers save as one product with two original questions, intent snapshots and seasonal scope');
}finally{await b.close()}
