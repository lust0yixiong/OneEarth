import assert from "node:assert/strict";
import test from "node:test";
import {execFileSync} from "node:child_process";
import {mkdtempSync,rmSync} from "node:fs";
import path from "node:path";
import {randomUUID,createHash} from "node:crypto";
import {setTimeout as delay} from "node:timers/promises";
import {once} from "node:events";
import express from "express";
import {Pool} from "pg";
import {runtimeWebToolStore,WebToolAccessError,type WebGrantInput} from "./runtime-web-tool-store";
import {runtimeWebToolChannel} from "./runtime-web-tool-router";
import {webToolPath,type WebToolCall,type WebToolReceipt} from "./web-tool-contract";
import {postgresTaskStore} from "./postgres-task-store";
import {workTasks,type TaskStore} from "./task-store";
import {researchExecutor} from "./research-executor";
import type {DiscoveryBusinessInput} from "./discovery-a2a-client";
import {emptyFilters} from "../src/domain/spatial";
const pgBin=process.env.ONEEARTH_A2A_TEST_PG_BIN;
async function until(read:()=>boolean|Promise<boolean>,ms=6000){const start=Date.now();while(!await read()){if(Date.now()-start>ms)assert.fail("persistent web tool channel did not advance");await delay(15);}}
const operation={kind:"search" as const,provider:"Bing" as const,query:"NOAA wind dataset"};
const errorStatus=(status:number)=>(e:unknown)=>e instanceof WebToolAccessError&&e.status===status;

test("isolated PG runtime web receipts, authority, lifecycle and production-worker independence",{skip:!pgBin&&"set ONEEARTH_A2A_TEST_PG_BIN",timeout:45000},async t=>{
  assert.ok(pgBin);const dir=mkdtempSync("/tmp/oe-runtime-web-tools-"),data=path.join(dir,"pg"),old=process.env.ONEEARTH_RUNTIME_DATABASE_URL,oldDiscovery=process.env.ONEEARTH_DISCOVERY_URL;
  const pg=(command:string,args:string[])=>execFileSync(path.join(pgBin,command),args,{stdio:"pipe",encoding:"utf8"});let started=false;
  const closers:(()=>Promise<unknown>)[]=[];
  t.after(async()=>{for(const close of closers.reverse())await close();if(old===undefined)delete process.env.ONEEARTH_RUNTIME_DATABASE_URL;else process.env.ONEEARTH_RUNTIME_DATABASE_URL=old;
    if(oldDiscovery===undefined)delete process.env.ONEEARTH_DISCOVERY_URL;else process.env.ONEEARTH_DISCOVERY_URL=oldDiscovery;
    if(started)pg("pg_ctl",["-D",data,"-m","fast","-w","stop"]);rmSync(dir,{recursive:true,force:true});});
  pg("initdb",["-D",data,"-U","oneearth_fixture","-A","trust","--no-locale","--encoding=UTF8"]);
  pg("pg_ctl",["-D",data,"-l",path.join(dir,"postgres.log"),"-o",'-c listen_addresses= -k "'+dir+'"',"-w","start"]);started=true;
  const connectionString="postgresql://oneearth_fixture@localhost/postgres?host="+encodeURIComponent(dir);process.env.ONEEARTH_RUNTIME_DATABASE_URL=connectionString;
  const tasks=await postgresTaskStore("runtime");closers.push(()=>Promise.resolve(tasks.close()));
  const sql=new Pool({connectionString});closers.push(()=>sql.end());
  let now=Date.now();
  const authority=await runtimeWebToolStore({now:()=>now,ttlMs:1000,maxQueued:2,maxCallsPerGrant:128});closers.push(()=>authority.close());
  async function parent(){const id=randomUUID();await tasks.submit(id,{query:"controlled",conversationId:randomUUID()});assert.equal((await tasks.claim())?.id,id);return id;}
  function grantInput(researchTaskId:string,extra:Partial<WebGrantInput>={}):WebGrantInput{return {researchTaskId,messageId:randomUUID(),kind:"discovery",allowSearch:true,allowFetch:true,deepseekSearch:false,deepseekFetch:false,...extra};}
  const call=(g:WebGrantInput,taskId:string):WebToolCall=>({taskId,messageId:g.messageId,callId:randomUUID(),operation});
  async function authorized(extra:Partial<WebGrantInput>={}){const g=grantInput(await parent(),extra),token=await authority.reserve(g),taskId=randomUUID();await authority.bind(token,taskId);return {g,token,taskId};}

  await t.test("unbound receipt is 425; task/message identity and supplier permissions are checked before admission",async()=>{
    const g=grantInput(await parent()),token=await authority.reserve(g),taskId=randomUUID(),c=call(g,taskId);
    await assert.rejects(authority.request(token,c),errorStatus(425));await authority.bind(token,taskId);
    await assert.rejects(authority.request("x".repeat(43),c),errorStatus(403));await assert.rejects(authority.request(token,{...c,taskId:randomUUID()}),errorStatus(403));
    await assert.rejects(authority.request(token,{...c,messageId:randomUUID()}),errorStatus(403));await assert.rejects(authority.request(token,{...c,operation:{...operation,provider:"DeepSeek Search"}}),errorStatus(403));
    assert.deepEqual(await authority.request(token,c),{state:"pending"});assert.deepEqual(await authority.request(token,c),{state:"pending"});
    await assert.rejects(authority.request(token,{...c,operation:{...operation,query:"different"}}),errorStatus(409));
    const persisted=(await sql.query("SELECT * FROM runtime_web_tool_grants WHERE digest=$1",[createHash("sha256").update(token).digest("hex")])).rows[0];assert.ok(persisted);assert.ok(!JSON.stringify(persisted).includes(token));await authority.revoke(token);
  });
  await t.test("invalid queued calls are failed without execution and no longer occupy global budget after cancel or expiry",async()=>{
    for(const ending of ["cancel","expiry"]){
      const first=await authorized();await authority.request(first.token,call(first.g,first.taskId));await authority.request(first.token,call(first.g,first.taskId));
      const second=await authorized();await assert.rejects(authority.request(second.token,call(second.g,second.taskId)),errorStatus(429));
      if(ending==="cancel")await tasks.finish(first.g.researchTaskId,"cancelled",{code:"cancelled"});else now+=1001;
      // The second expiry grant must be recreated after the clock jump.
      const next=ending==="cancel"?second:await authorized();assert.deepEqual(await authority.request(next.token,call(next.g,next.taskId)),{state:"pending"});
      const rows=(await sql.query("SELECT state,receipt FROM runtime_web_tool_calls WHERE grant_digest=$1",[createHash("sha256").update(first.token).digest("hex")])).rows;
      assert.equal(rows.length,2);assert.ok(rows.every(r=>r.state==="failed"&&r.receipt.error.code==="WEB_TOOL_GRANT_ENDED"));await authority.revoke(next.token);await authority.revoke(second.token);
    }
  });
  await t.test("an exact URL grant allows normal origin/PDF with switches off but denies Search, DeepSeek and unrelated sources",async()=>{
    const f=await authorized({kind:"source-read",allowSearch:false,urls:["https://example.org/original.pdf"]});
    const base={kind:"fetch" as const,provider:"PDF 原文" as const,url:"https://example.org/original.pdf",hit:{url:"https://example.org/original.pdf",title:"Original",snippet:"Identity",doi:"10.1234/unapproved"}};
    const c={...call(f.g,f.taskId),operation:base};assert.deepEqual(await authority.request(f.token,c),{state:"pending"});
    const raw=(await sql.query("SELECT input FROM runtime_web_tool_calls WHERE call_id=$1",[c.callId])).rows[0].input;assert.equal(raw.operation.hit.doi,undefined);
    const scoped={...c,callId:randomUUID(),operation:{...base,locators:[{kind:"table" as const,value:"2"}]}};
    assert.deepEqual(await authority.request(f.token,scoped),{state:"pending"});
    const saved=(await sql.query("SELECT input FROM runtime_web_tool_calls WHERE call_id=$1",[scoped.callId])).rows[0].input;
    assert.deepEqual(saved.operation.locators,scoped.operation.locators);
    const open=await authorized();
    await assert.rejects(authority.request(open.token,{...call(open.g,open.taskId),operation:scoped.operation}),errorStatus(403));
    await authority.revoke(open.token);
    await assert.rejects(authority.request(f.token,{...c,callId:randomUUID(),operation}),errorStatus(403));await assert.rejects(authority.request(f.token,{...c,callId:randomUUID(),operation:{...base,provider:"DeepSeek Fetch"}}),errorStatus(403));
    await assert.rejects(authority.request(f.token,{...c,callId:randomUUID(),operation:{...base,provider:"Zenodo 索引"}}),errorStatus(403));
    await assert.rejects(authority.request(f.token,{...c,callId:randomUUID(),operation:{...base,url:"https://example.org/other.pdf"}}),errorStatus(403));await authority.revoke(f.token);
  });
  await t.test("restart marks a claimed uncertain call failed and never runs it again; queued work still runs once",async()=>{
    const f=await authorized(),c=call(f.g,f.taskId);await authority.request(f.token,c);const picked=await authority.claim();assert.equal(picked?.callId,c.callId);
    const apiStore=await runtimeWebToolStore({now:()=>now,maxQueued:2});closers.push(()=>apiStore.close());let executed=0;
    const channel=await runtimeWebToolChannel(apiStore,{run:async()=>{executed++;return {hits:[]};},pollMs:10});
    try{const previous=await authority.request(f.token,c);assert.equal(previous.state,"failed");if(previous.state==="failed")assert.equal(previous.error.code,"WEB_TOOL_OUTCOME_UNKNOWN");
      assert.equal(executed,0);const next={...c,callId:randomUUID()};await authority.request(f.token,next);await until(async()=>(await authority.request(f.token,next)).state==="complete");assert.equal(executed,1);
      await tasks.finish(f.g.researchTaskId,"complete",{result:{message:"completed"}});await assert.rejects(authority.request(f.token,next),errorStatus(403));
    }finally{await channel.close();await apiStore.close();closers.pop();}
  });
  await t.test("API polling never duplicates external work, canceled late results are not adopted, and capacity is real",async()=>{
    const apiStore=await runtimeWebToolStore({now:()=>now});let executed=0,active=0,peak=0,release!:()=>void;
    const paused=new Promise<void>(r=>{release=r;});
    const channel=await runtimeWebToolChannel(apiStore,{capacity:1,pollMs:10,run:async(_op,signal)=>{executed++;active++;peak=Math.max(peak,active);
      await Promise.race([paused,new Promise<void>((_r,reject)=>signal.addEventListener("abort",()=>reject(new DOMException("aborted","AbortError")),{once:true}))]);active--;return {hits:[{url:"https://example.org/source",title:"Saved",snippet:"actual"}]};}});
    const app=express();app.use(channel.router);const server=app.listen(0,"127.0.0.1");await once(server,"listening");const address=server.address();assert.ok(address&&typeof address!=="string");const origin="http://127.0.0.1:"+address.port;
    async function post(token:string,c:WebToolCall){const response=await fetch(origin+webToolPath,{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+token},body:JSON.stringify(c)});return {status:response.status,value:await response.json() as WebToolReceipt};}
    try{const f=await authorized(),c=call(f.g,f.taskId);assert.equal((await post(f.token,c)).status,202);await until(()=>executed===1);
      for(let i=0;i<4;i++)assert.equal((await post(f.token,c)).status,202);assert.equal(executed,1);
      await tasks.finish(f.g.researchTaskId,"cancelled",{code:"cancelled"});release();await until(async()=>!!(await sql.query("SELECT 1 FROM runtime_web_tool_calls WHERE call_id=$1 AND state='failed'",[c.callId])).rowCount);
      assert.equal((await post(f.token,c)).status,403);assert.equal(peak,1);const late=(await sql.query("SELECT receipt FROM runtime_web_tool_calls WHERE call_id=$1",[c.callId])).rows[0].receipt;assert.equal(late.state,"failed");assert.equal(late.value,undefined);
    }finally{release();await channel.close();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await apiStore.close();}
  });

  await t.test("the actual research worker can await A2A while the separate runtime API channel executes and returns its tool receipt",async()=>{
    const apiStore=await runtimeWebToolStore({now:()=>now}),received:any[]=[],roots=new Map<string,any>();let release!:()=>void,executions=0;
    const paused=new Promise<void>(r=>{release=r;});
    const channel=await runtimeWebToolChannel(apiStore,{capacity:1,pollMs:10,run:async()=>{executions++;await paused;return {hits:[{title:"Actual source",url:"https://example.org/actual",snippet:"actual search result"}]};}});
    const app=express();app.use(channel.router);app.use(express.json({type:["application/json","application/a2a+json"]}));let callback:Promise<void>|undefined;const errors:unknown[]=[];
    let origin="";
    app.post("/message:send",(req,res)=>{const message=req.body.message,input=message.parts[0].data.input;received.push(structuredClone(req.body));
      assert.equal(req.body.configuration.returnImmediately,true);const task={id:randomUUID(),contextId:randomUUID(),status:{state:"TASK_STATE_WORKING"},artifacts:[] as any[]};roots.set(task.id,task);res.json({task});
      callback=(async()=>{const call:WebToolCall={taskId:task.id,messageId:message.messageId,callId:randomUUID(),operation};let receipt:WebToolReceipt|undefined;
        for(let tries=0;tries<300;tries++){const response=await fetch(origin+webToolPath,{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+input.runtimeWebToolGrant},body:JSON.stringify(call)});
          if(response.status===425){await delay(10);continue;}assert.ok([200,202].includes(response.status));receipt=await response.json();if(receipt?.state!=="pending")break;await delay(10);}
        assert.equal(receipt?.state,"complete");task.artifacts.push({artifactId:"final",parts:[{data:{kind:"oneearth.discovery.event.v1",event:{seq:1,result:{plan:{dataQuestion:input.query},papers:[],haina:[],searches:[{engine:"Bing",query:operation.query,status:"done",hits:(receipt as any).value.hits}],sourceStatus:[],issues:[]}}}}]});task.status.state="TASK_STATE_COMPLETED";
      })().catch(error=>{errors.push(error);task.status.state="TASK_STATE_FAILED";});
    });
    app.get("/tasks/:id",(req,res)=>res.json(roots.get(req.params.id)));
    app.post(/^\/tasks\/([^/]+):subscribe$/,(req,res)=>{const task=roots.get(req.params[0]);res.type("text/event-stream");const send=()=>res.write("data: "+JSON.stringify({task})+"\n\n");send();const timer=setInterval(()=>{send();if(task.status.state!=="TASK_STATE_WORKING")res.end();},10);res.once("close",()=>clearInterval(timer));});
    const server=app.listen(0,"127.0.0.1");await once(server,"listening");const address=server.address();assert.ok(address&&typeof address!=="string");origin="http://127.0.0.1:"+address.port;process.env.ONEEARTH_DISCOVERY_URL=origin;
    const id=randomUUID(),messageId=randomUUID(),input:Omit<DiscoveryBusinessInput,"deepseekTools">={query:"查找NOAA风场资料",history:[],references:[],currentDatasets:[],scope:{filters:emptyFilters(),selection:null,caseId:null,citation:null}};
    await tasks.submit(id,{query:input.query});let maintenance=0,stop:(()=>Promise<void>)|undefined;
    try{stop=await workTasks(tasks,async(task,signal,emit)=>{if(task.id!==id)return {result:{message:"ordinary"}};
        const executor=researchExecutor({executor:"codex",model:"authorized"},{search:false,fetch:false},signal,{researchTaskId:id,authority});
        try{return {result:await executor.discover(messageId,input,event=>emit({...event}),{onAccepted:async binding=>{await tasks.append(id,{discoveryBinding:binding});}})};}finally{await executor.close();}
      },{maintenance:async()=>{maintenance++;}});
      await until(()=>executions===1);assert.equal((await tasks.get(id))?.status,"running");const mark=maintenance;
      const ordinary=randomUUID();await tasks.submit(ordinary,{query:"ordinary"});await delay(80);assert.equal((await tasks.get(ordinary))?.status,"queued");assert.equal(maintenance,mark,"parent workTasks poll is really waiting on A2A");
      release();await until(async()=>(await tasks.get(id))?.status==="complete");await until(async()=>(await tasks.get(ordinary))?.status==="complete");assert.deepEqual(errors,[]);assert.equal(executions,1);
      const token=received[0].message.parts[0].data.input.runtimeWebToolGrant;assert.ok(token);assert.ok(!JSON.stringify(await tasks.events(id,0)).includes(token));
      const grant=(await sql.query("SELECT * FROM runtime_web_tool_grants WHERE digest=$1",[createHash("sha256").update(token).digest("hex")])).rows[0];assert.equal(grant.discovery_id,[...roots.keys()][0]);assert.equal(grant.revoked,true);
      assert.equal(((await tasks.terminal(id))!.result as any).searches[0].hits[0].url,"https://example.org/actual");
    }finally{release();await stop?.();await callback;await channel.close();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await apiStore.close();}
  });
});
