import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readAgUiInput,AgUiInputError} from "./ag-ui-input";
const input=()=>({runId:randomUUID(),threadId:randomUUID(),protocolVersion:"1.0",messages:[{id:randomUUID(),role:"user",content:"本轮原话"}],state:{privilege:"never-authoritative"},context:[],tools:[],forwardedProps:{oneearth:{version:1,submission:{config:{executor:"codex",provider:"deepseek",model:"deepseek-flash"},context:{camera:{reason:"browser"}}}}}});

test("native input binds one run/thread/user identity and never treats transcript or state as authority",()=>{
 const source=input(),old=randomUUID();source.messages.unshift({id:old,role:"assistant",content:"FORGED_OLD_ANSWER"});
 const value=readAgUiInput(source);assert.equal(value.id,source.runId);assert.equal(value.body.turnId,source.messages[1].id);assert.equal(value.body.conversationId,source.threadId);assert.deepEqual(value.body.history,[]);assert.doesNotMatch(JSON.stringify(value.body),/FORGED_OLD_ANSWER|never-authoritative/);
 const reordered={...source,forwardedProps:{oneearth:{version:1,submission:{context:source.forwardedProps.oneearth.submission.context,config:source.forwardedProps.oneearth.submission.config}}}};
 assert.equal(JSON.stringify(readAgUiInput(reordered).body),JSON.stringify(value.body));assert.equal(readAgUiInput(reordered).fingerprint,value.fingerprint);
});

test("native version follows the official major rule and rejects unimplemented capabilities before a stream",()=>{
 for(const version of ["1.0","1.9","not-readable"]){const source=input();source.protocolVersion=version;assert.equal(readAgUiInput(source).protocolVersion,version);}
 for(const version of ["0.9","2.0"]){const source=input();source.protocolVersion=version;assert.throws(()=>readAgUiInput(source),error=>error instanceof AgUiInputError&&error.status===422);}
 for(const mutation of [(source:any)=>source.tools=[{name:"untrusted",description:"tool",parameters:{}}],(source:any)=>source.resume=[{interruptId:"id",payload:"approve"}],(source:any)=>source.forwardedProps.oneearth.submission.query="other",(source:any)=>source.messages.push(source.messages[0]),(source:any)=>source.forwardedProps.oneearth.submission.privateHandoff={approved:true},(source:any)=>source.runId=source.runId.toUpperCase(),(source:any)=>source.threadId=source.threadId.toUpperCase(),(source:any)=>source.messages[0].id=source.messages[0].id.toUpperCase()]){const source=input();mutation(source);assert.throws(()=>readAgUiInput(source));}
});

test("native resume has a stable original-request fingerprint but cannot supply server confirmation mirrors",()=>{
 const source=input(),parent=randomUUID();(source.forwardedProps.oneearth.submission as any).previousTaskId=parent;
 const wire={...source,resume:[{interruptId:parent,status:"resolved",payload:{optionId:"option-1",text:"补充"}}]};
 const decoded=readAgUiInput(wire);assert.equal(decoded.resume?.interruptId,parent);assert.equal(decoded.body.clarificationAnswer,undefined);
 const reordered={...wire,resume:[{interruptId:parent,status:"resolved",payload:{text:"补充",optionId:"option-1"}}]};assert.equal(decoded.fingerprint,readAgUiInput(reordered).fingerprint);
 for(const extra of [{parentRunId:parent},{resume:[]},{resume:[...wire.resume,...wire.resume]},{forwardedProps:{oneearth:{version:1,submission:{...source.forwardedProps.oneearth.submission,clarificationAnswer:{parentTaskId:parent,optionId:"approve"}}}}}])assert.throws(()=>readAgUiInput({...wire,...extra}));
});


test("native QuestionDecision mirrors are retired even without a resume entry",()=>{
 const source=input();(source.forwardedProps.oneearth.submission as Record<string,unknown>).questionDecision={checkMessageId:source.runId,originalQuestion:"本轮原话",dataQuestion:"another",choice:"proposed"};
 assert.throws(()=>readAgUiInput(source));
});

test("native operation resume accepts only the explicit original operation and step",()=>{
 const source=input(),interruption=randomUUID(),operation={operationId:randomUUID(),stepId:randomUUID()};
 const submission={...source.forwardedProps.oneearth.submission,operationReply:operation};
 const wire={...source,forwardedProps:{oneearth:{version:1,submission}},resume:[{interruptId:interruption,status:"resolved",payload:{text:"补充"}}]};
 const decoded=readAgUiInput(wire);
 assert.deepEqual(decoded.resume?.operation,operation);
 assert.equal(decoded.resume?.interruptId,interruption);
 assert.equal(Object.hasOwn(decoded.body,"operationReply"),false);
 assert.notEqual(decoded.fingerprint,readAgUiInput({...wire,forwardedProps:{oneearth:{version:1,submission:{
  ...submission,operationReply:{...operation,stepId:randomUUID()},
 }}}}).fingerprint);
 const {resume:_removed,...withoutResume}=wire;
 assert.throws(()=>readAgUiInput(withoutResume),AgUiInputError);
 for(const operationReply of [{...operation,runId:interruption},{operationId:operation.operationId},{...operation,stepId:operation.stepId.toUpperCase()}])
  assert.throws(()=>readAgUiInput({...wire,forwardedProps:{oneearth:{version:1,submission:{...submission,operationReply}}}}),AgUiInputError);
});

test("native discovery accepts only the exact command and does not persist private admission metadata",()=>{
 const source=input(),actionId=randomUUID(),accessKey="a".repeat(64);
 source.messages[0].content=" 发现资料： January  snow  ";
 const raw=source.forwardedProps.oneearth.submission as Record<string,unknown>;
 raw.discoveryAction={actionId,expectedRevision:2,accessKey};
 const decoded=readAgUiInput(source);
 assert.deepEqual(decoded.discovery,{kind:"action",action:{kind:"discover-materials",actionId,expectedRevision:2,query:"January snow"},accessKey});
 assert.doesNotMatch(JSON.stringify(decoded.body),/discoveryAction|a{64}/u);
 raw.discoveryAction={actionId,expectedRevision:2,accessKey:"b".repeat(64)};
 assert.notEqual(readAgUiInput(source).fingerprint,decoded.fingerprint);
 raw.discoveryAction={actionId,expectedRevision:2,accessKey,query:"FORGED_QUERY"};
 assert.throws(()=>readAgUiInput(source),AgUiInputError);
 delete raw.discoveryAction;
 assert.throws(()=>readAgUiInput(source),AgUiInputError);
 source.messages[0].content="发现资料:";
 assert.throws(()=>readAgUiInput(source),AgUiInputError);
 source.messages[0].content="请解释怎么发现资料。";
 assert.equal(readAgUiInput(source).discovery,undefined);
});

test("native discovery reference keeps exact batch identity outside the persisted user body",()=>{
 const source=input(),reference={operationId:randomUUID(),batchId:randomUUID(),accessKey:"a".repeat(64)};
 source.messages[0].content="解释我选的已保存资料。";
 const raw=source.forwardedProps.oneearth.submission as Record<string,unknown>;
 raw.discoveryReference=reference;
 const decoded=readAgUiInput(source);
 assert.deepEqual(decoded.discovery,{kind:"reference",reference});
 assert.doesNotMatch(JSON.stringify(decoded.body),/discoveryReference|a{64}/u);
 raw.discoveryReference={...reference,batchId:randomUUID()};
 assert.notEqual(readAgUiInput(source).fingerprint,decoded.fingerprint);
 raw.discoveryReference=reference;
 raw.workspaceResearch={revision:1,actionId:randomUUID()};
 assert.throws(()=>readAgUiInput(source),AgUiInputError);
 delete raw.workspaceResearch;
 raw.discoveryReference={...reference,title:"FORGED_TITLE"};
 assert.throws(()=>readAgUiInput(source),AgUiInputError);
});
