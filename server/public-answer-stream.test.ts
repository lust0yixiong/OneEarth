import test from "node:test";
import assert from "node:assert/strict";
import {PublicAnswerBuffer,PublicMessageExtractor} from "./public-answer-stream";
import {parseSynthesis} from "./scientific-answer";

test("public channel extracts only the top-level message across every JSON boundary",()=>{
 const values:string[]=[],raw=JSON.stringify({decide:{kind:"read",message:"NOT_PUBLIC"},message:'公开正文。\n含"引号"、反斜线\\与𝄞。',sections:[{text:"NOT_PUBLIC"}],reasoning:"NOT_PUBLIC"});
 const parser=new PublicMessageExtractor(text=>values.push(text));for(const char of raw)parser.feed(char);
 assert.equal(values.join(""),'公开正文。\n含"引号"、反斜线\\与𝄞。');assert.equal(parser.text,values.join(""));
});

test("public prefix holds incomplete credentials and never leaks JSON or signed data",()=>{
 const out:string[]=[],stream=new PublicAnswerBuffer(text=>out.push(text));
 for(const delta of ["普通说明。\n","Authorization: Bear","er DUMMY_PRIVATE_VALUE\n","token=\n\n"]){stream.push(delta);}
 assert.doesNotMatch(out.join(""),/DUMMY_PRIVATE_VALUE|Bearer DUMMY|token=\n/u);
 const json=new PublicAnswerBuffer(()=>assert.fail("no structured payload"));json.push('{"decide":{"kind":"respond"}}\n');assert.throws(()=>json.finish('{"decide":{"kind":"respond"}}\n'));
 for(const raw of ["https://example.org/a?X-Amz-Signature=PRIVATE_VALUE\n","/private/var/oneearth-private-file\n"]){const values:string[]=[],buffer=new PublicAnswerBuffer(v=>values.push(v));for(const char of raw)buffer.push(char);buffer.finish(raw);assert.doesNotMatch(values.join(""),/PRIVATE_VALUE|oneearth-private-file/);}
});

test("only verified source numbers may become a public prefix; final normalized content agrees",()=>{
 const ref={kind:"web" as const,url:"https://example.org/archived",title:"Saved source"},out:string[]=[];
 const stream=new PublicAnswerBuffer(text=>out.push(text),text=>{try{return parseSynthesis(JSON.stringify({message:text}),[ref],[]).message;}catch{return undefined;}});
 stream.push("已有记录支持该事实。[S1]\n\n");assert.deepEqual(out,["已有记录支持该事实。〔1〕"]);
 stream.push("另一个尚未核实。[S999]\n");assert.equal(out.length,1);
});
