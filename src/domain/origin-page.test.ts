import test from 'node:test';
import assert from 'node:assert/strict';
import {readOriginPage} from '../../server/origin-page';
import {searchSources} from '../../server/web-search';
import {rememberReadEvidence} from './read-evidence';
import type {SourceRequest} from '../../server/source-fetch';
import type {WebHit} from './types';
const hit:WebHit={title:'MetPy cape_cin',url:'https://unidata.github.io/MetPy/latest/api/generated/metpy.calc.cape_cin.html',snippet:'Atmospheric parcel calculation',doi:'10.1234/example.v2',version:'2'};
const signal=()=>new AbortController().signal;
const source=(html:string,type='text/html; charset=utf-8'):SourceRequest=>async(url,_signal,options)=>{
  assert.equal(options?.textOnly,true);assert.equal(options?.maxBytes,1_000_000);
  return {url:url.href,status:200,headers:{'content-type':type},bytes:Buffer.from(html),truncated:false};
};
test('origin reads real text without scripts/navigation and preserves original DOI identity',async()=>{
  const r=await readOriginPage(hit,hit.url,signal(),source('<nav>ignore-menu</nav><main><h1>MetPy cape_cin</h1><pre>cape, cin = cape_cin(pressure, temperature, dewpoint, parcel_profile)</pre><p>Returns convective available potential energy and convective inhibition.</p><script>secret-script</script></main>'));
  assert.equal(r.hits[0].doi,hit.doi);assert.equal(r.hits[0].version,'2');assert.match(r.hits[0].pageExcerpt,/cape, cin/);assert.doesNotMatch(r.hits[0].pageExcerpt,/ignore-menu|secret-script/);assert.match(r.warning,/片段/);
  const reads=rememberReadEvidence([],[{engine:'原站读取',query:hit.url,status:'done',hits:r.hits}]);assert.equal(reads[0].url,hit.url);assert.match(reads[0].excerpt,/cape_cin/);
});
test('origin refuses private initial and redirected addresses without requesting the target',async()=>{
  let count=0;const req:SourceRequest=async url=>{count++;return {url:url.href,status:302,headers:{location:'http://127.0.0.1/private'},bytes:Buffer.alloc(0),truncated:false};};
  await assert.rejects(readOriginPage(hit,'http://127.0.0.1/private',signal(),req));assert.equal(count,0);
  await assert.rejects(readOriginPage(hit,hit.url,signal(),req));assert.equal(count,1);
});
test('origin rejects attachment, MIME mismatch and access gates rather than claiming a read',async()=>{
  await assert.rejects(readOriginPage(hit,'https://example.org/doc.pdf',signal(),source('unused')));
  await assert.rejects(readOriginPage(hit,hit.url,signal(),source('%PDF example','application/pdf')));
  await assert.rejects(readOriginPage(hit,hit.url,signal(),source('<main>Sign in to access this page</main>')));
  await assert.rejects(readOriginPage(hit,hit.url,signal(),source('<h1>Just a moment</h1><p>Verify you are human</p>')));
  await assert.rejects(readOriginPage(hit,hit.url,signal(),source('<title>Just a moment...</title><main>'+('Please verify your browser '.repeat(100))+'</main>')));
});
test('origin excerpt is bounded, handles text responses and honours parent cancellation',async()=>{
  const r=await readOriginPage(hit,hit.url,signal(),source('MetPy cape_cin documentation. '.repeat(500),'text/plain'));assert.equal(r.hits[0].pageExcerpt.length,5200);assert.match(r.warning,/有界/);
  const c=new AbortController();c.abort();let count=0;await assert.rejects(readOriginPage(hit,hit.url,c.signal,async()=>{count++;throw Error('unexpected');}));assert.equal(count,0);
});
const plan=[{web:'MetPy cape_cin',dataset:'MetPy'}];
function mocked(providerStatus:number,content?:string):typeof fetch{return async(input)=>{
  const u=new URL(String(input));
  if(u.hostname==='www.bing.com')return new Response('<rss><channel>'+Array.from({length:6},(_,i)=>`<item><title>MetPy cape_cin ${i}</title><link>https://example.org/page${i}</link></item>`).join('')+'</channel></rss>');
  if(u.hostname==='api.datacite.org')return Response.json({data:[],meta:{total:0}});
  assert.equal(u.origin,'https://api.deepseek.com');return content!==undefined?Response.json({content}):new Response(null,{status:providerStatus});
};}
async function key(t:{after:(f:()=>void)=>void}){const old=process.env.DEEPSEEK_API_KEY;process.env.DEEPSEEK_API_KEY='test-only';t.after(()=>{if(old===undefined)delete process.env.DEEPSEEK_API_KEY;else process.env.DEEPSEEK_API_KEY=old;});}
test('provider 404 recovers with at most three origin reads and leaves failed provider steps visible',async t=>{
  await key(t);let reads=0;
  const runs=await searchSources(plan,signal(),()=>{},{deepseekTools:{search:false,fetch:true},fetchImpl:mocked(404),originRead:async(h,url)=>{reads++;return {hits:[{...h,pageExcerpt:'Actual MetPy content '+url}],requestUrl:url,warning:'Public origin excerpt'};}});
  assert.equal(reads,3);assert.equal(runs.filter(r=>r.engine==='DeepSeek Fetch'&&r.status==='failed').length,3);assert.equal(runs.filter(r=>r.engine==='原站读取'&&r.status==='done').length,3);
});
test('failed origin reads are bounded to three and provider account failures never start fallback',async t=>{
  await key(t);
  for(const status of [404,401,402,403,429]){let reads=0;const runs=await searchSources(plan,signal(),()=>{},{deepseekTools:{search:false,fetch:true},fetchImpl:mocked(status),originRead:async()=>{reads++;throw Error('source unavailable');}});assert.equal(reads,status===404?3:0);if(reads)assert.equal(runs.filter(r=>r.engine==='原站读取'&&r.status==='failed').length,3);}
});
test('duplicate origin text does not fill three evidence slots and disabled Fetch does no origin work',async t=>{
  await key(t);let reads=0;const originRead:typeof readOriginPage=async h=>{reads++;return {hits:[{...h,pageExcerpt:'Identical MetPy page content'}],requestUrl:h.url,warning:'Excerpt'};};
  const runs=await searchSources(plan,signal(),()=>{},{deepseekTools:{search:false,fetch:true},fetchImpl:mocked(404),originRead});assert.equal(reads,3);assert.equal(runs.filter(r=>r.engine==='原站读取').flatMap(r=>r.hits).length,1);assert.ok(runs.some(r=>r.warning?.includes('重复')));
  reads=0;await searchSources(plan,signal(),()=>{},{deepseekTools:{search:false,fetch:false},fetchImpl:mocked(404),originRead});assert.equal(reads,0);
});
