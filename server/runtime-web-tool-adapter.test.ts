import assert from "node:assert/strict";
import test from "node:test";
import {randomUUID} from "node:crypto";
import {parseWebToolCall,parseWebToolOperation,webToolHit,type WebToolOperation} from "./web-tool-contract";
import {runWebTool,webToolFailure} from "./runtime-web-tool-adapter";
import type {SourceRequest} from "./source-fetch";

const target="https://archive.example.com/datasets/forest";
const hit={title:"Forest catalogue",url:target,snippet:"Stable source identity"};
const page=(url:string):WebToolOperation=>({kind:"fetch",provider:"原站读取",url,hit});
const active=()=>new AbortController().signal;

test("web capability call accepts only typed bounded operations and public source identities",()=>{
  const call={taskId:randomUUID(),messageId:randomUUID(),callId:randomUUID(),operation:page(target)};
  assert.deepEqual(parseWebToolCall(call),call);
  assert.equal(parseWebToolCall({...call,model:"discovery model"}),undefined);
  assert.equal(parseWebToolCall({...call,callId:"unstable"}),undefined);
  assert.equal(parseWebToolOperation(page("http://127.0.0.1/internal")),undefined);
  assert.equal(parseWebToolOperation(page(target+"?api_key=credential")),undefined);
  assert.equal(parseWebToolOperation({...page(target),hit:{...hit,pageExcerpt:"archived, not a fresh read"}}),undefined);
  const focused=webToolHit({...hit,pageExcerpt:"archived, not a fresh read",sourceTurn:1,previousRead:true});
  assert.equal(focused.pageExcerpt,undefined);
  assert.equal(focused.previousRead,undefined);
  assert.ok(parseWebToolOperation({kind:"search",provider:"Bing",query:"x".repeat(160)}));
  assert.equal(parseWebToolOperation({kind:"search",provider:"DataCite",query:"x".repeat(81)}),undefined);
});

test("the adapter calls the selected transport and returns the actual citation and bounded excerpt",async()=>{
  const calls:string[]=[];
  const fetchImpl:typeof fetch=async address=>{
    const url=new URL(String(address));calls.push(url.hostname);
    assert.equal(url.searchParams.get("q"),"forest canopy");
    return new Response(`<rss><channel><item><title>Forest canopy catalogue</title><link>${target}</link><description>Forest canopy metadata</description></item></channel></rss>`);
  };
  const sources=await runWebTool({kind:"search",provider:"Bing",query:"forest canopy"},active(),{fetchImpl});
  assert.deepEqual(sources.hits.map(h=>h.url),[target]);
  const sourceRequest:SourceRequest=async(url,signal)=>{
    signal.throwIfAborted();calls.push(url.href);
    return {url:url.href,status:200,headers:{"content-type":"text/plain"},bytes:Buffer.from("Forest canopy. The official record describes a versioned canopy height product."),truncated:false};
  };
  const read=await runWebTool({kind:"fetch",provider:"原站读取",url:target,hit:sources.hits[0]},active(),{sourceRequest});
  assert.deepEqual(calls,["www.bing.com",target]);
  assert.equal(read.requestUrl,target);
  assert.match(read.hits[0].pageExcerpt!,/versioned canopy height/);
});

test("invalid native authority and upstream failure stay failures without an alternate source",async()=>{
  await assert.rejects(runWebTool({kind:"native-search",queries:["forest"]},active()),error=>{
    assert.equal(webToolFailure(error).code,"WEB_NATIVE_NOT_AUTHORIZED");return true;
  });
  const calls:string[]=[];
  const fetchImpl:typeof fetch=async address=>{
    calls.push(String(address));
    return new Response("",{status:503});
  };
  await assert.rejects(runWebTool({kind:"search",provider:"Bing",query:"forest"},active(),{fetchImpl}),/HTTP 503/);
  assert.equal(calls.length,1);
});
