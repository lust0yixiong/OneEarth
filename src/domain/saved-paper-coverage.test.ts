import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import express from 'express';
import {assets,assetById,registerPapers} from './datasets';
import {catalogGrid} from './results';
import {cellAt,emptyFilters,gridSpec} from './spatial';
import {coverageRouter} from '../../server/coverage-router';
import {coverageIndex} from '../../server/coverage-index';
import type {PaperRecord} from './paper-record';
import type {CandidateSet,Filters} from './types';
const record=(digit:string,dsKey:string,point:[number,number]):PaperRecord=>({
 id:'earthnano:'+digit.repeat(64),dsKey,papers:1,paperTitle:'Saved local evidence',studyContext:'Documented station',points:[point],
 need:{name:'论文研究数据',product:'Saved paper point',type:'论文研究数据',detail:'Actual point record',status:'有论文用法记录',source:'EarthNano 论文断言库',
  profile:{role:'data',spatial:'coverage',coverage:'1 个官方坐标',access:'Public metadata',limitation:'Test evidence only',years:[2000,2005],utcWindow:[Date.parse('2000-01-01T00:00:00Z'),Date.parse('2006-01-01T00:00:00Z')]},
  tabs:[{kind:'table',label:'论文用法（本页）',columns:['paper','role','var','context','paperId','datasetId'],rows:[['Saved local evidence','source','x','station','saved-paper','D1']]}]}});
const scope=(r:PaperRecord,filters:Filters=emptyFilters(),selected=true):CandidateSet=>{
 const grid=gridSpec('h3',7),point=r.points[0];return {ids:[r.id],caseId:null,title:'Saved answer',filters,selection:selected?{id:cellAt(point,grid),grid,point}:null,layer:'all',camera:{center:point,zoom:2200,reason:'test'},gridSystem:'h3'};
};
test('saved paper point counts in its selected evidence grid without entering the global feed',()=>{
 const r=record('a','doi:10.9999/saved-hidden-point',[-66.8,18.317]);registerPapers([r],false);
 const f=emptyFilters(),g=gridSpec('h3',7),b=scope(r),cell=b.selection!.id;
 assert.ok(assetById.has(r.id));assert.ok(!assets.some(a=>a.id===r.id));
 assert.ok(catalogGrid(g,f,b).get(cell)?.has(r.dsKey),'selected entry must not be lost through object identity');
 assert.ok(!catalogGrid(g,f).get(cell)?.has(r.dsKey),'hidden reference must not publish globally');
 for(const changes of [{source:'haina'},{type:'卫星观测产品'},{period:[2020,2023] as [number,number]},{utcWindow:[Date.parse('2020-01-01T00:00:00Z'),Date.parse('2021-01-01T00:00:00Z')] as [number,number]}]){
  const filtered={...f,...changes};assert.ok(!catalogGrid(g,filtered,{...b,filters:filtered}).get(cell)?.has(r.dsKey),'saved references still obey every existing filter');
 }
 assert.equal(catalogGrid(gridSpec('s2',7),f,b).size,0,'saved selection retains its original grid');
});
test('a newer catalogue record does not remove the exact older answer point',()=>{
 const old=record('b','doi:10.9999/replaced-saved-point',[-67,18]);registerPapers([old]);
 const next=record('c',old.dsKey,[140,36]);registerPapers([next]);
 assert.ok(!assets.some(a=>a.id===old.id));assert.ok(assets.some(a=>a.id===next.id));
 const f=emptyFilters(),g=gridSpec('h3',7),b=scope(old),cell=b.selection!.id;
 assert.ok(catalogGrid(g,f,b).get(cell)?.has(old.dsKey));
 assert.ok(!catalogGrid(g,f).get(cell)?.has(old.dsKey),'old point must not leak back into unscoped catalogue');
});
test('one hydration batch retains both historical references for the same dataset without publishing them',()=>{
 const a=record('e','doi:10.9999/two-saved-versions',[-66.5,18.5]),b=record('f',a.dsKey,[140,36]);
 registerPapers([a,b,a],false);
 assert.equal(assetById.get(a.id)?.id,a.id);assert.equal(assetById.get(b.id)?.id,b.id);
 assert.ok(!assets.some(r=>r.id===a.id||r.id===b.id));
 const grid=gridSpec('h3',7);
 for(const r of [a,b]){const batch=scope(r);assert.ok(catalogGrid(grid,emptyFilters(),batch).get(batch.selection!.id)?.has(r.dsKey));}
});
test('coverage scope hydrates a saved local paper record on demand without publishing it',async()=>{
 const r=record('d','doi:10.9999/hydrated-saved-point',[-66.9,18.4]),directory=await mkdtemp(path.join(tmpdir(),'saved-coverage-'));
 const index=coverageIndex(path.join(directory,'coverage.sqlite'));const requests:string[][]=[];
 const app=express();app.use(express.json());app.use('/coverage',coverageRouter(index,ids=>{requests.push(ids);registerPapers(ids.includes(r.id)?[r]:[],false);}));
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
 const address=server.address();assert.ok(address&&typeof address!=='string');const url='http://127.0.0.1:'+address.port+'/coverage/';
 const post=async(route:string,body:unknown)=>{const res=await fetch(url+route,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});assert.equal(res.status,200);return res.json();};
 try{
  assert.ok(!assetById.has(r.id));const b=scope(r),f=emptyFilters();const s=await post('scopes',{filters:f,batch:b});
  const result=await post('cells',{id:s.id,grid:b.selection!.grid,cells:[b.selection!.id],includeProducts:true});
  assert.deepEqual(requests,[[r.id]]);assert.deepEqual(result.cells,[[b.selection!.id,1]]);assert.deepEqual(result.members,[[b.selection!.id,[r.dsKey]]]);
  assert.ok(!assets.some(a=>a.id===r.id));await post('scopes',{filters:f});assert.equal(requests.length,1,'global reads never hydrate saved references');
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));await index.close();await rm(directory,{recursive:true,force:true});}
});
