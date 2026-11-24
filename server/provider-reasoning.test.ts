import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {ProviderReasoningObserver,providerReasoningArchive,providerReasoningLimits} from "./provider-reasoning";
import {publicFlashResponses,validProviderRequest} from "./provider-reasoning-relay";
import type {ProviderReasoningSnapshot} from "../src/domain/types";

function frame(type:string,sequence:number,fields:Record<string,unknown>={}){return Buffer.from("event: "+type+"\r\ndata: "+JSON.stringify({type,sequence_number:sequence,item_id:"public-item",output_index:0,content_index:0,summary_index:0,...fields})+"\r\n\r\n");}

test("only the named public text channels produce cumulative, deduplicated task/attempt snapshots",()=>{
 const snapshots:ProviderReasoningSnapshot[]=[],id=randomUUID()+":"+randomUUID()+":1",observer=new ProviderReasoningObserver(id,value=>snapshots.push(value));
 for(const [i,type] of ["response.created","response.output_item.added","response.output_text.delta","response.output_item.done"].entries())assert.equal(observer.feed(frame(type,i,{item:{type:"reasoning",content:[{text:"PRIVATE_ITEM_CONTENT"}],summary:[{text:"NESTED_NOT_SELECTED"}],encrypted_content:"ENCRYPTED_MUST_NOT_SHOW"},delta:"STDOUT_ANSWER_NOT_REASONING",text:"UNKNOWN_TEXT"})),true);
 assert.equal(snapshots.length,0);
 const one=frame("response.reasoning_text.delta",4,{delta:"先核对已提供的材料。"});
 for(let i=0;i<one.length;i++)assert.equal(observer.feed(one.subarray(i,i+1)),true);
 assert.equal(snapshots.length,1);assert.equal(snapshots[0].text,"先核对已提供的材料。");assert.equal(snapshots[0].kind,"deepseek-thinking");assert.ok(snapshots[0].id.startsWith(id+":"));
 observer.feed(frame("response.reasoning_text.delta",4,{delta:"DUPLICATE"}));
 observer.feed(frame("response.reasoning_text.done",5,{text:"先核对已提供的材料。"}));
 assert.equal(snapshots.length,2);assert.equal(snapshots[1].id,snapshots[0].id);assert.equal(snapshots[1].revision,2);assert.equal(snapshots[1].complete,true);assert.equal(snapshots[1].text,snapshots[0].text);
 observer.feed(frame("response.reasoning_summary_text.done",6,{text:"保留证据边界。"}));
 assert.equal(snapshots.at(-1)?.kind,"summary");assert.notEqual(snapshots.at(-1)?.id,snapshots[0].id);
 assert.doesNotMatch(JSON.stringify(snapshots),/PRIVATE_ITEM|ENCRYPTED|STDOUT|NESTED|UNKNOWN|DUPLICATE/);observer.close();
});

test("credentials and signed/private locators crossing every delta boundary are never exposed in an earlier snapshot",()=>{
 for(const raw of ["文档 https://example.org/a?id=42&amp;amp;sig=CONTROLLED_SIGNATURE 查看。","Authorization: Bearer CONTROLLED_BEARER 后续说明。","token=CONTROLLED_TOKEN 后续说明。","sk-controlled123456789 后续说明。","AKIA0123456789ABCDEF 后续说明。","参考 /private/var/example/report.pdf 然后继续。","-----BEGIN PRIVATE KEY-----\nCONTROLLED_PRIVATE_KEY\n-----END PRIVATE KEY----- 后续说明。"]){
  const values:ProviderReasoningSnapshot[]=[],observer=new ProviderReasoningObserver(randomUUID(),value=>values.push(value));let seq=0;
  for(const char of raw)observer.feed(frame("response.reasoning_text.delta",seq++,{delta:char}));
  observer.feed(frame("response.reasoning_text.done",seq,{text:raw}));
  for(const value of values)assert.doesNotMatch(value.text,/CONTROLLED|controlled123|AKIA012|\/private\/var|[?&](?:amp;)*sig=/u);
  assert.ok(values.length>0);assert.ok(values.at(-1)!.complete);observer.close();
 }
});

test("an unfinished secret tail stays buffered on cancellation, and a mismatched done cannot replace public text",()=>{
 const values:ProviderReasoningSnapshot[]=[],observer=new ProviderReasoningObserver(randomUUID(),value=>values.push(value));
 observer.feed(frame("response.reasoning_text.delta",0,{delta:"Safe start. https://example.org/a?sig=UNFINISHED_SECRET"}));
 observer.feed(frame("response.reasoning_text.done",1,{text:"A DIFFERENT FINAL TEXT"}));observer.close();
 assert.equal(values.length,1);assert.equal(values[0].text,"Safe start. ");assert.equal(values[0].complete,undefined);assert.doesNotMatch(JSON.stringify(values),/UNFINISHED|DIFFERENT/);
});

test("bounded public snapshots never borrow arbitrary tool or metadata payloads",()=>{
 const values:ProviderReasoningSnapshot[]=[],observer=new ProviderReasoningObserver(randomUUID(),value=>values.push(value));
 observer.feed(frame("response.reasoning_text.delta",0,{delta:"已核材料。".repeat(3000)}));
 assert.ok(values.length>1);assert.ok(values.every(value=>Buffer.byteLength(value.text)<=providerReasoningLimits.textBytes));assert.equal(values[0].complete,undefined);
 assert.equal(observer.feed(frame("response.output_item.added",1,{item:{type:"function_call",name:"view_image",arguments:'{"path":"PRIVATE_TOOL_ARGUMENT"}'}})),false);assert.doesNotMatch(JSON.stringify(values),/PRIVATE_TOOL_ARGUMENT/);observer.close();
 const tooLarge=new ProviderReasoningObserver(randomUUID(),()=>assert.fail("no completed allowed frame"));assert.equal(tooLarge.feed(Buffer.alloc(providerReasoningLimits.frameBytes+1,65)),true);assert.equal(tooLarge.feed(Buffer.from("\n\n")),true);assert.equal(tooLarge.feed(frame("response.output_item.added",2,{item:{type:"function_call",name:"view_image"}})),false);tooLarge.close();
});

test("18201 public deltas and a large final response retain the complete tail without stopping the normal answer",()=>{
 const values:ProviderReasoningSnapshot[]=[],observer=new ProviderReasoningObserver(randomUUID(),value=>values.push(value));let raw="";
 for(let i=0;i<18201;i++){const text=i===18200?"最终公开尾段。":"公开片段。";raw+=text;assert.equal(observer.feed(frame("response.reasoning_text.delta",i,{delta:text})),true);}
 assert.equal(observer.feed(frame("response.reasoning_text.done",18201,{text:raw})),true);
 assert.equal(observer.feed(frame("response.completed",18202,{response:{output:[{type:"message",content:[{type:"output_text",text:"ANSWER_BODY ".repeat(20000)}]}]}})),true);
 const latest=new Map(values.map(value=>[value.id,value]));assert.ok(latest.size<=providerReasoningLimits.segments);assert.match([...latest.values()].at(-1)!.text,/最终公开尾段。$/u);assert.ok([...latest.values()].some(value=>value.truncated));assert.ok(values.every(value=>!(value.truncated&&value.complete)));observer.close();
});

test("actual tool argument frames are blocked independently of display size or SSE chunk boundaries",()=>{
 for(const type of ["response.function_call_arguments.delta","response.function_call_arguments.done","response.custom_tool_call_input.delta","response.web_search_call.in_progress"]){
  const observer=new ProviderReasoningObserver(randomUUID(),()=>{}),bytes=frame(type,0,{delta:"CONTROLLED_TOOL_ARGUMENT"});let allowed=true;
  for(let i=0;i<bytes.length&&allowed;i++)allowed=observer.feed(bytes.subarray(i,i+1));assert.equal(allowed,false,type);observer.close();
 }
});

test("task archives merge revisions, isolate other tasks and enforce total/entry limits",()=>{
 const taskId=randomUUID(),emitted:ProviderReasoningSnapshot[]=[],archive=providerReasoningArchive(taskId,[],value=>emitted.push(value));
 const value:ProviderReasoningSnapshot={id:taskId+":attempt:1",revision:1,kind:"deepseek-thinking",text:"Public text."};archive.accept(value);archive.accept(value);archive.accept({...value,id:randomUUID()+":attempt:1"});archive.accept({...value,revision:2,text:"Public text. Finished.",complete:true});archive.accept({...value,revision:3,text:"Cannot reopen"});
 assert.equal(archive.values.length,1);assert.equal(emitted.length,2);assert.equal(archive.values[0].complete,true);
 for(let i=0;i<30;i++)archive.accept({id:taskId+":attempt:"+(i+2),revision:1,kind:"summary",text:"x".repeat(8192)});
 assert.ok(archive.values.length<=providerReasoningLimits.snapshots);assert.ok(archive.values.reduce((sum,item)=>sum+Buffer.byteLength(item.text),0)<=providerReasoningLimits.totalBytes);
});

test("DeepSeek public-text qualification cannot be claimed by a local or arbitrary provider",()=>{
 assert.ok(publicFlashResponses({executor:"codex",model:"deepseek-flash",provider:"deepseek"}));assert.ok(publicFlashResponses({executor:"codex",model:"deepseek-flash",provider:"custom",endpoint:"https://api.deepseek.com"}));
 for(const config of [{executor:"claude" as const,model:"deepseek-flash",provider:"deepseek" as const},{executor:"codex" as const,model:"another-model",provider:"deepseek" as const},...['http://127.0.0.1:1234','https://api.deepseek.com.evil.test','https://api.deepseek.com/','https://api.deepseek.com?x=1'].map(endpoint=>({executor:"codex" as const,model:"deepseek-flash",provider:"custom" as const,endpoint}))])assert.equal(publicFlashResponses(config),false);
});

test("the last-hop request guard refuses private CLI metadata and unapproved tool inputs",()=>{
 const good={model:"deepseek-flash",stream:true,store:false,input:[{type:"message",role:"user",content:[{type:"input_text",text:"Explain the provided material."}]}],tools:[{type:"function",name:"request_user_input"},{type:"function",name:"view_image"}]};
 assert.ok(validProviderRequest(Buffer.from(JSON.stringify(good)),undefined));
 for(const value of [{...good,model:"different"},{...good,input:[{type:"function_call_output",output:"LOCAL_TOOL_OUTPUT"}]},{...good,tools:[{type:"mcp",server_url:"https://example.org/private"}]},{...good,tools:[{type:"function",name:"arbitrary"}]},{...good,input:[{type:"message",role:"developer",content:[{type:"input_text",text:"cwd /private/var/example/oneearth-chat"}]}]}])assert.throws(()=>validProviderRequest(Buffer.from(JSON.stringify(value)),undefined));
});
