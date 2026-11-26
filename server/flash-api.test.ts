import test,{type TestContext} from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import https from "node:https";
import {once} from "node:events";
import {mkdtemp,writeFile,rm} from "node:fs/promises";
import path from "node:path";
import {tmpdir} from "node:os";
import {randomUUID} from "node:crypto";
import {runFlashApi,authorizedFlashApi} from "./flash-api";
import {createModelExecutor} from "./executor";
import {createModelService} from "./model-service";
import {modelExecutionContext} from "./model-execution-context";
import {openTaskStore} from "./task-store";
import type {ProviderReasoningSnapshot} from "../src/domain/types";
const frame=(type:string,seq:number,fields:Record<string,unknown>={})=>"data: "+JSON.stringify({type,sequence_number:seq,item_id:"one",output_index:0,content_index:0,...fields})+"\n\n";
async function upstream(t:TestContext,handler:http.RequestListener){const server=http.createServer(handler);server.listen(0,"127.0.0.1");await once(server,"listening");const address=server.address();assert.ok(address&&typeof address!=="string");t.after(async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));});return ((options:any,callback:any)=>{assert.equal(options.protocol,"https:");assert.equal(options.hostname,"api.deepseek.com");assert.equal(options.path,"/responses");assert.equal(options.headers["accept-encoding"],"identity");return http.request({...options,protocol:"http:",hostname:"127.0.0.1",port:address.port},callback);}) as typeof https.request;}
const success=(text:string)=>frame("response.output_text.delta",2,{delta:text})+frame("response.output_text.done",3,{text})+frame("response.completed",4,{response:{status:"completed"}});

test("server foreground Flash uses the pinned API with original prompt, public deltas and no CLI configuration",async t=>{
 const captured:any[]=[],values:ProviderReasoningSnapshot[]=[],prompt='原任务 '+JSON.stringify({history:'已核历史',decide:{kind:'clarify'}}),answer=JSON.stringify({decide:{kind:"clarify",question:"需要哪一项？",options:[]}});
 const transport=await upstream(t,async(req,res)=>{let text="";for await(const bytes of req)text+=bytes;captured.push(JSON.parse(text));assert.equal(req.headers.authorization,"Bearer CONTROLLED_KEY");res.writeHead(200,{"Content-Type":"text/event-stream"});res.write(frame("response.reasoning_text.delta",0,{delta:"公开说明。 "}));res.end(frame("response.reasoning_text.done",1,{text:"公开说明。 "})+success(answer));});
 const service=createModelService();service.setServiceKey({executor:"codex",provider:"deepseek",model:"deepseek-flash"},"CONTROLLED_KEY");
 const run=createModelExecutor(service.configureService,transport),tasks=openTaskStore(":memory:");t.after(()=>tasks.close());
 const out=await modelExecutionContext.run({role:"foreground",taskId:randomUUID(),tasks},()=>run({executor:"codex",provider:"deepseek",model:"deepseek-flash"},prompt,AbortSignal.timeout(3000),{providerReasoning:{taskId:"api-test",onSnapshot:v=>values.push(v)}}));
 assert.equal(out,answer);assert.equal(captured.length,1);assert.equal(captured[0].input[1].content[0].text,prompt);assert.deepEqual(captured[0].tools,[]);assert.equal(captured[0].store,false);assert.equal(captured[0].tool_choice,"none");assert.ok(values.some(v=>v.text.includes("公开说明")));assert.doesNotMatch(JSON.stringify(captured),/skills_instructions|environment_context|client_metadata|\/Users\//);
});

for(const scenario of ["status","disconnect","tool","compressed","bad-delta"] as const)test("one API attempt fails without retry or CLI fallback: "+scenario,async t=>{
 let count=0;const transport=await upstream(t,async(req,res)=>{count++;for await(const _ of req){}if(scenario==="status"){res.writeHead(429).end('DO_NOT_LOG_PROVIDER_BODY');return;}res.writeHead(200,{"Content-Type":"text/event-stream",...(scenario==="compressed"?{"Content-Encoding":"gzip"}:{})});if(scenario==="disconnect"){res.end(frame("response.output_text.delta",0,{delta:"Partial"}));return;}if(scenario==="tool"){res.end(frame("response.function_call_arguments.delta",0,{delta:'{"path":"HIDDEN"}'})+success("bad"));return;}if(scenario==="bad-delta"){res.end(frame("response.output_text.delta",0,{delta:null})+frame("response.completed",1));return;}res.end(success("compressed"));});
 await assert.rejects(runFlashApi("Only the original authorized task.","CONTROLLED_KEY",AbortSignal.timeout(3000),{transport}));assert.equal(count,1);
});

test("API cancellation cuts the current request and stops public display without retries",async t=>{
 let count=0;const values:ProviderReasoningSnapshot[]=[],controller=new AbortController();
 const transport=await upstream(t,async(req,res)=>{count++;for await(const _ of req){}res.writeHead(200,{"Content-Type":"text/event-stream"});res.write(frame("response.reasoning_text.delta",0,{delta:"已公开的说明。 "}));});
 const result=runFlashApi("Original scope.","CONTROLLED_KEY",controller.signal,{transport,reasoning:{taskId:"cancel",onSnapshot:v=>{values.push(v);controller.abort();}}});await assert.rejects(result);assert.equal(count,1);assert.ok(values.length);assert.ok(values.every(v=>!v.complete));
});

test("public configuration cannot disguise a custom local endpoint as the fixed Flash provider",()=>{
 assert.equal(authorizedFlashApi({executor:"claude",provider:"deepseek",model:"deepseek-flash"}),true);
 for(const endpoint of ["http://127.0.0.1:1","https://api.deepseek.com.evil.test","https://api.deepseek.com/other"])assert.equal(authorizedFlashApi({executor:"codex",provider:"custom",endpoint,model:"deepseek-flash"}),false);
});

test("normal background models still use one CLI spawn rather than the foreground API",async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),"oneearth-background-cli-")),prior=process.env.PATH;await writeFile(path.join(dir,"codex"),'#!/bin/sh\ncat >/dev/null\nprintf \'{"background":true}\'\n',{mode:0o700});process.env.PATH=dir+path.delimiter+(prior||"");t.after(async()=>{process.env.PATH=prior;await rm(dir,{recursive:true,force:true});});
 const tasks=openTaskStore(":memory:");t.after(()=>tasks.close());const run=createModelExecutor(()=>{},(()=>assert.fail("no API transport")) as typeof https.request);
 assert.equal(await modelExecutionContext.run({role:"background",taskId:randomUUID(),tasks},()=>run({executor:"codex",model:"gpt-6-luna"},"Original background task.",AbortSignal.timeout(3000))),'{"background":true}');
});
