import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {once} from "node:events";
import {setTimeout as delay} from "node:timers/promises";
import test,{type TestContext} from "node:test";
import express from "express";
import {discoverThroughA2A,discoveryA2ACancellation,type DiscoveryBusinessInput,type DiscoveryBinding,type DiscoveryA2AOptions} from "./discovery-a2a-client";
import {researchExecutor} from "./research-executor";
import {TaskCancelled} from "./task-cancellation";
import type {DataSearchResult} from "./data-search";
import type {DiscoveryEvent} from "./discovery-contract";

function deferred(){let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done;});return{resolve,promise};}
async function until(check:()=>boolean){const end=Date.now()+2500;while(!check()){assert.ok(Date.now()<end,"fixture state did not arrive");await delay(5);}}
const input=():DiscoveryBusinessInput=>({query:"find controlled source material",history:[],references:[],currentDatasets:[],scope:{} as DiscoveryBusinessInput["scope"]});
const result=():DataSearchResult=>({plan:{questionMode:"preserve",dataQuestion:input().query,paper:{name:"",facets:[],region:[]},web:[],hainaQueries:[],dataNeed:null},
  papers:[],haina:[],searches:[],sourceStatus:[],issues:[]});
type Remote={id:string;contextId:string;status:{state:string};artifacts:any[];jobs:number};
type Hook=(req:express.Request,res:express.Response,next:()=>void)=>void;

async function provider(t:TestContext,options:{send?:Hook;get?:Hook;subscribe?:Hook;cancel?:Hook;multiline?:boolean}={}){
  const app=express();app.use(express.json({type:"application/a2a+json"}));
  const requests:{method:string;path:string;body:any;version?:string;contentType?:string}[]=[];
  app.use((req,_res,next)=>{requests.push({method:req.method,path:req.path,body:req.body,version:req.get("A2A-Version"),contentType:req.get("content-type")});next();});
  const tasks=new Map<string,Remote>(),messages=new Map<string,{fingerprint:string;task:Remote}>(),streams=new Map<string,Set<express.Response>>();
  let sequence=0,jobs=0;
  const reply=(res:express.Response,body:unknown,status=200)=>res.status(status).type("application/a2a+json").send(JSON.stringify(body));
  const error=(res:express.Response,status:number,reason:string)=>reply(res,{error:{code:status,message:reason,details:[{"@type":"type.googleapis.com/google.rpc.ErrorInfo",domain:"a2a-protocol.org",reason}]}},status);
  const snapshot=(remote:Remote)=>JSON.parse(JSON.stringify({id:remote.id,contextId:remote.contextId,status:remote.status,artifacts:remote.artifacts}));
  function frame(res:express.Response,value:unknown){
    const lines=JSON.stringify(value,null,options.multiline?2:undefined).split("\n").map(line=>"data: "+line);
    res.write(": heartbeat\r\nid: ignored-wire-cursor\r\n"+lines.join("\r\n")+"\r\n\r\n");
  }
  function add(remote:Remote,event:DiscoveryEvent){
    const artifact={artifactId:"event-"+(++sequence),parts:[{data:{kind:"oneearth.discovery.event.v1",event:{...event,seq:sequence}}}]};
    remote.artifacts.push(artifact);
    for(const res of streams.get(remote.id)||[])frame(res,{artifactUpdate:{taskId:remote.id,contextId:remote.contextId,artifact,lastChunk:true}});
    return artifact;
  }
  function state(remote:Remote,value:string){
    remote.status={state:value};
    for(const res of streams.get(remote.id)||[])frame(res,{statusUpdate:{taskId:remote.id,contextId:remote.contextId,status:remote.status}});
    if(value!=="TASK_STATE_WORKING")for(const res of streams.get(remote.id)||[])res.end();
  }
  const finish=(remote:Remote,value=result(),status="TASK_STATE_COMPLETED")=>{add(remote,{result:value});state(remote,status);};
  const send:Hook=(req,res,next)=>{
    if(req.get("A2A-Version")!=="1.0"||req.body?.configuration?.returnImmediately!==true||req.body?.message?.role!=="ROLE_USER"){
      error(res,400,"INVALID_ARGUMENT");return;
    }
    const {message}=req.body,fingerprint=JSON.stringify(req.body),old=messages.get(message.messageId);
    if(old){if(old.fingerprint!==fingerprint){error(res,409,"ALREADY_EXISTS");return;}reply(res,{task:snapshot(old.task)});return;}
    let remote:Remote;
    if(message.taskId){
      remote=tasks.get(message.taskId)!;
      if(!remote){error(res,404,"TASK_NOT_FOUND");return;}
      if(remote.status.state!=="TASK_STATE_INPUT_REQUIRED"||message.contextId!==remote.contextId){error(res,400,"UNSUPPORTED_OPERATION");return;}
      const business=message.parts[0].data.input;
      if(business.clarificationReply){
        const latest=Math.max(...remote.artifacts.filter(a=>a.parts[0].data.event.result).map(a=>a.parts[0].data.event.seq));
        if(business.continuedFrom!==remote.id||business.clarificationReply.afterSeq!==latest){error(res,409,"INVALID_ARGUMENT");return;}
      }
      remote.status={state:"TASK_STATE_WORKING"};remote.jobs++;
    }else{
      remote={id:"discovery-"+randomUUID(),contextId:"context-"+randomUUID(),status:{state:"TASK_STATE_WORKING"},artifacts:[],jobs:1};tasks.set(remote.id,remote);
    }
    jobs++;messages.set(message.messageId,{fingerprint,task:remote});
    if(options.send){options.send(req,res,()=>reply(res,{task:snapshot(remote)}));}else reply(res,{task:snapshot(remote)});
  };
  app.post("/message:send",send);
  app.get("/tasks/:id",(req,res)=>{
    const remote=tasks.get(String(req.params.id));if(!remote){error(res,404,"TASK_NOT_FOUND");return;}
    const next=()=>reply(res,snapshot(remote));if(options.get)options.get(req,res,next);else next();
  });
  app.post(/^\/tasks\/([^/]+):subscribe$/,(req,res)=>{
    const id=decodeURIComponent(req.params[0]),remote=tasks.get(id);
    if(!remote){error(res,404,"TASK_NOT_FOUND");return;}
    const next=()=>{
      if(remote.status.state!=="TASK_STATE_WORKING"){error(res,400,"UNSUPPORTED_OPERATION");return;}
      res.type("text/event-stream").flushHeaders();
      frame(res,{task:snapshot(remote)});
      const connected=streams.get(id)||new Set();connected.add(res);streams.set(id,connected);
      res.once("close",()=>connected.delete(res));
    };
    if(options.subscribe)options.subscribe(req,res,next);else next();
  });
  app.post(/^\/tasks\/([^/]+):cancel$/,(req,res)=>{
    const id=decodeURIComponent(req.params[0]),remote=tasks.get(id);
    if(!remote){error(res,404,"TASK_NOT_FOUND");return;}
    const next=()=>{state(remote,"TASK_STATE_CANCELED");reply(res,snapshot(remote));};
    if(options.cancel)options.cancel(req,res,next);else next();
  });
  const server=app.listen(0,"127.0.0.1");await once(server,"listening");
  const address=server.address();assert.ok(address&&typeof address!=="string");
  const previous=process.env.ONEEARTH_DISCOVERY_URL,protocol=process.env.ONEEARTH_DISCOVERY_PROTOCOL;
  process.env.ONEEARTH_DISCOVERY_URL="http://127.0.0.1:"+address.port;delete process.env.ONEEARTH_DISCOVERY_PROTOCOL;
  t.after(async()=>{server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));
    if(previous===undefined)delete process.env.ONEEARTH_DISCOVERY_URL;else process.env.ONEEARTH_DISCOVERY_URL=previous;
    if(protocol===undefined)delete process.env.ONEEARTH_DISCOVERY_PROTOCOL;else process.env.ONEEARTH_DISCOVERY_PROTOCOL=protocol;});
  const accepted=async(messageId:string)=>{await until(()=>messages.has(messageId));return messages.get(messageId)!.task;};
  return{requests,tasks,messages,streams,reply,error,snapshot,frame,add,state,finish,accepted,get jobs(){return jobs;}};
}

test("the default executor sends nonblocking A2A business input without runtime model configuration",async t=>{
  let service:Awaited<ReturnType<typeof provider>>;
  service=await provider(t,{get:(req,_res,next)=>{service.finish(service.tasks.get(String(req.params.id))!);next();}});
  for(const executor of ["codex","claude"] as const){
    const run=researchExecutor({executor,model:"runtime-model-must-stay-local"}, {search:true,fetch:false},new AbortController().signal);
    try{await run.discover(randomUUID(),{...input(),initialPlan:"never-send-internal-plan",config:{credential:"never-send"},credentials:"never-send",executor:"never-send"} as any,()=>{});}
    finally{await run.close();}
  }
  const sends=service.requests.filter(r=>r.path==="/message:send");assert.equal(sends.length,2);
  for(const send of sends){
    assert.equal(send.version,"1.0");assert.equal(send.contentType,"application/a2a+json");
    assert.equal(send.body.configuration.returnImmediately,true);assert.equal(send.body.message.role,"ROLE_USER");
    const business=send.body.message.parts[0].data;
    assert.equal(business.kind,"oneearth.discovery.request.v1");assert.deepEqual(business.input.deepseekTools,{search:true,fetch:false});
    assert.ok(!JSON.stringify(send.body).includes("never-send"));assert.ok(!JSON.stringify(send.body).includes("runtime-model"));
    assert.equal(send.body.message.taskId,undefined);
  }
  assert.ok(service.requests.every(r=>!r.path.startsWith("/v1/")));
});

test("archived and incremental SSE artifacts deduplicate by immutable identity and event sequence",async t=>{
  const service=await provider(t,{multiline:true}),messageId=randomUUID(),events:DiscoveryEvent[]=[],order:string[]=[];
  const pending=discoverThroughA2A(messageId,input(),new AbortController().signal,e=>{events.push(e);order.push("event");},{
    onAccepted:async()=>{order.push("accepted");},onCheckpoint:async()=>{order.push("checkpoint");},
  });
  const remote=await service.accepted(messageId);
  const first=service.add(remote,{finding:{id:"early",source:"fixture",items:[]} as any});
  await until(()=>(service.streams.get(remote.id)?.size||0)>0);
  for(const res of service.streams.get(remote.id)!)service.frame(res,{artifactUpdate:{taskId:remote.id,contextId:remote.contextId,artifact:first,lastChunk:true}});
  service.add(remote,{stage:"real incremental progress"});service.finish(remote);
  await pending;
  assert.equal(order[0],"accepted");assert.equal(order.at(-1),"checkpoint");
  assert.equal(events.filter(e=>e.finding).length,1);assert.equal(new Set(events.map(e=>e.seq)).size,events.length);
});

test("completion before subscription is recovered by GET without subscribing or resending",async t=>{
  let service:Awaited<ReturnType<typeof provider>>;
  service=await provider(t,{get:(req,_res,next)=>{service.finish(service.tasks.get(String(req.params.id))!);next();}});
  const messageId=randomUUID();await discoverThroughA2A(messageId,input(),new AbortController().signal,()=>{});
  assert.equal(service.requests.filter(r=>r.path==="/message:send").length,1);
  assert.equal(service.requests.filter(r=>r.path.endsWith(":subscribe")).length,0);
});

test("a completed acceptance receipt without inline artifacts is recovered from GET",async t=>{
  let service:Awaited<ReturnType<typeof provider>>;
  service=await provider(t,{send:(req,res)=>{
    const remote=service.messages.get(req.body.message.messageId)!.task;service.finish(remote);
    service.reply(res,{task:{id:remote.id,contextId:remote.contextId,status:remote.status}});
  }});
  await discoverThroughA2A(randomUUID(),input(),new AbortController().signal,()=>{});
  assert.equal(service.requests.filter(r=>r.method==="GET").length,1);
  assert.ok(!service.requests.some(r=>r.path.endsWith(":subscribe")));
});

test("a task completing between GET and subscribe is read back instead of recreated",async t=>{
  let service:Awaited<ReturnType<typeof provider>>;
  service=await provider(t,{subscribe:(req,res)=>{
    const remote=service.tasks.get(decodeURIComponent(req.params[0]))!;service.finish(remote);
    service.error(res,400,"UNSUPPORTED_OPERATION");
  }});
  await discoverThroughA2A(randomUUID(),input(),new AbortController().signal,()=>{});
  assert.equal(service.requests.filter(r=>r.path.endsWith(":subscribe")).length,1);
  assert.equal(service.requests.filter(r=>r.path==="/message:send").length,1);
  assert.equal(service.requests.filter(r=>r.method==="GET").length,2);
});

test("completion while disconnected is recovered with all archived material once",async t=>{
  const service=await provider(t),messageId=randomUUID(),events:DiscoveryEvent[]=[];
  const pending=discoverThroughA2A(messageId,input(),new AbortController().signal,e=>events.push(e));
  const remote=await service.accepted(messageId);await until(()=>(service.streams.get(remote.id)?.size||0)>0);
  service.add(remote,{finding:{id:"saved",source:"fixture",items:[]} as any});
  for(const res of service.streams.get(remote.id)!)res.destroy();
  service.finish(remote);
  await pending;
  assert.equal(events.filter(e=>e.finding).length,1);assert.equal(events.filter(e=>e.result).length,1);
  assert.equal(service.requests.filter(r=>r.path==="/message:send").length,1);
});

test("stream EOF alone does not finish or cancel a working discovery",async t=>{
  const service=await provider(t),messageId=randomUUID();let done=false;
  const pending=discoverThroughA2A(messageId,input(),new AbortController().signal,()=>{}).then(r=>{done=true;return r;});
  const remote=await service.accepted(messageId);await until(()=>(service.streams.get(remote.id)?.size||0)>0);
  for(const res of service.streams.get(remote.id)!)res.end();
  await until(()=>service.requests.filter(r=>r.path.endsWith(":subscribe")).length>=2);
  assert.equal(done,false);assert.equal(remote.status.state,"TASK_STATE_WORKING");
  service.finish(remote);await pending;
  assert.equal(service.jobs,1);assert.ok(!service.requests.some(r=>r.path.endsWith(":cancel")));
});

test("an uncertain send retries the identical stable message and does not create another job",async t=>{
  let first=true,service:Awaited<ReturnType<typeof provider>>;
  service=await provider(t,{send:(_req,res,next)=>{if(first){first=false;res.destroy();}else next();},get:(req,_res,next)=>{service.finish(service.tasks.get(String(req.params.id))!);next();}});
  const messageId=randomUUID();await discoverThroughA2A(messageId,input(),new AbortController().signal,()=>{});
  const sends=service.requests.filter(r=>r.path==="/message:send");
  assert.equal(sends.length,2);assert.deepEqual(sends[0].body,sends[1].body);assert.equal(service.jobs,1);
});

for(const explicit of [true,false])test((explicit?"explicit cancellation":"ordinary local abort")+" respects accepted task ownership",async t=>{
  const service=await provider(t),controller=new AbortController(),messageId=randomUUID(),events:DiscoveryEvent[]=[];
  const pending=discoverThroughA2A(messageId,input(),controller.signal,e=>events.push(e));
  const rejected=assert.rejects(pending);
  const remote=await service.accepted(messageId);await until(()=>(service.streams.get(remote.id)?.size||0)>0);
  service.add(remote,{finding:{id:"kept",source:"fixture",items:[]} as any});await until(()=>events.some(e=>e.finding));
  controller.abort(explicit?new TaskCancelled():undefined);controller.abort(new TaskCancelled());
  await rejected;
  const cancels=service.requests.filter(r=>r.path.endsWith(":cancel"));
  assert.equal(cancels.length,explicit?1:0);
  if(explicit){assert.equal(cancels[0].path,"/tasks/"+remote.id+":cancel");assert.notEqual(remote.id,messageId);assert.equal(remote.status.state,"TASK_STATE_CANCELED");}
  else assert.equal(remote.status.state,"TASK_STATE_WORKING");
  assert.ok(remote.artifacts.some(a=>a.parts[0].data.event.finding));
});

test("cancelling before acceptance never guesses a task ID from messageId",async t=>{
  const waiting=deferred(),service=await provider(t,{send:(_req,_res)=>waiting.resolve()}),controller=new AbortController(),messageId=randomUUID();
  const diagnostics:string[]=[];t.mock.method(console,"error",(s:string)=>diagnostics.push(s));
  const pending=assert.rejects(discoverThroughA2A(messageId,input(),controller.signal,()=>{}));
  await waiting.promise;controller.abort(new TaskCancelled());await pending;
  assert.ok(!service.requests.some(r=>r.path.endsWith(":cancel")));
  assert.ok(diagnostics.some(s=>s.includes(messageId)&&s.includes("not acknowledged")));
  assert.equal(service.requests.filter(r=>r.path==="/message:send").length,1);
});

test("an invalid receipt cannot authorize cancelling an existing task",async t=>{
  const service=await provider(t,{send:(_req,res)=>{res.type("application/a2a+json").send(JSON.stringify({task:{id:"foreign"},error:{message:"ambiguous"}}));}});
  const controller=new AbortController(),scope=discoveryA2ACancellation(controller.signal);
  t.mock.method(console,"error",()=>{});
  await assert.rejects(discoverThroughA2A(randomUUID(),input(),controller.signal,()=>{},{},scope),/受理确认/);
  controller.abort(new TaskCancelled());await scope.close();
  assert.ok(!service.requests.some(r=>r.path.endsWith(":cancel")));
});

test("a completed child racing cancellation keeps its stored result",async t=>{
  let service:Awaited<ReturnType<typeof provider>>;
  service=await provider(t,{cancel:(req,res)=>{const remote=service.tasks.get(decodeURIComponent(req.params[0]))!;service.finish(remote);service.reply(res,service.snapshot(remote));}});
  const controller=new AbortController(),messageId=randomUUID();
  const pending=assert.rejects(discoverThroughA2A(messageId,input(),controller.signal,()=>{}));
  const remote=await service.accepted(messageId);await until(()=>(service.streams.get(remote.id)?.size||0)>0);
  controller.abort(new TaskCancelled());await pending;
  assert.equal(remote.status.state,"TASK_STATE_COMPLETED");assert.ok(remote.artifacts.some(a=>a.parts[0].data.event.result));
});

test("binding persistence completes before acquired events are exposed",async t=>{
  const persisted=deferred(),accepted=deferred();let service:Awaited<ReturnType<typeof provider>>,visible=0;
  service=await provider(t,{send:(req,res)=>{const remote=service.messages.get(req.body.message.messageId)!.task;service.finish(remote);service.reply(res,{task:service.snapshot(remote)});}});
  const pending=discoverThroughA2A(randomUUID(),input(),new AbortController().signal,()=>{visible++;},{onAccepted:async()=>{accepted.resolve();await persisted.promise;}});
  await accepted.promise;assert.equal(visible,0);persisted.resolve();await pending;assert.equal(visible,1);
});

test("INPUT_REQUIRED confirmation survives a lost response, runs once and skips the prior archived question",async t=>{
  let dropped=false;
  const service=await provider(t,{send:(req,res,next)=>{
    if(req.body.message.taskId&&!dropped){dropped=true;res.destroy();}else next();
  }}),firstId=randomUUID();let checkpoint:DiscoveryBinding|undefined;
  const first=discoverThroughA2A(firstId,input(),new AbortController().signal,()=>{},{onCheckpoint:async b=>{checkpoint=b;}});
  const remote=await service.accepted(firstId);await until(()=>(service.streams.get(remote.id)?.size||0)>0);
  const proposal={...result(),questionCheck:{originalQuestion:input().query,proposedQuestion:"confirmed narrow question"}} as DataSearchResult;
  service.finish(remote,proposal,"TASK_STATE_INPUT_REQUIRED");assert.ok((await first).questionCheck);
  assert.equal(service.jobs,1);assert.equal(checkpoint?.state,"TASK_STATE_INPUT_REQUIRED");assert.ok(checkpoint?.lastSeq);
  assert.ok(!remote.artifacts.some(a=>a.parts[0].data.event.finding));
  const nextId=randomUUID(),events:DiscoveryEvent[]=[],options:DiscoveryA2AOptions={target:checkpoint!,afterSeq:checkpoint!.lastSeq};
  const second=discoverThroughA2A(nextId,{...input(),continuedFrom:remote.id,decision:{checkMessageId:firstId,originalQuestion:input().query,
    dataQuestion:"confirmed narrow question",choice:"proposed"}},new AbortController().signal,e=>events.push(e),options);
  assert.equal((await service.accepted(nextId)).id,remote.id);await until(()=>service.requests.filter(r=>r.path.endsWith(":subscribe")).length===2);
  service.finish(remote);assert.equal((await second).questionCheck,undefined);
  assert.equal(events.filter(e=>e.result).length,1);assert.equal(service.tasks.size,1);assert.equal(service.jobs,2);
  const confirmations=service.requests.filter(r=>r.path==="/message:send"&&r.body.message.messageId===nextId);
  assert.equal(confirmations.length,2);assert.deepEqual(confirmations[0].body,confirmations[1].body);
  const sent=service.requests.filter(r=>r.path==="/message:send").at(-1)!.body.message;
  assert.equal(sent.taskId,remote.id);assert.equal(sent.parts[0].data.input.decision.checkMessageId,firstId);
  t.diagnostic(JSON.stringify({firstMessage:firstId,confirmationMessage:nextId,externalTask:remote.id,jobs:service.jobs,checkpoint:checkpoint!.lastSeq,resultsAfterConfirmation:events.filter(e=>e.result).length}));
});

test("a new evidence gap creates a new task linked by the actual previous discovery ID",async t=>{
  let service:Awaited<ReturnType<typeof provider>>;
  service=await provider(t,{get:(req,_res,next)=>{service.finish(service.tasks.get(String(req.params.id))!);next();}});
  const firstId=randomUUID();await discoverThroughA2A(firstId,input(),new AbortController().signal,()=>{});
  const previous=(await service.accepted(firstId)).id,nextId=randomUUID();
  await discoverThroughA2A(nextId,{...input(),continuation:{previousId:previous,focus:"a specific new evidence gap"}},new AbortController().signal,()=>{});
  const next=(await service.accepted(nextId)).id;assert.notEqual(next,previous);
  const sent=service.requests.filter(r=>r.path==="/message:send").at(-1)!.body.message;
  assert.equal(sent.taskId,undefined);assert.equal(sent.parts[0].data.input.continuation.previousId,previous);
});

test("minimal clarification uses the archived wait checkpoint; old new-message replies fail while duplicates stay idempotent",async t=>{
  const service=await provider(t),firstId=randomUUID();let checkpoint:DiscoveryBinding|undefined;
  const first=discoverThroughA2A(firstId,input(),new AbortController().signal,()=>{},{onCheckpoint:async b=>{checkpoint=b;}});
  const remote=await service.accepted(firstId);await until(()=>(service.streams.get(remote.id)?.size||0)>0);
  service.finish(remote,{...result(),clarification:"Which period?"},"TASK_STATE_INPUT_REQUIRED");await first;
  const reply={continuedFrom:remote.id,clarificationReply:{text:"Use the original authorized period.",afterSeq:checkpoint!.lastSeq!}};
  const options:DiscoveryA2AOptions={target:checkpoint!,afterSeq:checkpoint!.lastSeq},messageId=randomUUID();
  const next=discoverThroughA2A(messageId,{...reply,config:{model:"must-not-leak"},scope:{place:"must-not-leak"},history:["must-not-leak"]} as any,
    new AbortController().signal,()=>{},options);
  await service.accepted(messageId);await until(()=>service.requests.filter(r=>r.path.endsWith(":subscribe")).length===2);
  const secondQuestion={...result(),clarification:"Which station?"};service.finish(remote,secondQuestion,"TASK_STATE_INPUT_REQUIRED");await next;
  const sent=service.requests.filter(r=>r.path==="/message:send"&&r.body.message.messageId===messageId)[0].body.message.parts[0].data.input;
  assert.deepEqual(sent,reply);assert.equal(service.jobs,2);
  await assert.rejects(discoverThroughA2A(randomUUID(),reply,new AbortController().signal,()=>{},options),/INVALID_ARGUMENT/);
  assert.equal(service.jobs,2);
  assert.equal((await discoverThroughA2A(messageId,reply,new AbortController().signal,()=>{},options)).clarification,"Which station?");
  assert.equal(service.jobs,2);assert.equal(service.tasks.size,1);
});

test("an artifact from another task is rejected without contaminating the acquired evidence",async t=>{
  const service=await provider(t),messageId=randomUUID(),events:DiscoveryEvent[]=[];
  const pending=assert.rejects(discoverThroughA2A(messageId,input(),new AbortController().signal,e=>events.push(e)),/归属/);
  const remote=await service.accepted(messageId);await until(()=>(service.streams.get(remote.id)?.size||0)>0);
  const artifact={artifactId:"bad",parts:[{data:{kind:"oneearth.discovery.event.v1",event:{seq:9,stage:"must not enter record"}}}]};
  for(const res of service.streams.get(remote.id)!)service.frame(res,{artifactUpdate:{taskId:"foreign",contextId:remote.contextId,artifact}});
  await pending;assert.ok(!events.some(e=>e.stage==="must not enter record"));
});
