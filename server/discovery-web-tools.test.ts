import assert from "node:assert/strict";
import {randomBytes,randomUUID} from "node:crypto";
import {once} from "node:events";
import {createServer,type ServerResponse} from "node:http";
import test, {type TestContext} from "node:test";
import {discoveryWebTools} from "./discovery-web-tools";
import {searchSources} from "./web-search";
import {readTurnSource} from "./turn-reading";
import {parseWebToolCall,webToolPath,type WebToolCall,type WebToolReceipt} from "./web-tool-contract";
import {prepareSourceRead} from "./discovery-material-operations";
import {discoveryInput} from "./discovery-input";
import {discoveryConfiguration} from "./discovery-config";
import type {DiscoveryInput} from "./discovery-contract";
import type {WebHit} from "../src/domain/types";

const hit:WebHit={url:"https://example.test/orbit",title:"Satellite orbit archive",snippet:"Satellite orbit data and observation times."};
const grant=()=>randomBytes(32).toString("base64url");
const identity=()=>({taskId:randomUUID(),messageId:randomUUID()});

type FixtureReply = WebToolReceipt | string | ((res:ServerResponse,status:number)=>void);
async function fixture(t:TestContext,reply:(call:WebToolCall,attempt:number)=>[number,FixtureReply]) {
  const binding=identity(), secret=grant(), calls:WebToolCall[]=[], attempts=new Map<string,number>();
  const server=createServer(async (req,res)=>{
    try{
      assert.equal(req.method,"POST");
      assert.equal(req.url,webToolPath);
      assert.equal(req.headers.authorization,"Bearer "+secret);
      let raw="";
      for await(const data of req)raw+=data;
      assert.ok(!raw.includes(secret));
      const call=parseWebToolCall(JSON.parse(raw)); assert.ok(call);
      assert.equal(call.taskId,binding.taskId);
      assert.equal(call.messageId,binding.messageId);
      const attempt=(attempts.get(call.callId)??0)+1;attempts.set(call.callId,attempt);
      calls.push(call);
      const [status,receipt]=reply(call,attempt);
      if (typeof receipt === "function") return receipt(res,status);
      res.writeHead(status,{"Content-Type":"application/json"});
      res.end(typeof receipt === "string" ? receipt : JSON.stringify(receipt));
    }catch(error){
      t.diagnostic(error instanceof Error?error.message:String(error));
      res.writeHead(500).end();
    }
  }).listen(0,"127.0.0.1");
  await once(server,"listening");
  t.after(()=>{server.closeAllConnections();server.close();});
  const address=server.address();assert.ok(address&&typeof address!=="string");
  return {base:"http://127.0.0.1:"+address.port,binding,secret,calls,attempts};
}

test("discovery keeps staged keyword choices and reads the selected hit via a receipt on the accepted task",async t=>{
  const f=await fixture(t,({operation},attempt)=>{
    if(attempt===1)return [425,{state:"pending"}];
    if(attempt===2)return [202,{state:"pending"}];
    if(operation.kind==="search")
      return [200,{state:"complete",value:{hits:operation.provider==="Bing"?[hit]:[]}}];
    assert.equal(operation.kind,"fetch");
    assert.equal(operation.provider,"DeepSeek Fetch");
    assert.equal(operation.url,hit.url);
    assert.ok(!operation.hit.pageExcerpt);
    return [200,{state:"complete",value:{hits:[{...hit,pageExcerpt:"Fixture excerpt"}]}}];
  });
  const signal=new AbortController().signal;
  const tools=discoveryWebTools(f.base,f.binding,f.secret,true);
  const queries=[{web:"satellite orbit archive",dataset:"satellite orbit"}];
  const forbidden=()=>{assert.fail("direct web tool called");};
  const options={tools,fetchImpl:forbidden,nativeSearch:forbidden,archiveRead:forbidden,originRead:forbidden,
    deepseekTools:{search:true,fetch:true}};
  const first=await searchSources(queries,signal,()=>{}, {...options,readPages:false});
  assert.deepEqual(first.map(run=>run.engine).sort(),["Bing","DataCite","DeepSeek Search"]);
  const complete=await searchSources(queries,signal,()=>{}, {...options,initialRuns:first});
  assert.equal(complete.find(run=>run.engine==="DeepSeek Fetch")?.hits[0].pageExcerpt,"Fixture excerpt");
  assert.equal(f.attempts.size,4);
  for(const group of f.calls){const same=f.calls.filter(call=>call.callId===group.callId);assert.equal(same.length,3);assert.deepEqual(same,[group,group,group]);}
  assert.ok(!JSON.stringify(complete).includes(f.secret));
});

test("exact URL reads keep the selected PDF page and same-address origin fallback",async t=>{
  const pdf="https://example.test/content.pdf#page=7";
  const f=await fixture(t,({operation})=>{
    assert.equal(operation.kind,"fetch");
    if(operation.provider==="DeepSeek Fetch"){
      assert.equal(operation.fresh,true);
      assert.equal(operation.url,hit.url);
      return [200,{state:"failed",error:{message:"Fixture provider denied",status:403,stopBatch:true}}];
    }
    assert.equal(operation.url,operation.provider==="PDF 原文"?pdf:hit.url);
    if(operation.provider==="PDF 原文"){
      assert.equal(operation.focus,"核对方法 第 7 页");
      assert.equal(operation.question,"核对方法");
    }else assert.equal(operation.provider,"原站读取");
    return [200,{state:"complete",value:{requestUrl:operation.url,warning:"partial",hits:[{...hit,url:operation.url,pageExcerpt:"Fixture text"}]}}];
  });
  const tools=discoveryWebTools(f.base,f.binding,f.secret,false);
  const signal=new AbortController().signal;
  const got=await readTurnSource({...hit,discoveredBy:"user"},"核对方法",signal,true,tools);
  assert.equal(got.engine,"原站读取");
  assert.equal(got.fetchIssue,"Fixture provider denied");
  assert.equal(got.requestUrl,hit.url);
  const document=await readTurnSource({title:"Methods",url:pdf},"核对方法",signal,false,tools);
  assert.equal(document.requestUrl,pdf);
  assert.equal(document.engine,"PDF 原文");
  assert.equal(f.calls.length,3);
});

test("runtime failure preserves a retrieved search hit and missing grant cannot reach any network transport",async t=>{
  let direct=0;
  const forbidden=()=>{direct++;assert.fail("network reached without a grant");};
  const keys=[{web:"satellite orbit archive",dataset:"satellite orbit"}];
  const signal=new AbortController().signal;
  const unavailable=discoveryWebTools("http://127.0.0.1:1",identity(),undefined,false,forbidden);
  const without=await searchSources(keys,signal,()=>{},{tools:unavailable,fetchImpl:forbidden,deepseekTools:{search:true,fetch:true}});
  assert.deepEqual(without.map(run=>run.status),["failed","failed","failed","failed"]);
  await assert.rejects(readTurnSource({title:hit.title,url:hit.url},"Question",signal,true,unavailable),/不可用/);
  assert.equal(direct,0);

  const first=grant();
  const fixtureGrant=await fixture(t,({operation})=>operation.kind==="search"
    ? [200,{state:"complete",value:{hits:operation.provider==="Bing"?[hit]:[]}}]
    : [200,{state:"failed",error:{message:"Fetch unavailable",stopBatch:true,status:429}}]);
  const tools=discoveryWebTools(fixtureGrant.base,fixtureGrant.binding,fixtureGrant.secret,false);
  const runs=await searchSources(keys,signal,()=>{},{tools,deepseekTools:{search:false,fetch:true}});
  assert.deepEqual(runs.find(run=>run.engine==="Bing")?.hits,[hit]);
  assert.equal(runs.find(run=>run.engine==="DeepSeek Fetch")?.status,"failed");
  assert.ok(fixtureGrant.calls.every(({operation})=>operation.kind!=="fetch" || operation.provider==="DeepSeek Fetch"));

  const current=grant(), parent=identity(), original:Omit<DiscoveryInput,"config">={
    query:"固定查找",scope:{filters:{need:-1,type:"",source:"",place:"",period:null,depth:null,maxDem:null},selection:null,caseId:null,citation:null},
    history:[],references:[],currentDatasets:[],runtimeWebToolGrant:first,deepseekTools:{search:false,fetch:false},
  };
  const config=discoveryConfiguration({ONEEARTH_DISCOVERY_CHAT_MODEL:'{"executor":"codex","model":"gpt-6-luna"}'});
  assert.equal(config.kind,"configured");
  if(config.kind!=="configured")return;
  const preparation=discoveryInput({
    get:async()=>({body:JSON.stringify({...original,config:config.model}),id:parent.messageId,fingerprint:"fixture",status:"complete",created:0,updated:0}),
    terminal:async()=>({id:parent.messageId,at:0,seq:12,result:{clarification:"scope?"}}),
  },config,{hasJob:async()=>false,progress:async()=>undefined});
  const reply={continuedFrom:parent.taskId,clarificationReply:{text:"继续查找",afterSeq:12}};
  const waiting={id:parent.taskId,jobId:parent.messageId,waitingSeq:12};
  const none=await preparation.a2a(reply,waiting);
  const withNew=await preparation.a2a({...reply,runtimeWebToolGrant:current},waiting);
  assert.ok("body" in none && none.body && !("runtimeWebToolGrant" in none.body));
  assert.ok("body" in withNew && withNew.body && withNew.body.runtimeWebToolGrant===current);
  assert.ok("issue" in await preparation.a2a({...reply,runtimeWebToolGrant:"invalid"},waiting));
  const exact=prepareSourceRead({question:"Question",targets:[{kind:"web",url:hit.url,title:hit.title}],runtimeWebToolGrant:current},false);
  assert.ok("body" in exact && exact.body.input.runtimeWebToolGrant===current);
});

test("native and Zenodo paths also use the runtime; cancellation stops a pending call",async t=>{
  const zenodo={url:"https://zenodo.org/records/123",title:"Zenodo fixture",snippet:"Official archive",doi:"10.5281/zenodo.123"};
  const attachment={...zenodo,url:"https://zenodo.org/api/records/123/files/report.pdf/content",title:"Report PDF"};
  const cancel=new AbortController();
  const f=await fixture(t,({operation})=>{
    if(operation.kind==="search"){
      if(operation.query==="cancel this lookup"){
        cancel.abort(new Error("fixture stopped"));
        return [202,{state:"pending"}];
      }
      return [200,{state:"complete",value:{hits:[]}}];
    }
    if(operation.kind==="native-search")return [200,{state:"complete",value:{hits:[],queries:operation.queries}}];
    if(operation.provider==="Zenodo 索引"){
      assert.equal(operation.url,zenodo.url);
      return [200,{state:"complete",value:{hits:[{...zenodo,pageExcerpt:"Fixture manifest"}],attachmentTargets:[attachment]}}];
    }
    assert.equal(operation.provider,"PDF 原文");
    assert.equal(operation.url,attachment.url);
    return [200,{state:"complete",value:{requestUrl:attachment.url,warning:"Pages only",hits:[{...attachment,pageExcerpt:"Fixture PDF excerpt"}]}}];
  });
  const tools=discoveryWebTools(f.base,f.binding,f.secret,true);
  const runs=await searchSources([{web:"Zenodo archive",dataset:"Zenodo archive"}],new AbortController().signal,()=>{},{
    tools,archiveQuestion:"核对 https://zenodo.org/records/123 的 report.pdf",deepseekTools:{search:false,fetch:true},
  });
  assert.ok(f.calls.some(call=>call.operation.kind==="native-search"));
  assert.ok(f.calls.some(call=>call.operation.kind==="fetch"&&call.operation.provider==="Zenodo 索引"));
  assert.ok(runs.some(run=>run.engine==="PDF 原文"&&run.hits.some(value=>value.pageExcerpt==="Fixture PDF excerpt")));
  await assert.rejects(tools.search("Bing","cancel this lookup",cancel.signal),/fixture stopped/);
  assert.equal(f.calls.filter(call=>call.operation.kind==="search"&&call.operation.query==="cancel this lookup").length,1);
});

test("web search without an explicit tool or test transport fails before dispatch",async t=>{
  const globalFetch=t.mock.method(globalThis,"fetch",async()=>{throw Error("unexpected global fetch");});
  let nativeCalls=0;
  const nativeSearch=async()=>{nativeCalls++;return {hits:[],queries:[]};};
  await assert.rejects(searchSources([{web:"satellite orbit",dataset:"satellite orbit"}],
    new AbortController().signal,()=>{},{nativeSearch}),/未配置公开网络检索工具/);
  assert.equal(globalFetch.mock.callCount(),0);
  assert.equal(nativeCalls,0);
});

test("runtime transport preserves rate limit and unavailability status without exposing the response body",async t=>{
  const f=await fixture(t,({operation})=>{
    assert.equal(operation.kind,"search");
    return [operation.provider==="Bing"?429:503,{state:"failed",error:{message:"internal response details"}}];
  });
  const tools=discoveryWebTools(f.base,f.binding,f.secret,false);
  const signal=new AbortController().signal;
  await assert.rejects(tools.search("Bing","satellite orbit",signal),{message:"运行时公开网络工具不可用（HTTP 429）。"});
  await assert.rejects(tools.search("DataCite","satellite orbit",signal),{message:"运行时公开网络工具不可用（HTTP 503）。"});
  assert.equal(f.calls.length,2);
});

test("a truncated HTTP 200 body is replayed with the same accepted task and call ID",async t=>{
  const receipt={state:"complete",value:{hits:[hit]}} as const;
  const raw=JSON.stringify(receipt);
  let disconnect:()=>void=()=>assert.fail("response headers were not sent");
  const f=await fixture(t,(_call,attempt)=>{
    if (attempt>1)return [200,raw];
    return [200,(res,status)=>{
      res.writeHead(status,{"Content-Type":"application/json","Content-Length":Buffer.byteLength(raw)});
      res.write('{"state":');
      disconnect=()=>res.destroy();
    }];
  });
  let receivedHeaders=0;
  const transport:typeof fetch=async(input,init)=>{
    const response=await fetch(input,init);
    assert.equal(response.status,200);
    if (++receivedHeaders===1)disconnect();
    return response;
  };
  const tools=discoveryWebTools(f.base,f.binding,f.secret,false,transport);
  assert.deepEqual(await tools.search("Bing","satellite orbit",AbortSignal.timeout(3000)),receipt.value);
  assert.equal(receivedHeaders,2);
  assert.equal(f.calls.length,2);
  assert.deepEqual(f.calls[0],f.calls[1]);
});

test("complete malformed JSON and invalid receipt fields are not replayed",async t=>{
  const f=await fixture(t,({operation})=>{
    assert.equal(operation.kind,"search");
    return [200,operation.provider==="Bing" ? '{"state":' : '{"state":"complete","value":{"hits":42}}'];
  });
  const tools=discoveryWebTools(f.base,f.binding,f.secret,false);
  const signal=AbortSignal.timeout(3000);
  for (const provider of ["Bing","DataCite"] as const)
    await assert.rejects(tools.search(provider,"satellite orbit",signal),/没有返回有效的网络工具回执/);
  assert.equal(f.calls.length,2);
  assert.ok([...f.attempts.values()].every(count=>count===1));
});
