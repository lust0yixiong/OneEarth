import test from 'node:test';
import type {SourceResponse} from '../../server/source-fetch';
import assert from 'node:assert/strict';
import {readPdfPage} from '../../server/read-pdf-page';
import {pdfRangeReader} from '../../server/pdf-ranges';
import {rememberReadEvidence} from './read-evidence';
const url='https://example.org/guide.pdf', hit={url,title:'Satellite guide',snippet:'Search snippet only'};
function document(padding=0,line="Verified example of cloud optical properties and atmospheric retrieval documentation."){
  const lines:string[]=[];for(const word of line.split(' ')){if(!lines.length||lines.at(-1)!.length+word.length>80)lines.push(word);else lines[lines.length-1]+=' '+word;}
  const stream='BT /F1 12 Tf 20 780 Td '+lines.map((text,i)=>(i?'0 -14 Td ':'')+'('+text+') Tj').join(' ')+' ET';
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>','<< /Length '+stream.length+' >>\nstream\n'+stream+'\nendstream','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let body='%PDF-1.4\n';const offsets=[];
  for(const [i,o] of objects.entries()){offsets.push(body.length);body+=(i+1)+' 0 obj\n'+o+'\nendobj\n';}
  body+='%'+ 'x'.repeat(padding)+'\n';
  const offset=body.length;
  return Buffer.from(body+'xref\n0 6\n0000000000 65535 f \n'+offsets.map(i=>String(i).padStart(10,'0')+' 00000 n \n').join('')+'trailer\n<< /Root 1 0 R /Size 6 >>\nstartxref\n'+offset+'\n%%EOF\n');
}
test('Chat PDF evidence includes the physical page number and survives a follow-up',async()=>{
  const result=await readPdfPage(hit,url,new AbortController().signal,async()=>({url,status:200,bytes:document(),headers:{},truncated:false}));
  const reads=rememberReadEvidence([],[{engine:'PDF 原文',status:'done',query:url,hits:result.hits}]);
  assert.match(reads[0].excerpt,/PDF 第 1 页.*Verified example/);assert.equal(reads[0].url,url);
});
test('a login page or incomplete PDF is not a successful page read',async()=>{
  for(const bytes of [Buffer.from('<html>login</html>'),Buffer.from('%PDF-broken')]){
    await assert.rejects(readPdfPage(hit,url,new AbortController().signal,async()=>({url,status:200,bytes,headers:{},truncated:false})));
  }
});

test('PDF without validators uses one bounded complete response, discards probe and records content fingerprint',async()=>{
  const old=document(40000),fresh=document(40000,'Fresh response only: verified measurement fields and corrected atmospheric retrieval documentation.');
  let calls=0;
  const r=await readPdfPage(hit,url,new AbortController().signal,async(_u,_s,options):Promise<SourceResponse>=>{
    calls++;assert.equal(options?.maxBytes,options?.range?4*1024*1024:4*1024*1024-32768);
    return options?.range?{url,status:206,bytes:old.subarray(0,32768),headers:{'content-range':'bytes 0-32767/'+old.length},truncated:false}:{url,status:200,bytes:fresh,headers:{},truncated:false};
  });
  assert.equal(calls,2);assert.match(r.hits[0].pageExcerpt!,/Fresh response only/);assert.match(r.hits[0].pageExcerpt!,/sha256:[a-f0-9]{64}/);
});
test('unvalidated fallback cannot join a second partial response or accept an oversized snapshot',async()=>{
  const pdf=document(40000);
  for(const mode of ['partial','oversize','truncated']){
    let calls=0;
    await assert.rejects(readPdfPage(hit,url,new AbortController().signal,async():Promise<SourceResponse>=>{
      calls++;
      if(calls===1)return {url,status:206,bytes:pdf.subarray(0,32768),headers:{'content-range':'bytes 0-32767/'+pdf.length},truncated:false};
      return {url,status:mode==='partial'?206:200,bytes:mode==='oversize'?Buffer.concat([pdf,Buffer.alloc(4*1024*1024)]):pdf,headers:{},truncated:mode==='truncated'};
    }));assert.equal(calls,2);
  }
});
test('display range reader refuses cross-response assembly without strong validator and serves a complete snapshot without network',async()=>{
  let calls=0;const read=pdfRangeReader(async()=>{calls++;throw Error('must not fetch');});
  const first=Buffer.from('%PDF-1234'),remote={url,size:40000,first,validator:'',at:0};
  await assert.rejects(read('id',remote,32768,39999,new AbortController().signal),/不能拼接/);assert.equal(calls,0);
  const full=Buffer.alloc(40000);const bytes=await read('id',{...remote,first:full},32768,39999,new AbortController().signal);assert.equal(bytes.length,7232);assert.equal(calls,0);
});

test('validated range reads keep exact version checks instead of silently mixing changed documents',async()=>{
  const pdf=document(40000);
  for(const change of [false,true]){
    let calls=0;
    const run=readPdfPage(hit,url,new AbortController().signal,async(_u,_s,o):Promise<SourceResponse>=>{
      calls++;const m=o!.range!.match(/bytes=(\d+)-(\d+)/)!;const begin=Number(m[1]),end=Math.min(Number(m[2]),pdf.length-1);
      return {url,status:206,bytes:pdf.subarray(begin,end+1),headers:{'content-range':`bytes ${begin}-${end}/${pdf.length}`,etag:change&&calls>1?'"new"':'"stable"'},truncated:false};
    });
    if(change)await assert.rejects(run,/版本已变化/);else assert.match((await run).hits[0].pageExcerpt!,/Verified example/);
    assert.ok(calls>1);
  }
});
function manyPages(outline=false){
  const objects=['<< /Type /Catalog /Pages 2 0 R '+(outline?'/Outlines 16 0 R /PageMode /UseOutlines ':'')+'>>','<< /Type /Pages /Kids [3 0 R 5 0 R 7 0 R 9 0 R 11 0 R 13 0 R] /Count 6 >>'];
  for(let i=0;i<6;i++){
    const stream='BT /F1 12 Tf 20 100 Td (Physical page '+(i+1)+': '+(i===5?'APPENDIX_TARGET verified fields and calibration units.':'Introductory material about satellite observation and clouds.')+') Tj ET';
    objects.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Contents '+(4+i*2)+' 0 R /Resources << /Font << /F1 15 0 R >> >> >>','<< /Length '+stream.length+' >>\nstream\n'+stream+'\nendstream');
  }
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  if(outline)objects.push('<< /Type /Outlines /First 17 0 R /Last 17 0 R /Count 1 >>','<< /Title (Questionnaire Appendix - Field Survey) /Parent 16 0 R /Dest [13 0 R /Fit] >>');
  let body='%PDF-1.4\n';const offsets:number[]=[];
  objects.forEach((o,i)=>{offsets.push(body.length);body+=(i+1)+' 0 obj\n'+o+'\nendobj\n';});const offset=body.length;
  return Buffer.from(body+'xref\n0 '+(objects.length+1)+'\n0000000000 65535 f \n'+offsets.map(i=>String(i).padStart(10,'0')+' 00000 n \n').join('')+'trailer\n<< /Root 1 0 R /Size '+(objects.length+1)+' >>\nstartxref\n'+offset+'\n%%EOF\n');
}
test('explicit physical page request is read beyond the introductory pages within the same bounded PDF',async()=>{
  const r=await readPdfPage(hit,url,new AbortController().signal,async()=>({url,status:200,bytes:manyPages(),headers:{},truncated:false}),'请核对第6页 APPENDIX_TARGET');
  assert.match(r.hits[0].pageExcerpt!,/PDF 第 6 页/);assert.match(r.hits[0].pageExcerpt!,/APPENDIX_TARGET/);assert.match(r.hits[0].pageExcerpt!,/文档共 6 页/);
});

test('PDF windows prefer actual question fields late in a page over title and generic earliest mentions, preserving exact offsets',async()=>{
  const {pdfTextWindows}=await import('../../server/read-pdf-worker.mjs');
  const text='Retrieval of wheat biophysical attributes. '+('Atzberger Jarmer reflectance model study. '.repeat(50))+' MATERIALS AND METHODS Ground field measurements: LAI was measured at the same location. SPAD chlorophyll observations used thirty plants per field. '+('Unrelated closing text. '.repeat(30));
  const windows=pdfTextWindows(text,['lai','spad'],['atzberger','jarmer','wheat','reflectance','model','field','measurements'],['retrieval','wheat','biophysical','attributes']);
  assert.ok(windows.some((w:{text:string})=>w.text.includes('SPAD chlorophyll')));assert.ok(windows.some((w:{start:number})=>w.start>1450));
  assert.ok(windows.length<=2);assert.ok(windows.reduce((n:number,w:{text:string})=>n+w.text.length,0)<=1400);
  for(const w of windows)assert.equal(w.text,text.slice(w.start,w.end));
});
test('PDF windows retain two distant requested evidence regions without creating continuous invented text or scanning new pages',async()=>{
  const {pdfTextWindows}=await import('../../server/read-pdf-worker.mjs');
  const text='GROUND MEASUREMENT measured_value original_first. '+('intervening material '.repeat(90))+' VALIDATION uncertainty original_second. '+('tail '.repeat(100));
  const windows=pdfTextWindows(text,['measured_value','uncertainty'],[],[]);
  assert.equal(windows.length,2);assert.ok(windows[0].end<=windows[1].start);assert.ok(windows[0].text.includes('original_first'));assert.ok(windows[1].text.includes('original_second'));
  for(const w of windows)assert.equal(w.text,text.slice(w.start,w.end));
});

test('actual PDF worker returns late ground-measurement text rather than only the title-led first1450 characters',async()=>{
  const text='Satellite guide retrieval introduction. '+('General introductory discussion of reflectance and modelling. '.repeat(45))+' MATERIALS AND METHODS Ground measurements paired LAI samples with SPAD observations. This is the recorded field protocol. '+('Closing discussion. '.repeat(20));
  const r=await readPdfPage(hit,url,new AbortController().signal,async()=>({url,status:200,bytes:document(0,text),headers:{},truncated:false}),
    'satellite guide retrieval introduction reflectance modelling ground measurements','Ground measurements LAI samples');
  assert.match(r.hits[0].pageExcerpt!,/Ground measurements paired LAI samples with SPAD observations/);
  assert.match(r.hits[0].pageExcerpt!,/文本字符 [2-9]\d{3}/);assert.match(r.hits[0].pageExcerpt!,/局部片段/);
});

test('actual PDF outline destination resolves questionnaire appendix to physical page6 within bounded read budget',async()=>{
  let requests=0;
  const r=await readPdfPage(hit,url,new AbortController().signal,async(_u,_s,o)=>{requests++;assert.ok((o?.maxBytes||0)<=4*1024*1024);return {url,status:200,bytes:manyPages(true),headers:{},truncated:false};},
    'field survey appendix questionnaire','请看调查附录里的问卷和记录表');
  assert.match(r.hits[0].pageExcerpt!,/PDF 第 6 页/);assert.match(r.hits[0].pageExcerpt!,/APPENDIX_TARGET/);
  assert.match(r.hits[0].pageExcerpt!,/"status":"matched"/);assert.match(r.hits[0].pageExcerpt!,/"pageNo":6/);assert.equal(requests,1);
});
test('without actual outline the same appendix request does not guess a distant physical page from printed-page hints',async()=>{
  const r=await readPdfPage(hit,url,new AbortController().signal,async()=>({url,status:200,bytes:manyPages(false),headers:{},truncated:false}),
    'field survey appendix questionnaire','请看调查附录里的问卷和记录表');
  assert.doesNotMatch(r.hits[0].pageExcerpt!,/APPENDIX_TARGET|PDF 第 6 页/);assert.match(r.hits[0].pageExcerpt!,/"status":"no-outline"/);
  assert.match(r.hits[0].pageExcerpt!,/物理页码 1, 2, 3, 4/);
});
