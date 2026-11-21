import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {sourceExcerpts} from '../../server/evidence-excerpts';
import {catalogueRows} from '../../server/chat-executor';
import {emptyFilters} from './spatial';
import type {PaperRecord} from './paper-record';
import type {DiscoveryContext} from './types';
const saved=JSON.parse(readFileSync(new URL('./fixtures/sn202-numeric-followup.json',import.meta.url),'utf8')) as {question:string;conversationContext:string;record:PaperRecord};
const target=saved.question+'\n'+saved.conversationContext;
function assertComparison(result:ReturnType<typeof sourceExcerpts>){
 const block=result.excerpts.find(e=>e.block?.startsWith('B0252'));
 assert.ok(block,'the held B0252 paragraph must reach the synthesis evidence');
 assert.match(block.quote,/1000 Gt C/);assert.match(block.quote,/0\.49/);assert.match(block.quote,/0\.51/);assert.match(block.quote,/7-yr running mean/);assert.match(block.quote,/Table 1/);
 assert.ok(!block.quote.includes('4.08'),'the selector must not fabricate an arithmetic claim in quoted text');
 assert.ok(result.includedChars<=2600);assert.equal(result.sourceTextChars,4193);
 for(const e of result.excerpts){const tab=saved.record.need.tabs.find(t=>t.kind==='text'&&t.label===e.label);assert.equal(e.quote,tab!.quote!.slice(e.start,e.end));}
}
test('saved SN202 ratio follow-up now retains B0252 values and table locator at the existing 2600 character budget',()=>{
 assertComparison(sourceExcerpts(saved.record.need.tabs,target,2600,saved.question));
});
test('the real catalogue packing path passes the numeric follow-up focus into paper evidence',()=>{
 const context={caseId:null,filters:emptyFilters(),selection:null} as DiscoveryContext;
 const rows=catalogueRows(target,context,{message:'',paperOnly:true},[],[saved.record],undefined,'paper',saved.question);
 const row=rows.find(r=>r.id===saved.record.id);assert.ok(row&&'excerpts' in row);
 assertComparison(row);
 assert.ok(JSON.stringify(rows).length<=48000);
});
