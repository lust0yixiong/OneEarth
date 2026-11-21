import test from "node:test";
import assert from "node:assert/strict";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {webDocumentType,referenceCitationType,referenceChannel,citationTypeLabels} from "./citation-types";
import {citationDetails} from "./answer-sources";
import {assets} from "./datasets";
import {AnswerContent} from "../components/AnswerContent";
import {parseDataCitePage} from "../../server/datacite-search";
import type {AnswerReference} from "./types";

test("document metadata identifies publications without turning network papers into assertion-library citations",()=>{
  for(const url of ['https://isprs-archives.copernicus.org/articles/XLVIII-4-W7-2023/11/2023/',
    'https://www.mdpi.com/2072-4292/17/7/1163','https://www.nature.com/articles/s41586-024-01234-5',
    'https://www.frontiersin.org/journals/forests-and-global-change/articles/10.3389/ffgc.2024.1419023/full'])
    {assert.equal(webDocumentType({url}),'paper',url);assert.equal(referenceCitationType({kind:'web',title:'Online paper',url,referenceType:'paper'}),'web');}
  for(const url of ['https://doi.org/10.1234/unknown','https://www.mdpi.com/about','https://www.nature.com/articles/d41586-024-news',
    'https://mdpi.com.evil.example/2072-4292/17/7/1163','https://user:pass@www.mdpi.com/2072-4292/17/7/1163'])
    assert.equal(webDocumentType({url}),'web',url);
  assert.equal(webDocumentType({url:'https://example.org',referenceType:'data'}),'data');
  assert.equal(webDocumentType({url:'https://example.org',referenceType:'constructor' as never}),'web');
  assert.deepEqual(citationTypeLabels,{data:'本地数据集',paper:'文献依据',web:'网页来源'});
});

test("assertion datasets are literature evidence, managed Haina entities are local data, and public catalogues are web sources",()=>{
  const ref:AnswerReference={kind:'asset',id:'earthnano:'+'a'.repeat(64),title:'Dataset used in papers',source:'EarthNano'};
  assert.deepEqual(citationDetails({...ref,referenceType:'data'}),{type:'paper',channel:'文献依据',evidence:'文献与数据关联记录'});
  const local=assets.find(a=>a.origins.includes('haina'))!;
  assert.equal(citationDetails({kind:'asset',id:local.id,title:local.title,source:local.source}).type,'data');
  assert.equal(citationDetails({kind:'asset',id:'Q10-4',title:'WRF study',source:'Paper'}).type,'web','an archived paper entry alone is not an assertion-library retrieval');
  assert.equal(citationDetails({kind:'asset',id:'Q10-2',title:'WRF docs',source:'UCAR'}).type,'web');
  assert.equal(citationDetails({kind:'asset',id:'Q05-1',title:'OISST',source:'NOAA'}).type,'web','a catalogue entry is not a local entity');
  assert.equal(citationDetails(ref).nature,undefined,'unknown data nature must not be inferred from a dataset name');
  assert.equal(citationDetails({kind:'asset',id:'constellation:'+'b'.repeat(64),title:'Received observation',source:'Push'}).nature,'观测记录');
});

test("network dataset metadata retains its document kind but groups as web, including legacy saved citations",()=>{
  const hit=parseDataCitePage({data:[{id:'10.1234/record',type:'dois',attributes:{doi:'10.1234/record',titles:[{title:'Recorded dataset'}]}}],meta:{total:1}}).hits[0];
  assert.equal(hit.referenceType,'data');
  const ref:AnswerReference={kind:'web',title:hit.title,url:hit.url};
  assert.deepEqual(citationDetails(ref,{searches:[{engine:'Bing',query:'record',status:'done',hits:[{...hit,referenceType:undefined}]},
    {engine:'DataCite',query:'record',status:'done',hits:[{...hit,referenceType:undefined}]}]}),
    {type:'web',channel:'DataCite',evidence:'数据集 DOI 元数据'});
  assert.equal(citationDetails({...ref,referenceType:'data'},{webSources:JSON.parse(JSON.stringify([hit]))}).type,'web');
  assert.equal(citationDetails(ref).type,'web','a DOI alone cannot identify a dataset');
});

test("inline citations display the three type icons without permanently rendering reference details",()=>{
  const local=assets.find(a=>a.holding)!;
  const refs:AnswerReference[]=[{kind:'asset',id:local.id,title:local.title,source:local.source},
    {kind:'asset',id:'earthnano:'+'b'.repeat(64),title:'Assertion record',source:'EarthNano'},
    {kind:'web',title:'A study found online',url:'https://www.mdpi.com/2072-4292/17/7/1163',referenceType:'paper'}];
  const html=renderToStaticMarkup(createElement(AnswerContent,{text:'Data〔1〕 Paper〔2〕 Docs〔3〕',references:refs,inspect(){}}));
  for(const type of ['data','paper','web'])assert.match(html,new RegExp('data-reference-type="'+type+'"'));
  for(const icon of ['database','book-open','globe'])assert.match(html,new RegExp('lucide-'+icon));
  assert.doesNotMatch(html,/role="tooltip"|title="/);
  assert.match(html,/href="https:\/\/www.mdpi.com/);assert.ok(html.includes('data-asset-id="'+local.id+'"'));
});

test('only managed holdings or actually received data establish a local entity; remote file URLs and titles do not',()=>{
 const ref:AnswerReference={kind:'asset',id:'remote',title:'Local dataset.tif',source:'Catalogue',referenceType:'data'};
 const remote={origins:['public'],datasetId:'remote:tiff'};
 assert.equal(referenceChannel(ref,remote),'web');
 assert.equal(referenceChannel(ref,{...remote,datasetId:'paper:10.1234/article'}),'web','a paper identifier is document identity, not acquisition provenance');
 assert.equal(referenceCitationType(ref,{...remote,holding:{channelId:'workspace',channelName:'工作区',access:'workspace'}}),'data');
 assert.equal(referenceChannel(ref,remote,{file:null,measurements:[]}),'web');
 assert.equal(referenceChannel(ref,remote,{file:null,measurements:[{variable:'SST',value:20,unit:'°C'}]}),'local');
 assert.equal(referenceCitationType({kind:'web',title:'Remote GeoTIFF',url:'https://example.org/data.tif',sourceChannel:'local',referenceType:'data'}),'web');
});

test('recorded acquisition survives registry eviction without trusting legacy document-type labels',()=>{
 const ref:AnswerReference={kind:'asset',id:'archived-local',title:'Held data',source:'Archive',sourceChannel:'local'};
 assert.equal(citationDetails(ref).type,'data');
 assert.equal(citationDetails({...ref,sourceChannel:undefined,referenceType:'data'}).type,'web');
 assert.equal(citationDetails({...ref,sourceChannel:'assertion',referenceType:'data'}).type,'paper');
});
