import assert from "node:assert/strict";
import test from "node:test";
import {randomUUID} from "node:crypto";
import {RuntimeConversationHistory,estimatedHistoryTokens,historyReadSelections,type HistoryTurn} from "./conversation-history";
const row=(n:number,answer="Complete answer "+n):HistoryTurn=>({taskId:randomUUID(),turnId:randomUUID(),submittedAt:n,question:"Complete question "+n,assistantText:answer,taskState:"complete",observationRestricted:false,references:[{kind:"web",url:"https://example.org/report-"+n,title:"Report "+n,webEvidenceStage:"pdf-excerpt"}]});
test("all received turns under budget remain complete, in storage order even across backwards clocks",()=>{
 const rows=[row(9),row(4),row(4),row(1),row(12)],history=new RuntimeConversationHistory(rows,randomUUID()),p=history.projection();
 assert.deepEqual(p.turns.map(turn=>turn.taskId),rows.map(turn=>turn.taskId));assert.equal(p.turns.length,5);assert.ok(p.turns.every(turn=>turn.complete));assert.ok(estimatedHistoryTokens(p)<=8000);assert.ok(JSON.stringify(p).includes("Complete answer 9"));
});
test("overflow prioritizes the latest three whole tables and gives older origin and block ranges",()=>{
 const old=row(1,"旧报告语义目的。\n\n"+"旧材料细节".repeat(6500)),rows=[old,...[2,3,4].map(n=>row(n,"|Variable|Value|\n|---|---|\n|Q"+n+"|"+n+"|"))],h=new RuntimeConversationHistory(rows,randomUUID()),p=h.projection();
 for(const r of rows.slice(-3))assert.ok(p.turns.find(t=>t.taskId===r.taskId)?.complete);
 const index=p.index.find(turn=>turn.taskId===old.taskId)!;assert.ok(index);assert.equal(index.references?.[0].kind,"web");assert.equal((index.references?.[0] as any).webEvidenceStage,"pdf-excerpt");assert.ok(index.blocks.some(block=>block.id==="a2"&&block.end-block.start>20000));assert.ok(estimatedHistoryTokens(p)<=8000);
});
test("exact block readback preserves a whole table and does not duplicate its body",()=>{
 const table="|Kind|Unit|\n|---|---|\n|A|m|\n|B|s|",r=row(1,"Earlier explanation.\n\n"+table),h=new RuntimeConversationHistory([r,...[2,3,4].map(n=>row(n))],randomUUID());
 const p=h.read([{taskId:r.taskId,turnId:r.turnId!,blockIds:["a2"]}]);assert.equal(p.readback?.state,"loaded");assert.equal(p.turns.find(t=>t.taskId===r.taskId)?.blocks.find(b=>b.id==="a2")?.text,table);assert.equal(JSON.stringify(p).split("|A|m|").length-1,1);assert.ok(estimatedHistoryTokens(p)<=8000);
});
test("too-large tables stay visibly partial, never a sliced pretend-full table",()=>{
 const r=row(1,"|Variable|Value|\n|---|---|\n"+"|Data|123456789|\n".repeat(5000)),h=new RuntimeConversationHistory([r],randomUUID()),p=h.read([{taskId:r.taskId,turnId:r.turnId!,blockIds:["a1"]}]);
 assert.equal(p.readback?.state,"partial");assert.ok(!p.turns.some(t=>t.blocks.some(b=>b.id==="a1")));assert.ok(p.index[0].blocks.some(b=>b.kind==="table"));
});
test("foreign IDs, wrong turns, missing blocks, and malformed requests cannot become loaded",()=>{
 const r=row(1),h=new RuntimeConversationHistory([r],randomUUID());
 for(const selection of [[{taskId:randomUUID(),turnId:null,blockIds:[]}],[{taskId:r.taskId,turnId:randomUUID(),blockIds:[]}],[{taskId:r.taskId,turnId:null,blockIds:["a99"]}],[]])assert.equal(h.read(selection).readback?.state,"unavailable");
 assert.throws(()=>historyReadSelections(JSON.stringify({decide:{kind:"history-read",selections:[{taskId:"https://example.org/secret",turnId:null,blockIds:[]}]}})),/身份/);
});
test("observation-owned history exposes no original text or reference even when specifically requested",()=>{
 const r={...row(1,"RESTRICTED_FILE_FACT"),question:"RESTRICTED_QUESTION",observationRestricted:true},h=new RuntimeConversationHistory([r],randomUUID());
 const projection=h.read([{taskId:r.taskId,turnId:null,blockIds:[]}]);assert.equal(projection.readback?.state,"unavailable");assert.doesNotMatch(JSON.stringify(projection),/RESTRICTED_|report-1/);assert.deepEqual(h.sourceTargets("file"),[]);
});
test("only actual supplied blocks can receive a semantic model summary",()=>{
 const r=row(1,"Earlier declared purpose.\n\n"+"overflow text ".repeat(7000)),h=new RuntimeConversationHistory([r,...[2,3,4].map(n=>row(n))],randomUUID()),source=h.summaryInput("purpose");assert.ok(source.length);
 h.acceptSummary(JSON.stringify({summaries:[{taskId:r.taskId,turnId:r.turnId,blockIds:[source[0].blocks[0].id],text:"原轮讨论用途；完整覆盖仍未核实。"}]}));assert.ok(h.projection().summaries.some(s=>s.kind==="model-summary"));
 assert.throws(()=>h.acceptSummary(JSON.stringify({summaries:[{taskId:r.taskId,turnId:r.turnId,blockIds:["a999"],text:"invented"}]})),/未绑定/);
});
test("estimator counts CJK, ASCII, punctuation and complete serialized indices consistently",()=>{
 assert.equal(estimatedHistoryTokens("中文"),2);assert.equal(estimatedHistoryTokens("abcdefgh"),2);assert.equal(estimatedHistoryTokens("{}[]"),4);assert.ok(estimatedHistoryTokens({text:"中文"})>2);
});

test("an extremely long latest turn still leaves recent tables and a light old locator within budget",()=>{
 const older=row(1,"old purpose"),recent=[row(2,"|A|B|\n|---|---|\n|1|2|"),row(3,"|C|D|\n|---|---|\n|3|4|")],latest=row(4,Array.from({length:20},(_,i)=>"Long latest block "+i+" "+"新段条件".repeat(300)).join("\n\n"));
 const p=new RuntimeConversationHistory([older,...recent,latest],randomUUID()).projection();assert.ok(estimatedHistoryTokens(p)<=8000);
 assert.ok(p.turns.find(turn=>turn.taskId===recent[0].taskId));assert.ok(p.turns.find(turn=>turn.taskId===recent[1].taskId));
 assert.ok(p.index.some(turn=>turn.taskId===older.taskId)||p.turns.some(turn=>turn.taskId===older.taskId));assert.ok(p.budget.omittedBlocks>0);
});
