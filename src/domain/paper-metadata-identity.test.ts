import test from 'node:test';
import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {isolatePaperMetadata,relatedNamedPaperCandidate} from '../../server/paper-metadata-identity';
import {searchPapers,normalizePaperSpace} from '../../server/earthnano';
const value=(value:unknown,...sources:string[])=>({value,sources});
const metadata=(key:string,title:string,wrong:string,source='gbif')=>({entity:{ds_key:key,doi_url:'https://doi.org/'+key.slice(4)},fields:{title:{values:[value(wrong,source),value(title,'datacite')]},description:{values:[value('unrelated provider content',source),value('correct registry content','datacite')]},spatial:{values:[value({raw_kind:'geoLocations',points:[[20,100]],bbox:[90,10,110,30]},source)]}}});
test('SN212 download snapshot and SN218 eBird isolate conflicting GBIF values before building spatial evidence',()=>{
 for(const [key,title] of [['doi:10.15468/dl.5hvdxz','Occurrence Download'],['doi:10.15468/aomfnb','EOD – eBird Observation Dataset']]){
  const raw=metadata(key,title,'Lichen occurrences from epiphytic communities in Quercus forests in northern Portugal (2004)');const before=structuredClone(raw);
  const result=isolatePaperMetadata(key,raw);
  assert.equal(result.quarantined[0].source,'gbif');assert.ok(result.quarantined[0].reasons.length);
  assert.deepEqual((result.fields.title as {values:unknown[]}).values,[value(title,'datacite')]);
  assert.equal(result.fields.spatial,undefined);assert.deepEqual(normalizePaperSpace(result.fields.spatial).points,[]);
  assert.deepEqual(raw,before,'upstream payload stays unchanged');
 }
});
test('SN295 mismatched figshare article and version URLs are not treated as the requested DOI',()=>{
 for(const url of ['https://kcl.figshare.com/articles/dataset/LGBTQ_Young_People/33265227','https://figshare.com/articles/dataset/Travel_time/7638134/3']){
  const key='doi:10.6084/m9.figshare.7638134.v4';const raw=metadata(key,'Travel time to cities and ports in the year 2015','LGBTQ+ Young People Minority Stress, Mediators, and Mental Health','figshare');
  Object.assign(raw.fields,{landing:{values:[value(url,'figshare')]}});
  const r=isolatePaperMetadata(key,raw);assert.equal(r.fields.landing,undefined);assert.equal(r.quarantined[0].source,'figshare');
 }
});
test('matching provider identities, source-shared values and compatible short titles remain available',()=>{
 const key='doi:10.15468/aomfnb',raw=metadata(key,'EOD – eBird Observation Dataset','eBird');
 assert.equal(isolatePaperMetadata(key,raw).quarantined.length,0);
 const shared=metadata(key,'EOD – eBird Observation Dataset','unrelated lichen');shared.fields.description.values=[value('shared description','gbif','datacite')];
 assert.deepEqual((isolatePaperMetadata(key,shared).fields.description as {values:unknown[]}).values,[value('shared description','datacite')]);
 const f=metadata('doi:10.6084/m9.figshare.7638134.v4','Travel time to cities and ports','Travel time to cities and ports','figshare');Object.assign(f.fields,{landing:{values:[value('https://figshare.com/articles/dataset/Travel_time/7638134/4','figshare')]}});
 assert.equal(isolatePaperMetadata('doi:10.6084/m9.figshare.7638134.v4',f).quarantined.length,0);
 assert.deepEqual(isolatePaperMetadata(key,{entity:{ds_key:'doi:10.1234/wrong'},fields:raw.fields}).fields,{});
});
test('named fallback relevance checks actual titles, not self-declared matched facets',()=>{
 assert.equal(relatedNamedPaperCandidate('GBIF occurrence download',['species occurrence'],{ds_key:'doi:10.1234/sage',display_name:'SAGE III/ISS L2 Solar Event Species Profiles',matched_facets:['species occurrence']}),false);
 assert.equal(relatedNamedPaperCandidate('animal audio annotation',['wind noise'],{display_name:'Dataset for marine vessel detection from Sentinel 2 images'}),false);
 assert.equal(relatedNamedPaperCandidate('GEDI',['canopy height'],{display_name:'GEDI canopy height'}),true);
 assert.equal(relatedNamedPaperCandidate('DOI:10.1234/target.v2',['wind noise'],{ds_key:'doi:10.1234/target.v2',display_name:'Different but exact DOI title'}),true);
});
test('unrelated task fallback never expands usages while normal independent GEDI matches still verify',async t=>{
 t.mock.method(Client.prototype,'connect',async()=>{});t.mock.method(Client.prototype,'close',async()=>{});
 const used:{name:string;arguments:Record<string,unknown>}[]=[];
 t.mock.method(Client.prototype,'callTool',async(request:{name:string;arguments:Record<string,unknown>})=>{
  used.push(request);const key='doi:10.1234/gedi';const payload=request.name==='resolve_dataset'?{status:'not_found'}:request.name==='find_dataset_by_task'?{status:'ok',has_more:false,candidates:[{ds_key:'doi:10.1234/mars',display_name:'Mars Environmental Monitoring Station',n_papers:99,matched_facets:['canopy height']},{ds_key:key,display_name:'GEDI canopy height',n_papers:1}]}:request.name==='search_dataset_usage'?{status:'ok',usages:[{ds_key:request.arguments.ds_key,paper_id:'p',dataset_id:'D1',paper_title:'Forest canopy'}]}:{status:'ok'};
  return {content:[{type:'text',text:JSON.stringify(payload)}]};
 });
 const r=await searchPapers({name:'GEDI',facets:[{need:'height',queries:['canopy height']}],region:[]},new AbortController().signal,()=>{});
 assert.deepEqual(r.records.map(r=>r.dsKey),['doi:10.1234/gedi']);assert.ok(!used.slice(2).some(r=>JSON.stringify(r.arguments).includes('mars')));assert.match(r.notices!.join(' '),/未继续读取/);
});
test('controlled SN212 MCP workflow emits the registry title and excludes quarantined provider coordinates',async t=>{
 t.mock.method(Client.prototype,'connect',async()=>{});t.mock.method(Client.prototype,'close',async()=>{});
 const key='doi:10.15468/dl.5hvdxz',raw=metadata(key,'Occurrence Download','Lichen occurrences from epiphytic communities in Quercus forests in northern Portugal (2004)');
 raw.fields.spatial.values.push(value({raw_kind:'geoLocations',bbox:[-180,-90,180,90]},'datacite'));
 const untouched=structuredClone(raw);
 t.mock.method(Client.prototype,'callTool',async({name}:{name:string})=>{
  const payload=name==='resolve_dataset'?{status:'ok',entities:[{ds_key:key,n_papers:1,display_name:'Lichen occurrences from epiphytic communities',matched_via:'exact'}]}:
   name==='get_dataset_metadata'?{status:'ok',...raw}:name==='search_dataset_usage'?{status:'ok',usages:[{ds_key:key,paper_id:'p',dataset_id:'D1',paper_title:'California iNaturalist observations'}]}:{status:'ok'};
  return {content:[{type:'text',text:JSON.stringify(payload)}]};
 });
 const result=await searchPapers({name:'10.15468/dl.5hvdxz',facets:[],region:[]},new AbortController().signal,()=>{});
 assert.equal(result.records.length,1);const record=result.records[0];
 assert.equal(record.need.product,'Occurrence Download');assert.deepEqual(record.points,[]);assert.equal(record.need.profile?.extent,'world');
 const official=record.need.tabs.find(t=>t.label==='官方元数据');assert.ok(official?.kind==='table');
 assert.ok(!JSON.stringify(official).includes('Lichen'));assert.ok(!JSON.stringify(official).includes('gbif'));
 assert.ok(record.need.tabs.some(t=>t.label==='元数据身份核对'));assert.match(result.notices!.join(' '),/gbif/);
 assert.deepEqual(raw,untouched);
});
