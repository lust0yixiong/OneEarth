import test from 'node:test';import assert from 'node:assert/strict';
import fixtures from './answer-evidence-check.fixtures.json';
import {auditSourceStatements,prepareAudit,sourceStatementAuditSchema,type AuditInput,type Finding} from '../../server/answer-evidence-check';
const real=(name:'SN0340'|'SN0379Full'|'SN0379Summary')=>structuredClone(fixtures[name]) as AuditInput;
const finding=(input:AuditInput,claim:string,kind:Finding['kind']='unsupported-detail',overrides:Partial<Finding>={}):Finding=>({claim,claimStart:input.answer.indexOf(claim),claimType:kind==='scope-overclaim'?'absence':'reported-fact',displayCitations:[input.bindings[0].display],sourceRefs:input.bindings[0].sourceRefs,witnesses:[],kind,action:({'unsupported-detail':'verify-or-remove-detail','scope-overclaim':'restrict-to-loaded-scope','literal-conflict':'reconcile-loaded-evidence','source-identity':'verify-source-identity'} as const)[kind],...overrides});
const result=(findings:Finding[],sampledClaims=findings.length)=>({sampledClaims,completeAnswerAudit:false,findings:findings.map(({claimStart:_,...f})=>f)});
const mock=(value:unknown)=>async()=>value;

test('schema requires all top-level and nested fields, admits no free auditor facts or proposed rewrite',()=>{
 const walk=(v:any)=>{if(v?.type==='object'){assert.deepEqual(v.required,Object.keys(v.properties));assert.equal(v.additionalProperties,false);Object.values(v.properties).forEach(walk);}if(v?.items)walk(v.items);};walk(sourceStatementAuditSchema);
});
test('SN0340 literal30plants/SPAD detail and full-paper negation are sampled source-scope findings, not scientific falsity',async()=>{
 const input=real('SN0340');const claims=['叶绿素则在每个田块、每个测量日抽测 30 株','把叶片 SPAD 推算的叶绿素含量乘以对应 LAI 得到','论文也没有提供参数误差协方差、剖面似然或固定另一参数后的扰动检验'];claims.forEach(q=>assert.ok(input.answer.includes(q)));
 assert.equal(input.sources[0].windows[0].text.includes('SPAD'),false);
 let calls=0;const checked=await auditSourceStatements(input,async(prompt,schema)=>{calls++;assert.ok(prompt.includes('supplied'));assert.equal(schema,sourceStatementAuditSchema);return result(claims.map((q,i)=>finding(input,q,i===2?'scope-overclaim':'unsupported-detail')));});
 assert.equal(calls,1);assert.equal(checked.status,'ok');assert.equal(checked.findings.length,3);assert.equal(checked.completeAnswerAudit,false);assert.equal(checked.sourceState[0].completeness.loaded,'partial');
});
test('SN0379 full72-file index provides literal2021TIFF witness without implying pixels read',async()=>{
 const input=real('SN0379Full'),claim='清单虽完整，但没有列出 2021 年整幅栅格',quote='CLCD_v01_2021_albert.tif';assert.ok(input.sources[0].windows[0].text.includes(quote));
 const f=finding(input,claim,'literal-conflict',{claimType:'absence',witnesses:[{sourceRef:'S23',windowId:'all-files',quote}]});const checked=await auditSourceStatements(input,mock(JSON.stringify(result([f]))));assert.equal(checked.findings.length,1);assert.equal(checked.sourceState[0].stage,'file-index');assert.equal(checked.sourceState[0].completeness.totalItems,72);assert.equal(checked.sourceState[0].completeness.supplied,'complete');
});
test('SN0379 excerpt-only audit cannot borrow full-list witness; complete upstream access differs from supplied summary',async()=>{
 const input=real('SN0379Summary'),claim='清单虽完整，但没有列出 2021 年整幅栅格';assert.equal(input.sources[0].windows[0].text.includes('CLCD_v01_2021_albert.tif'),false);
 const f=finding(input,claim,'scope-overclaim');const checked=await auditSourceStatements(input,mock(result([f])));assert.equal(checked.findings.length,1);assert.equal(checked.sourceState[0].completeness.loaded,'complete');assert.equal(checked.sourceState[0].completeness.supplied,'summary');
 const bad=finding(input,claim,'literal-conflict',{witnesses:[{sourceRef:'S23',windowId:'files-excerpt',quote:'CLCD_v01_2021_albert.tif'}]});const rejected=await auditSourceStatements(input,mock(result([bad])));assert.equal(rejected.findings.length,0);assert.equal(rejected.diagnostics[0].code,'nonliteral-or-cross-source-witness');
});
test('fabricated claim, stale display mapping, wrong S alias and cross-source witness are rejected individually',async()=>{
 const input=real('SN0340'),q='叶绿素则在每个田块、每个测量日抽测 30 株';
 const bad=[finding(input,'叶绿素测了300株'),finding(input,q,'unsupported-detail',{sourceRefs:['S1']}),finding(input,q,'unsupported-detail',{displayCitations:[9]}),finding(input,q,'literal-conflict',{witnesses:[{sourceRef:'S23',windowId:'all-files',quote:'CLCD_v01_2021_albert.tif'}]})];bad[0]={...finding(input,q),claim:'叶绿素测了300株'};
 const checked=await auditSourceStatements(input,mock(result(bad)));assert.equal(checked.findings.length,0);assert.equal(checked.status,'partial');assert.deepEqual(checked.diagnostics.map(d=>d.code),['nonliteral-claim','invalid-source-binding','invalid-source-binding','nonliteral-or-cross-source-witness']);
});
test('history background and assistant suggestions never become source windows; suggestions in answer cannot be evidence findings',async()=>{
 const input=real('SN0340');input.sources.push({...input.sources[0],ref:'S88',channel:'history-context',windows:[{id:'old',location:'old',text:'HISTORY SECRET SPAD 30'}]},{...input.sources[0],ref:'S89',channel:'assistant-proposal',windows:[{id:'advice',location:'assistant',text:'ASSISTANT PROPOSAL SPAD 30'}]});input.bindings.push({display:2,sourceRefs:['S88']},{display:3,sourceRefs:['S89']});input.answer+='〔2〕〔3〕';const packed=prepareAudit(input);assert.equal(packed.prompt.includes('HISTORY SECRET'),false);assert.equal(packed.prompt.includes('ASSISTANT PROPOSAL'),false);
 input.answer='建议使用SPAD测量30株。〔1〕';const q='SPAD测量30株';const checked=await auditSourceStatements(input,mock(result([finding(input,q)])));assert.equal(checked.findings.length,0);assert.equal(checked.diagnostics[0].code,'proposal-not-source-fact');
});
test('source budget truncation is explicit and excluded tail cannot be a witness',async()=>{
 const input=real('SN0379Full');const prepared=prepareAudit(input,256);assert.equal(prepared.packed.sources[0].auditInputComplete,false);assert.ok(prepared.packed.sources[0].omittedChars>0);assert.equal(prepared.packed.sources[0].completeness.loaded,'complete');
 const q='清单虽完整，但没有列出 2021 年整幅栅格';const checked=await auditSourceStatements(input,mock(result([finding(input,q,'scope-overclaim')])),{maxSourceChars:256});assert.equal(checked.findings.length,1);
});
test('full text/index scope cannot be declared incomplete by auditor, and witness cannot be silently empty',async()=>{
 const input=real('SN0379Full'),q='清单虽完整，但没有列出 2021 年整幅栅格';const checked=await auditSourceStatements(input,mock(result([finding(input,q,'scope-overclaim'),finding(input,q,'literal-conflict')])));assert.equal(checked.findings.length,0);assert.deepEqual(checked.diagnostics.map(d=>d.code),['scope-overclaim-needs-incomplete-scope','conflict-needs-literal-witness']);
});
test('bounded schema rejects >8claims, unknown fields, oversized output and ambiguous source IDs',async()=>{
 const input=real('SN0340');for(const output of [result([],9),{...result([]),rewrite:'new facts'},'x'.repeat(16001)]){const checked=await auditSourceStatements(input,mock(output));assert.equal(checked.status,'rejected');}
 input.sources.push(input.sources[0]);let called=false;const checked=await auditSourceStatements(input,async()=>{called=true;return result([]);});assert.equal(called,false);assert.equal(checked.status,'rejected');
});
test('missing required fields and incorrect action cannot turn an advisory finding into a validated operation',async()=>{
 const input=real('SN0340'),q='叶绿素则在每个田块、每个测量日抽测 30 株';const f:any=finding(input,q);delete f.witnesses;const g=finding(input,q,'unsupported-detail',{action:'reconcile-loaded-evidence'});const checked=await auditSourceStatements(input,mock(result([f,g])));assert.equal(checked.findings.length,0);assert.ok(checked.diagnostics.every(d=>d.code==='invalid-finding-schema'));
});
test('one-call deadline aborts dependency, external cancellation works, empty result never certifies full scientific truth',async()=>{
 const input=real('SN0340');let calls=0,aborted=false;
 const checked=await auditSourceStatements(input,async(_p,_s,signal)=>{calls++;return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(Error('dependency-aborted'));}));},{timeoutMs:5});assert.equal(checked.status,'timeout');assert.equal(calls,1);assert.equal(aborted,true);
 const controller=new AbortController();controller.abort();let invoked=false;const cancelled=await auditSourceStatements(input,async()=>{invoked=true;return result([]);},{signal:controller.signal});assert.equal(cancelled.status,'cancelled');assert.equal(invoked,false);
 const empty=await auditSourceStatements(input,mock(result([],2)));assert.deepEqual(empty.findings,[]);assert.equal(empty.sampledClaims,2);assert.equal(empty.completeAnswerAudit,false);
});


test('identity mismatch needs literal same-source metadata and preserves original S binding',async()=>{
 const input=real('SN0379Full');input.answer='资料为CLCD v8。〔3〕';input.sources[0].windows.push({id:'identity',location:'current loaded API metadata',text:'{"recordDoi":"10.5281/zenodo.12779975","version":"1.0.3"}'});
 const f=finding(input,'资料为CLCD v8','source-identity',{claimType:'identity',witnesses:[{sourceRef:'S23',windowId:'identity',quote:'"version":"1.0.3"'}]});const checked=await auditSourceStatements(input,mock(result([f])));assert.equal(checked.findings.length,1);assert.deepEqual(checked.findings[0].sourceRefs,['S23']);
});
test('no cited current source skips the run; unknown completeness never means full text',async()=>{
 const input=real('SN0340');input.sources[0].completeness.loaded='unknown';const q='论文也没有提供参数误差协方差、剖面似然或固定另一参数后的扰动检验';const checked=await auditSourceStatements(input,mock(result([finding(input,q,'scope-overclaim')])));assert.equal(checked.findings.length,1);
 input.sources[0].channel='history-context';let invoked=false;const skipped=await auditSourceStatements(input,async()=>{invoked=true;return result([]);});assert.equal(invoked,false);assert.equal(skipped.status,'skipped');
});


test('program locates a unique literal claim and rejects all repeated occurrences without asking model for offsets',async()=>{
 const input=real('SN0340'),q='叶绿素则在每个田块、每个测量日抽测 30 株';const checked=await auditSourceStatements(input,mock(result([finding(input,q)])));assert.equal(checked.status,'ok');assert.equal(checked.findings[0].claimStart,input.answer.indexOf(q));
 input.answer=q+'。'+q+'。〔1〕';const ambiguous=await auditSourceStatements(input,mock(result([finding(input,q)])));assert.equal(ambiguous.findings.length,0);assert.equal(ambiguous.diagnostics[0].code,'ambiguous-literal-claim');
});
test('a complete metadata record still cannot certify absence in the full paper',async()=>{
 const input=real('SN0340');input.sources[0].stage='metadata';input.sources[0].completeness={loaded:'complete',supplied:'complete',totalItems:null,suppliedItems:null};const q='论文也没有提供参数误差协方差、剖面似然或固定另一参数后的扰动检验';const checked=await auditSourceStatements(input,mock(result([finding(input,q,'scope-overclaim')])));assert.equal(checked.findings.length,1);
});
