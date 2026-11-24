import {readPdfPage} from "../../server/read-pdf-page";
import https from 'node:https';
import dns from 'node:dns/promises';
import {syncBuiltinESMExports} from 'node:module';
import {PassThrough} from 'node:stream';
import {EventEmitter} from 'node:events';
import type {ClientRequest,IncomingMessage} from 'node:http';
import {readArchiveIndex} from '../../server/archive-index';
import test from "node:test";
import assert from "node:assert/strict";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {parseSearchPlan,parseBingResults,parseDuckDuckGoResults,searchDuckDuckGo,relevantWebHits,searchSources} from "../../server/web-search";
import {pagesToRead} from "../../server/fetch-pages";
import {parseDataCitePage} from "../../server/datacite-search";
import {SearchSteps} from "../components/SearchSteps";
import type {SearchRun} from "./types";

const record={id:"10.1234/climcaps",type:"dois",attributes:{doi:"10.1234/climcaps",titles:[{title:"CLIMCAPS atmospheric profiles"}],descriptions:[{description:"<p>Temperature and moisture</p>"}],publisher:{name:"Archive"},version:"2.1",url:"https://example.org/data",relatedIdentifiers:[{relatedIdentifier:"10.1234/paper",relatedIdentifierType:"DOI",relationType:"IsReferencedBy"}]}};
const page={data:[record],meta:{total:12}};
const rss=(title="ERA5 pressure levels",url="https://example.org/era5")=>`<rss><channel><title>Search</title><item><title>${title}</title><link>${url}</link><description>ERA5 hourly humidity</description></item></channel></rss>`;
const ddg='<div class="results"><div class="result"><a class="result__a" href="https://example.org/era5">ERA5 pressure levels</a><span class="result__snippet">ERA5 hourly humidity</span></div></div>';
const plan=[{web:"ERA5 humidity data",dataset:"ERA5"}];

test("search plans separate web needs from compact DOI queries and cap independent groups",()=>{
  assert.deepEqual(parseSearchPlan(JSON.stringify([...plan,...plan,...plan,{web:"CLIMCAPS profile data",dataset:"CLIMCAPS"}])),[...plan,{web:"CLIMCAPS profile data",dataset:"CLIMCAPS"}]);
  assert.throws(()=>parseSearchPlan(JSON.stringify(["long paragraphs cannot become DOI queries"])),/检索词/);
  assert.throws(()=>parseSearchPlan(JSON.stringify([{web:"data",dataset:"word ".repeat(20)}])),/检索词/);
});
test("web adapters reject challenges, malformed pages, unsafe links and duplicate links",()=>{
  assert.throws(()=>parseBingResults("<html>verification required</html>"),/验证/);
  assert.throws(()=>parseDuckDuckGoResults('<form id="challenge-form"></form>'),/验证码/);
  assert.throws(()=>parseDuckDuckGoResults('<html>upstream error</html>'),/结果页/);
  assert.deepEqual(parseBingResults('<rss><channel></channel></rss>'),[]);
  assert.deepEqual(parseBingResults(rss("ERA5","javascript:alert(1)")),[]);
  assert.equal(parseDuckDuckGoResults(ddg+ddg).length,1);
});
test("HTTP 200 with unrelated titles cannot become useful web evidence",()=>{
  const hits=[{title:"Time in Panama",snippet:"Current local time",url:"https://example.org/time"},{title:"CLIMCAPS V2.1 atmospheric state",snippet:"Temperature retrieval",url:"https://example.org/climcaps"}];
  const result=relevantWebHits(hits,"CLIMCAPS V2.1 temperature moisture profiles data");
  assert.deepEqual(result.hits,[hits[1]]);assert.match(result.warning!,/排除 1 条/);
});
test("DataCite keeps DOI identity, publisher, version and relationship direction",()=>{
  const result=parseDataCitePage(page);
  assert.equal(result.total,12);assert.equal(result.hits[0].doi,"10.1234/climcaps");
  assert.equal(result.hits[0].url,"https://doi.org/10.1234/climcaps");
  assert.equal(result.hits[0].publisher,"Archive");assert.equal(result.hits[0].version,"2.1");
  assert.equal(result.hits[0].snippet,"Temperature and moisture");
  assert.deepEqual(result.hits[0].relatedIdentifiers,record.attributes.relatedIdentifiers);
});
test("malformed metadata and inconsistent counts never masquerade as zero matches",()=>{
  for(const value of [{},{data:[],meta:{total:3}},{data:[record],meta:{total:0}},{data:[record],meta:{total:"1"}},{data:[{...record,id:"10.1234/other"}],meta:{total:1}}])
    assert.throws(()=>parseDataCitePage(value));
  assert.deepEqual(parseDataCitePage({data:[],meta:{total:0}}),{hits:[],total:0});
});
test("a failed web request falls back while DOI metadata uses its own query and keeps true progress",async()=>{
  const urls:URL[]=[],updates:SearchRun[][]=[];
  const fetchImpl:typeof fetch=async input=>{
    const url=new URL(String(input));urls.push(url);
    if(url.hostname==="www.bing.com")throw new TypeError("fetch failed",{cause:{code:"ECONNRESET"}});
    return url.hostname==="api.datacite.org"?Response.json(page):new Response(ddg);
  };
  const result=await searchSources(plan,new AbortController().signal,runs=>updates.push(runs),{fetchImpl});
  assert.deepEqual(result.map(r=>[r.engine,r.status,r.hits.length]),[["Bing","failed",0],["DataCite","done",1],["DuckDuckGo","done",1]]);
  assert.match(result[0].error!,/重置/);
  assert.equal(urls.find(u=>u.hostname==="api.datacite.org")!.searchParams.get("query"),"ERA5");
  assert.equal(urls.find(u=>u.hostname==="duckduckgo.com" || u.hostname==="html.duckduckgo.com")!.searchParams.get("q"),"ERA5 humidity data");
  assert.equal(updates[0][0].status,"running");assert.equal(updates[0][0].hits.length,0);
  assert.ok(result.every(r=>r.startedAt && typeof r.elapsedMs==="number"));
});
test("API failures remain failures, not successful empty steps",async()=>{
  const result=await searchSources(plan,new AbortController().signal,()=>{},{fetchImpl:async()=>new Response("Unavailable",{status:503})});
  assert.equal(result.length,3);assert.ok(result.every(r=>r.status==="failed" && /503/.test(r.error!)));
});
test("Search and Fetch switches independently control paid requests and preserve DOI evidence", async t => {
  const previousKey = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = "test-only";
  t.after(() => {
    if (previousKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = previousKey;
  });
  for (const search of [false,true]) for (const fetchPages of [false,true]) {
    const calls: string[] = [];
    const bodies: string[] = [];
    const fetchImpl: typeof fetch = async (input,init) => {
      const url = new URL(String(input));
      if (url.hostname === "www.bing.com") return new Response(rss());
      if (url.hostname === "api.datacite.org") return Response.json({...page,data:[{...record,attributes:{...record.attributes,titles:[{title:"ERA5 humidity profiles"}]}}]});
      assert.equal(url.origin,"https://api.deepseek.com");
      assert.equal(init?.method,"POST");
      assert.equal(new Headers(init?.headers).get("Authorization"),"Bearer test-only");
      const body = JSON.parse(String(init?.body));
      calls.push(url.pathname);
      if (url.pathname === "/v1/tools/search") {
        assert.equal(body.query,plan[0].web);
        return Response.json({results:[
          {url:"https://example.org/products/era5",title:"ERA5 official product",snippet:"Hourly data"},
          {url:"https://example.org/products/era5",title:"ERA5 repeated product",snippet:"Duplicate"},
          {url:"http://127.0.0.1/private",title:"ERA5 private"},
        ]});
      }
      assert.equal(url.pathname,"/v1/tools/fetch");
      bodies.push(body.url);
      return body.url === "https://example.org/era5" ? new Response("",{status:503})
        : Response.json({content:"ERA5 Product documentation: version 2.1. "+body.url,title:"Product record"});
    };
    const runs = await searchSources(plan,new AbortController().signal,()=>{},{
      deepseekTools:{search,fetch:fetchPages},fetchImpl,originRead:false,
    });
    assert.equal(calls.filter(p => p.endsWith("/search")).length,Number(search));
    assert.deepEqual(bodies.sort(),fetchPages
      ? ["https://example.org/data","https://example.org/era5",...(search?["https://example.org/products/era5"]:[])] : []);
    assert.equal(runs.find(r => r.engine === "DeepSeek Search")?.hits.length ?? 0,Number(search));
    assert.equal(runs.find(r => r.engine === "Bing")?.hits.length,1);
    const reads = runs.filter(r => r.engine === "DeepSeek Fetch");
    assert.equal(reads.length,bodies.length);
    if (fetchPages) {
      const doiHit = reads.flatMap(r => r.hits).find(h => h.doi === record.id);
      assert.equal(doiHit?.version,"2.1");
      assert.match(doiHit?.pageExcerpt ?? "",/Product documentation/);
      assert.match(reads.find(r => r.status === "failed")?.error ?? "",/503/);
    }
  }
});
test("timeout and parent cancellation are distinct and cancellation does not start fallback",async()=>{
  const pending:typeof fetch=async(_input,init)=>new Promise((_resolve,reject)=>init!.signal!.addEventListener("abort",()=>reject(init!.signal!.reason),{once:true}));
  const keepAlive=setTimeout(()=>{},1000);
  try{
    const result=await searchSources(plan,new AbortController().signal,()=>{},{fetchImpl:pending,timeoutMs:5});
    assert.ok(result.every(r=>r.status==="failed" && r.error==="请求超时"));
    const controller=new AbortController();let count=0;
    const request=searchSources(plan,controller.signal,()=>{},{fetchImpl:async(...args)=>{count++;return pending(...args);}});
    controller.abort();await assert.rejects(request,/abort/i);assert.equal(count,2);
  }finally{clearTimeout(keepAlive);}
});
test("equivalent dataset searches in different groups issue only one request",async()=>{
  let count=0;
  const result=await searchSources([...plan,{web:"ERA5 temperature data",dataset:"ERA5"}],new AbortController().signal,()=>{},{fetchImpl:async input=>{
    if(new URL(String(input)).hostname==="api.datacite.org"){count++;return Response.json(page);}
    return new Response(rss());
  }});
  assert.equal(count,1);assert.equal(result.filter(r=>r.engine==="DataCite").length,1);
});
test("steps expose errors and a real result link without expanding; empty sets do not show success checks",()=>{
  const html=renderToStaticMarkup(createElement(SearchSteps,{runs:[{engine:"Bing",query:"ERA5",status:"failed",hits:[],error:"连接被重置"},{engine:"DataCite",query:"CLIMCAPS",status:"done",hits:parseDataCitePage(page).hits,total:12},{engine:"DataCite",query:"missing",status:"done",hits:[],total:0}]}));
  assert.match(html,/检索失败/);assert.match(html,/<p class="search-error">连接被重置/);
  assert.match(html,/class="search-preview"/);assert.match(html,/https:\/\/doi.org\/10.1234\/climcaps/);
  assert.match(html,/无匹配结果/);assert.match(html,/circle-minus/);assert.doesNotMatch(html,/javascript:/);
});

test('DuckDuckGo retries a reset on Lite, reads the matching snippet and skips its ad links',async()=>{
  const hosts:string[]=[];
  const lite='<table><tr><td><a class="result-link" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Fera5">ERA5 pressure levels</a></td></tr><tr><td class="result-snippet">ERA5 hourly humidity</td></tr><tr><td><a class="result-link" href="https://duckduckgo.com/y.js?ad=1">ad</a></td></tr></table>';
  const result=await searchDuckDuckGo('ERA5 humidity',new AbortController().signal,async input=>{
    const url=new URL(String(input));hosts.push(url.hostname);assert.equal(url.searchParams.get('q'),'ERA5 humidity');
    if(hosts.length===1)throw new TypeError('fetch failed',{cause:{code:'ECONNRESET'}});
    return new Response(lite);
  });
  assert.deepEqual(hosts,['html.duckduckgo.com','lite.duckduckgo.com']);assert.equal(new URL(result.requestUrl).hostname,hosts[1]);
  assert.deepEqual(result.hits,[{title:'ERA5 pressure levels',url:'https://example.org/era5',snippet:'ERA5 hourly humidity'}]);
});
test('DuckDuckGo preserves challenges, rate limits and valid empty searches without retrying them',async()=>{
  for(const [status,body,expected] of [[202,'<form id="challenge-form"></form>','验证码'],[429,'','429'],[200,'<div class="no-results"></div>','']] as const){
    let calls=0;const work=searchDuckDuckGo('ERA5',new AbortController().signal,async()=>{calls++;return new Response(body,{status});});
    if(expected)await assert.rejects(work,new RegExp(expected));else assert.deepEqual((await work).hits,[]);
    assert.equal(calls,1);
  }
});
test('Fetch prefers a concrete topical version over a concept and avoids unrelated record pages',()=>{
  const concept='10.5281/zenodo.23391523',version='10.5281/zenodo.23391524';
  const make=(doi:string,type:string,related:string)=>({title:'10-m Forest Canopy Height Map of Greater Khingan',doi,url:'https://doi.org/'+doi,snippet:'forest measurements',relatedIdentifiers:[{relationType:type,relatedIdentifierType:'DOI',relatedIdentifier:related}]});
  const hits=[make(concept,'HasVersion',version),make(version,'IsVersionOf',concept),{title:'Metal hydride pressure data',url:'https://example.org/records/42',snippet:''}];
  const pages=pagesToRead([{engine:'DataCite',status:'done',query:'forest',hits}],[{web:'Greater Khingan forest canopy height',dataset:'forest'}]);
  assert.deepEqual(pages.map(p=>p.hit.url),['https://doi.org/'+version]);assert.equal(pages[0].urls[0],'https://zenodo.org/records/23391524');
});
test('Fetch replenishes failed and duplicate reads within six calls; account errors stop replenishment',async t=>{
  const prior=process.env.DEEPSEEK_API_KEY;process.env.DEEPSEEK_API_KEY='test-only';
  t.after(()=>{if(prior===undefined)delete process.env.DEEPSEEK_API_KEY;else process.env.DEEPSEEK_API_KEY=prior;});
  for (const mode of ['fallback','unavailable','quota','empty']) {
    let reads=0;const urls=new Set<string>();
    const fetchImpl:typeof fetch=async(input,init)=>{
      const url=new URL(String(input));
      if(url.hostname==='api.datacite.org') return Response.json({data:[],meta:{total:0}});
      if(url.hostname==='www.bing.com')return new Response('<rss><channel>'+Array.from({length:6},(_,i)=>`<item><title>ERA5 humidity ${i}</title><link>https://example.org/study${i}</link></item>`).join('')+'</channel></rss>');
      assert.equal(url.pathname,'/v1/tools/fetch');const pageUrl=JSON.parse(String(init?.body)).url;
      assert.ok(!urls.has(pageUrl));urls.add(pageUrl);reads++;
      if(mode==='quota')return new Response(null,{status:402});
      if(mode==='empty' && reads===1)return Response.json({content:'登录 账号 添加成功！前往申请单查看'});
      if(mode==='unavailable' || (mode==='fallback' && reads===1))return new Response(null,{status:404});
      return Response.json({content:reads<=3?'Same ERA5 page body':'Different ERA5 material '+pageUrl});
    };
    const runs=await searchSources(plan,new AbortController().signal,()=>{},{fetchImpl,deepseekTools:{fetch:true,search:false},originRead:false});
    const rows=runs.filter(r=>r.engine==='DeepSeek Fetch');assert.equal(rows.length,mode==='unavailable'?6:mode==='quota'?3:5);
    const excerpts=rows.flatMap(r=>r.hits.map(h=>h.pageExcerpt));assert.equal(new Set(excerpts).size,mode==='fallback'||mode==='empty'?3:0);
    if(mode==='empty')assert.ok(rows.some(r=>r.error?.includes('正文')));
    if(mode==='fallback'){assert.ok(rows.some(r=>r.warning?.includes('重复')));assert.ok(rows.some(r=>r.error?.includes('404')));}
  }
});

test('a failed publisher page can recover through its DOI while keeping the citation identity',async t=>{
  const prior=process.env.DEEPSEEK_API_KEY;process.env.DEEPSEEK_API_KEY='test-only';
  t.after(()=>{if(prior===undefined)delete process.env.DEEPSEEK_API_KEY;else process.env.DEEPSEEK_API_KEY=prior;});
  const calls:string[]=[];
  const runs=await searchSources([{web:'CLIMCAPS profiles',dataset:'CLIMCAPS'}],new AbortController().signal,()=>{},{originRead:false,deepseekTools:{search:false,fetch:true},fetchImpl:async(input,init)=>{
    const url=new URL(String(input));
    if(url.hostname==='api.datacite.org')return Response.json(page);
    if(url.hostname==='www.bing.com')return new Response(rss('CLIMCAPS atmospheric profiles',record.attributes.url));
    const target=JSON.parse(String(init?.body)).url;calls.push(target);
    return calls.length===1?new Response(null,{status:404}):Response.json({content:'CLIMCAPS temperature and humidity profiles, version 2.1.'});
  }});
  const doiUrl='https://doi.org/'+record.id;
  assert.deepEqual(calls,[record.attributes.url,doiUrl]);
  const attempts=runs.filter(r=>r.engine==='DeepSeek Fetch');assert.deepEqual(attempts.map(r=>r.status),['failed','done']);
  assert.equal(attempts[1].hits[0].url,doiUrl);
});

test('deduplicates a mirrored paper with a repeated heading without merging independent DOI versions by title alone',()=>{
  const title='Deformation monitoring of Changbai Mountain using InSAR and GNSS';
  const hits=[{title:title+' - '+title,url:'https://example.org/mirror',snippet:''},{title,url:'https://example.net/publisher',snippet:''},
    {title:'Deformation monitoring of Changbai Mountain using InSAR ...',url:'https://example.net/abbreviated',snippet:''},
    ...['10.1234/survey1','10.1234/survey2'].map(doi=>({title:'GNSS survey of recent deformation in Changbai Mountain',doi,url:'https://doi.org/'+doi,snippet:''}))];
  const selected=pagesToRead([{engine:'Bing',query:'Changbai InSAR GNSS',status:'done',hits}],[{web:'Changbai InSAR GNSS',dataset:'GNSS'}]);
  assert.equal(selected.length,3);assert.equal(selected.filter(p=>p.hit.doi).length,2);
});

function archiveAttachmentPdf(){
  const text='ARCHIVE_PDF_ACTUAL_TEXT: Original appendix field measured_velocity has unit metres per second.';
  const stream='BT /F1 12 Tf 20 100 Td ('+text+') Tj ET';
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>','<< /Length '+stream.length+' >>\nstream\n'+stream+'\nendstream','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let body='%PDF-1.4\n';const offsets:number[]=[];
  for(const [i,o] of objects.entries()){offsets.push(body.length);body+=(i+1)+' 0 obj\n'+o+'\nendobj\n';}
  const offset=body.length;
  return Buffer.from(body+'xref\n0 6\n0000000000 65535 f \n'+offsets.map(i=>String(i).padStart(10,'0')+' 00000 n \n').join('')+'trailer\n<< /Root 1 0 R /Size 6 >>\nstartxref\n'+offset+'\n%%EOF\n');
}
test('official named PDF attachment with /content URL is actually parsed through search workflow, not treated as manifest or snippet evidence',async t=>{
  const id='8201849',file='Appendix field guide.pdf',api='https://zenodo.org/api/records/'+id;
  const contentUrl=api+'/files/'+encodeURIComponent(file)+'/content';
  assert.ok(contentUrl.endsWith('/content'));assert.ok(!contentUrl.endsWith('.pdf'));
  const pdf=archiveAttachmentPdf(),transportUrls:string[]=[],searchUrls:string[]=[];
  const manifest=Buffer.from(JSON.stringify({id:Number(id),doi:'10.5281/zenodo.'+id,metadata:{title:'Official archive',version:'1.0'},files:[{key:file,size:pdf.length},{key:'large_data.zip',size:80_000_000}]}));
  // Mock the pinned transport below fetchSource: actual archive parsing and PDF worker remain in the test.
  // A public DNS result is supplied locally; no real DNS, TLS or external source is contacted.
  t.mock.method(dns,'lookup',async()=>[{address:'8.8.8.8',family:4}]);
  t.mock.method(https,'request',((url:URL,_options:unknown,callback:(r:IncomingMessage)=>void)=>{
    transportUrls.push(url.href);assert.ok([api,contentUrl].includes(url.href),'unexpected transport request '+url.href);
    const bytes=url.href===api?manifest:pdf;
    const req=Object.assign(new EventEmitter(),{end(){queueMicrotask(()=>{
      const res=Object.assign(new PassThrough(),{statusCode:200,headers:{'content-type':url.href===api?'application/json':'application/pdf','content-length':String(bytes.length)}});
      callback(res as unknown as IncomingMessage);res.end(bytes);
    });return req;}});
    return req as unknown as ClientRequest;
  }) as typeof https.request);
  syncBuiltinESMExports();
  t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});
  const fetchImpl:typeof fetch=async input=>{
    const url=new URL(String(input));searchUrls.push(url.href);
    if(url.hostname==='api.datacite.org')return Response.json({data:[],meta:{total:0}});
    if(url.hostname==='www.bing.com')return new Response('<rss><channel></channel></rss>');
    if(url.hostname.endsWith('duckduckgo.com'))return new Response('<div class="no-results">No results</div>');
    throw Error('Unexpected search/Fetch request '+url.href);
  };
  const runs=await searchSources([{web:'archive appendix fields',dataset:'10.5281/zenodo.'+id}],new AbortController().signal,()=>{},
    {fetchImpl,archiveRead:readArchiveIndex,originRead:false,
      pdfRead:(hit,url,signal,focus,question)=>readPdfPage(hit,url,signal,undefined,focus,question),archiveQuestion:'请读取 https://zenodo.org/records/'+id+' 的 '+file+'，核对字段和单位。',deepseekTools:{search:false,fetch:true}});
  const list=runs.find(r=>r.engine==='原站读取'&&r.query===api);
  assert.equal(list?.status,'done');assert.match(list!.hits[0].pageExcerpt!,/Appendix field guide.pdf/);
  assert.doesNotMatch(list!.hits[0].pageExcerpt!,/ARCHIVE_PDF_ACTUAL_TEXT/,'manifest itself must not claim attachment content');
  const read=runs.find(r=>r.engine==='PDF 原文'&&r.query===contentUrl);
  assert.equal(read?.status,'done',JSON.stringify(runs));assert.equal(read!.hits.length,1);
  assert.match(read!.hits[0].pageExcerpt!,/ARCHIVE_PDF_ACTUAL_TEXT/);assert.match(read!.hits[0].pageExcerpt!,/PDF 第 1 页/);
  assert.equal(read!.hits[0].url,contentUrl);assert.equal(read!.hits[0].doi,'10.5281/zenodo.'+id);assert.equal(read!.hits[0].version,'1.0');
  assert.deepEqual(transportUrls,[api,contentUrl]);assert.ok(!searchUrls.some(u=>new URL(u).hostname==='api.deepseek.com'));
});

test("named-region hints prioritize topical pages and preserve broader method candidates",()=>{
  const global={title:"Snow depth field measurements",url:"https://example.org/global",snippet:"Calibration methods and regional field observations."};
  const regional={title:"Snow depth field measurements…",url:"https://example.org/local",snippet:"Snow depth field measurements over O'Brien Basin."};
  const wrong={title:"O’Brien Basin visitor directory",url:"https://example.org/visitors",snippet:"Travel opening hours."};
  const runs:SearchRun[]=[{engine:"Bing",query:"snow depth",status:"done",hits:[global,regional,wrong]}];
  const queries=[{web:"snow depth field measurements",dataset:"snow depth"}];
  assert.deepEqual(pagesToRead(runs,queries).map(page=>page.hit.url),[global.url,regional.url]);
  const ranked=pagesToRead(runs,queries,undefined,["O’Brien Basin"]);
  assert.deepEqual(ranked.map(page=>page.hit.url),[regional.url,global.url]);
  assert.deepEqual(pagesToRead(runs,queries,{targets:[global],strict:true},["O’Brien Basin"]).map(page=>page.hit.url),[global.url]);
  const placeOnly=pagesToRead(runs,[{web:"O'Brien Basin",dataset:"O'Brien Basin"}],undefined,["O’Brien Basin"]);
  assert.deepEqual(placeOnly,pagesToRead(runs,[{web:"O'Brien Basin",dataset:"O'Brien Basin"}]));
  assert.deepEqual(runs[0].hits,[global,regional,wrong]);
});
