import {researchExecutor} from "../../server/research-executor";
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {modelReply} from '../../server/chat-executor';
import {citationDetails} from './answer-sources';
import {assets} from './datasets';
import {emptyFilters} from './spatial';
import type {DiscoveryContext} from './types';
import type {PaperRecord} from './paper-record';
import type {DataSearchResult} from '../../server/data-search';

test('the real reply builder records acquisition channels without overwriting retrieval document metadata',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'oneearth-source-channel-')),oldPath=process.env.PATH,oldAudit=process.env.ONEEARTH_ANSWER_EVIDENCE_AUDIT;
 const haina=assets.find(a=>a.holding&&a.origins.includes('haina'))!;
 const local={...haina,id:'managed-test-entity',datasetId:'managed:test',origins:['managed'],holding:{channelId:'managed',channelName:'工作区数据服务',access:'workspace' as const}};
 const paper={id:'earthnano:'+'d'.repeat(64),dsKey:'doi:10.1234/test-data',paperTitle:'A test study',studyContext:'',need:{product:'Dataset usage record',source:'EarthNano',detail:'A source-backed dataset use.',tabs:[{kind:'text',label:'原文 · A test study',quote:'A literal paragraph in the assertion library.'}]}} as PaperRecord;
 const web=[{title:'An online paper',url:'https://www.nature.com/articles/s41586-024-01234-5',snippet:'Public article metadata.',referenceType:'paper' as const},
  {title:'An online data record',url:'https://doi.org/10.1234/record',snippet:'Public dataset metadata.',referenceType:'data' as const}];
 try{
  const executable='#!'+process.execPath+`\nlet input='';process.stdin.on('data',b=>input+=b);process.stdin.on('end',()=>{const at=input.lastIndexOf('\\n{"question":');const p=JSON.parse(input.slice(at+1));const rows=[...p.catalogue,...p.webResults];process.stdout.write(JSON.stringify({message:rows.map(r=>r.title+'['+r.ref+']').join('；'),sections:[],limitation:'',followUp:'',researchNotes:[],calculationRequests:[]}));});\n`;
  await writeFile(path.join(dir,'codex'),executable,{mode:0o755});process.env.PATH=dir+path.delimiter+oldPath;delete process.env.ONEEARTH_ANSWER_EVIDENCE_AUDIT;
  const retrieval:DataSearchResult={plan:{questionMode:'preserve',dataQuestion:'核对这些来源',dataNeed:null,hainaQueries:[],paper:{name:'',facets:[],region:[],scenario:[]},web:[]},papers:[paper],haina:[local],searches:[{engine:'Bing',status:'done',query:'source provenance',hits:web}],issues:[],sourceStatus:[]};
  const context={caseId:null,filters:emptyFilters(),selection:null,camera:{center:[105,25],zoom:1,reason:'test'},candidateIds:[local.id],inCandidateScope:true} as DiscoveryContext;
  const result=await modelReply('核对这些来源',context,{message:''},[],researchExecutor({executor:'codex',model:''},undefined,new AbortController().signal),new AbortController().signal,undefined,[paper],'',undefined,retrieval);
  const refs=result.answerNotes.references!;
  const held=refs.find(r=>r.kind==='asset'&&r.id===local.id)!,assertion=refs.find(r=>r.kind==='asset'&&r.id===paper.id)!;
  assert.equal(held.sourceChannel,'local');assert.equal(assertion.sourceChannel,'assertion');
  assert.equal(citationDetails(assertion).type,'paper');assert.equal(citationDetails(held).type,'data');
  const network=refs.filter(r=>r.kind==='web');assert.equal(network.length,2);
  assert.deepEqual(network.map(r=>r.referenceType),['paper','data']);
  assert.ok(network.every(r=>r.sourceChannel==='web'&&citationDetails(r).type==='web'));
 }finally{
  if(oldPath===undefined)delete process.env.PATH;else process.env.PATH=oldPath;
  if(oldAudit===undefined)delete process.env.ONEEARTH_ANSWER_EVIDENCE_AUDIT;else process.env.ONEEARTH_ANSWER_EVIDENCE_AUDIT=oldAudit;
  await rm(dir,{recursive:true,force:true});
 }
});
