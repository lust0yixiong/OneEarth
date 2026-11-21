import test from 'node:test';
import assert from 'node:assert/strict';
import {arithmetic,calculate,verifyCalculationRequests} from '../../server/verified-calculation';
import {synthesizeAnswer} from '../../server/scientific-answer';

test('SN347 pH conversion is evaluated from literal supplied inputs, not an approximate model sum',()=>{
 const expression='8.000 + 0.10383 + 4.33e-5*25*35 + 3.633e-5*25^2 - 4.921e-5*35^2';
 assert.ok(Math.abs(arithmetic(expression)-8.1041415)<1e-10);
 assert.equal(arithmetic('-2^2'),-4);assert.equal(arithmetic('2^3^2'),512);assert.equal(arithmetic('sqrt(9)+abs(-2)+log10(100)'),7);
 const reports=verifyCalculationRequests([{operation:'arithmetic',arguments:JSON.stringify({expression}),scope:'example',sourceRefs:['S1']}],1);
 assert.equal(reports[0].status,'completed');assert.equal(reports[0].scope,'example');
});

test('SN363 numeric classification honors the actual closed/open interval boundaries',()=>{
 const intervals=[{label:'poor',min:-1,max:0},{label:'relatively-poor',min:0,max:.25},{label:'moderate',min:.25,max:.5},{label:'good',min:.5,max:1,maxInclusive:true}];
 for(const [value,label] of [[.16,'relatively-poor'],[.23,'relatively-poor'],[0,'relatively-poor'],[.25,'moderate'],[1,'good']] as const)assert.equal((calculate('classify',{value,intervals}) as any).label,label);
 assert.throws(()=>calculate('classify',{value:.25,intervals:[{label:'a',min:0,max:.25,maxInclusive:true},{label:'b',min:.25,max:1}]}),/overlapping/);
 assert.equal((calculate('classify',{value:2,intervals}) as any).label,null);
});

test('SN452 synthetic example has a real strict ranking reversal under positive equal weights',()=>{
 const result=calculate('rankReversalExample',{}) as any;
 assert.equal(result.synthetic,true);assert.deepEqual(result.weights,[.5,.5]);assert.equal(result.rows.length,4);assert.ok(result.reversals.length>0);
 for(const [a,b] of result.reversals){const score=(method:any,name:string)=>method.find((r:any)=>r.name===name).score;assert.ok((score(result.minmax,a)-score(result.minmax,b))*(score(result.sampleZ,a)-score(result.sampleZ,b))<0);}
 const original=calculate('normalizeCompare',{rows:[{name:'甲',values:[10,0]},{name:'乙',values:[0,10]},{name:'丙',values:[100,9]}]}) as any;
 assert.deepEqual(original.minmax.map((r:any)=>r.name),['丙','乙','甲']);assert.deepEqual(original.sampleZ.map((r:any)=>r.name),['丙','乙','甲']);assert.equal(original.reversals.length,0);
});

test('untrusted expressions, non-finite arithmetic and invalid or absent source identities are rejected',()=>{
 for(const expression of ['process.exit()','import("fs")','1/0','sqrt(-1)','2**8','NaN','1e999','2^999','('.repeat(30)+'1'+')'.repeat(30),'1;2'])assert.throws(()=>arithmetic(expression));
 assert.throws(()=>calculate('normalizeCompare',{rows:[{name:'A',values:[1]},{name:'B',values:[1]}]}),/zero-variance/);
 for(const req of [{operation:'arithmetic',arguments:'{"expression":"1+2"}',scope:'source',sourceRefs:[]},{operation:'arithmetic',arguments:'{"expression":"1+2"}',scope:'source',sourceRefs:['S99']},{operation:'rankReversalExample',arguments:'{}',scope:'source',sourceRefs:['S1']}])assert.equal(verifyCalculationRequests([req],1)[0].status,'rejected');
 assert.throws(()=>verifyCalculationRequests([{}, {}, {}],1),/maximum-two/);
});

test('one calculation round is reported and retained through bounded citation repair with the same materials',async()=>{
 const prompts:string[]=[],reports:unknown[]=[],ref={kind:'web' as const,title:'Method',url:'https://example.org/method'};
 const answer=await synthesizeAnswer('unchanged-evidence',[ref],[],async prompt=>{prompts.push(prompt);return JSON.stringify(prompts.length===1?{message:'draft',calculationRequests:[{operation:'arithmetic',arguments:'{"expression":"(3+4)/2"}',scope:'example',sourceRefs:['S1']}]}:{message:prompts.length===2?'示例3.5 [S99]':'合成示例3.5 [S1]'});},new AbortController().signal,undefined,report=>reports.push(report));
 assert.equal(prompts.length,3);assert.equal(reports.length,1);assert.ok(prompts[1].includes('3.5'));assert.ok(prompts[2].includes('3.5'));assert.ok(prompts.every(p=>p.startsWith('unchanged-evidence')));assert.equal(answer.references.length,1);
});

test('no request means no fabricated calculation progress; requests never trigger a second tool round',async()=>{
 let calls=0,reports=0;
 await synthesizeAnswer('evidence',[],[],async()=>{calls++;return '{"message":"解释原则"}';},new AbortController().signal,undefined,()=>reports++);
 assert.equal(calls,1);assert.equal(reports,0);
 calls=0;
 const draft={message:'draft',calculationRequests:[{operation:'rankReversalExample',arguments:'{}',scope:'example',sourceRefs:[]}]};
 const answer=await synthesizeAnswer('evidence',[],[],async()=>{calls++;return JSON.stringify(draft);},new AbortController().signal,undefined,()=>reports++);
 assert.deepEqual(answer.recovery?.failedNodes,['answer-repair']);assert.match(answer.limitation,/校验未完成/);
 assert.equal(calls,3);assert.equal(reports,1,'only first draft tool requests are executed');
});
