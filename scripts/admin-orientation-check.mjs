import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {readActiveWorkspace} from './read-active-workspace.mjs';
const base=process.env.ONEEARTH_URL || 'http://127.0.0.1:5274';
for(let retry=0;retry<40;retry++){
 if(await fetch(base+'/api/health').then(r=>r.ok).catch(()=>false))break;
 await new Promise(resolve=>setTimeout(resolve,250));
}
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const errors=[],calls=[];
try{
 const context=await browser.newContext({viewport:{width:1440,height:960}});
 await context.addInitScript(()=>{if(!sessionStorage.getItem('orientation-seeded')){localStorage.setItem('oneearth.workspace.v1',JSON.stringify({caseId:null,camera:{center:[103.98,22.25],zoom:4,reason:'行政区视野核验'},chatOpen:false,messages:[]}));sessionStorage.setItem('orientation-seeded','1');}});
 const page=await context.newPage();page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));
 page.on('request',r=>{if(r.url().includes('/api/orientation?'))calls.push(new URL(r.url()).searchParams.get('level'));});
 await page.goto(base+'/',{waitUntil:'networkidle'});await page.locator('canvas[data-painted]').waitFor();
 const hint=page.locator('.earth-location');await page.waitForFunction(()=>document.querySelector('.location-path')?.textContent.includes('越南'));
 assert.doesNotMatch(await hint.innerText(),/Lào Cai|Sa Pa/);assert.equal(calls.length,0);
 async function zoomUntil(target){
   for(let i=0;i<45;i++){const current=await page.evaluate(readActiveWorkspace);if(current.camera.zoom>=target)return;await page.getByLabel('放大地球',{exact:true}).click();await page.waitForTimeout(180);}
   throw Error('Zoom target not reached');
 }
 await zoomUntil(8);await page.waitForFunction(()=>document.querySelector('.location-path')?.textContent.includes('Lào Cai'));
 assert.doesNotMatch(await page.locator('.location-path').innerText(),/Sa Pa/);
 await zoomUntil(32);await page.waitForFunction(()=>document.querySelector('.location-path')?.textContent.includes('Sa Pa'));
 assert.deepEqual([...new Set(calls)],['1','2']);
 await page.getByLabel('行政区位置依据',{exact:true}).click();
 assert.match(await page.locator('.location-provenance-panel').innerText(),/2008.*区划[\s\S]*2020.*区划/);
 await page.screenshot({path:'/tmp/oneearth-administrative-detail.png'});
 await page.getByLabel('行政区位置依据',{exact:true}).click();
 const before=calls.length;await zoomUntil(120);await page.waitForTimeout(650);
 assert.equal(calls.length,before,'No extra requests for levels absent from the source');
 await page.screenshot({path:'/tmp/oneearth-administrative-vietnam.png'});
 if(await page.getByLabel('收起 Chat',{exact:true}).count())await page.getByLabel('收起 Chat',{exact:true}).click();
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(350);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.screenshot({path:'/tmp/oneearth-administrative-mobile.png'});
 assert.deepEqual(errors,[]);console.log(JSON.stringify({status:'PASS',label:await page.locator('.location-path').innerText(),requestedLevels:calls,mobileOverflow:await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth),errors},null,2));
}finally{await browser.close();}
