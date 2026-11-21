import test from 'node:test';
import assert from 'node:assert/strict';
import {rememberAssertionEvidence,selectAssertionEvidence,validAssertionEvidenceMemory,assertionMemoryNotice} from './assertion-evidence-memory';
const assetId='earthnano:'+'a'.repeat(64),otherId='earthnano:'+'b'.repeat(64),now='2026-11-15T02:00:00.000Z';
const quote='You must learn to live better with the Jats. (field notes, August 1997, based on reports of several Scheduled Castes present at the meeting).';
const excerpt=(text=quote)=>({label:'原文 · A fist is stronger than five fingers',block:'B0244 · Threats to Jat power',quote:text,start:100,end:100+text.length,sourceLength:100+text.length,partial:false,source:{paperId:'daurala-paper',rqId:'RQ1',datasetId:'D1'}});
test('SN462 cited assertion paragraph persists across a new unrelated retrieval without becoming a web reading',()=>{
 const first=rememberAssertionEvidence([],[{id:assetId,excerpts:[excerpt()]}],[assetId],{query:'田野笔记公开范例',recordedAt:now});
 const second=rememberAssertionEvidence(first,[{id:otherId,excerpts:[excerpt('An unrelated new source.')]}],[],{query:'Daurala那段会议转述原文'});
 const chosen=selectAssertionEvidence(second,{query:'会议转述 B0244',assetIds:[assetId]});
 assert.equal(chosen[0].quote,quote);assert.equal(chosen[0].stage,'assertion-excerpt');assert.equal(chosen[0].paperId,'daurala-paper');assert.equal(chosen[0].sourceTurn,undefined);assert.ok(!('url' in chosen[0]));assert.match(assertionMemoryNotice,/不是本轮新请求MCP/);
});
test('only supplied and finally cited rows enter memory; same paragraph IDs do not merge across papers',()=>{
 assert.deepEqual(rememberAssertionEvidence([],[{id:assetId,excerpts:[excerpt()]}],[],{recordedAt:now}),[]);
 const unknown={...excerpt(),source:undefined};const other={...excerpt(),source:{paperId:'another-paper',rqId:'RQ1',datasetId:'D1'}};
 const memory=rememberAssertionEvidence([],[{id:assetId,excerpts:[unknown,other]}],[assetId],{recordedAt:now});
 assert.equal(memory.length,2);assert.equal(memory[0].paperId,undefined);assert.equal(memory[1].paperId,'another-paper');assert.ok(validAssertionEvidenceMemory(memory));
});
test('literal truncation updates offsets and partial state; six windows/4800 chars/16KiB limits are enforced',()=>{
 const long='Observed field-note text. '.repeat(100),mem=rememberAssertionEvidence([],[{id:assetId,excerpts:[excerpt(long)]}],[assetId],{recordedAt:now});
 assert.equal(mem[0].quote,long.slice(0,1200));assert.equal(mem[0].end,mem[0].start+1200);assert.equal(mem[0].partial,true);assert.equal(mem[0].excerptTruncated,true);assert.equal(mem[0].originalQuoteLength,long.length);
 const rows=Array.from({length:15},(_,i)=>({...excerpt('Literal paragraph '+i),block:'B'+i}));
 const bounded=rememberAssertionEvidence(mem,[{id:assetId,excerpts:rows}],[assetId],{recordedAt:now});assert.ok(bounded.length<=6);assert.ok(bounded.reduce((s,e)=>s+e.quote.length,0)<=4800);assert.ok(validAssertionEvidenceMemory(bounded));
 assert.equal(validAssertionEvidenceMemory([{...mem[0],end:1}]),false);assert.equal(validAssertionEvidenceMemory([{...mem[0],partial:false}]),false);
});
