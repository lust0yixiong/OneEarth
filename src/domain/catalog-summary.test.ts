import test from 'node:test';
import assert from 'node:assert/strict';
import {paperCatalogSummary,paperMapSummary,paperRecords,validPaperRecord,paperModel,type PaperRecord} from './paper-record';
import {registerPapers,assetById,loadRemoteAssetIds,assets} from './datasets';
import {emptyFilters,gridSpec,cellAt} from './spatial';
import {candidates} from './results';
const full:PaperRecord={id:'earthnano:'+'e'.repeat(64),dsKey:'test:catalog-summary',papers:1,paperTitle:'Actual paper',studyContext:'Study context is not a local sample',points:[],
  need:{name:'data',product:'Exact historical dataset',datasetId:'test:catalog-summary',type:'test',source:'文献资料',status:'used',detail:'Searchable method and variables',
    profile:{role:'data',spatial:'coverage',coverage:'Official envelope',areaBasis:'bounding-box',area:{type:'Polygon',coordinates:[[[100,20],[100,30],[110,30],[110,20],[100,20]]]},access:'public',limitation:'Not an observation'},
    tabs:[{kind:'table',label:'论文用法（本页）',rows:[['Paper','usage','variable','context','paper-1','data-1','10.1234/paper']]},{kind:'text',label:'原文 · Paper',quote:'Original evidence survives hydration.'}]},
  researchQuestions:[{paperId:'paper-1',rqId:'r1',datasetId:'data-1',paperTitle:'Paper',question:'Actual research question'}]};
test('catalogue transport retains exact identity, searchable questions and map membership, then hydrates full historical evidence once',async()=>{
  const summary=paperCatalogSummary(full);assert.ok(validPaperRecord(summary));assert.deepEqual(summary.researchQuestions,full.researchQuestions);assert.equal(summary.need.profile,full.need.profile);
  registerPapers([summary]);const g=gridSpec('h3',3),point:[number,number]=[105,25],selection={id:cellAt(point,g),grid:g,point};
  const before=candidates(null,emptyFilters(),'all',selection).map(a=>a.id);
  const oldFetch=globalThis.fetch;let calls=0;
  globalThis.fetch=(async()=>{calls++;return Response.json([full]);}) as typeof fetch;
  try{await loadRemoteAssetIds([full.id]);}finally{globalThis.fetch=oldFetch;}
  assert.equal(calls,1);assert.equal(paperRecords.get(full.id)?.catalogSummary,undefined);assert.equal(assetById.get(full.id)?.tabs.length,2);
  assert.deepEqual(candidates(null,emptyFilters(),'all',selection).map(a=>a.id),before);
  registerPapers([summary]);assert.equal(paperRecords.get(full.id)?.catalogSummary,undefined);assert.equal(assetById.get(full.id)?.tabs.length,2);
  assert.equal(assets.filter(a=>a.id===full.id).length,1);
  assert.equal(paperModel(full),paperModel(full));
  assert.equal(full.need.tabs.length,2);
});

test('map index preserves exact membership and text search metadata and hydrates omitted evidence',async()=>{
  const index=paperMapSummary(full);assert.ok(validPaperRecord(index));
  assert.equal(index.need.profile,full.need.profile);assert.deepEqual(index.points,full.points);
  assert.equal(index.need.detail,full.need.detail);assert.equal(index.id,full.id);assert.equal(index.dsKey,full.dsKey);
  assert.equal(index.researchQuestions,undefined);assert.equal(index.need.tabs[0].rows?.[0][4],'paper-1');
  assert.ok(JSON.stringify(index).length<JSON.stringify(full).length);assert.equal(full.researchQuestions?.length,1);
  registerPapers([{...index,id:'earthnano:'+'f'.repeat(64),dsKey:'test:map-index'}]);
  const id='earthnano:'+'f'.repeat(64),oldFetch=globalThis.fetch;let calls=0;
  globalThis.fetch=(async()=>{calls++;return Response.json([{...full,id,dsKey:'test:map-index'}]);}) as typeof fetch;
  try{await loadRemoteAssetIds([id]);await loadRemoteAssetIds([id]);}finally{globalThis.fetch=oldFetch;}
  assert.equal(calls,1);assert.deepEqual(paperRecords.get(id)?.researchQuestions,full.researchQuestions);
  assert.deepEqual(assetById.get(id)?.tabs,full.need.tabs);
});
