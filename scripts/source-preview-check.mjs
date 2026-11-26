import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {isNativeChatSubmission,nativeChatSubmission} from './read-native-chat.mjs';
import {nativeChatFixture} from './native-chat-fixture.mjs';
// Two actual PDF pages with an unused large stream; range loading must avoid the whole file.
function fixturePdf(){
 const objects=[
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 5 0 R >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>',
  ...['First page measured height.','Second page uncertainty is 2 metres.'].map(text=>{const s=`BT /F1 14 Tf 50 720 Td (${text}) Tj ET`;return `<< /Length ${Buffer.byteLength(s)} >>\nstream\n${s}\nendstream`;}),
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  '<< /Length 700000 >>\nstream\n'+' '.repeat(700000)+'\nendstream',
 ];
 let body='%PDF-1.7\n',offsets=[0];for(const [i,obj] of objects.entries()){offsets.push(Buffer.byteLength(body));body+=`${i+1} 0 obj\n${obj}\nendobj\n`;}
 const xref=Buffer.byteLength(body);body+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
 return Buffer.from(body);
}
const base=process.env.ONEEARTH_URL||'http://127.0.0.1:5274',publicUrl='https://example.org/oneearth-preview-fixture',
  webUrl='https://example.org/oneearth-web-fixture',fileUrl='/api/source-preview/files/'+'a'.repeat(64)+'.pdf',pdf=fixturePdf();
if(new URL(base).port==='5174')throw Error('必须使用隔离实例。');
const output=process.env.ONEEARTH_EVIDENCE_DIR;
if(output)await mkdir(output,{recursive:true});
const title='PDF preview fixture', webTitle='网页预览回归样例';
const refs=[{kind:'web',title,url:publicUrl},{kind:'web',title:webTitle,url:webUrl}];
const reply={message:'资料中的不确定度需要核对。〔1〕\n出版方网页另见对应条目。〔2〕',answerNotes:{
  references:refs,webSources:refs.map(ref=>({...ref,snippet:'公开样例。'})),sources:[],reviewed:2,elapsedMs:1,executor:'UI fixture'}};
const b=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try{
 const p=await b.newPage({viewport:{width:1512,height:859},deviceScaleFactor:1});p.setDefaultTimeout(15000);const errors=[],ranges=[];p.on('pageerror',e=>errors.push(e.message));
 await p.route('**/api/source-preview/check',route=>route.fulfill({json:{url:route.request().postDataJSON().url,disposition:'preview'}}));
 await p.route('**/api/ag-ui',route=>nativeChatFixture(route,{response:reply}));
 let failing=false;
 await p.route(webUrl,r=>r.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><meta charset=utf-8><article>数据目录按观测时间组织，样例有独立的版本标识。</article>'}));
 await p.route('**/api/source-preview',r=>r.fulfill(r.request().postDataJSON().url===webUrl ? {json:{kind:'html',title:webTitle,label:'网页正文',
    paragraphs:['数据目录按观测时间组织，样例有独立的版本标识。'],links:[],pdfLinks:[],url:webUrl,originalUrl:webUrl,canEmbed:true,fetchedAt:new Date().toISOString(),truncated:false}} : failing?{status:502,json:{error:'来源站点返回 HTTP 403。'}}:{json:{kind:'pdf',range:true,fileUrl,originalUrl:publicUrl,url:publicUrl,title:'Fixture PDF',fetchedAt:new Date().toISOString(),bytes:pdf.length}}));
 await p.route('**'+fileUrl,async r=>{const m=r.request().headers().range?.match(/bytes=(\d+)-(\d+)/);assert.ok(m);const start=Number(m[1]),end=Number(m[2]);ranges.push([start,end]);await r.fulfill({status:206,headers:{'Content-Type':'application/pdf','Content-Range':`bytes ${start}-${end}/${pdf.length}`,'Accept-Ranges':'bytes'},body:pdf.subarray(start,end+1)});});
 await p.goto(base);await p.getByLabel('向 OneEarth 提问',{exact:true}).fill('预览回归测试');await p.getByLabel('发送消息',{exact:true}).click();await p.locator('.oe-answer-footer').waitFor();
 if(output)await p.screenshot({path:output+'/answer.png'});
 await p.locator('.answer-citation[href="'+webUrl+'"]').first().click();
 await p.frameLocator('.web-source-preview iframe').getByText('数据目录按观测时间组织，样例有独立的版本标识。',{exact:true}).waitFor();
 if(output)await p.screenshot({path:output+'/web-preview.png'});
 await p.getByRole('button',{name:'关闭预览',exact:true}).click().catch(()=>p.keyboard.press('Escape'));
 await p.locator('.answer-citation[href="'+publicUrl+'"]').first().click();
 const reader=p.getByLabel('原始证据预览',{exact:true});await reader.locator('canvas[data-page="1"]').waitFor();await reader.getByRole('button',{name:'下一页',exact:true}).click();await reader.locator('canvas[data-page="2"]').waitFor();
 if(output)await p.screenshot({path:output+'/pdf-preview.png'});
 await reader.getByRole('button',{name:'放大文档',exact:true}).click();await reader.getByRole('button',{name:'适合页宽',exact:true}).filter({hasText:'125%'}).waitFor();await reader.locator('canvas[data-page="2"]').waitFor();
 await p.setViewportSize({width:390,height:844});await reader.locator('canvas[data-page="2"]').waitFor();assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await reader.getByRole('button',{name:'引用到 Chat',exact:true}).click();assert.match(await p.locator('.citation-attachment').innerText(),/PDF 第 2 页文字摘录/);
 const sent=p.waitForRequest(isNativeChatSubmission);await p.getByLabel('向 OneEarth 提问',{exact:true}).fill('说明这个引用页中的不确定度。');await p.getByLabel('发送消息',{exact:true}).click();const input=nativeChatSubmission(await sent);const quote=input.forwardedProps.oneearth.submission.context.citation;assert.match(quote.body,/Second page uncertainty is 2 metres/);assert.equal(quote.url,publicUrl+'#page=2');assert.equal(quote.locator.page,2);await p.locator('.oe-answer-footer').nth(1).waitFor();
 const requested=ranges.reduce((sum,[a,z])=>sum+z-a+1,0);assert.ok(ranges.length>=2);assert.ok(requested<pdf.length,`${requested} must be less than ${pdf.length}`);
 failing=true;await p.locator('.answer-citation[href="'+publicUrl+'"]').last().click();await reader.getByText('来源站点返回 HTTP 403。',{exact:true}).waitFor();assert.equal(await reader.getByRole('link',{name:'在新标签页打开原始来源'}).getAttribute('href'),publicUrl);assert.ok(await reader.getByRole('button',{name:'重试读取',exact:true}).isEnabled());
 assert.deepEqual(errors,[]);console.log('PASS actual two-page PDF rendering, page navigation, range bytes '+requested+'/'+pdf.length+', zoom/mobile, original-URL page quote sent into a follow-up and explicit inaccessible-source fallback.');
}finally{await b.close();}
