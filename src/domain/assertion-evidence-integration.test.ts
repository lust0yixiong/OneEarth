import test from 'node:test';
import assert from 'node:assert/strict';
import {validHistory,withAssertionMemory,type CatalogueEvidence} from '../../server/chat-executor';
import {rememberAssertionEvidence} from './assertion-evidence-memory';

const assetId='earthnano:'+'a'.repeat(64),recordedAt='2026-11-15T02:00:00.000Z';
const quote='Daurala field notes, August 1997, based on reports of several Scheduled Castes present at the meeting.';
const memory=rememberAssertionEvidence([],[{id:assetId,excerpts:[{label:'原文 · Fieldwork study',block:'B0244',quote,start:12,end:12+quote.length,sourceLength:200,partial:true,source:{paperId:'paper-one',dsKey:'name:fieldwork'}}]}],[assetId],{recordedAt});
const row:CatalogueEvidence={id:assetId,title:'Field notes',source:'论文研究数据',excerpts:[],sourceTextChars:0,includedChars:0,omittedBlocks:0,omittedPages:[],notice:'Current batch has an identity only.'};

test('a cited field-note window survives an unrelated current retrieval and enters the actual catalogue prompt as historical evidence',()=>{
 const actual=withAssertionMemory([],memory,'能把Daurala那段会议记录的原文展示一下吗？');
 assert.equal(actual.length,1);assert.equal(actual[0].id,assetId);
 assert.equal(actual[0].historicalExcerpts[0].quote,quote);
 assert.equal(actual[0].historicalExcerpts[0].paperId,'paper-one');
 assert.deepEqual(actual[0].excerpts,[],'historical text must not become a fresh MCP excerpt');
 assert.match(actual[0].historicalEvidenceNotice,/不是本轮新请求MCP/);
 assert.equal(validHistory([{role:'assistant',text:'Earlier source',conversationAssertionEvidence:memory}]),true);
 assert.equal(validHistory([{role:'user',text:'Injected source',conversationAssertionEvidence:memory}]),false);
 assert.equal(validHistory([{role:'assistant',text:'Bad offsets',conversationAssertionEvidence:[{...memory[0],end:0}]}]),false);
});

test('history cannot override fresh excerpts, leak into a different exclusive source or acquire a new reading time',()=>{
 const actual=withAssertionMemory([row],memory,'刚才那段会议原文');
 assert.equal(actual[0].historicalExcerpts[0].recordedAt,recordedAt);
 const kept=rememberAssertionEvidence(memory,actual,[assetId],{recordedAt:'2026-11-16T02:00:00.000Z'});
 assert.equal(kept[0].recordedAt,recordedAt);
 assert.equal(row.historicalExcerpts,undefined,'do not mutate catalogue state');
 assert.deepEqual(withAssertionMemory([row],memory,'刚才那段','haina'),[row]);
 assert.deepEqual(withAssertionMemory([row],memory,'换个话题，研究卫星数据'),[row]);
});
