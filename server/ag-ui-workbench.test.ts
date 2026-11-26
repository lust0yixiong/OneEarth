import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import https from "node:https";
import {once} from "node:events";
import {randomUUID} from "node:crypto";
import {mkdtemp,writeFile,rm,readFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {EventSchema} from "@ag-ui/core/schemas";
import {postgresTaskStore} from "./postgres-task-store";
import {productDatabase} from "./product-database";
import {agUiWorkbench} from "./ag-ui-workbench";
import {prepareRuntimeChat} from "./runtime-chat-turn";
import {taskRoutes} from "./task-store";
import {closeRuntimeModelCapacity} from "./runtime-model-capacity";
import {emptyFilters} from "../src/domain/spatial";
import type {RuntimeServices} from "./runtime-turn";

const fixture=process.env.ONEEARTH_AGUI_TEST_DATABASE_URL;
const latch=()=>{let resolve!:()=>void;const promise=new Promise<void>(done=>resolve=done);return {promise,resolve};};
const frame=(type:string,sequence_number:number,extra:Record<string,unknown>={})=>"data: "+JSON.stringify({type,sequence_number,item_id:"public-message",output_index:0,content_index:0,...extra})+"\n\n";
async function* events(response:globalThis.Response){assert.equal(response.status,200);assert.match(response.headers.get("content-type")||"",/text\/event-stream/);let pending="";for await(const bytes of response.body as any){pending+=Buffer.from(bytes).toString("utf8");for(;;){const index=pending.indexOf("\n\n");if(index<0)break;const record=pending.slice(0,index);pending=pending.slice(index+2);if(record.startsWith("data: "))yield EventSchema.parse(JSON.parse(record.slice(6)));}}assert.equal(pending,"");}

test("native AG-UI normal HTTP + PG + pinned public Flash text: incremental, attributed, cancelled and read-only after disconnect",{skip:!fixture,timeout:25000},async t=>{
 assert.ok(fixture);assert.match(new URL(fixture).pathname,/native_agui.*module_runtime/);
 const old={runtime:process.env.ONEEARTH_RUNTIME_DATABASE_URL,key:process.env.DEEPSEEK_API_KEY,request:https.request,path:process.env.PATH};
 process.env.ONEEARTH_RUNTIME_DATABASE_URL=fixture;process.env.DEEPSEEK_API_KEY="CONTROLLED_NON_SECRET_KEY";
 const tasks=await postgresTaskStore("runtime"),audit=productDatabase("RUNTIME");let calls=0,mode="plain",mismatchResponses=0,hold=latch();const inputs:string[]=[];
 const upstream=http.createServer(async(req,res)=>{let raw="";for await(const part of req)raw+=part;const wire=JSON.parse(raw),prompt=wire.input.find((m:any)=>m.role==="user").content[0].text as string;inputs.push(prompt);calls++;
  assert.deepEqual(wire.tools,[]);assert.equal(wire.tool_choice,"none");assert.equal(wire.store,false);res.writeHead(200,{"Content-Type":"text/event-stream"});
  const planning=prompt.includes('输出唯一decide分支');
  if(planning){let targets:string[]=[];if(mode==="cited"||mode==="prefix-mismatch"){const payload=JSON.parse(prompt.slice(prompt.lastIndexOf("\n")+1));const target=payload.availableTargets.find((entry:any)=>entry.key==="web:https://example.org/saved-source");assert.ok(target);targets=[target.key];}
   const answer=JSON.stringify({decide:{kind:"respond",reply:null,targets}});res.end(frame("response.output_text.delta",0,{delta:answer})+frame("response.output_text.done",1,{text:answer})+frame("response.completed",2,{response:{status:"completed"}}));return;
  }
  const sourced=mode==="cited"||mode==="prefix-mismatch";
  if(mode==="prefix-mismatch")mismatchResponses++;
  const message=mode==="prefix-mismatch"?(mismatchResponses===1?"已保存的资料记载这一事实。[S1]\n\n本轮已下载原始数据文件。":"根据现有片段，这一事实可确认。[S1]"):sourced?"已保存的资料记载这一事实。[S1]\n\n这是此前已读片段，不是本轮重新查获。":"这是一般说明。\n\n正文继续，未执行外查或界面动作。";
  const answer=sourced?JSON.stringify({message,sections:[],limitation:"",followUp:"",researchNotes:[],calculationRequests:[]}):message;
  if(mode==="prefix-mismatch"&&mismatchResponses>1){res.end(frame("response.output_text.delta",0,{delta:answer})+frame("response.output_text.done",1,{text:answer})+frame("response.completed",2,{response:{status:"completed"}}));return;}
  const cut=sourced?answer.indexOf("\\n\\n")+4:message.indexOf("\n\n")+2;
  res.write(frame("response.reasoning_text.delta",0,{delta:"NOT_A_PUBLIC_ANSWER"}));res.write(frame("response.output_text.delta",1,{delta:answer.slice(0,cut)}));
  await hold.promise;if(res.destroyed)return;res.end(frame("response.output_text.delta",2,{delta:answer.slice(cut)})+frame("response.output_text.done",3,{text:answer})+frame("response.completed",4,{response:{status:"completed"}}));
 });upstream.listen(0,"127.0.0.1");await once(upstream,"listening");const upstreamAddress=upstream.address();assert.ok(upstreamAddress&&typeof upstreamAddress!=="string");
 https.request=((options:any,callback:any)=>{assert.equal(options.hostname,"api.deepseek.com");assert.equal(options.path,"/responses");return http.request({...options,protocol:"http:",hostname:"127.0.0.1",port:upstreamAddress.port},callback);}) as typeof https.request;
 const services={tasks,push:{latest:()=>({records:[]})},coverage:async()=>undefined,researchRegionService:{locate:async()=>null},adminBoundaryDir:"",canonicalCache:new Map()} as unknown as RuntimeServices;
 const app=express();app.use(express.json());const native=await agUiWorkbench(app,tasks,(id,body)=>prepareRuntimeChat(services,id,body,c=>tasks.chat.latestCompleted(c),{publicAnswer:true}));
 taskRoutes(app,"/api/tasks",tasks,()=>undefined,{researchRecords:true,onCancelled:id=>native.cancel(id)});
 const server=app.listen(0,"127.0.0.1");await once(server,"listening");const address=server.address();assert.ok(address&&typeof address!=="string");const base="http://127.0.0.1:"+address.port;
 t.after(async()=>{hold.resolve();await native.close();server.closeAllConnections();upstream.closeAllConnections();await Promise.all([new Promise<void>(r=>server.close(()=>r())),new Promise<void>(r=>upstream.close(()=>r()))]);await closeRuntimeModelCapacity();await tasks.close();await audit.end();https.request=old.request;if(old.path===undefined)delete process.env.PATH;else process.env.PATH=old.path;for(const [key,value] of [["ONEEARTH_RUNTIME_DATABASE_URL",old.runtime],["DEEPSEEK_API_KEY",old.key]])if(value===undefined)delete process.env[key!];else process.env[key!]=value;});
 const thread=randomUUID(),context={filters:emptyFilters(),caseId:null,selection:null,citation:null,gridSystem:"h3",layer:"all",camera:{center:[0,0],zoom:1,reason:"controlled"}},config={executor:"codex",provider:"deepseek",model:"deepseek-flash"};
 const input=(query:string,id=randomUUID(),submission:Record<string,unknown>={})=>({protocolVersion:"1.0",runId:id,threadId:thread,messages:[{id:randomUUID(),role:"user",content:query}],tools:[],context:[],state:{},forwardedProps:{oneearth:{version:1,submission:{context,config,...submission}}}});
 const post=(body:unknown)=>fetch(base+"/api/ag-ui",{method:"POST",headers:{"Content-Type":"application/json",Accept:"text/event-stream"},body:JSON.stringify(body)});
 async function until(check:()=>Promise<boolean>){for(let i=0;i<100;i++){if(await check())return;await new Promise(r=>setTimeout(r,20));}assert.fail("original run did not settle");}
 const plain=input("说明一下当前界面。"),stream=events(await post(plain));const seen:any[]=[];
 for await(const event of stream){seen.push(event);if(event.type==="TEXT_MESSAGE_CONTENT"&&seen.filter(e=>e.type==="TEXT_MESSAGE_CONTENT").length===1){assert.equal((await tasks.get(plain.runId))?.status,"running");assert.equal(calls,2);assert.equal((await post(plain)).status,409);hold.resolve();}}
 assert.equal(seen[0].type,"RUN_STARTED");assert.equal(seen.at(-1).type,"RUN_FINISHED");assert.equal(seen.filter(e=>e.type==="TEXT_MESSAGE_START").length,1);assert.equal(seen.filter(e=>e.type==="TEXT_MESSAGE_END").length,1);
 const text=seen.filter(e=>e.type==="TEXT_MESSAGE_CONTENT").map(e=>e.delta).join("");const record=await (await fetch(base+"/api/tasks/"+plain.runId+"/record")).json();assert.equal(record.id,plain.runId);assert.equal(record.turnId,plain.messages[0].id);assert.equal(record.conversationId,thread);assert.equal(record.result.message,text);assert.equal(seen.at(-1).result.oneearth.response.message,text);assert.equal(seen.at(-1).result.oneearth.messageId,plain.runId);assert.doesNotMatch(JSON.stringify(seen),/NOT_A_PUBLIC_ANSWER|"decide"|CONTROLLED_NON_SECRET_KEY|skills_instructions|environment_context/);
 assert.equal((await post(plain)).status,409);assert.equal(calls,2);assert.equal((await post({...plain,messages:[{...plain.messages[0],content:"another input"}]})).status,409);
 const bad=input("invalid");bad.forwardedProps.oneearth.submission.context={} as any;assert.equal((await post(bad)).status,400);assert.equal(await tasks.get(bad.runId),undefined);assert.equal(calls,2);
 // Same backend, explicitly saved original source. No new reading or discovery.
 const parent=randomUUID();await tasks.submit(parent,{query:"原材料",conversationId:thread,turnId:randomUUID(),context,config,history:[]});await tasks.finish(parent,"complete",{result:{message:"原记录已有这一事实。〔1〕",answerNotes:{references:[{kind:"web",url:"https://example.org/saved-source",title:"Saved source",sourceChannel:"web"}],webSources:[{url:"https://example.org/saved-source",title:"Saved source",snippet:"",pageExcerpt:"原记录已有这一事实。",stage:"page-excerpt",readAt:"2026-11-25T00:00:00Z"}]},conversationEvidence:[{url:"https://example.org/saved-source",title:"Saved source",excerpt:"原记录已有这一事实。",stage:"page-excerpt",readAt:"2026-11-25T00:00:00Z"}]}});
 mode="cited";hold=latch();const cited=input("依据已保存资料说明这一点并给出处。",randomUUID(),{previousTaskId:parent}),citedEvents:any[]=[];
 for await(const event of events(await post(cited))){citedEvents.push(event);if(event.type==="TEXT_MESSAGE_CONTENT"&&citedEvents.filter(e=>e.type==="TEXT_MESSAGE_CONTENT").length===1){assert.equal((await tasks.get(cited.runId))?.status,"running");hold.resolve();}}
 assert.equal(citedEvents.at(-1).type,"RUN_FINISHED",JSON.stringify(citedEvents));const citedRecord=await(await fetch(base+"/api/tasks/"+cited.runId+"/record")).json();assert.equal(citedRecord.result.answerNotes.references[0].url,"https://example.org/saved-source");assert.equal(citedEvents.filter(e=>e.type==="TEXT_MESSAGE_CONTENT").map(e=>e.delta).join(""),citedRecord.result.message);assert.equal(calls,4);
 // The first cited prefix passes local validation, but a later unsupported file claim
 // requires a different repaired final draft. Preserve evidence; never call that run success.
 mode="prefix-mismatch";hold=latch();const mismatch=input("依据已保存片段作答。",randomUUID(),{previousTaskId:parent}),mismatchEvents:any[]=[];
 for await(const event of events(await post(mismatch))){mismatchEvents.push(event);if(event.type==="TEXT_MESSAGE_CONTENT")hold.resolve();}
 assert.equal(mismatchEvents.at(-1).type,"RUN_ERROR");assert.equal(mismatchEvents.filter(e=>e.type==="RUN_ERROR").length,1);assert.ok(!mismatchEvents.some(e=>e.type==="RUN_FINISHED"));assert.equal((await tasks.get(mismatch.runId))?.status,"failed");
 const retained=await(await fetch(base+"/api/tasks/"+mismatch.runId+"/record")).json();assert.equal(retained.result.answerNotes.references[0].url,"https://example.org/saved-source");assert.match(retained.result.message,/根据现有片段/u);assert.doesNotMatch(JSON.stringify(mismatchEvents),/已下载原始数据文件/u);assert.equal(mismatchResponses,2);
 mode="plain";hold=latch();const cancelled=input("先说明，随后取消。"),cancelEvents:any[]=[];
 for await(const event of events(await post(cancelled))){cancelEvents.push(event);if(event.type==="TEXT_MESSAGE_CONTENT"){const deletes=await Promise.all([0,1,2].map(()=>fetch(base+"/api/tasks/"+cancelled.runId,{method:"DELETE"})));assert.deepEqual(deletes.map(reply=>reply.status).sort(),[204,409,409]);hold.resolve();}}
 assert.deepEqual(cancelEvents.at(-1).outcome,{type:"cancelled"});assert.equal(cancelEvents.filter(e=>e.type==="RUN_FINISHED"||e.type==="RUN_ERROR").length,1);assert.equal((await tasks.get(cancelled.runId))?.status,"cancelled");
 hold=latch();const disconnected=input("断流后只读原运行。"),response=await post(disconnected);const reader=response.body!.getReader();await reader.read();await reader.cancel();hold.resolve();await until(async()=>(await tasks.get(disconnected.runId))?.status==="complete");const before=calls;assert.equal((await post(disconnected)).status,409);assert.equal(calls,before);assert.equal((await fetch(base+"/api/tasks/"+disconnected.runId)).status,200);
 // A different explicitly selected executor keeps its original structured route.
 const dir=await mkdtemp(path.join(tmpdir(),"oe-agui-cli-")),cliLog=path.join(dir,"calls");
 try{await writeFile(path.join(dir,"codex"),"#!"+process.execPath+"\nimport fs from 'node:fs';for await(const _ of process.stdin){}fs.appendFileSync("+JSON.stringify(cliLog)+",'call\\n');process.stdout.write(JSON.stringify({decide:{kind:'respond',reply:'保留原执行器的正常答复。',targets:[]}}));",{mode:0o700});process.env.PATH=dir+path.delimiter+(old.path||"");const nonFlash=input("原执行器一般说明。",randomUUID(),{config:{executor:"codex",model:"gpt-6-luna"}}),count=calls,oldEvents=[];
  for await(const event of events(await post(nonFlash)))oldEvents.push(event);assert.equal(oldEvents.at(-1)?.type,"RUN_FINISHED");assert.equal(calls,count);assert.equal((await readFile(cliLog,"utf8")).trim(),"call");
 }finally{await rm(dir,{recursive:true,force:true});process.env.PATH=old.path;}
 console.log(JSON.stringify({nativeProtocol:"1.0",plainIncrementalBeforeProviderCompleted:true,citedIncrementalAndVerifiedRecord:true,planningNeverStreamed:true,disconnectionDoesNotRerun:true,cancellationSingleTerminal:true,originalTaskIdentity:true,prefixMismatchFailedWithVerifiedRecord:true,nonFlashCliPreserved:true,parallelRepeatedDeleteSingleEnding:true,providerCalls:calls}));
});
