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

function reasoningResponse(events:unknown[]) {
  return new Response(events.map(event=>JSON.stringify(event)+"\n").join(""),{headers:{"content-type":"application/x-ndjson"}});
}

const reasoningSummary={id:"planner",revision:1,kind:"summary" as const,text:"供应方已返回首段摘要。"};
const reasoningLater={...reasoningSummary,revision:2,text:"供应方已返回首段摘要。\n这里是第二段。",complete:true};

test("provider snapshots replace by revision, and stale trace and terminal data cannot erase the update",async()=>{
  const snapshots:RunTrace[]=[];
  const result=await readChatResponse(reasoningResponse([
    {providerReasoning:reasoningSummary,traceStarted:21},
    {providerReasoning:{...reasoningSummary,text:"同版本不替换"}},
    {providerReasoning:reasoningLater},
    {providerReasoning:{...reasoningSummary,revision:3,text:"   "}},
    {stage:"真实阶段",runTrace:{started:21,stages:[],calls:[],providerReasoning:[reasoningSummary]}},
    {result:{message:"正文",runTrace:{started:21,stages:["归档阶段"],calls:[],providerReasoning:[reasoningSummary]}}},
  ]),(_stage,_searches,trace)=>{if(trace)snapshots.push(trace);});
  assert.equal(snapshots.length,3);
  assert.deepEqual(snapshots[0].providerReasoning,[reasoningSummary]);
  assert.deepEqual(snapshots[1].providerReasoning,[reasoningLater]);
  assert.deepEqual(snapshots[2].providerReasoning,[reasoningLater]);
  assert.deepEqual(result.runTrace?.providerReasoning,[reasoningLater]);
  assert.deepEqual(result.runTrace?.stages,["归档阶段"]);
  assert.equal(result.message,"正文");
});

test("same-task reconnect retains the last observed revision; separate tasks may reuse a snapshot ID",async()=>{
  const [reconnected,independent]=await Promise.all([
    readChatResponse(reasoningResponse([{providerReasoning:reasoningSummary},{result:{message:"同任务"}}]),()=>{},
      undefined,[reasoningLater]),
    readChatResponse(reasoningResponse([{providerReasoning:{...reasoningSummary,kind:"deepseek-thinking",text:"身份独立"}},{result:{message:"新任务"}}]),()=>{}),
  ]);
  assert.deepEqual(reconnected.runTrace?.providerReasoning,[reasoningLater]);
  assert.equal(independent.runTrace?.providerReasoning?.[0].text,"身份独立");
});

test("a failure event can retain the last real provider snapshot in its original trace",async()=>{
  await assert.rejects(()=>readChatResponse(reasoningResponse([
    {providerReasoning:reasoningSummary},
    {error:"运行中断",code:"fixture",providerReasoning:reasoningLater},
  ]),()=>{}),error=>{
    assert.ok(error instanceof ChatResponseError);
    assert.equal(error.code,"fixture");
    assert.deepEqual(error.runTrace?.providerReasoning,[reasoningLater]);
    return true;
  });
});

test("an empty or malformed provider snapshot never creates reasoning content",async()=>{
  const result={message:"普通回答"};
  assert.deepEqual(await readChatResponse(reasoningResponse([
    {providerReasoning:{...reasoningSummary,text:"  "}},
    {providerReasoning:{...reasoningSummary,kind:"internal-debug"}},
    {providerReasoning:{...reasoningSummary,revision:Infinity}},
    {result},
  ]),()=>{}),result);
});

test("long same-kind reasoning segments preserve independent IDs and explicit truncation",async()=>{
  const one={...reasoningSummary,id:"segment-one",text:"前".repeat(8000),complete:true};
  const two={...reasoningSummary,id:"segment-two",revision:2,text:"后".repeat(10000),complete:true,truncated:true};
  const older={...two,revision:1,text:"旧段",truncated:false};
  const result=await readChatResponse(reasoningResponse([
    {providerReasoning:one},{providerReasoning:older},{providerReasoning:two},
    {runTrace:{started:1,stages:[],calls:[],providerReasoning:[one,older]}},
    {result:{message:"正文独立保留"}},
  ]),()=>{});
  assert.deepEqual(result.runTrace?.providerReasoning,[one,two]);
  assert.equal(result.message,"正文独立保留");
});

test("provider reasoning keeps the newest twelve IDs in arrival order across reconnect",async()=>{
  const parts=Array.from({length:13},(_,i)=>({...reasoningSummary,id:"attempt-"+i}));
  const updated={...parts[4],revision:2,text:"仍在原位置"};
  const tail={...parts[12],truncated:true};
  const archived=[...parts.slice(1,12),tail];
  const retired=new Set<string>();
  let latest:RunTrace|undefined;
  await assert.rejects(readChatResponse(reasoningResponse([
    ...parts.slice(0,12).map(providerReasoning=>({providerReasoning})),
    {providerReasoning:tail},
  ]),(_stage,_searches,trace)=>{latest=trace;},undefined,undefined,retired),/连接在回复完成前中断/);
  assert.deepEqual(latest?.providerReasoning,archived);

  const result=await readChatResponse(reasoningResponse([
    {providerReasoning:parts[0]},
    {providerReasoning:updated},
    {result:{message:"重连后正文",runTrace:{started:1,stages:[],calls:[],providerReasoning:archived}}},
  ]),()=>{},undefined,latest?.providerReasoning,retired);
  const expected=archived.map(part=>part.id===updated.id ? updated : part);
  assert.deepEqual(result.runTrace?.providerReasoning,expected);
  assert.equal(result.message,"重连后正文");
});

test("lifecycle-only events and a terminal cancellation carry ordered facts separately from progress text",async()=>{
  const events=[
    {seq:1,runtimePhase:{phase:"waiting-discovery",operation:"read"}},
    {seq:2,runtimePhase:{phase:"unrecognized"}},
    {seq:3,runtimePhase:{phase:"cancelled"},remoteStop:{discoveryTaskId:"a",state:"pending"},error:"取消",code:"cancelled"},
  ];
  const phases:unknown[]=[],stages:unknown[]=[];
  await assert.rejects(readChatResponse(reasoningResponse(events),stage=>stages.push(stage),
    undefined,undefined,undefined,(facts,seq)=>phases.push({facts,seq})),{code:"cancelled"});
  assert.deepEqual(stages,[]);
  assert.deepEqual(phases,[
    {seq:1,facts:{runtimePhase:{phase:"waiting-discovery",operation:"read"}}},
    {seq:3,facts:{runtimePhase:{phase:"cancelled"},remoteStops:[{discoveryTaskId:"a",state:"pending"}]}},
  ]);
});
