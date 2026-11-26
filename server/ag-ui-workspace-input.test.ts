import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readAgUiInput,AgUiInputError} from "./ag-ui-input";
import {nativeWorkspaceTool,workspaceToolCall,unverifiedWorkspaceToolResult} from "../src/domain/native-workspace-tool";

const input=()=>({protocolVersion:"1.0",runId:randomUUID(),threadId:randomUUID(),messages:[{id:randomUUID(),role:"user",content:"说明真实工作台状态。"}],tools:[nativeWorkspaceTool],context:[],state:{},forwardedProps:{oneearth:{version:1,submission:{previousTaskId:randomUUID(),context:{},config:{executor:"codex",model:"gpt-6-luna"}}}}});
test("native tools are a registered delivery capability, never model or execution authority",()=>{
 const source=input(),decoded=readAgUiInput(source);assert.equal(decoded.workspaceTool,true);assert.deepEqual(decoded.workspaceReplies,[]);assert.equal((decoded.body as any).tools,undefined);
 const absent=readAgUiInput({...source,tools:[]});assert.equal(absent.workspaceTool,false);assert.notEqual(absent.fingerprint,decoded.fingerprint);
 for(const tools of [[{...nativeWorkspaceTool,name:"other"}],[{...nativeWorkspaceTool,parameters:{allow:"everything"}}],[nativeWorkspaceTool,nativeWorkspaceTool]])assert.throws(()=>readAgUiInput({...source,tools}),error=>error instanceof AgUiInputError&&error.status===422);
 assert.throws(()=>readAgUiInput({...source,forwardedProps:{oneearth:{version:1,submission:{...source.forwardedProps.oneearth.submission,questionDecision:{choice:"original"}}}}}));
});
test("standard tool transcript remains private validation input and requires an explicit next user message",()=>{
 const source=input(),parent=source.forwardedProps.oneearth.submission.previousTaskId;
 const call=workspaceToolCall(parent,{message:"原已核动作",mesh:true,workspaceEffect:{effectId:"workspace:"+parent,state:"proposed",fields:["mesh"]}})!;
 const message=unverifiedWorkspaceToolResult(parent),assistant={id:parent,role:"assistant",content:"CLIENT_OLD_TEXT_NOT_AUTHORITY",toolCalls:[call]};
 const wire={...source,messages:[assistant,message,...source.messages]},decoded=readAgUiInput(wire);
 assert.deepEqual(decoded.workspaceReplies,[{runId:parent,call,message}]);assert.equal(decoded.body.history.length,0);assert.doesNotMatch(JSON.stringify(decoded.body),/CLIENT_OLD_TEXT_NOT_AUTHORITY|toolCallId|workspace-result/);
 for(const messages of [[message,assistant,...source.messages],[assistant,...source.messages],[message,...source.messages],[assistant,message],[assistant,message,message,...source.messages]])assert.throws(()=>readAgUiInput({...source,messages}));
 const changed={...message,error:"changed"};assert.notEqual(readAgUiInput({...source,messages:[assistant,changed,...source.messages]}).fingerprint,decoded.fingerprint);
});
