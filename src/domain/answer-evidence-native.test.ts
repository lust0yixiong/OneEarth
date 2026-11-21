import test from 'node:test';import assert from 'node:assert/strict';import fixtures from './answer-evidence-check.fixtures.json';
import {auditSourceStatements,prepareAudit,sourceStatementAuditSchema,type AuditInput} from '../../server/answer-evidence-check';
const real=(id:'SN0340'|'SN0379Full')=>structuredClone(fixtures[id]) as AuditInput;
const native=(claim:string,kind='unsupported-detail')=>({claim,claimType:kind==='scope-overclaim'?'absence':'reported-fact',displayCitations:[1],sourceRefs:['S17'],witnesses:[],kind,action:kind==='scope-overclaim'?'restrict-to-loaded-scope':'verify-or-remove-detail'});
const result=(findings:unknown[])=>({sampledClaims:Math.max(1,findings.length),completeAnswerAudit:false,findings});
test('native schema requires no UTF16 offset; prompt asks <=4high-risk source facts and excludes tool states',()=>{
 const f=(sourceStatementAuditSchema.properties.findings as any).items;assert.equal('claimStart' in f.properties,false);assert.equal(f.required.includes('claimStart'),false);const prompt=prepareAudit(real('SN0340')).prompt;assert.match(prompt,/最多4条高风险来源内容事实/);assert.match(prompt,/无需计算或返回claimStart/);assert.match(prompt,/由真实trace单独核对/);
});
test('real0340toolstatus finding does not produce a finding or force caller repair',async()=>{
 const input=real('SN0340'),claim='论文断言库本轮检索未完成部分证据调用，网络补充检索也有请求失败';input.answer=claim+'。〔1〕';let calls=0;const checked=await auditSourceStatements(input,async()=>{calls++;return result([native(claim)]);});assert.equal(checked.status,'ok');assert.equal(checked.findings.length,0);assert.equal(calls,1);assert.ok(checked.diagnostics.some(d=>d.code==='platform-status-out-of-scope'));
});
test('real30plants detail remains eligible and program adds exact unique offset',async()=>{
 const input=real('SN0340'),claim='叶绿素则在每个田块、每个测量日抽测 30 株';const checked=await auditSourceStatements(input,async()=>result([native(claim)]));assert.equal(checked.findings.length,1);assert.equal(checked.findings[0].claimStart,input.answer.indexOf(claim));
});
test('source-absence original未提供 is not mistaken for a platform status',async()=>{
 const input=real('SN0340'),claim='论文也没有提供参数误差协方差、剖面似然或固定另一参数后的扰动检验';const checked=await auditSourceStatements(input,async()=>result([native(claim,'scope-overclaim')]));assert.equal(checked.findings.length,1);assert.equal(checked.diagnostics.some(d=>d.code==='platform-status-out-of-scope'),false);
});
test('unique literal only: repeated claim and fuzzy paraphrase rejected; offsets from model disallowed',async()=>{
 const input=real('SN0340');input.answer='抽测30株。抽测30株。〔1〕';for(const claim of ['抽测30株','抽测300株']){const checked=await auditSourceStatements(input,async()=>result([native(claim)]));assert.equal(checked.findings.length,0);assert.ok(checked.diagnostics.some(d=>['ambiguous-literal-claim','nonliteral-claim'].includes(d.code)));}
 input.answer='论文抽测30株。〔1〕';const withOffset=await auditSourceStatements(input,async()=>result([{...native('论文抽测30株'),claimStart:0}]));assert.equal(withOffset.findings.length,0);assert.equal(withOffset.diagnostics[0].code,'invalid-finding-schema');
});
test('completeCLCDfilename index still exposes literal2021TIFF; index does not imply raster contents',async()=>{
 const input=real('SN0379Full'),claim='清单虽完整，但没有列出 2021 年整幅栅格';const f={...native(claim),claimType:'absence',displayCitations:[3],sourceRefs:['S23'],kind:'literal-conflict',action:'reconcile-loaded-evidence',witnesses:[{sourceRef:'S23',windowId:'all-files',quote:'CLCD_v01_2021_albert.tif'}]};const checked=await auditSourceStatements(input,async()=>result([f]));assert.equal(checked.findings.length,1);assert.equal(checked.sourceState[0].stage,'file-index');
});
test('narrow status filter does not discard mixed scientific absence or unsupported field-method fact',async()=>{
 const input=real('SN0340'),claim='网络检索失败，原文没有提供30株采样说明';input.answer=claim+'。〔1〕';const checked=await auditSourceStatements(input,async()=>result([native(claim)]));assert.equal(checked.findings.length,1);assert.equal(checked.diagnostics.some(d=>d.code==='platform-status-out-of-scope'),false);
});
test('tight source budget prioritizes actual excerpt over large relation metadata and labels truncation',()=>{
 const input=real('SN0340');input.sources[0].windows=[{id:'structured-summary',text:'relationship '.repeat(1000),location:'not full text'},{id:'excerpt-0',text:'Actual loaded field-method quote.',location:'partial paper B0042'},{id:'historical-assertion-0',text:'Historic literal quote.',location:'not freshMCP or full paper'}];const packed=prepareAudit(input,400).packed;assert.ok(packed.sources[0].windows.some(w=>w.text==='Actual loaded field-method quote.'));assert.equal(packed.sources[0].windows[0].id,'historical-assertion-0');assert.equal(packed.sources[0].auditInputComplete,false);assert.equal(packed.sources[0].completeness.loaded,'partial');
});
