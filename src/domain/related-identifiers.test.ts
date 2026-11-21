import test from 'node:test';
import assert from 'node:assert/strict';
import {boundedRelatedIdentifiers} from '../../server/related-identifiers';
import {parseDataCitePage} from '../../server/datacite-search';
const relation=(id:string,type='IsDerivedFrom')=>({relatedIdentifier:id,relatedIdentifierType:'DOI',relationType:type});
test('large dependency manifests stay bounded while late version and identity links remain available',()=>{
 const records=Array.from({length:15000},(_,i)=>relation('10.15468/example.'+i));
 const parent=relation('10.5281/zenodo.100','IsVersionOf'),identity=relation('10.1234/same','IsIdenticalTo'),paper=relation('10.1234/paper','IsSupplementTo');records.push(parent,identity,paper);
 const r=boundedRelatedIdentifiers(records);
 assert.ok(r.relatedIdentifiers.includes(parent));assert.ok(r.relatedIdentifiers.includes(identity));assert.ok(r.relatedIdentifiers.includes(paper));
 assert.ok(r.relatedIdentifiers.length<=20);assert.ok(Buffer.byteLength(JSON.stringify(r.relatedIdentifiers))<=3000);
 assert.equal(r.relatedIdentifiersTotal,records.length);assert.equal(r.relatedIdentifiersOmitted,records.length-r.relatedIdentifiers.length);
 assert.equal(records.length,15003,'the caller/source manifest is unchanged');
});
test('identifiers are retained verbatim or explicitly omitted, never made into partial DOIs',()=>{
 const long=relation('https://example.org/'+('x'.repeat(5000))),normal=relation('10.1234/normal');
 const r=boundedRelatedIdentifiers([long,normal]);assert.deepEqual(r.relatedIdentifiers,[normal]);assert.equal(r.relatedIdentifiersOmitted,1);
 const small=[normal];assert.deepEqual(boundedRelatedIdentifiers(small),{relatedIdentifiers:small});
});
test('the actual DataCite adapter cannot pass an unbounded occurrence-download manifest to model/UI state',()=>{
 const relatedIdentifiers=Array.from({length:14360},(_,i)=>relation('10.15468/source.'+i));
 relatedIdentifiers.push(relation('10.5281/zenodo.parent','IsVersionOf'));
 const payload={meta:{total:1},data:[{type:'dois',id:'10.15468/dl.fixture',attributes:{doi:'10.15468/dl.fixture',titles:[{title:'Occurrence Download'}],descriptions:[{description:'A real discovery entry shape; no rows downloaded.'}],relatedIdentifiers}}]};
 const result=parseDataCitePage(payload),hit=result.hits[0];
 assert.equal(hit.doi,'10.15468/dl.fixture');assert.equal(result.total,1);
 assert.ok(JSON.stringify(hit).length<4500);assert.equal(hit.relatedIdentifiersTotal,14361);
 assert.ok(hit.relatedIdentifiers?.some(x=>x.relationType==='IsVersionOf'));
 assert.equal(payload.data[0].attributes.relatedIdentifiers.length,14361);
});
