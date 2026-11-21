import test,{type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {createHash} from 'node:crypto';
import {mkdtemp,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {publicSourceAddress,sourceUrl,fetchSource,type SourceRequest,type SourceResponse} from '../../server/source-fetch';
import {extractSourceHtml,sourcePreview} from '../../server/source-preview';
import {readSourcePreview} from './source-preview';
const response=(url:string,body:string,status=200,headers:Record<string,string>={'content-type':'text/html'}):SourceResponse=>({url,status,headers,bytes:Buffer.from(body),truncated:false});
const article='<html><head><title>Published dataset</title><meta name="citation_pdf_url" content="/download/1"></head><body><nav>Menu only</nav><article><h1>Actual published record</h1><p>'+('Measured canopy height and uncertainty for the observed study area. '.repeat(8))+'</p><p><a href="/methods">Read methods</a></p><script>evil()</script></article></body></html>';
async function service(t:TestContext,request:SourceRequest,timeoutMs?:number){
  const root=await mkdtemp(path.join(tmpdir(),'oe-source-test-'));
  const directory=path.join(root,".local","source-preview");
  const app=express();app.use(express.json());app.use('/api/source-preview',sourcePreview(directory,{request,timeoutMs}));
  const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
  t.after(async()=>{await new Promise<void>(r=>server.close(()=>r()));await rm(root,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+(server.address() as {port:number}).port;
  const read=(url:string,refresh=false)=>fetch(base+'/api/source-preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url,refresh})});
  return {base,read,directory};
}

test('source reads reject private, reserved, mapped and non-HTTP addresses',()=>{
  for(const ip of ['127.0.0.1','10.107.207.77','192.168.1.1','169.254.169.254','100.64.0.1','0.0.0.0','198.18.0.1','224.0.0.1','::1','::ffff:127.0.0.1','fe80::1','fc00::1','2001:db8::1','2002:7f00:1::'])assert.equal(publicSourceAddress(ip),false,ip);
  for(const ip of ['8.8.8.8','1.1.1.1','2606:4700:4700::1111'])assert.equal(publicSourceAddress(ip),true);
  for(const url of ['file:///tmp/x','ftp://example.org/file','http://127.1/','http://[::1]/','http://example.org:5433/','https://user:pass@example.org/'])assert.throws(()=>sourceUrl(url));
  assert.equal(sourceUrl('https://example.org/record#page=3').href,'https://example.org/record');
});

test('DOI redirects can cross public origins; private redirects and loops stop before any private request',async()=>{
  const visited:string[]=[];
  const request:SourceRequest=async url=>{visited.push(url.href);return url.hostname==='doi.org'?response(url.href,'',302,{location:'https://publisher.org/record'}):response(url.href,article);};
  assert.equal((await fetchSource('https://doi.org/10.1/id',AbortSignal.timeout(1000),request)).url,'https://publisher.org/record');
  assert.equal(visited.length,2);
  let calls=0;
  await assert.rejects(fetchSource('https://example.org',AbortSignal.timeout(1000),async url=>{calls++;return response(url.href,'',302,{location:'http://10.107.207.77:5433/'});}),/公开来源|标准/);
  assert.equal(calls,1);
  await assert.rejects(fetchSource('https://example.org',AbortSignal.timeout(1000),async url=>response(url.href,'',302,{location:'/loop'})),/跳转/);
  await assert.rejects(fetchSource('https://example.org',AbortSignal.timeout(1000),async url=>response(url.href,'',403)),/HTTP 403/);
});

test('Readability extracts actual article text and PDF metadata without executing or including scripts',()=>{
  const parsed=extractSourceHtml(article,'https://example.org/record');
  assert.ok(parsed.paragraphs.some(p=>p.includes('Measured canopy height')));
  assert.ok(parsed.paragraphs.every(p=>!p.includes('evil()')&&!p.includes('Menu only')));
  assert.deepEqual(parsed.pdfLinks,[{title:'PDF 原文',url:'https://example.org/download/1'}]);
  assert.ok(parsed.links.some(l=>l.url==='https://example.org/methods'));
  assert.throws(()=>extractSourceHtml('<title>Just a moment...</title><p>Verifying</p>','https://example.org'),/验证|限制/);
  assert.equal(extractSourceHtml('<html><head><meta name="description" content="Publisher catalogue summary"></head><body><div id="app"></div></body></html>','https://example.org').label,'发布方页面摘要');
});

test('source API caches actual reads, refreshes explicitly, reports inaccessible sites and serves detected PDFs with Range',async t=>{
  let calls=0;
  const s=await service(t,async url=>{
    calls++;
    if(url.pathname==='/blocked')return response(url.href,'',403);
    if(url.pathname==='/download')return response(url.href,'%PDF-1.7\nactual PDF bytes',200,{'content-type':'application/octet-stream'});
    return response(url.href,article,200,{'content-type':'text/html;charset=utf-8','x-frame-options':'DENY'});
  });
  const one=readSourcePreview(await(await s.read('https://example.org/record')).json());
  assert.equal(one.kind,'html');if(one.kind==='html')assert.equal(one.canEmbed,false);
  await s.read('https://example.org/record');assert.equal(calls,1);
  await s.read('https://example.org/record',true);assert.equal(calls,2);
  const blocked=await s.read('https://example.org/blocked');assert.equal(blocked.status,502);assert.equal((await blocked.json()).code,'SOURCE_HTTP_403');
  const pdf=readSourcePreview(await(await s.read('https://example.org/download')).json());assert.equal(pdf.kind,'pdf');
  if(pdf.kind!=='pdf')throw Error('PDF not detected');
  const full=await fetch(s.base+pdf.fileUrl);assert.equal(full.headers.get('content-type'),'application/pdf');assert.match(await full.text(),/^%PDF-/);
  const range=await fetch(s.base+pdf.fileUrl,{headers:{Range:'bytes=0-4'}});assert.equal(range.status,206);assert.equal(await range.text(),'%PDF-');
  assert.equal((await fetch(s.base+'/api/source-preview/files/'+('f'.repeat(64))+'.pdf')).status,410);
  assert.equal((await fetch(s.base+'/api/source-preview/files/secrets.pdf')).status,404);
  assert.equal((await s.read('http://127.0.0.1/private')).status,400);
});

test('script-rendered webpages still open when they have no extractable text and reject range probes',async t=>{
  const s=await service(t,async(url,_signal,options)=>options?.range ? response(url.href,'',416) :
    response(url.href,'<title>Data portal</title><main id="app"></main><script src="/app.js"></script>'));
  const preview=readSourcePreview(await(await s.read('https://example.org/app')).json());
  assert.equal(preview.kind,'html');
  if(preview.kind==='html'){assert.equal(preview.canEmbed,true);assert.deepEqual(preview.paragraphs,[]);}
});

test('malformed/truncated binary responses do not become cached complete PDFs',async t=>{
  const s=await service(t,async url=>({...response(url.href,'%PDF-1.7 incomplete',200,{'content-type':'text/html'}),truncated:true}));
  const result=await s.read('https://example.org/download');assert.equal(result.status,502);assert.match((await result.json()).error,/不完整/);
  assert.throws(()=>readSourcePreview({kind:'pdf',title:'x',url:'https://x.org',originalUrl:'https://x.org',fetchedAt:'now',fileUrl:'file:///tmp/private.pdf'}));
});

test('large PDF metadata and page ranges read only needed bytes and preserve validators',async t=>{
  const complete=Buffer.concat([Buffer.from('%PDF-1.7\n'),Buffer.alloc(750000,32)]),calls:{range?:string;ifRange?:string}[]=[];
  const s=await service(t,async(url,_signal,options)=>{
    calls.push(options||{});const match=options?.range?.match(/^bytes=(\d+)-(\d+)$/);assert.ok(match);
    const start=Number(match[1]),end=Math.min(Number(match[2]),complete.length-1);
    return {url:url.href,status:206,headers:{'content-type':'application/pdf','content-range':`bytes ${start}-${end}/${complete.length}`,etag:'"edition-1"'},bytes:complete.subarray(start,end+1),truncated:false};
  });
  const pdf=readSourcePreview(await(await s.read('https://example.org/book.pdf')).json());
  assert.equal(pdf.kind,'pdf');if(pdf.kind!=='pdf')throw Error('Not PDF');assert.equal(pdf.range,true);assert.equal(pdf.bytes,complete.length);
  const first=await fetch(s.base+pdf.fileUrl,{headers:{Range:'bytes=0-8191'}});assert.equal(first.status,206);assert.deepEqual(Buffer.from(await first.arrayBuffer()),complete.subarray(0,8192));assert.equal(calls.length,1);
  const second=await fetch(s.base+pdf.fileUrl,{headers:{Range:'bytes=262144-327679'}});assert.equal(second.status,206);assert.deepEqual(Buffer.from(await second.arrayBuffer()),complete.subarray(262144,327680));assert.equal(calls.at(-1)?.ifRange,'"edition-1"');
  const countAfterRead=calls.length;
  const overlap=await fetch(s.base+pdf.fileUrl,{headers:{Range:'bytes=262150-310000'}});
  assert.deepEqual(Buffer.from(await overlap.arrayBuffer()),complete.subarray(262150,310001));
  assert.equal(calls.length,countAfterRead);
  assert.equal((await fetch(s.base+pdf.fileUrl,{headers:{Range:'bytes=0-999999999'}})).status,416);
});

test('Markdown downloads keep formatting and use the final public URL for relative links',async t=>{
  const markdown = '# Heights\n\n| Site | Value |\n| --- | --- |\n| A | 10 |\n\n[Methods](methods.md)';
  let calls = 0;
  const s = await service(t, async url => {
    calls++;
    if (url.pathname.endsWith('/denied.md')) return response(url.href,'<html><title>Access denied</title></html>',200,{'content-type':'text/html'});
    if (url.pathname === '/download') return response(url.href,markdown,200,{'content-type':'application/octet-stream','content-disposition':'attachment; filename="field-notes.md"'});
    assert.equal(url.hostname,'raw.githubusercontent.com');
    const bytes=Buffer.from(markdown);
    return response(url.href, markdown, 206, {'content-type':'text/plain','content-range':'bytes 0-'+(bytes.length-1)+'/'+bytes.length});
  });
  const result=readSourcePreview(await(await s.read('https://github.com/example/data/blob/main/README.md')).json());
  assert.equal(result.kind,'markdown');
  if(result.kind==='markdown'){assert.equal(result.body,markdown);assert.equal(result.url,'https://raw.githubusercontent.com/example/data/main/README.md');}
  assert.equal(calls,1);
  assert.equal((await(await s.read('https://example.org/download')).json()).kind,'markdown');
  assert.equal((await s.read('https://example.org/denied.md')).status,502);
});

test('unvalidated and weak-ETag PDF previews use a complete snapshot and content-addressed immutable file, rechecking URL on reopen',async t=>{
  for(const etag of ['', 'W/"unstable"']){
    let revision=1,calls=0;
    const bytes=()=>Buffer.concat([Buffer.from('%PDF-1.7\nversion '+revision+'\n'),Buffer.alloc(20000,revision)]);
    const s=await service(t,async(url,_signal,o):Promise<SourceResponse>=>{
      calls++;const full=bytes();
      if(o?.range){assert.equal(o.maxBytes,4*1024*1024);return {url:url.href,status:206,bytes:full.subarray(0,8192),headers:{'content-range':`bytes 0-8191/${full.length}`,etag},truncated:false};}
      assert.equal(o?.maxBytes,4*1024*1024-8192);
      return {url:url.href,status:200,bytes:full,headers:{etag},truncated:false};
    });
    const first=readSourcePreview(await(await s.read('https://example.org/unversioned.pdf')).json());
    assert.equal(first.kind,'pdf');if(first.kind!=='pdf')throw Error('Not PDF');assert.notEqual(first.range,true);
    const old=bytes(),name=createHash('sha256').update(old).digest('hex')+'.pdf';assert.ok(first.fileUrl.endsWith(name));
    revision=2;
    const second=readSourcePreview(await(await s.read('https://example.org/unversioned.pdf')).json());
    assert.equal(second.kind,'pdf');if(second.kind!=='pdf')throw Error('Not PDF');assert.notEqual(second.fileUrl,first.fileUrl);assert.equal(calls,4);
    assert.deepEqual(Buffer.from(await(await fetch(s.base+first.fileUrl)).arrayBuffer()),old);
    assert.deepEqual(Buffer.from(await(await fetch(s.base+second.fileUrl)).arrayBuffer()),bytes());assert.equal(calls,4);
    const range=await fetch(s.base+second.fileUrl,{headers:{Range:'bytes=10-30'}});assert.equal(range.status,206);assert.deepEqual(Buffer.from(await range.arrayBuffer()),bytes().subarray(10,31));
  }
});
test('already complete PDF snapshots are named by content even across different unversioned URLs',async t=>{
  let calls=0;const body='%PDF-1.7\nIdentical snapshot bytes';
  const s=await service(t,async url=>{calls++;return response(url.href,body,200,{'content-type':'application/pdf'});});
  const first=await(await s.read('https://example.org/a.pdf')).json(),second=await(await s.read('https://other.org/b.pdf')).json();
  assert.equal(first.fileUrl,second.fileUrl);assert.ok(first.fileUrl.endsWith(createHash('sha256').update(body).digest('hex')+'.pdf'));assert.equal(calls,2);
});
test('unvalidated PDF fallback rejects partial, oversized, truncated and private-redirect responses without caching a PDF',async t=>{
  for(const mode of ['partial','oversized','truncated','private']){
    let calls=0;const pdf=Buffer.concat([Buffer.from('%PDF-1.7\n'),Buffer.alloc(20000)]);
    const s=await service(t,async url=>{
      calls++;
      if(calls===1)return {url:url.href,status:206,bytes:pdf.subarray(0,8192),headers:{'content-range':`bytes 0-8191/${pdf.length}`},truncated:false};
      if(mode==='private')return response(url.href,'',302,{location:'http://127.0.0.1/private'});
      return {url:url.href,status:mode==='partial'?206:200,bytes:mode==='oversized'?Buffer.concat([pdf,Buffer.alloc(4*1024*1024)]):pdf,headers:{},truncated:mode==='truncated'};
    });
    const res=await s.read('https://example.org/bad.pdf');assert.ok(res.status>=400);assert.equal(calls,2);assert.deepEqual(await readdir(s.directory).catch(()=>[]),[]);
  }
});
test('unvalidated PDF fallback retains the preview deadline and reports timeout',async t=>{
  let calls=0;
  const s=await service(t,async(url,signal)=>{
    calls++;
    if(calls===1)return {url:url.href,status:206,bytes:Buffer.from('%PDF-1.7\n'),headers:{'content-range':'bytes 0-8/20000'},truncated:false};
    return new Promise<SourceResponse>((_resolve,reject)=>{if(signal.aborted)reject(signal.reason);else signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});
  },30);
  const r=await s.read('https://example.org/slow.pdf');assert.equal(r.status,502);assert.equal((await r.json()).code,'WEB_FETCH_TIMEOUT');assert.equal(calls,2);
});

test('preflight checks redirects, framing restrictions and refusals before choosing a preview, without reading private URLs',async t=>{
  const visited:string[]=[];
  const s=await service(t,async(url,_signal,options)=>{
    visited.push(url.href);
    if(url.pathname==='/doi')return response(url.href,'',302,{location:'/denied'});
    if(url.pathname==='/denied')return response(url.href,article,200,{'content-type':'text/html','x-frame-options':'SAMEORIGIN'});
    if(url.pathname==='/csp')return response(url.href,article,200,{'content-type':'text/html','content-security-policy':"frame-ancestors 'self'"});
    if(url.pathname==='/403')return response(url.href,'',403);
    if(url.pathname==='/book')return response(url.href,'%PDF-1.7\nfixture',200,{'content-type':'application/pdf'});
    if(url.pathname==='/notes.md')return response(url.href,'# Method\n\nActual notes',200,{'content-type':'text/markdown'});
    if(url.pathname==='/dynamic' && options?.range)return response(url.href,'',416);
    return response(url.href,article);
  });
  const check=(url:string)=>fetch(s.base+'/api/source-preview/check',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url})});
  for(const path of ['/doi','/csp','/403'])assert.equal((await(await check('https://example.org'+path)).json()).disposition,'external');
  const count=visited.length;await check('https://example.org/403');assert.equal(visited.length,count);
  for(const path of ['/book','/notes.md','/allowed','/dynamic'])assert.equal((await(await check('https://example.org'+path)).json()).disposition,'preview');
  const before=visited.length;assert.equal((await check('http://127.0.0.1/private')).status,400);assert.equal(visited.length,before);
});
