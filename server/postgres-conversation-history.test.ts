import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import test from "node:test";
import {postgresTaskStore} from "./postgres-task-store";
import {productDatabase} from "./product-database";
import {RuntimeConversationHistory} from "./conversation-history";

const fixture=process.env.ONEEARTH_HISTORY_TEST_DATABASE_URL;

test("runtime history includes old and handed-off turns in admission order, within the admitted session", {skip:!fixture}, async t=>{
  assert.ok(fixture);
  assert.match(new URL(fixture).pathname,/(?:^|[-_])test(?:[-_]|$)/);
  const previous=process.env.ONEEARTH_RUNTIME_DATABASE_URL;
  process.env.ONEEARTH_RUNTIME_DATABASE_URL=fixture;
  const tasks=await postgresTaskStore("runtime");
  const audit=productDatabase("RUNTIME");
  t.after(async ()=>{
    await audit.end();
    await tasks.close();
    if(previous===undefined)delete process.env.ONEEARTH_RUNTIME_DATABASE_URL;
    else process.env.ONEEARTH_RUNTIME_DATABASE_URL=previous;
  });

  const conversationId=randomUUID(),foreign=randomUUID();
  const input=(query:string,session=conversationId)=>({conversationId:session,turnId:randomUUID(),query,history:[]});
  const ids:string[]=[];
  const add=async (query:string,kind:"legacy"|"chat"|"research",session=conversationId)=>{
    const id=randomUUID(),body=input(query,session);
    ids.push(id);
    if(kind==="legacy")await tasks.submit(id,body);
    else assert.ok(await tasks.chat.admit(id,body,100));
    if(kind==="research")assert.ok(await tasks.chat.promote(id));
    return {id,body};
  };
  const oldest=await add("A".repeat(800),"legacy");
  const full="历史结论\n\n"+("首段条目".repeat(300))+"\n\n较老轮后段的独立站点证据。";
  const url="https://example.test/archived/report";
  const displayOnly="仅供原轮展示的模型说明";
  assert.ok(await tasks.finish(oldest.id,"complete",{result:{message:full,answerNotes:{
    references:[{kind:"web",url,title:"原来源"}],
    webSources:[{url,title:"原来源",stage:"pdf-excerpt",pageExcerpt:"不进入历史投影的材料原文。"}],
  }}}));
  const front=await add("普通前台问答","chat");
  assert.ok(await tasks.chat.finish(front.id,"complete",{result:{message:"普通前台答复"}}));
  const research=await add("前台转后台","research");
  assert.ok(await tasks.finish(research.id,"complete",{result:{message:"真实后台终档",runTrace:{
    started:100,stages:[],calls:[],providerReasoning:[{id:research.id+":fixture",revision:1,kind:"deepseek-thinking",text:displayOnly}]
  }}}));

  const intermediate:Array<Awaited<ReturnType<typeof add>>>=[];
  for(let n=0;n<5;n++){
    const entry=await add("中间第 "+n+" 轮","chat");
    intermediate.push(entry);
    assert.ok(await tasks.chat.finish(entry.id,"complete",{result:{message:"中间答复 "+n}}));
  }
  const protectedTurn=await add("受保护的具体问题","chat");
  assert.ok(await tasks.chat.finish(protectedTurn.id,"complete",{result:{message:"受保护的数据值",answerNotes:{
    references:[{kind:"asset",id:"observation:hidden",evidenceLevel:"observation-file"}],
  }}}));
  const other=await add("另一会话不能读取","chat",foreign);
  await add("旧记录可能含\u0000字符","chat",foreign);
  const current=await add("当前问题不能进自身历史","chat");
  const future=await add("较晚接受的会话消息","chat");

  // Exercise exact admission order even when every task has the same timestamp.
  for(const table of ["runtime_chat_messages","runtime_tasks"]){
    await audit.query(`UPDATE ${table} SET created=10000 WHERE id=ANY($1::uuid[])`,[ids]);
  }
  await audit.query("UPDATE runtime_chat_messages SET created=10001 WHERE id=$1",[front.id]);
  await audit.query("UPDATE runtime_chat_messages SET created=9999 WHERE id=$1",[future.id]);
  const history=await tasks.conversationHistory!(conversationId,current.id);
  assert.deepEqual(history.map(turn=>turn.taskId),[oldest,front,research,...intermediate,protectedTurn].map(entry=>entry.id));
  assert.equal(history[0].question,"","oversized locator text stays in the original archive");
  assert.equal(history[0].turnId,oldest.body.turnId);
  assert.equal(history[0].assistantText,undefined,"older answer bodies stay in PostgreSQL until selected");
  assert.equal(history[0].bodyOmitted,true);
  assert.deepEqual(history[0].references,[{kind:"web",url,title:"原来源",webEvidenceStage:"pdf-excerpt"}]);
  assert.equal(history[2].assistantText,undefined);
  assert.equal(history.find(turn=>turn.taskId===intermediate.at(-1)!.id)?.assistantText,"中间答复 4");
  const load=(selections:import("./conversation-history").HistorySelection[])=>
    tasks.conversationHistory!(conversationId,current.id,{mode:"read",selections});
  const read=await load([oldest,research,protectedTurn].map(({id,body})=>({taskId:id,turnId:body.turnId,blockIds:[]})));
  assert.deepEqual(read.map(turn=>turn.taskId),[oldest.id,research.id,protectedTurn.id]);
  assert.equal(read[0].question,oldest.body.query);
  assert.equal(read[0].assistantText,full);
  assert.deepEqual(read[0].references,history[0].references);
  assert.equal(read[1].assistantText,"真实后台终档");
  assert.equal(read[2].assistantText,undefined);
  assert.deepEqual(await load([{taskId:oldest.id,turnId:randomUUID(),blockIds:[]},{taskId:other.id,turnId:other.body.turnId,blockIds:[]},
    {taskId:future.id,turnId:future.body.turnId,blockIds:[]}]),[]);
  const projected=new RuntimeConversationHistory(history,current.id,load);
  const targeted=await projected.readBounded([{taskId:oldest.id,turnId:oldest.body.turnId,blockIds:["a3"]}]);
  assert.equal(targeted.readback?.state,"loaded");
  assert.equal(targeted.turns.find(turn=>turn.taskId===oldest.id)?.blocks[0].text,"较老轮后段的独立站点证据。");
  assert.ok(!JSON.stringify(history).includes(displayOnly));
  assert.equal(history.at(-1)?.observationRestricted,true);
  assert.equal(history.at(-1)?.assistantText,undefined);
  assert.equal(history.at(-1)?.references,undefined);
  assert.doesNotMatch(JSON.stringify(history),/受保护的具体问题|受保护的数据值|材料原文/);
  assert.ok(!history.some(turn=>turn.taskId===future.id||turn.taskId===other.id));
  assert.deepEqual(await tasks.conversationHistory!(foreign,current.id),[]);
  assert.deepEqual(await tasks.conversationHistory!(conversationId,randomUUID()),[]);
});
