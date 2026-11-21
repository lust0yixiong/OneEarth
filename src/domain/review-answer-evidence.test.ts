import test from 'node:test';import assert from 'node:assert/strict';
import {parseSynthesis} from '../../server/scientific-answer';
import {reviewAnswerEvidence,buildAnswerEvidenceInput,type EvidenceReviewInput} from '../../server/review-answer-evidence';
import type {CatalogueEvidence} from '../../server/chat-executor';
import type {ToolCall,AnswerReference} from './types';
const ref:Extract<AnswerReference,{kind:'web'}>={kind:'web',title:'Wheat RTM paper',url:'https://example.org/paper'};
const empty=(message:string)=>({message,sections:[],limitation:'',followUp:'',researchNotes:[],calculationRequests:[]});
function setup(){
 const events:ToolCall[]=[];const input:EvidenceReviewInput={parsedAnswer:parseSynthesis(JSON.stringify(empty('论文抽测30株。[S2]')),[{kind:'asset',id:'not-used',title:'other',source:'catalog'},ref],[]),catalogue:[],references:[{kind:'asset',id:'not-used',title:'other',source:'catalog'},ref],webHits:[{...ref,snippet:'Search lead only',pageExcerpt:'Measured LAI in wheat; partial paper extract.',stage:'pdf-excerpt',readBy:'platform'}],question:'两种参数怎样分别核对？',originalSynthesisPrompt:'ORIGINAL PROMPT question=两种参数怎样分别核对？ [S2] existing wheat source; history context is not a source',calculations:[{operation:'arithmetic',scope:'example',sourceRefs:[],status:'completed',result:2}],run:async()=>({sampledClaims:1,completeAnswerAudit:false,findings:[]}),parentSignal:new AbortController().signal,onTool:e=>events.push(e)};
 // parseSynthesis references must identify the exact current batch references.
 input.parsedAnswer=parseSynthesis(JSON.stringify(empty('论文抽测30株。[S2]')),input.references,input.webHits);
 return {input,events};
}
const fact=(claim='论文抽测30株')=>({claim,claimType:'reported-fact',displayCitations:[1],sourceRefs:['S2'],witnesses:[],kind:'unsupported-detail',action:'verify-or-remove-detail'});
const audit=(findings:unknown[]=[])=>({sampledClaims:1,completeAnswerAudit:false,findings});
test('wrapper binds display1 to originalS2, labels supplied structured relations and excludes assistant notes',()=>{
 const {input}=setup();input.webHits[0].priorEvidence=[{url:ref.url,title:ref.title,excerpt:'Old actually read literal window',readAt:'2026-11-15T00:00:00Z',readBy:'platform',stage:'page-excerpt'}];input.catalogue=[{id:'not-used',title:'other',source:'catalog',summary:'SOURCE ASSERTION SUMMARY',study:'SOURCE STUDY CONTEXT',researchNotes:[{note:'ASSISTANT ADVICE MUST NOT APPEAR'}],excerpts:[],sourceTextChars:0,includedChars:0,omittedBlocks:0,omittedPages:[],notice:''}];
 input.parsedAnswer=parseSynthesis(JSON.stringify(empty('论文抽测30株。[S2] 另见来源关系。[S1]')),input.references,input.webHits);
 const a=buildAnswerEvidenceInput(input);assert.deepEqual(a.bindings,[{display:1,sourceRefs:['S2']},{display:2,sourceRefs:['S1']}]);const packed=JSON.stringify(a);assert.ok(packed.includes('Old actually read literal window'));assert.equal(packed.includes('SOURCE ASSERTION SUMMARY'),true);assert.equal(packed.includes('SOURCE STUDY CONTEXT'),true);assert.equal(packed.includes('ASSISTANT ADVICE MUST NOT APPEAR'),false);assert.ok(a.sources[0].windows.some(w=>w.location.includes('structured relation')&&w.location.includes('not original full text')));assert.ok(a.sources.every(s=>s.completeness.loaded==='partial'));
});
test('manifest namesComplete alone is necessary and count agreement required; an index is never file content',()=>{
 const {input}=setup();input.webHits[0].manifestIndex={names:['a.tif','b.tif'],sourceTotal:2,namesComplete:true,contentsRead:false};let a=buildAnswerEvidenceInput(input);assert.equal(a.sources.find(s=>s.ref==='S2')?.stage,'file-index');assert.equal(a.sources.find(s=>s.ref==='S2')?.completeness.loaded,'complete');
 input.webHits[0].manifestIndex.namesComplete=false;a=buildAnswerEvidenceInput(input);assert.equal(a.sources.find(s=>s.ref==='S2')?.completeness.loaded,'partial');
 input.webHits[0].manifestIndex.namesComplete=true;input.webHits[0].manifestIndex.sourceTotal=72;a=buildAnswerEvidenceInput(input);assert.equal(a.sources.find(s=>s.ref==='S2')?.completeness.loaded,'partial');
});
test('no finding uses exactly one audit, preserves answer and reports sampled rather than complete science',async()=>{
 const {input,events}=setup();let calls=0;input.run=async()=>{calls++;return audit();};const checked=await reviewAnswerEvidence(input);assert.equal(calls,1);assert.equal(checked.answer,input.parsedAnswer);assert.equal(checked.status,'sampled');assert.equal(events.at(-1)?.status,'done');assert.match(events.at(-1)?.output||'',/不代表科学事实全部已证/);
});
test('valid finding allows one repair with locked original question, same prompt and actual calculations, no new computation',async()=>{
 const {input,events}=setup();let calls=0;input.run=async(prompt,schema)=>{calls++;if(calls===1)return audit([fact()]);assert.ok(prompt.startsWith(input.originalSynthesisPrompt));assert.ok(prompt.includes('"lockedQuestion":"'+input.question+'"'));assert.ok(prompt.includes('"actualCalculationReports":'+JSON.stringify(input.calculations)));assert.match(prompt,/calculationRequests必须为\[\]/);return empty('当前节选未核实抽测株数。[S2]');};
 const checked=await reviewAnswerEvidence(input);assert.equal(calls,2);assert.equal(checked.status,'repaired');assert.equal(checked.answer.message,'当前节选未核实抽测株数。〔1〕');assert.equal(input.question,'两种参数怎样分别核对？');assert.ok(events.some(e=>e.id==='answer-source-repair'&&e.status==='done'));
});
test('nonliteral or cross-source findings cannot change the body or invoke repair; result is observably incomplete',async()=>{
 for(const f of [{...fact(),claim:'论文测了300株'},{...fact(),witnesses:[{sourceRef:'S99',windowId:'page',quote:'new fact'}]}]){
  const {input,events}=setup();let calls=0;input.run=async()=>{calls++;return audit([f]);};const checked=await reviewAnswerEvidence(input);assert.equal(calls,1);assert.equal(checked.answer.message,input.parsedAnswer.message);assert.match(checked.answer.limitation,/复核未完成/);assert.ok(events.some(e=>e.status==='partial'||e.status==='failed'));
 }
});
test('new S reference, new URL, rewritten-question field and new computation reject repair and withhold disputed certainty',async()=>{
 const bad=[empty('新结论。[S99]'),empty('新结论。[额外来源](https://evil.example/new)[S2]'),{...empty('被改问题的答复。[S2]'),question:'different question'},{...empty('新计算。[S2]'),calculationRequests:[{operation:'arithmetic',scope:'example',sourceRefs:[],arguments:'{"expression":"1+1"}'}]}];
 for(const reply of bad){const {input,events}=setup();let calls=0;input.run=async()=>++calls===1?audit([fact()]):reply;const checked=await reviewAnswerEvidence(input);assert.equal(calls,2);assert.notEqual(checked.answer.message,input.parsedAnswer.message);assert.equal(checked.answer.message.includes('论文抽测30株'),false);assert.equal('withheldClaims' in checked&&checked.withheldClaims,1);assert.deepEqual(checked.answer.references,input.parsedAnswer.references);assert.equal(input.parsedAnswer.message,'论文抽测30株。〔1〕');assert.match(checked.answer.limitation,/复核未完成/);assert.equal(events.at(-1)?.status,'partial');}
});
test('audit timeout and repair timeout abort their dependency under the shared deadline and leave true partial tool status',async()=>{
 for(const phase of ['audit','repair']){const {input,events}=setup();let calls=0,aborted=false;input.budgets={totalMs:20,auditMs:5,repairMs:5};input.run=async(_p,_s,signal)=>{calls++;if(phase==='repair'&&calls===1)return audit([fact()]);return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(Error('aborted'));}));};const checked=await reviewAnswerEvidence(input);assert.ok(aborted);assert.ok(checked.elapsedMs<150);if(phase==='audit')assert.equal(checked.answer.message,input.parsedAnswer.message);else{assert.notEqual(checked.answer.message,input.parsedAnswer.message);assert.equal('withheldClaims' in checked&&checked.withheldClaims,1);}assert.match(checked.answer.limitation,/复核未完成/);assert.ok(events.at(-1)?.status==='partial'||events.at(-1)?.status==='failed');assert.equal(calls,phase==='audit'?1:2);}
});
test('parent cancellation does not invoke run, and malformed audit is failed rather than passed',async()=>{
 const {input,events}=setup();const controller=new AbortController();controller.abort();input.parentSignal=controller.signal;let called=false;input.run=async()=>{called=true;return audit();};const cancelled=await reviewAnswerEvidence(input);assert.equal(called,false);assert.match(cancelled.answer.limitation,/复核未完成/);assert.equal(events.at(-1)?.status,'partial');
 const other=setup();other.input.run=async()=>({madeUp:'fact'});const malformed=await reviewAnswerEvidence(other.input);assert.equal(malformed.status,'failed');assert.equal(other.events.at(-1)?.status,'failed');
});


test('truncated audit input only defers unsupported-detail for full-material recheck; failed repair cannot justify deleting it',async()=>{
 const {input,events}=setup();input.webHits[0].pageExcerpt='partial source window '.repeat(600);let calls=0;input.run=async(prompt)=>{if(++calls===1)return audit([fact()]);assert.match(prompt,/不可仅据审计节选漏项裁掉/);return empty('无效新来源。[S99]');};const checked=await reviewAnswerEvidence(input);assert.equal(calls,2);assert.equal(checked.answer.message,input.parsedAnswer.message);assert.equal('withheldClaims' in checked&&checked.withheldClaims,0);assert.equal('deferredClaims' in checked&&checked.deferredClaims,1);assert.match(checked.answer.limitation,/审计输入有省略/);assert.equal(events.at(-1)?.status,'partial');
});
test('mixed valid and invalid audit findings repair only the validated subset and remain partial',async()=>{
 const {input,events}=setup();let calls=0;input.run=async(prompt)=>{if(++calls===1)return {...audit([fact(),{...fact(),claim:'forged fact'}]),sampledClaims:2};assert.equal(prompt.includes('forged fact'),false);return empty('抽测株数仍待核。[S2]');};const checked=await reviewAnswerEvidence(input);assert.equal(calls,2);assert.equal(checked.status,'repaired-partial');assert.match(checked.answer.limitation,/复核仍不完整/);assert.equal(events.at(-1)?.status,'partial');
});


test('historical assertion windows keep recorded time and exact source IDs without becoming fresh MCP or complete text',()=>{
 const {input}=setup(),assetId='earthnano:'+'a'.repeat(64),quote='Historical source says thirty plants were sampled.';const asset:AnswerReference={kind:'asset',id:assetId,title:'Historical assertion source',source:'paper'};input.references[1]=asset;input.webHits=[];input.parsedAnswer=parseSynthesis(JSON.stringify(empty('论文抽测30株。[S2]')),input.references,[]);
 const historical={stage:'assertion-excerpt',assetId,paperId:'paper-old',rqId:'RQ1',datasetId:'D2',label:'old exact excerpt',block:'B0042',quote,start:3,end:3+quote.length,sourceLength:200,partial:true,recordedAt:'2026-11-14T20:00:00Z',sourceTurn:1};
 input.catalogue=[{id:assetId,title:asset.title,source:'paper',excerpts:[],sourceTextChars:0,includedChars:0,omittedBlocks:0,omittedPages:[],notice:'',historicalExcerpts:[historical,{...historical,assetId:'earthnano:'+'b'.repeat(64)}]}];
 const a=buildAnswerEvidenceInput(input),source=a.sources[0];assert.equal(source.windows.filter(w=>w.id==='historical-assertion-0').length,1);assert.equal(source.windows.some(w=>w.id==='historical-assertion-1'),false);assert.equal(source.windows.find(w=>w.id==='historical-assertion-0')?.text,quote);assert.match(source.windows[0].location,/2026-11-14T20:00:00Z/);assert.match(source.windows[0].location,/not new MCP/);assert.ok(source.windows.some(w=>w.text.includes('paper-old')&&w.text.includes('B0042')));assert.equal(source.completeness.loaded,'partial');
});
test('usage, research path, question and coverage assertions remain available as structured evidence, not original prose',()=>{
 const {input}=setup();input.catalogue=[{id:'not-used',title:'other',source:'catalog',excerpts:[],sourceTextChars:0,includedChars:0,omittedBlocks:0,omittedPages:[],notice:'',summary:'source summary',study:'source study',usage:{rows:[['paired spectra and ground samples']]},researchPaths:[{stepId:'RQ1_S1',method:'SPAD sampling',researchNotes:'assistant private advice'}],researchQuestions:[{question:'LAI and CAB inversion'}],coverage:'official scope'}];input.parsedAnswer=parseSynthesis(JSON.stringify(empty('来源关系。[S1]')),input.references,input.webHits);const a=buildAnswerEvidenceInput(input),source=a.sources.find(s=>s.ref==='S1')!;for(const id of ['summary','study','usage','researchPaths','researchQuestions','coverage'])assert.ok(source.windows.some(w=>w.id==='structured-'+id));assert.equal(JSON.stringify(source).includes('assistant private advice'),false);assert.equal(source.stage,'metadata');assert.equal(source.completeness.loaded,'partial');
});
test('historical search snippets retain literal clues without being relabeled as read body',()=>{
 const {input}=setup();input.webHits[0].priorEvidence=[{url:ref.url,title:ref.title,excerpt:'Historical search says integration time10s.',readAt:'2026-11-14T20:00:00Z',stage:'search-snippet',sourceTurn:1}];const a=buildAnswerEvidenceInput(input),w=a.sources.find(s=>s.ref==='S2')!.windows.find(w=>w.id==='prior-literal-0')!;assert.match(w.text,/10s/);assert.match(w.location,/historical-search-snippet-not-page-read/);assert.match(w.location,/search-snippet/);assert.equal(a.sources.find(s=>s.ref==='S2')!.completeness.loaded,'partial');
});
test('repair can use actual provided landingUrl or metadata URL but never an invented external source',async()=>{
 for(const kind of ['landing','metadata']){const {input}=setup();const url=kind==='landing'?'https://publisher.example/official':'https://data.example/download';if(kind==='landing')input.webHits[0].landingUrl=url;else input.catalogue=[{id:'not-used',title:'other',source:'catalog',excerpts:[],sourceTextChars:0,includedChars:0,omittedBlocks:0,omittedPages:[],notice:'',metadata:[['download',url]]}];let calls=0;input.run=async()=>++calls===1?audit([fact()]):empty('株数待原文核对。[原站入口]('+url+')[S2]');const checked=await reviewAnswerEvidence(input);assert.equal(checked.status,'repaired');assert.ok(checked.answer.message.includes(url));}
});
