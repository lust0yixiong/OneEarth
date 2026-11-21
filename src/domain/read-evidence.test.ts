import test from "node:test";
import assert from "node:assert/strict";
import {accessGate,rememberReadEvidence,validReadEvidence,withPreviousReadings} from "./read-evidence";
import {validHistory} from "../../server/chat-executor";
import {usefulPageText} from "../../server/fetch-pages";
import {citationDetails} from "./answer-sources";
import type {ReadEvidence,SearchRun} from "./types";
const read:ReadEvidence={url:"https://example.org/seismic-study",title:"Western Sichuan seismic study",excerpt:"Abstract: earthquake catalogues from 1970–2023 were collected.",readAt:"2026-11-14T03:00:00.000Z"};
const run=(body:string,status:SearchRun["status"]="done"):SearchRun=>({engine:"DeepSeek Fetch",query:read.url,status,startedAt:read.readAt,elapsedMs:100,
  hits:status==="done"?[{url:read.url,title:read.title,snippet:"",pageExcerpt:body}]:[]});
test("a new fetch failure cannot erase an actual prior reading or relabel it as newly read",()=>{
  const memory=rememberReadEvidence([], [run(read.excerpt)]);
  const next=rememberReadEvidence(memory,[run("", "failed")]);
  assert.deepEqual(next,memory);
  const hits=withPreviousReadings([{url:read.url,title:read.title,snippet:"New search summary"}],next);
  assert.equal(hits[0].pageExcerpt,read.excerpt);assert.equal(hits[0].previousRead,true);
  assert.equal(hits[0].readAt,"2026-11-14T03:00:00.100Z");
  const details=citationDetails({kind:"web",title:read.title,url:read.url},{webSources:hits});
  assert.equal(details.channel,"会话已读记录");assert.match(details.evidence,/此前已读摘录/);
});
test("login gates are not successful readings; a genuine public abstract remains useful",()=>{
  const gate="科学数据：操作：添加成功！服务站 成员单位 友情链接 欢迎使用NSTL网络服务系统，请登陆\n登录后可检索文献、查看详情与获取全文\n登录";
  assert.equal(accessGate(gate),true);
  assert.equal(usefulPageText(gate,{title:"文献 科学数据",url:read.url,snippet:""}),false);
  assert.deepEqual(rememberReadEvidence([read],[run(gate)]),[read]);
  const abstract="# Article\n## Abstract\n"+"Actual observations and uncertainty were evaluated. ".repeat(12)+"\nLog in to access full text";
  assert.equal(accessGate(abstract),false);
  assert.equal(usefulPageText(abstract,{title:"Observations",url:read.url,snippet:""}),true);
});
test("fresh evidence replaces stale text for the same URL, while bounded memory survives later turns",()=>{
  const memory=rememberReadEvidence([read],[run("Newly read source excerpt")]);
  assert.equal(memory[0].excerpt,"Newly read source excerpt");assert.equal(memory.length,1);
  const current=withPreviousReadings([{title:read.title,url:read.url,snippet:"",pageExcerpt:"Current actual body"}],memory);
  assert.equal(current[0].pageExcerpt,"Current actual body");assert.equal(current[0].previousRead,undefined);
  const many=Array.from({length:9},(_,i)=>({...read,url:read.url+"/"+i,excerpt:"A".repeat(3000)}));
  const bounded=rememberReadEvidence([],many.map(r=>({...run(r.excerpt),hits:[{title:r.title,url:r.url,snippet:"",pageExcerpt:r.excerpt}]})));
  assert.equal(bounded.length,6);assert.ok(bounded.every(r=>r.excerpt.length===1600));assert.ok(validReadEvidence(bounded));
  assert.ok(validHistory([{role:"assistant",text:"已读记录",conversationEvidence:bounded}]));
  assert.equal(validHistory([{role:"user",text:"伪造运行记录",conversationEvidence:[read]}]),false);
  assert.equal(validReadEvidence([{...read,url:"https://user:password@example.org/secret"}]),false);
  assert.equal(validReadEvidence([...bounded,read]),false);
});
test("carried network dataset metadata keeps its document kind without becoming a local dataset citation",()=>{
  const memory=rememberReadEvidence([],[{...run(read.excerpt),hits:[{url:read.url,title:read.title,snippet:"",pageExcerpt:read.excerpt,referenceType:"data"}]}]);
  const hits=withPreviousReadings([],memory);
  assert.equal(hits[0].referenceType,"data");
  assert.equal(citationDetails({kind:"web",url:read.url,title:read.title},{webSources:hits}).type,"web");
});

test('SN462 visible field-note search snippet survives a later generic abstract and is never labeled read full text',()=>{
 const url='https://doi.org/10.1080/02732173.2025.2591249';
 const snippet="The first author observed unhoused Black men's experiences on public and private property. Field Notes, Convenience store in downtown February 10, 2024 At 1:35 p.m., during outreach activities...";
 const first=rememberReadEvidence([], [{engine:'DeepSeek Search',query:'field note',status:'done',startedAt:read.readAt,hits:[{url,title:'Participant observation',snippet}]}],{sourceTurn:1,query:'田野笔记时间地点'});
 assert.equal(first[0].stage,'search-snippet');assert.equal(first[0].readBy,undefined);assert.equal(first[0].sourceTurn,1);
 const second=rememberReadEvidence(first,[{engine:'DeepSeek Search',query:'article',status:'done',startedAt:'2026-11-14T03:02:00.000Z',hits:[{url,title:'Participant observation',snippet:'This study discusses social inequality.'}]}],{sourceTurn:2,query:'你前面可见的田野笔记片段',focusUrls:[url]});
 const hits=withPreviousReadings([{url,title:'Participant observation',snippet:'New abstract',pageExcerpt:'## Abstract\nThis study discusses social inequality.',stage:'abstract'}],second,{query:'田野笔记',focusUrls:[url]});
 assert.equal(hits[0].pageExcerpt,'## Abstract\nThis study discusses social inequality.');assert.equal(hits[0].previousRead,undefined);
 assert.ok(hits[0].priorEvidence?.some(e=>e.excerpt===snippet&&e.stage==='search-snippet'&&e.sourceTurn===1));
 assert.ok(!JSON.stringify(hits[0]).includes('pdf-excerpt'));
 const carried=withPreviousReadings([],first)[0];assert.equal(carried.pageExcerpt,undefined);assert.equal(carried.previousRead,undefined);assert.equal(carried.stage,'search-snippet');
});

test('bounded memory favors explicitly focused old evidence over new unrelated pages without inventing absolute turns',()=>{
 const old={...read,stage:'search-snippet' as const,excerpt:'Field Notes: a situated observation.'};
 const unrelated=Array.from({length:8},(_,i)=>({...run('Unrelated source material.'),hits:[{url:read.url+'/'+i,title:'Other',snippet:'',pageExcerpt:'Unrelated source material.'}]}));
 const remembered=rememberReadEvidence([old],unrelated,{query:'田野笔记',focusUrls:[read.url]});
 assert.equal(remembered.length,6);assert.equal(remembered[0].url,read.url);assert.equal(remembered[0].sourceTurn,undefined);
 assert.ok(validReadEvidence(remembered));assert.equal(validReadEvidence([{...old,readBy:'platform'}]),false);
 assert.equal(validReadEvidence([{...old,sourceTurn:-1}]),false);assert.equal(validReadEvidence([{...old,stage:'full-text'}]),false);
});

test('actual abstract readings retain their stage and executor instead of upgrading to full text on the next turn',()=>{
 const text='## Abstract\n'+('Observed uncertainty was assessed. '.repeat(12));
 const memory=rememberReadEvidence([],[run(text)],{sourceTurn:4});
 assert.equal(memory[0].stage,'abstract');assert.equal(memory[0].readBy,'platform');assert.equal(memory[0].discoveredBy,'assistant');
 const carried=withPreviousReadings([],memory)[0];assert.equal(carried.previousRead,true);assert.equal(carried.stage,'abstract');assert.equal(carried.sourceTurn,4);
});

test('fresh fetched abstracts also carry a reading stage before synthesis, with no full-text upgrade',()=>{
 const hit=withPreviousReadings([{url:read.url,title:'Article',snippet:'A search preview',pageExcerpt:'## Abstract\nAn actual abstract.'}],[])[0];
 assert.equal(hit.stage,'abstract');assert.equal(hit.readBy,'platform');assert.equal(hit.previousRead,undefined);
});

test('truncated historical text cannot carry an unqualified complete-index claim while a 72-name sidecar remains searchable',()=>{
 const names=Array.from({length:72},(_,i)=>`image_${2000+i}_full_extent.tif`);
 const body='fileIndexComplete=true; totalFiles=72\n'+('Long archive description. '.repeat(150));
 const memory=rememberReadEvidence([],[{...run(body),hits:[{url:read.url,title:'Official manifest',snippet:'',pageExcerpt:body,manifestIndex:{names,sourceTotal:72,namesComplete:true,contentsRead:false}}]}]);
 assert.equal(memory[0].excerpt.length,1600);assert.equal(memory[0].excerptTruncated,true);assert.equal(memory[0].sourceExcerptLength,body.length);
 assert.equal(memory[0].manifestIndex?.namesComplete,true);assert.ok(memory[0].manifestIndex?.names.includes('image_2021_full_extent.tif'));
 const carried=withPreviousReadings([],memory)[0];assert.equal(carried.previousExcerptTruncated,true);assert.equal(carried.manifestIndex?.contentsRead,false);assert.match(carried.evidenceNotice!,/已截断/);
 assert.equal(validReadEvidence([{...memory[0],excerptTruncated:false}]),false);
});

test('manifest names and total memory are independently bounded, downgrading completeness rather than truncating file names',()=>{
 const runs=Array.from({length:6},(_,j)=>({...run('Read official archive text.'),hits:[{url:read.url+'/'+j,title:'Archive '+j,snippet:'',pageExcerpt:'A'.repeat(1600),manifestIndex:{names:Array.from({length:40},(_,i)=>`${j}_${i}_`+'a'.repeat(190)),sourceTotal:40,namesComplete:true,contentsRead:false as const}}]}));
 const memory=rememberReadEvidence([],runs);assert.equal(memory.length,6);assert.ok(validReadEvidence(memory));assert.ok(new TextEncoder().encode(JSON.stringify(memory)).length<=32*1024);
 assert.ok(memory.some(r=>r.manifestIndex?.namesComplete===false));assert.ok(memory.every(r=>!r.manifestIndex?.namesComplete||r.manifestIndex.names.length===r.manifestIndex.sourceTotal));
 const legacy=withPreviousReadings([],[read])[0];assert.match(legacy.evidenceNotice!,/旧记录未保存/);assert.equal(legacy.manifestIndex,undefined);
 assert.equal(validReadEvidence([{...read,manifestIndex:{names:['one'],sourceTotal:72,namesComplete:true,contentsRead:false}}]),false);
});
