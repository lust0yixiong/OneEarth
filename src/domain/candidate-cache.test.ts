import test from 'node:test';
import assert from 'node:assert/strict';
import {candidates} from './results';
import {registerPapers} from './datasets';
import {emptyFilters} from './spatial';
import type {PaperRecord} from './paper-record';
const record:PaperRecord={id:'earthnano:'+'7'.repeat(64),dsKey:'test:candidate-cache',papers:1,paperTitle:'Actual evidence',studyContext:'',points:[],need:{name:'data',product:'Dataset',type:'test',source:'文献资料',detail:'actual evidence',status:'used',profile:{role:'data',spatial:'nonspatial',coverage:'No coordinates',access:'public',limitation:'Not a local sample'},tabs:[{kind:'table',label:'论文用法（本页）',rows:[['Paper','','','','paper-id','dataset-id']]}]}};
test('candidate reuse never leaks caller mutations, stale catalogues, or previous filter values',()=>{
 registerPapers([record]);const filters={...emptyFilters(),source:'paper'};
 const before=candidates(null,filters,'all',null).map(a=>a.id);assert.ok(before.includes(record.id));
 const returned=candidates(null,filters,'all',null);returned.length=0;
 assert.deepEqual(candidates(null,filters,'all',null).map(a=>a.id),before);
 filters.source='haina';assert.ok(!candidates(null,filters,'all',null).some(a=>a.id===record.id));
 filters.source='paper';assert.deepEqual(candidates(null,filters,'all',null).map(a=>a.id),before);
 const revised={...record,id:'earthnano:'+'8'.repeat(64)};registerPapers([revised]);
 const next=candidates(null,filters,'all',null);assert.ok(next.some(a=>a.id===revised.id));assert.ok(!next.some(a=>a.id===record.id));
});
