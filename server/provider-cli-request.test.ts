import assert from "node:assert/strict";
import {test} from "node:test";
import {gzipSync} from "node:zlib";
import {projectProviderRequest,providerCliInstructions} from "./provider-cli-request";

const prompt="Original application task.\nUse source [S1] and keep the newline.";
const message=(role:string,text:string)=>({type:"message",role,content:[{type:"input_text",text}]});
const tool=(name:string)=>({type:"function",name,description:"local fixture declaration",parameters:{type:"object"}});
function request(){
  return {model:"deepseek-flash",stream:true,store:true,tool_choice:"auto",parallel_tool_calls:false,
    include:["reasoning.encrypted_content"],prompt_cache_key:"local-test-session",client_metadata:{thread_id:"local-test-thread"},
    tools:[tool("request_user_input"),tool("view_image")],reasoning:{effort:"high"},
    input:[message("developer",providerCliInstructions),
      {type:"message",role:"developer",content:[
        {type:"input_text",text:"<skills_instructions>\n### Available skills\n/tmp/oneearth-chat-test/profile\n</skills_instructions>"},
        {type:"input_text",text:"<permissions instructions>\nLocal CLI sandbox.\n</permissions instructions>"},
      ]},
      message("user","<environment_context>\n<cwd>/private/var/isolated-fixture</cwd>\n</environment_context>"),
      message("user",prompt)]};
}
const bytes=(value:unknown)=>Buffer.from(JSON.stringify(value));
const project=(value:unknown,expected=prompt)=>JSON.parse(projectProviderRequest(bytes(value),undefined,expected).toString("utf8"));

test("keeps application stdin exact and removes the native CLI local envelopes and tracking fields",()=>{
  const raw=request(),out=project(raw);
  assert.deepEqual(out.input,[message("developer",providerCliInstructions),message("user",prompt)]);
  assert.deepEqual(out.reasoning,raw.reasoning);
  assert.deepEqual(out.tools,raw.tools);
  assert.equal(out.store,false);
  for(const key of ["client_metadata","prompt_cache_key","include"])assert.ok(!Object.hasOwn(out,key));
  assert.doesNotMatch(JSON.stringify(out),/\/private\/var|local-test-thread|skills_instructions/);
  assert.deepEqual(JSON.parse(projectProviderRequest(gzipSync(bytes(raw)),"gzip",prompt).toString()),out);
});

test("requires a unique byte-for-byte stdin and rejects additional task text and tool history",()=>{
  const raw=request();
  assert.throws(()=>project(raw,prompt+" "));
  for(const extra of [
    message("user",prompt), message("user","extra user question"),
    message("developer","unrecognized developer input"), message("assistant","uncertain response"),
    {type:"function_call_output",output:"previous output"},
    {type:"message",role:"user",content:[{type:"input_image",image_url:"https://example.invalid/one.png"}]},
  ])assert.throws(()=>project({...raw,input:[...raw.input,extra]}),/isolated provider contract/);
  assert.throws(()=>project({...raw,tools:[tool("mcp_test"),...raw.tools]}),/isolated provider contract/);
  assert.throws(()=>project({...raw,tools:[tool("view_image"),tool("view_image")]}),/isolated provider contract/);
  assert.throws(()=>project({...raw,previous_response_id:"old"}),/isolated provider contract/);
});

test("rejects secrets and local paths in the final application or tool fields without echoing them",()=>{
  const raw=request();
  for(const sensitive of [
    "look at /private/var/fixture-private/location",
    "https://sample.invalid/report?sign=fixture-secret",
    "https://127.0.0.1:5474/fixture-private",
  ]){
    assert.throws(()=>project({...raw,input:[message("user",sensitive)]},sensitive),error=>{
      assert.ok(error instanceof Error);
      return !error.message.includes(sensitive);
    });
  }
  assert.throws(()=>project({...raw,tools:[{...tool("view_image"),description:"Read /Users/fixture/private"}]}));
});
