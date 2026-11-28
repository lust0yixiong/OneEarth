import test,{type TestContext} from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import https from "node:https";
import {once} from "node:events";
import {randomUUID} from "node:crypto";
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {createModelExecutor} from "./executor";
import {createModelService} from "./model-service";
import {providerReasoningRelay} from "./provider-reasoning-relay";
import {providerCliInstructions} from "./provider-cli-request";
import {runForegroundTurn,type RuntimeServices,type RuntimeTurnInput} from "./runtime-turn";
import {openTaskStore} from "./task-store";
import {emptyFilters} from "../src/domain/spatial";
import {literatureDisplay} from "../src/domain/literature-label";
import type {ProviderReasoningSnapshot,DiscoveryResponse} from "../src/domain/types";

function frame(type:string,sequence:number,fields:Record<string,unknown>={}){return "event: "+type+"\ndata: "+JSON.stringify({type,sequence_number:sequence,item_id:"public-test",output_index:0,content_index:0,...fields})+"\n\n";}
async function listener(t:TestContext,handler:http.RequestListener){const server=http.createServer(handler);server.listen(0,"127.0.0.1");await once(server,"listening");const address=server.address();assert.ok(address&&typeof address!=="string");t.after(async()=>{server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));});return {port:address.port,origin:"http://127.0.0.1:"+address.port};}
function localTransport(port:number):typeof https.request{return ((options:any,callback:any)=>{assert.equal(options.protocol,"https:");assert.equal(options.hostname,"api.deepseek.com");assert.equal(options.path,"/responses");assert.equal(options.headers.authorization,"Bearer CONTROLLED_PROVIDER_KEY");assert.equal(options.headers["accept-encoding"],"identity");return http.request({...options,protocol:"http:",hostname:"127.0.0.1",port},callback);}) as typeof https.request;}
const wire=(prompt:string)=>({model:"deepseek-flash",stream:true,store:false,input:[{type:"message",role:"user",content:[{type:"input_text",text:prompt}]}],tools:[]});

test("the fixed relay incrementally passes all bytes through 18201 deltas, large bodies and final completion",async t=>{
 const prompt="A bounded original task.",values:ProviderReasoningSnapshot[]=[],controller=new AbortController();let expected="",forwarded:any;
 for(let i=0;i<18201;i++)expected+=frame("response.reasoning_text.delta",i,{delta:i===18200?"最后的公开尾段。":"公开段落。"});
 const raw="公开段落。".repeat(18200)+"最后的公开尾段。";expected+=frame("response.reasoning_text.done",18201,{text:raw});
 expected+=frame("response.output_text.done",18202,{text:"NORMAL_ANSWER ".repeat(20000)});expected+=frame("response.completed",18203,{response:{output:[{type:"message",content:[]}]}});
 const upstream=await listener(t,async(req,res)=>{let body="";for await(const chunk of req)body+=chunk;forwarded=JSON.parse(body);res.writeHead(200,{"content-type":"text/event-stream"});res.write(expected.slice(0,700));setTimeout(()=>res.end(expected.slice(700)),5);});
 const relay=await providerReasoningRelay("CONTROLLED_PROVIDER_KEY",{taskId:randomUUID(),onSnapshot:value=>values.push(value)},controller.signal,prompt,localTransport(upstream.port));t.after(()=>relay.close());
 const response=await fetch(relay.baseUrl+"/responses",{method:"POST",headers:{authorization:"Bearer "+relay.token,"content-type":"application/json"},body:JSON.stringify(wire(prompt))});
 assert.equal(response.status,200);assert.equal(await response.text(),expected);assert.equal(forwarded.input[1].content[0].text,prompt);
 const latest=[...new Map(values.map(value=>[value.id,value])).values()];assert.ok(latest.length>1);assert.match(latest.at(-1)!.text,/最后的公开尾段。$/u);assert.ok(latest.every(value=>!(value.complete&&value.truncated)));assert.doesNotMatch(JSON.stringify(values),/NORMAL_ANSWER/);
});

test("auth, exact original stdin and known CLI envelopes are required before any upstream request",async t=>{
 let upstreamCalls=0;const upstream=await listener(t,(_req,res)=>{upstreamCalls++;res.end();});const prompt="Original immutable prompt",values:ProviderReasoningSnapshot[]=[];
 const relay=await providerReasoningRelay("CONTROLLED_PROVIDER_KEY",{taskId:randomUUID(),onSnapshot:value=>values.push(value)},new AbortController().signal,prompt,localTransport(upstream.port));t.after(()=>relay.close());
 for(const [auth,body] of [["wrong",wire(prompt)],[relay.token,wire("Different prompt")],[relay.token,{...wire(prompt),tools:[{type:"mcp",server_url:"https://example.org/mcp"}]}],[relay.token,{...wire(prompt),input:[...wire(prompt).input,{type:"message",role:"developer",content:[{type:"input_text",text:"UNKNOWN_LOCAL_DIRECTIVE"}]}]}]] as const){const response=await fetch(relay.baseUrl+"/responses",{method:"POST",headers:{authorization:"Bearer "+auth,"content-type":"application/json"},body:JSON.stringify(body)});assert.ok(response.status>=400);}
 assert.equal(upstreamCalls,0);assert.equal(values.length,0);
});

test("each CLI relay attempt reserves the exact forwarded request, and rejection makes no provider request",async t=>{
 const prompt="Only my original task.",upstreamBodies:Buffer[]=[],reserved:Buffer[]=[],usage:unknown[]=[];
 const upstream=await listener(t,async(req,res)=>{
  const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(chunk);upstreamBodies.push(Buffer.concat(chunks));
  res.writeHead(200,{"content-type":"text/event-stream"}).end(frame("response.completed",0,{
    response:{usage:{input_tokens:23,output_tokens:3,total_tokens:26}},
  }));
 });
 const relay=await providerReasoningRelay("CONTROLLED_PROVIDER_KEY",{taskId:randomUUID(),onSnapshot:()=>{}},new AbortController().signal,prompt,
  localTransport(upstream.port),{reserveRequest:async(bytes,kind)=>{
   assert.equal(kind,"responses-relay");
   if(reserved.length===2)throw Error("Test cumulative budget exhausted.");
   reserved.push(bytes);
   return {recordUsage:async counts=>{usage.push(counts);}};
  }});
 t.after(()=>relay.close());
 for(const status of [200,200,429]){
  const result=await fetch(relay.baseUrl+"/responses",{method:"POST",headers:{authorization:"Bearer "+relay.token,"content-type":"application/json"},
   body:JSON.stringify(wire(prompt))});
  assert.equal(result.status,status);await result.text();
 }
 assert.deepEqual(upstreamBodies,reserved);assert.equal(upstreamBodies.length,2);
 assert.deepEqual(usage,[{inputTokens:23,outputTokens:3},{inputTokens:23,outputTokens:3}]);
});

test("unexpected compressed responses are rejected before encoded bytes can be mistaken for CLI SSE",async t=>{
 const values:ProviderReasoningSnapshot[]=[],upstream=await listener(t,(_req,res)=>{res.writeHead(200,{"content-type":"text/event-stream","content-encoding":"gzip"});res.end(Buffer.from([31,139,8,0,0]));}),prompt="Only the original task.";
 const relay=await providerReasoningRelay("CONTROLLED_PROVIDER_KEY",{taskId:randomUUID(),onSnapshot:value=>values.push(value)},new AbortController().signal,prompt,localTransport(upstream.port));t.after(()=>relay.close());
 const response=await fetch(relay.baseUrl+"/responses",{method:"POST",headers:{authorization:"Bearer "+relay.token,"content-type":"application/json"},body:JSON.stringify(wire(prompt))});assert.equal(response.status,502);assert.equal(await response.text(),"Unsupported provider response encoding.");assert.equal(values.length,0);
});

async function cliFixture(t:TestContext,{unknown=false,hold=false}:{unknown?:boolean;hold?:boolean}={}){
 const dir=mkdtempSync(path.join(tmpdir(),"oneearth-public-stream-test-")),log=path.join(dir,"cli.jsonl");const previousPath=process.env.PATH,previousKey=process.env.DEEPSEEK_API_KEY;process.env.PATH=dir+path.delimiter+(previousPath||"");process.env.DEEPSEEK_API_KEY="CONTROLLED_PROVIDER_KEY";
 const requests:any[]=[],snapshots:ProviderReasoningSnapshot[]=[],bodies:string[]=[];
 const upstream=await listener(t,async(req,res)=>{
  let body="";for await(const chunk of req)body+=chunk;bodies.push(body);const value=JSON.parse(body);requests.push(value);const prompt=value.input[1].content[0].text;
  assert.equal(value.input[0].content[0].text,providerCliInstructions);assert.doesNotMatch(body,/\/private\/var|\/tmp\/oneearth-chat|MUST_NOT_FORWARD|client_metadata|encrypted_content/);
  const answer=prompt.startsWith("仅做本轮")?{decide:{kind:"respond",reply:null,targets:["citation"]}}:{message:"按实际提供的摘录说明。",sections:[],limitation:"仅据提供的摘录。",followUp:"",researchNotes:[],calculationRequests:[]};
  res.writeHead(200,{"content-type":"text/event-stream"});res.write(frame("response.output_item.added",0,{item:{type:"reasoning",encrypted_content:"HIDDEN_NOT_PUBLIC"}}));res.write(frame("response.reasoning_text.delta",1,{delta:"EarthNano PUBLIC_DISPLAY_ONLY "}));
  if(hold)return;
  const suffix=frame("response.reasoning_text.done",2,{text:"EarthNano PUBLIC_DISPLAY_ONLY "})+frame("response.output_text.done",3,{text:JSON.stringify(answer)})+frame("response.completed",4,{response:{output:[{type:"message",content:[]}]}});setTimeout(()=>res.end(suffix),2);
 });
 writeFileSync(path.join(dir,"codex"),`#!${process.execPath}
import fs from 'node:fs';import http from 'node:http';let prompt='';for await(const chunk of process.stdin)prompt+=chunk;
const args=process.argv.slice(2),base=args.find(arg=>arg.startsWith('model_providers.oneearth_service.base_url='));const origin=JSON.parse(base.slice(base.indexOf('=')+1));
if(fs.readdirSync(process.env.CODEX_HOME).length)process.exit(80);
fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({isolated:true,args:args.filter(arg=>!arg.includes('path=')&&!arg.includes('instructions_file=')&&!arg.includes('base_url='))})+'\\n');
const wire={model:'deepseek-flash',stream:true,store:false,include:['reasoning.encrypted_content'],client_metadata:{installation_id:'MUST_NOT_FORWARD'},input:[
{type:'message',role:'developer',content:[{type:'input_text',text:${JSON.stringify(providerCliInstructions)}}]},
{type:'message',role:'developer',content:[{type:'input_text',text:'<skills_instructions>### Available skills /private/var/MUST_NOT_FORWARD</skills_instructions>'},{type:'input_text',text:'<permissions instructions>local /tmp/oneearth-chat/MUST_NOT_FORWARD</permissions instructions>'}]},
{type:'message',role:'user',content:[{type:'input_text',text:prompt}]},
{type:'message',role:'user',content:[{type:'input_text',text:${JSON.stringify(unknown?"UNKNOWN_LOCAL_DIRECTIVE":"<environment_context><cwd>/private/var/MUST_NOT_FORWARD</cwd></environment_context>")}}]}],tools:[{type:'function',name:'request_user_input'},{type:'function',name:'view_image'}]};
const req=http.request(origin+'/responses',{method:'POST',headers:{authorization:'Bearer '+process.env.ONEEARTH_EXECUTOR_KEY,'content-type':'application/json'}},res=>{let raw='';res.on('data',chunk=>raw+=chunk);res.on('end',()=>{if(res.statusCode!==200)process.exit(79);let answer;for(const row of raw.split('\\n'))if(row.startsWith('data: ')){const value=JSON.parse(row.slice(6));if(value.type==='response.output_text.done')answer=value.text;}if(!answer)process.exit(78);process.stdout.write(answer);});});req.on('error',()=>process.exit(77));req.end(JSON.stringify(wire));
`,{mode:0o700});
 t.after(()=>{if(previousPath===undefined)delete process.env.PATH;else process.env.PATH=previousPath;if(previousKey===undefined)delete process.env.DEEPSEEK_API_KEY;else process.env.DEEPSEEK_API_KEY=previousKey;rmSync(dir,{recursive:true,force:true});});
 const configure=createModelService().configureService,execute=createModelExecutor(configure,localTransport(upstream.port));
 return {execute,requests,snapshots,bodies,transport:localTransport(upstream.port),log:()=>{try{return readFileSync(log,"utf8").trim().split("\n").map(line=>JSON.parse(line));}catch{return [];}}};
}

test("the production executor keeps its CLI and stdout result, isolates the child and observes public SSE exactly once",async t=>{
 const f=await cliFixture(t),taskId=randomUUID(),result=await f.execute({executor:"codex",provider:"deepseek",model:"deepseek-flash"},"Only the supplied task.",AbortSignal.timeout(5000),{providerReasoning:{taskId,onSnapshot:value=>f.snapshots.push(value)}});
 assert.equal(JSON.parse(result).message,"按实际提供的摘录说明。");assert.equal(f.requests.length,1);assert.ok(f.snapshots.length>=2);assert.ok(f.snapshots.every(value=>value.id.startsWith(taskId+":")));assert.equal(f.snapshots.at(-1)!.text,"EarthNano PUBLIC_DISPLAY_ONLY ");assert.doesNotMatch(JSON.stringify(f.snapshots),/HIDDEN_NOT_PUBLIC|MUST_NOT_FORWARD/);assert.equal(f.log().length,1);assert.ok(f.log()[0].args.includes("--ignore-rules"));
});

test("unrecognized CLI additions fail closed without a provider call, and cancellation preserves only already-public text",async t=>{
 await t.test("unknown addition",async t=>{const f=await cliFixture(t,{unknown:true});await assert.rejects(f.execute({executor:"codex",provider:"deepseek",model:"deepseek-flash"},"Only the supplied task.",AbortSignal.timeout(5000),{providerReasoning:{taskId:randomUUID(),onSnapshot:value=>f.snapshots.push(value)}}));assert.equal(f.requests.length,0);assert.equal(f.snapshots.length,0);});
 await t.test("cancelled stream",async t=>{const f=await cliFixture(t,{hold:true}),controller=new AbortController(),promise=f.execute({executor:"codex",provider:"deepseek",model:"deepseek-flash"},"Only the supplied task.",controller.signal,{providerReasoning:{taskId:randomUUID(),onSnapshot:value=>f.snapshots.push(value)}});const deadline=Date.now()+5000;while(!f.snapshots.length&&Date.now()<deadline)await new Promise(done=>setTimeout(done,10));assert.ok(f.snapshots.length);controller.abort();await assert.rejects(promise);const count=f.snapshots.length;await new Promise(done=>setTimeout(done,20));assert.equal(f.snapshots.length,count);assert.ok(f.snapshots.every(value=>!value.complete));assert.equal(f.requests.length,1);});
});

test("real turn events and terminal archive preserve public provider text without feeding it to the next model",async t=>{
 const f=await cliFixture(t),previous=https.request,originalFetch=globalThis.fetch;https.request=f.transport;globalThis.fetch=async()=>assert.fail("no source or extra model traffic");
 t.after(()=>{https.request=previous;globalThis.fetch=originalFetch;});
 const tasks=openTaskStore(":memory:");t.after(()=>tasks.close());const services={tasks,push:{latest:()=>({records:[]})},coverage:async()=>assert.fail("no grid"),researchRegionService:{locate:async()=>null},adminBoundaryDir:tmpdir(),canonicalCache:new Map()} as unknown as RuntimeServices;
 const input:RuntimeTurnInput={query:"解释附着摘录。",conversationId:randomUUID(),turnId:randomUUID(),history:[],config:{executor:"codex",provider:"deepseek",model:"deepseek-flash"},context:{caseId:null,filters:emptyFilters(),selection:null,citation:{title:"Provided text",scope:"片段",body:"CONTROLLED_SOURCE_FACT"},gridSystem:"h3",layer:"all",camera:{center:[0,0],zoom:1,reason:"fixture"}}};
 const id=randomUUID(),events:any[]=[];tasks.submit(id,input);tasks.claim();const outcome=await runForegroundTurn(services,id,input,AbortSignal.timeout(10000),event=>{events.push(event);tasks.append(id,event);});assert.equal(outcome.kind,"reply");if(outcome.kind!=="reply")return;assert.equal(outcome.payload.error,undefined);tasks.finish(id,"complete",outcome.payload);
 const result=outcome.payload.result as DiscoveryResponse;assert.equal(f.requests.length,2,"one original planner and one original synthesis, no additional request");assert.ok(events.some(event=>event.providerReasoning));assert.ok(result.runTrace!.providerReasoning!.every(value=>value.text==="EarthNano PUBLIC_DISPLAY_ONLY "));assert.equal(result.message,"按实际提供的摘录说明。");
 assert.equal((tasks.terminal(id) as any).result.runTrace.providerReasoning.length,2);assert.deepEqual(literatureDisplay({providerReasoning:result.runTrace!.providerReasoning}).providerReasoning,result.runTrace!.providerReasoning);
 const before=f.requests.length,nextId=randomUUID(),next={...input,turnId:randomUUID(),previousTaskId:id};tasks.submit(nextId,next);tasks.claim();const follow=await runForegroundTurn(services,nextId,next,AbortSignal.timeout(10000),()=>{});assert.equal(follow.kind,"reply");for(const body of f.bodies.slice(before))assert.doesNotMatch(body,/PUBLIC_DISPLAY_ONLY|providerReasoning|HIDDEN_NOT_PUBLIC/);
});
