import test from "node:test";
import assert from "node:assert/strict";
import {ChatResponseError,readChatResponse} from "./chat-response";
import type {RunTrace} from "./types";
import {rectangle} from "./geo-rectangle";
const failure={error:"这次回答的资料引用未能核实，请按原条件重试。",code:"invalid_answer_references"};
test("research region arrives before the answer and reconnect snapshots replay the same layer",async()=>{
  const region={label:"川西",status:"located",precision:"approximate",geometry:rectangle(97,27,105,34),source:"示意窗口",note:"仅定位"};
  const seen:unknown[]=[];
  const events=[{researchRegion:region},{researchRegion:{...region,geometry:{type:"Invalid"}}},{researchRegion:region,stage:"正在检索"},{researchRegion:null},{result:{message:"回答",researchRegion:null}}];
  const r=await readChatResponse(new Response(events.map(e=>JSON.stringify(e)).join("\n")+"\n",{headers:{"content-type":"application/x-ndjson"}}),()=>{},r=>seen.push(r));
  assert.deepEqual(seen,[region,region,null]);assert.equal(r.researchRegion,null);
});
test("JSON errors preserve the reason that citation verification failed",async()=>{
  await assert.rejects(()=>readChatResponse(Response.json(failure,{status:502}),()=>{}),error=>error instanceof ChatResponseError && error.code===failure.code && error.message===failure.error);
});
test("streamed citation failures keep their reason after a repair stage",async()=>{
  const stages:string[]=[];
  const response=new Response(JSON.stringify({stage:"正在重新核对回答中的资料引用"})+"\n"+JSON.stringify(failure)+"\n",{headers:{"content-type":"application/x-ndjson"}});
  await assert.rejects(()=>readChatResponse(response,stage=>stages.push(stage)),error=>error instanceof ChatResponseError && error.code===failure.code);
  assert.deepEqual(stages,["正在重新核对回答中的资料引用"]);
});
test("valid streamed answers keep their reference mapping",async()=>{
  const result={message:"温度资料〔1〕",answerNotes:{references:[{kind:"asset",id:"sounder",title:"Sounder",source:"catalogue"}]}};
  const response=new Response(JSON.stringify({result})+"\n",{headers:{"content-type":"application/x-ndjson"}});
  assert.deepEqual(await readChatResponse(response,()=>{}),result);
});

test("incremental calls preserve progress, replace running states and retain failure evidence",async()=>{
  const call={id:"source-paper",kind:"tool",name:"断言库",input:"temperature"};
  const events=[
    {stage:"正在检索",traceStarted:123},
    {call:{...call,status:"running"},traceStarted:123},
    {call:{id:"source-haina",kind:"tool",name:"海纳",input:"temperature",status:"done",output:"3"},traceStarted:123},
    {call:{...call,status:"failed",error:"connection failed"},traceStarted:123},
    {stage:"正在整理答复",traceStarted:123},
    {error:"未能完成答复"},
  ];
  const snapshots:RunTrace[]=[];
  const response=new Response(events.map(e=>JSON.stringify(e)).join("\n")+"\n",{headers:{"content-type":"application/x-ndjson"}});
  await assert.rejects(()=>readChatResponse(response,(_stage,_searches,trace)=>{if(trace)snapshots.push(trace);}),error=>{
    assert.ok(error instanceof ChatResponseError);
    assert.equal(error.runTrace?.calls.length,2);
    assert.equal(error.runTrace?.calls[0].status,"failed");
    assert.equal(error.runTrace?.calls[1].status,"done");
    assert.deepEqual(error.runTrace?.stages,["正在检索","正在整理答复"]);
    return true;
  });
  // React keeps earlier snapshots: a later update must not mutate them in place.
  assert.equal(snapshots[1].calls[0].status,"running");
  assert.equal(snapshots[0].calls.length,0);
});

test("findings arrive before the terminal answer, replace by source and restore on reconnect",async()=>{
  let push!:(text:string)=>void;
  const stream=new ReadableStream<Uint8Array>({start(controller){
    push=text=>controller.enqueue(new TextEncoder().encode(text+"\n"));
  }});
  const snapshots:RunTrace[]=[];
  const receiving=readChatResponse(new Response(stream,{headers:{"content-type":"application/x-ndjson"}}),
    (_stage,_searches,trace)=>{if(trace)snapshots.push(trace);});
  const first={id:"web",source:"公开网络",summary:"找到线索，待核查",items:[{title:"NOAA product"}]};
  push(JSON.stringify({finding:first,traceStarted:123}));
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(snapshots.length,1);
  assert.equal(snapshots[0].findings?.[0].summary,first.summary);
  push(JSON.stringify({finding:{...first,summary:"已取得发布页面摘录"},traceStarted:123}));
  push(JSON.stringify({runTrace:{started:123,stages:[],calls:[],findings:[first]}}));
  push(JSON.stringify({result:{message:"最终汇总"}}));
  assert.equal((await receiving).message,"最终汇总");
  assert.equal(snapshots[1].findings?.length,1);
  assert.equal(snapshots[1].findings?.[0].summary,"已取得发布页面摘录");
  assert.equal(snapshots[0].findings?.[0].summary,first.summary);
  assert.deepEqual(snapshots[2].findings,[first]);
});
