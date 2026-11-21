import {readFileSync} from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readArchiveIndex,zenodoRecordId,explicitArchiveTarget,priorArchiveTarget} from '../../server/archive-index';
import {searchSources} from '../../server/web-search';
import type {SourceRequest,SourceResponse} from '../../server/source-fetch';
import type {WebHit} from './types';
const hit:WebHit={title:'HRTEM data',url:'https://doi.org/10.5281/zenodo.8201849',doi:'10.5281/zenodo.8201849',snippet:'raw image metadata'};
const signal=()=>new AbortController().signal;
const csv='File name,Pixel Scale (nm),Folder\n"Au_01.dm3",0.033,"session/folder"\nAu_02.dm3,0.033,session/folder\nAu_03.dm3,0.033,session/folder\nAu_04.dm3,0.033,session/folder\n';
function response(url:string,body:string,type:string):SourceResponse{return {url,status:200,headers:{'content-type':type},bytes:Buffer.from(body),truncated:false};}
function manifest(files:unknown[],id=8201849){return JSON.stringify({id,metadata:{title:'HRTEM archive'},files});}
const files=[{key:'large.zip',size:10_000_000},{key:'raw_data_metadata.csv',size:csv.length,links:{self:'http://127.0.0.1/private'}}];
test('official manifest and small CSV produce actual file/field/record provenance without downloading images or trusting links',async()=>{
  const requests:string[]=[];
  const req:SourceRequest=async(url,_s,options)=>{requests.push(url.href);assert.ok((options?.maxBytes||0)<=256*1024);
    return url.pathname.endsWith('/content')?response(url.href,csv,'text/plain; charset=utf-8'):response(url.href,manifest(files),'application/json');};
  const r=await readArchiveIndex(hit,signal(),req);
  assert.equal(requests.length,2);assert.ok(requests.every(u=>u.startsWith('https://zenodo.org/api/records/8201849')));
  assert.equal(r.hits.length,2);assert.match(r.hits[1].pageExcerpt!,/Au_01\.dm3/);assert.match(r.hits[1].pageExcerpt!,/0\.033/);
  assert.doesNotMatch(r.hits[1].pageExcerpt!,/Au_04/);assert.match(r.hits[1].pageExcerpt!,/未打开DM3/);
  assert.equal(r.hits[1].url,'https://zenodo.org/api/records/8201849/files/raw_data_metadata.csv/content');
});
test('explicit DOI or record URL works without search results; bare IDs and mismatched identifiers are not guessed',()=>{
  assert.equal(zenodoRecordId(hit),'8201849');assert.equal(zenodoRecordId({...hit,url:'https://zenodo.org/records/1'}),undefined);
  assert.equal(explicitArchiveTarget([{web:'read the files',dataset:'10.5281/zenodo.8201849'}])?.doi,hit.doi);
  assert.equal(explicitArchiveTarget([{web:'https://zenodo.org/records/8201849 metadata',dataset:'HRTEM'}])?.doi,hit.doi);
  assert.equal(explicitArchiveTarget([{web:'study 8201849 metadata',dataset:'HRTEM'}]),undefined);
});
test('only an explicit follow-up to a unique previously read Zenodo record can reuse historical identity',()=>{
  const prior=[{url:'https://zenodo.org/records/8201849',title:'HRTEM archive',excerpt:'Previously read official description'}];
  assert.equal(zenodoRecordId(priorArchiveTarget('你提到的 HRTEM 例子，能挑一张原图吗？',prior)!),'8201849');
  assert.equal(priorArchiveTarget('讲讲现在的水样保存方法',prior),undefined);
  assert.equal(priorArchiveTarget('刚才的例子先不看，换一个主题',prior),undefined);
  assert.equal(priorArchiveTarget('此前的数据怎么读？',[...prior,{url:'https://zenodo.org/records/9000000',title:'Other archive',excerpt:'Other read'}]),undefined);
  assert.equal(priorArchiveTarget('你提到的这个例子',[]),undefined);
});
test('large CSV/ZIP are manifest-only and an API version mismatch cannot silently select another version',async()=>{
  let calls=0;const req:SourceRequest=async url=>{calls++;return response(url.href,manifest([{key:'raw_data_metadata.csv',size:129*1024},{key:'images.zip',size:1_000_000}]),'application/json');};
  const r=await readArchiveIndex(hit,signal(),req);assert.equal(calls,1);assert.equal(r.hits.length,1);assert.match(r.warning,/未下载大型附件/);
  await assert.rejects(readArchiveIndex(hit,signal(),async url=>response(url.href,manifest(files,9000000),'application/json')),/版本记录/);
});
test('private redirects and cancelled requests are refused by the existing public transport',async()=>{
  let calls=0;const req:SourceRequest=async url=>{calls++;return {...response(url.href,'','text/plain'),status:302,headers:{location:'http://127.0.0.1/private'}};};
  await assert.rejects(readArchiveIndex(hit,signal(),req));assert.equal(calls,1);
  const c=new AbortController();c.abort();calls=0;await assert.rejects(readArchiveIndex(hit,c.signal,req));assert.equal(calls,0);
});
test('oversized, invalid or non-CSV responses preserve the manifest but do not claim actual rows',async()=>{
  for(const mode of ['truncated','html','badcsv']){
    const req:SourceRequest=async url=>{
      if(!url.pathname.endsWith('/content'))return response(url.href,manifest(files),'application/json');
      const r=response(url.href,mode==='badcsv'?'onecolumn\nvalue\n':'<html>Access denied</html>',mode==='html'?'text/html':'text/plain');
      if(mode==='truncated')r.truncated=true;return r;
    };
    const r=await readArchiveIndex(hit,signal(),req);assert.equal(r.hits.length,1);assert.match(r.warning,/索引读取未完成/);
  }
});
test('search workflow reaches explicit archive even with no chosen web page, and honours disabled Fetch',async()=>{
  const fetchImpl:typeof fetch=async input=>{
    const u=new URL(String(input));
    if(u.hostname==='api.datacite.org')return Response.json({data:[],meta:{total:0}});
    if(u.hostname==='www.bing.com')return new Response('<rss><channel></channel></rss>');
    if(u.hostname.endsWith('duckduckgo.com'))return new Response('<div class="no-results">No results</div>');
    throw Error('Unexpected request '+u.href);
  };
  let reads=0;const archiveRead:typeof readArchiveIndex=async()=>{reads++;return {hits:[{title:'Read index',url:'https://zenodo.org/api/records/8201849',snippet:'index',pageExcerpt:'Actual CSV rows with Au_01.dm3'}],requestUrl:'https://zenodo.org/api/records/8201849',warning:'small index only'};};
  const queries=[{web:'inspect original image',dataset:'10.5281/zenodo.8201849'}];
  const runs=await searchSources(queries,signal(),()=>{},{fetchImpl,archiveRead,deepseekTools:{search:false,fetch:true}});
  assert.equal(reads,1);assert.ok(runs.some(r=>r.engine==='原站读取'&&r.hits.some(h=>h.pageExcerpt?.includes('Au_01.dm3'))));
  await searchSources(queries,signal(),()=>{},{fetchImpl,archiveRead,deepseekTools:{search:false,fetch:false}});assert.equal(reads,1);
});
test('normal search entry preserves a named historical archive when generated search terms lose its ID, while current explicit identity wins',async()=>{
  const fetchImpl:typeof fetch=async input=>{
    const u=new URL(String(input));
    if(u.hostname==='api.datacite.org')return Response.json({data:[],meta:{total:0}});
    if(u.hostname==='www.bing.com')return new Response('<rss><channel></channel></rss>');
    if(u.hostname.endsWith('duckduckgo.com'))return new Response('<div class="no-results">No results</div>');
    throw Error('Unexpected request');
  };
  const targets:string[]=[];const archiveRead:typeof readArchiveIndex=async h=>{targets.push(zenodoRecordId(h)!);return {hits:[],requestUrl:h.url,warning:'test'};};
  const base={fetchImpl,archiveRead,deepseekTools:{search:false,fetch:true},archiveQuestion:'你提到的HRTEM例子，能挑一张原图说明标尺吗？',priorArchiveTargets:[{url:'https://zenodo.org/records/8201849',title:'HRTEM archive',excerpt:'Actual prior reading'}]};
  const noId=[{web:'HRTEM original image scale metadata',dataset:'HRTEM'}];
  await searchSources(noId,signal(),()=>{},base);assert.deepEqual(targets,['8201849']);
  await searchSources([{web:'10.5281/zenodo.12345 files',dataset:'HRTEM'}],signal(),()=>{},base);assert.equal(targets.at(-1),'12345');
  await searchSources(noId,signal(),()=>{},{...base,archiveQuestion:'改看 https://zenodo.org/records/67890 的文件'});assert.equal(targets.at(-1),'67890');
  const before=targets.length;await searchSources(noId,signal(),()=>{},{...base,archiveQuestion:'换一个主题，看看水质模型'});assert.equal(targets.length,before);
});

test('official concept identifiers resolve to a concrete version; selected file uses resolved record and retains provenance',async()=>{
  const urls:string[]=[];
  const req:SourceRequest=async url=>{urls.push(url.href);return url.pathname.endsWith('/content')?response(url.href,csv,'text/csv'):response(url.href,JSON.stringify({id:8201850,doi:'10.5281/zenodo.8201850',conceptrecid:'8201849',conceptdoi:'10.5281/zenodo.8201849',metadata:{title:'Archive',version:'1.2'},files}),'application/json');};
  const r=await readArchiveIndex(hit,signal(),req);
  assert.equal(r.identity?.resolution,'concept-to-version');assert.equal(r.identity?.version,'1.2');
  assert.equal(r.identity?.resolvedRecord,'8201850');assert.equal(r.manifest?.complete,true);
  assert.match(urls[1],/records\/8201850\/files/);assert.match(r.hits[1].pageExcerpt!,/Au_01/);
});
test('concept permission requires matching concept DOI, concept record and concrete DOI; explicit version never drifts',async()=>{
  const valid={id:8201850,doi:'10.5281/zenodo.8201850',conceptrecid:'8201849',conceptdoi:'10.5281/zenodo.8201849',metadata:{version:'2'},files};
  for(const data of [{...valid,conceptdoi:'10.5281/zenodo.99'},{...valid,conceptrecid:'99'},{...valid,doi:'10.5281/zenodo.99'},{...valid,doi:undefined},{...valid,conceptdoi:undefined}]){
    let calls=0;await assert.rejects(readArchiveIndex(hit,signal(),async url=>{calls++;return response(url.href,JSON.stringify(data),'application/json');}));assert.equal(calls,1);
  }
  await assert.rejects(readArchiveIndex({...hit,version:'1'},signal(),async url=>response(url.href,JSON.stringify(valid),'application/json')),/版本标签/);
  const concrete={...hit,url:'https://zenodo.org/records/8201851',doi:'10.5281/zenodo.8201851'};
  await assert.rejects(readArchiveIndex(concrete,signal(),async url=>response(url.href,JSON.stringify(valid),'application/json')),/版本记录/);
});
test('small README is actually read, but an explicitly requested small table has priority',async()=>{
  const list=[{key:'readme.txt',size:30},...files];const visited:string[]=[];
  const req:SourceRequest=async url=>{visited.push(url.href);return !url.pathname.endsWith('/content')?response(url.href,manifest(list),'application/json'):response(url.href,url.pathname.includes('readme')?'README original: field definitions.':csv,'text/plain');};
  const r=await readArchiveIndex(hit,signal(),req);assert.match(r.hits[1].pageExcerpt!,/README original/);assert.match(visited[1],/readme.txt/);
  const named=await readArchiveIndex(hit,signal(),req,{question:'请读取 raw_data_metadata.csv 的第一行'});assert.match(named.hits[1].pageExcerpt!,/Au_01/);
});
test('named PDF is a target with concrete version provenance, never successful read evidence; complete manifest retains omitted files',async()=>{
  const list=Array.from({length:20},(_,i)=>({key:'file'+i+'.zip',size:1_000_000}));list.push({key:'report.pdf',size:900000});
  const r=await readArchiveIndex(hit,signal(),async url=>response(url.href,manifest(list),'application/json'),{question:'请读 report.pdf'});
  assert.equal(r.hits.length,1);assert.equal(r.manifest?.files.length,21);assert.equal(r.manifest?.complete,true);
  assert.equal(r.attachmentTargets?.[0].url,'https://zenodo.org/api/records/8201849/files/report.pdf/content');assert.equal(r.attachmentTargets?.[0].pageExcerpt,undefined);
  assert.match(r.hits[0].pageExcerpt!,/report.pdf/);assert.match(r.hits[0].pageExcerpt!,/omittedFromExcerpt/);
});
test('paginated or malformed file listings are explicitly partial, never claimed complete',async()=>{
  const data={id:8201849,files:{count:30,entries:{a:{key:'a.zip',size:100}},links:{next:'https://zenodo.org/api/records/8201849/files?page=2'}}};
  const r=await readArchiveIndex(hit,signal(),async url=>response(url.href,JSON.stringify(data),'application/json'));
  assert.equal(r.manifest?.complete,false);assert.equal(r.manifest?.totalFiles,30);assert.match(r.hits[0].pageExcerpt!,/"manifestComplete":false/);
});

test('saved real CLCD72-file manifest includes the late2021TIFF in a complete bounded model-visible filename index',async()=>{
  const fixture=JSON.parse(readFileSync(new URL('./fixtures/archive-clcd-12779975-files.json',import.meta.url),'utf8'));
  assert.equal(fixture.files.length,72);assert.ok(fixture.files.findIndex((f:{key:string})=>f.key==='CLCD_v01_2021_albert.tif')>=16);
  let requests=0;
  const r=await readArchiveIndex({...hit,url:'https://zenodo.org/records/12779975',doi:fixture.doi},signal(),async url=>{
    requests++;return response(url.href,JSON.stringify({id:fixture.record,doi:fixture.doi,metadata:{title:'CLCD',version:'1.0.3'},files:fixture.files}),'application/json');
  },{question:'比较长三角2020—2023年的土地覆盖'});
  assert.equal(requests,1,'listing names must not download large TIFF/ZIP');
  const index=r.hits[0].manifestIndex!;
  assert.equal(index.contentsRead,false);assert.equal(index.names.length,72);assert.equal(index.namesComplete,true);assert.equal(index.sourceTotal,72);
  assert.ok(index.names.includes('CLCD_v01_2021_albert.tif'));assert.ok(index.names.indexOf('CLCD_v01_2021_albert.tif')<16,'requested years outrank arbitrary first16');
  const excerpt=r.hits[0].pageExcerpt!;assert.match(excerpt,/"fileIndexComplete":true/);assert.match(excerpt,/"omittedNames":0/);
  assert.deepEqual(JSON.parse(excerpt.split('\n')[1]).fileNames,index.names);
});
test('filename index separately marks capped names and API pagination; UTF8 name budget and exact target priority remain bounded',async()=>{
  const longFiles=Array.from({length:100},(_,i)=>({key:'字段'.repeat(80)+i+'.zip',size:1000000}));
  const r=await readArchiveIndex(hit,signal(),async url=>response(url.href,manifest(longFiles),'application/json'));
  const index=r.hits[0].manifestIndex!;assert.ok(index.names.length<=80);assert.ok(Buffer.byteLength(JSON.stringify(index.names),'utf8')<=12*1024);
  assert.equal(index.namesComplete,false);assert.equal(index.contentsRead,false);assert.match(r.hits[0].pageExcerpt!,/"omittedNames":[1-9]/);
  const partial=await readArchiveIndex(hit,signal(),async url=>response(url.href,JSON.stringify({id:8201849,files:{count:3,entries:{a:{key:'a.zip',size:100}},links:{next:'https://zenodo.org/next'}}}),'application/json'));
  assert.equal(partial.hits[0].manifestIndex?.namesComplete,false);
  const explicit=await readArchiveIndex(hit,signal(),async url=>response(url.href,manifest([{key:'a_2023.zip',size:100},{key:'specific_1990.pdf',size:100}]),'application/json'),{question:'2023资料，但请读specific_1990.pdf'});
  assert.equal(explicit.hits[0].manifestIndex?.names[0],'specific_1990.pdf');assert.equal(explicit.attachmentTargets?.[0].pageExcerpt,undefined);
});
