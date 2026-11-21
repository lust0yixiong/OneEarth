import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceExcerpts} from '../../server/evidence-excerpts';
test('late measurement qualifications and multiple source pages survive bounded evidence packing',()=>{
 const qualification='B0068 · Measurement processing\nBoth up- and downcasts were obtained; however, CTD profiles were only collected downward. Each upward salinity profile is estimated from upward temperature and the preceding downward T-S relationship.';
 const pages=[{kind:'text',label:'Methods',quote:'B0012 · Overview\n'+('Introductory context. '.repeat(65))+'\n\n'+qualification},
 {kind:'text',label:'Quality control',quote:'B0082 · Assumptions\nLow vehicle speeds violate the frozen-field assumption; dissipation is disregarded.'}];
 const r=sourceExcerpts(pages,'区分实测和估算输入、混合率误差与不确定性');
 assert.ok(r.excerpts.some(x=>x.quote===qualification));
 assert.ok(r.excerpts.some(x=>x.label==='Quality control'));
 for(const x of r.excerpts){const p=pages.find(p=>p.label===x.label)!;assert.equal(x.quote,p.quote.slice(x.start,x.end));}
 assert.ok(r.includedChars<=2600);
});
test('different topology evidence on the second page retains both algorithms and original qualifications',()=>{
 const pages=[{kind:'text',label:'Whole skeleton matrix',quote:'B0019 · Analysis\nOur analysis recovers TaxonA as the sister taxon of TaxonB.'},
 {kind:'text',label:'Tooth matrix',quote:'B0280 · Tooth assignment\nIn both the TBR + TNT algorithms and TBR searches TaxonA was recovered as a sister-group of TaxonC.\n\nB0282 · Characters\nSome characters are recovered only in some trees; full character details are in the matrix file.'}];
 const r=sourceExcerpts(pages,'TaxonA与TaxonB、TaxonC两种树形和性状分别有哪些依据？');
 assert.equal(r.excerpts.length,3);assert.ok(r.excerpts.some(x=>x.quote.includes('only in some trees')));
 assert.ok(!JSON.stringify(r).includes('character 123'));
});
test('oversized sources stay literal and explicitly signal missing text within the total budget',()=>{
 const quote='B0020 · Very long block\n'+('Unrelated context. '.repeat(300))+' Estimated values are not direct measurements. '+('Remaining context. '.repeat(300));
 const r=sourceExcerpts([{kind:'text',label:'Large source',quote}],'区分估算和实测',700);
 assert.ok(r.includedChars<=700);assert.ok(r.excerpts.some(x=>x.partial));assert.ok(r.notice.includes('不能视为不存在'));
 const larger=sourceExcerpts([{kind:'text',label:'Large source',quote}],'区分估算和实测');
 assert.ok(larger.excerpts[0].partial);assert.equal(larger.excerpts[0].quote,quote.slice(larger.excerpts[0].start,larger.excerpts[0].end));
});
test('two long pages each retain a source window instead of silently dropping the second page',()=>{
 const pages=[{kind:'text',label:'First page',quote:'B0001 · Methods\n'+('Long measured introduction. '.repeat(80))},
 {kind:'text',label:'Second page',quote:'B0002 · Other matrix\n'+('Important topology observation. '.repeat(80))}];
 const r=sourceExcerpts(pages,'实测资料和另一矩阵的拓扑依据');
 assert.ok(r.excerpts.some(x=>x.label==='First page'));assert.ok(r.excerpts.some(x=>x.label==='Second page'));
 assert.equal(r.omittedPages.length,0);assert.ok(r.includedChars<=2600);
});
test('a late estimated qualification in a very long block is not lost to the earliest measured keyword',()=>{
 const quote='B0010 · Processing\nMeasured temperature was recorded. '+('Equipment introduction. '.repeat(170))+' However, upward salinity was only estimated, not directly measured. '+('Additional material. '.repeat(100));
 const r=sourceExcerpts([{kind:'text',label:'Methods',quote}],'区分实测输入与估算输入、误差限制');
 assert.ok(r.excerpts.some(x=>x.quote.includes('upward salinity was only estimated')));
 for(const x of r.excerpts)assert.equal(x.quote,quote.slice(x.start,x.end));
});

test('a concrete numeric ratio follow-up retains the paired source values instead of unrelated qualifications',()=>{
 const comparison='B0042 · Response comparison\nThe raw coefficient was 0.12 kg per day, whereas the moving average coefficient was 0.18 kg per day (Table 3).';
 const quote='B0001 · Limitations\n'+('Only estimated inputs were measured; however, uncertainty remains. '.repeat(15))+'\n\n'+comparison;
 const r=sourceExcerpts([{kind:'text',label:'Response study',quote}],'2020 dataset processing, estimated input limitations',650,'前面说系数增加了50%，比较的是哪两个数值和单位？');
 assert.ok(r.excerpts.some(x=>x.quote===comparison));assert.ok(r.includedChars<=650);
 for(const x of r.excerpts)assert.equal(x.quote,quote.slice(x.start,x.end));
});

test('an explicit source block request selects that literal paragraph within the same bounded budget',()=>{
 const requested='B0973 · Original result\nThe retained observation is 0.42 mg/L, with an uncertainty interval [0.31, 0.53] mg/L.';
 const quote='B0001 · General methods\n'+('Measured and estimated inputs have assumptions and uncertainty. '.repeat(20))+'\n\n'+requested;
 const r=sourceExcerpts([{kind:'text',label:'Original study',quote}],'继续核对实测输入与估算的不确定性',420,'请核对原文B0973段的0.42、单位和区间。');
 assert.ok(r.excerpts.some(x=>x.block?.startsWith('B0973')&&x.quote===requested));
 assert.ok(r.includedChars<=420);assert.ok(r.omittedBlocks>0);
});

test('a quoted passage request keeps its exact source window without concatenating it into a new claim',()=>{
 const target='B0022 · Sampling\nThe uncertainty increases at the sampling boundary, while the average level remains unchanged.';
 const quote='B0001 · Background\n'+('Different uncertainty observations in measured inputs. '.repeat(25))+'\n\n'+target;
 const r=sourceExcerpts([{kind:'text',label:'Sampling study',quote}],'测量误差与输入',450,'请解释“uncertainty increases at the sampling boundary”这段原文。');
 assert.ok(r.excerpts.some(x=>x.quote===target));assert.ok(r.includedChars<=450);
 for(const x of r.excerpts)assert.equal(x.quote,quote.slice(x.start,x.end));
});

test('source attribution remains separate even when two papers have identical block numbers and words',()=>{
 const quote='B0022 · Validation\nThe validation was performed in 2020.';
 const r=sourceExcerpts([{kind:'text',label:'Land study',quote,source:{paperId:'land-2023',rqId:'RQ1',datasetId:'land-model'}},
  {kind:'text',label:'Other study',quote,source:{paperId:'sustainability-2026',rqId:'RQ1',datasetId:'other-model'}}], '验证年份',2600,'哪篇论文的验证年份？',{region:'Heilongjiang'});
 assert.equal(r.excerpts.length,2,'identical prose in two sources must not be deduplicated across ownership');
 assert.deepEqual(r.excerpts.map(e=>[e.source.paperId,e.source.datasetId]),[['land-2023','land-model'],['sustainability-2026','other-model']]);
 for(const e of r.excerpts){assert.equal(e.source.block,e.block);assert.equal(e.source.start,e.start);assert.equal(e.source.end,e.end);assert.equal(e.source.region,'Heilongjiang');}
});

test('a dataset product title does not assign its source passage to a different cited paper',()=>{
 const r=sourceExcerpts([{kind:'text',label:'Impurity resistivity of Earth’s inner core',quote:'B0002 · Output\nSupplementary tables contain computed outputs.'}], 'SoDaH的输入还是输出？',2600,undefined,{paperId:'inner-core-paper',datasetId:'zenodo:7929259',rqId:'RQ2',role:'output'});
 assert.equal(r.excerpts[0].source.paperId,'inner-core-paper');assert.equal(r.excerpts[0].source.role,'output');
 assert.ok(!JSON.stringify(r.excerpts[0].source).includes('SoDaH'));
 const unknown=sourceExcerpts([{kind:'text',label:'SoDaH',quote:'B0001 · Methods\nObservations were analyzed.'}], 'SoDaH');
 assert.equal(unknown.excerpts[0].source.paperId,undefined,'a label is not an inferred paper ID');
});

test('a multi-paper product cannot assign its first paper to every text tab',async()=>{
 const {scopeSourceTabs}=await import('../../server/evidence-excerpts');
 const tabs=[{kind:'text',label:'原文 · Tropical deforestation causes large reductions in observed precipitation',quote:'B0092 · Results\nReported precipitation.'},
  {kind:'text',label:'原文 · Dynamic urban land extensification is projected to lead to imbalances in the global land-carbon equilibrium',quote:'B0038 · Results\nReported land carbon.'}];
 const scoped=scopeSourceTabs(tabs,[{paperId:'tropical-paper',paperTitle:tabs[0].label.slice(5),rqId:'RQ3',datasetId:'D21'}],{paperId:'tropical-paper',rqId:'RQ3',dsKey:'shared-product'});
 const r=sourceExcerpts(scoped,'结果',2600);
 assert.equal(r.excerpts[0].source.paperId,'tropical-paper');assert.equal(r.excerpts[1].source.paperId,undefined);assert.equal(r.excerpts[1].source.dsKey,'shared-product');
 const ambiguous=scopeSourceTabs([tabs[0]],[{paperId:'same-paper',paperTitle:tabs[0].label.slice(5),rqId:'RQ1',datasetId:'D1'},{paperId:'same-paper',paperTitle:tabs[0].label.slice(5),rqId:'RQ2',datasetId:'D2'}]);
 assert.equal(ambiguous[0].source?.paperId,'same-paper');assert.equal(ambiguous[0].source?.rqId,undefined);assert.equal(ambiguous[0].source?.datasetId,undefined);
});
