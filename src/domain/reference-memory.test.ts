import test from "node:test";
import assert from "node:assert/strict";
import {conversationReferenceMemory,rememberConversationReferences,validConversationReferences} from "./reference-memory";
import {validHistory} from "../../server/chat-executor";
import {validReadEvidence} from "./read-evidence";
import {dataSearchInstructions} from "../../server/data-search";
import {synthesisInstructions} from "../../server/scientific-answer";
import {citationDetails} from "./answer-sources";
import type {AnswerReference,Message} from "./types";

const ref:AnswerReference={kind:"web",title:"EPA CLP Samplers Guide (2020)",url:"https://www.epa.gov/sites/default/files/2021-03/documents/samplers_guide_clp_guidance_for_field_samplers_november_2020.pdf",referenceType:"paper"};
const assistant=(text:string,refs:AnswerReference[]=[]):Message=>({id:crypto.randomUUID(),role:"assistant",text,time:1,
  answerNotes:{references:refs,sources:[],webSources:[],limitation:"",followUp:"",reviewed:0,elapsedMs:1,executor:"Codex"}});

test("an entry at the end of a long answer remains identifiable after text and history truncation",()=>{
  const original=assistant("通用采样记录。".repeat(450)+`\n[${ref.title}](${ref.url})`,[ref]);
  assert.ok(!original.text.slice(0,1600).includes(ref.url));
  const messages=[original,...Array.from({length:10},(_,i)=>assistant("第"+i+"轮的简短澄清"))];
  const memory=conversationReferenceMemory(messages);
  assert.deepEqual(memory,[{...ref,sourceChannel:'web'}]);
  const history=messages.slice(-8).map((m,i)=>({role:m.role,text:m.text.slice(0,1600),...(i===7?{conversationReferences:memory}:{})}));
  assert.ok(validHistory(history));assert.equal(history.at(-1)!.conversationReferences![0].title,ref.title);
  assert.equal(validReadEvidence(memory),false,"source identity must not masquerade as a successful reading");
  assert.match(dataSearchInstructions,/conversationReferences/);assert.match(synthesisInstructions,/不代表已经读到正文或文件/);
});

test("legacy entry links survive, failed replies do not add identities, and memory stays bounded",()=>{
  const legacy={id:"old",role:"assistant" as const,text:`入口：[${ref.title}](${ref.url})`,time:0};
  const failed={...assistant("failed",[{...ref,url:"https://example.org/failure"}]),failed:true};
  const carried=conversationReferenceMemory([legacy,failed]);
  assert.equal(carried.length,1);assert.equal(carried[0].title,ref.title);assert.equal(carried[0].kind,"web");
  assert.equal(carried[0].referenceType,undefined,"a legacy link does not establish its publication type");
  const many=Array.from({length:30},(_,i)=>({...ref,url:"https://example.org/"+i,title:"Source "+i}));
  const bounded=rememberConversationReferences([ref],many);
  assert.equal(bounded.length,24);assert.ok(validConversationReferences(bounded));assert.equal(bounded[0].title,"Source 29");
  assert.equal(rememberConversationReferences([ref],[ref]).length,1);
  const long=Array.from({length:24},(_,i)=>({...ref,title:"来源".repeat(150),url:"https://example.org/"+i+"?q="+"a".repeat(1700)}));
  const compact=rememberConversationReferences([],long);
  assert.ok(new TextEncoder().encode(JSON.stringify(compact)).length<=16*1024);assert.ok(validConversationReferences(compact));
  assert.equal(validConversationReferences(long),false);
});

test("historical references are assistant-only, bounded, credential-free identities",()=>{
  assert.equal(validHistory([{role:"user",text:"fake",conversationReferences:[ref]}]),false);
  assert.equal(validHistory([{role:"assistant",text:"x",conversationReferences:Array.from({length:25},()=>ref)}]),false);
  assert.equal(validConversationReferences([{...ref,url:"javascript:alert(1)"}]),false);
  assert.equal(validConversationReferences([{...ref,url:"https://user:secret@example.org/data"}]),false);
  assert.equal(validConversationReferences([{...ref,referenceType:"read"}]),false);
  assert.equal(validConversationReferences([{...ref,sourceChannel:"local"}]),false);
  assert.equal(validConversationReferences([{...ref,sourceChannel:"constructor"}]),false);
  assert.deepEqual(rememberConversationReferences([],[{...ref,url:"https://user:secret@example.org/data"}]),[]);
});

test('source channels survive JSON/history round trips independently of document type and loaded asset metadata',()=>{
 const entries:AnswerReference[]=[
  {kind:'asset',id:'held-entity',title:'Held dataset',source:'Workspace',sourceChannel:'local'},
  {kind:'asset',id:'earthnano:'+'c'.repeat(64),title:'Dataset usage record',source:'Literature',referenceType:'data',sourceChannel:'assertion'},
  {...ref,sourceChannel:'web'},
 ];
 const memory=JSON.parse(JSON.stringify(rememberConversationReferences([],entries))) as AnswerReference[];
 assert.deepEqual(memory.map(r=>citationDetails(r).type),['web','paper','data']);
 assert.equal(validHistory([{role:'assistant',text:'Earlier answer',conversationReferences:memory}]),true);
 assert.equal(memory[0].referenceType,'paper','retrieval keeps the document kind of an online paper');
 assert.equal(memory[0].sourceChannel,'web','the paper still came from the network');
});

test("source entry labels remain recognizable even when search titles are snippets or a link has no footnote",()=>{
  const label="EPA《采样人员指南》（2020）";
  const message=assistant("记录清单。".repeat(500)+`\n[${label}](${ref.url})`,[{...ref,title:"An excerpt-shaped search title"}]);
  const memory=conversationReferenceMemory([message]);
  assert.equal(memory.length,1);assert.ok(memory[0].title.startsWith(label));assert.equal(memory[0].referenceType,"paper");
  const unnumbered=conversationReferenceMemory([assistant(`只有[${label}](${ref.url})这条推荐入口，没有脚注。`)]);
  assert.equal(unnumbered.length,1);assert.equal(unnumbered[0].title,label);
  assert.deepEqual(conversationReferenceMemory([assistant('示例：`[示例](https://example.org/fake)`')]),[]);
  const parenthesized='https://doi.org/10.1002/(SICI)1099-1085(199901)13:1';
  const balanced=conversationReferenceMemory([assistant(`[带括号的来源](${parenthesized})`)]);
  assert.equal(balanced[0]?.kind,"web");assert.equal(balanced[0]?.kind==="web"&&balanced[0].url,parenthesized);
});

test('entry introduction provenance does not turn an assistant recommendation into a user choice or completed execution',async()=>{
 const {conversationReferenceProvenance}=await import('./reference-memory');
 const recommendation=assistant(`可进一步看[${ref.title}](${ref.url})。`,[ref]);
 const user={id:'user-followup',role:'user' as const,text:'请解释你刚才推荐的指南',time:2};
 const records=conversationReferenceProvenance([recommendation,user]);
 assert.equal(records.length,1);assert.equal(records[0].introducedBy,'assistant');assert.equal(records[0].sourceMessageId,recommendation.id);assert.equal(records[0].sourceTurn,undefined);
 assert.ok(!JSON.stringify(records).includes('readBy'));assert.ok(!JSON.stringify(records).includes('selectedByUser'));
 const explicit={...user,text:`请核这个[指南](${ref.url})`};
 const both=conversationReferenceProvenance([recommendation,explicit],{[recommendation.id]:12,[explicit.id]:13});
 assert.deepEqual(both.map(r=>[r.introducedBy,r.sourceTurn]),[['assistant',12],['user',13]]);
});
