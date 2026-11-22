import assert from "node:assert/strict";
import test from "node:test";
import {sourceReadReceipts,validateSourceReadClaim,SourceReadClaimError} from "./source-read-provenance";
import type {SearchRun} from "../src/domain/types";

const reply=(message:string)=>({message,limitation:"",followUp:""});
test("history or snippets cannot authorize a claim of opening a source in this turn",()=>{
  assert.throws(()=>validateSourceReadClaim(reply("我本轮打开页面时也未能读到后半段。"),[]),SourceReadClaimError);
  assert.throws(()=>validateSourceReadClaim(reply("I opened the source this turn."),[]),SourceReadClaimError);
  assert.throws(()=>validateSourceReadClaim(reply("针对原句的定向检索也没有返回结果。"),[]),SourceReadClaimError);
  assert.doesNotThrow(()=>validateSourceReadClaim(reply("历史摘录没有后半段，本轮没有打开来源。"),[]));
});
test("only current read actions are source read receipts",()=>{
  const exact:SearchRun={engine:"原站读取",query:"https://example.org",status:"failed",hits:[]};
  const search:SearchRun={...exact,engine:"DeepSeek Search",status:"done"};
  assert.deepEqual(sourceReadReceipts([search,{...exact,cacheStoredAt:"2026-01-01"}]),[]);
  const receipts=sourceReadReceipts([exact]);
  assert.equal(receipts[0].status,"failed");
  assert.doesNotThrow(()=>validateSourceReadClaim(reply("本轮尝试打开原网页，未能取得正文。"),receipts));
});
