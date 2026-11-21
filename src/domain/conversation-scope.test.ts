import test from "node:test";
import assert from "node:assert/strict";
import {parseDataSearch,fallbackDataSearch} from "../../server/data-search";
import {conversationScope,scopedReply} from "../../server/conversation-scope";
import {emptyFilters} from "./spatial";
import type {DiscoveryContext} from "./types";

const context=():DiscoveryContext=>({caseId:null,filters:{...emptyFilters(),period:[2020,2023],place:"东亚"},
  selection:null,gridSystem:"h3",layer:"all",camera:{center:[105,25],zoom:1,reason:"视野"},citation:null});
function plan(period:unknown){return parseDataSearch(JSON.stringify({...fallbackDataSearch("只改年份"),
  questionMode:"preserve",clarification:"请确认研究对象？",conversationPeriod:period}),"只改年份");}

test("confirmed dialogue years update the globe and synthesis context together, preserving other conditions",()=>{
  const old=context(),p=plan([2001,2010]),next=conversationScope(old,p);
  assert.deepEqual(next.filters.period,[2001,2010]);
  assert.equal(next.filters.place,"东亚");
  assert.deepEqual(old.filters.period,[2020,2023]);
  const reply=scopedReply({message:"回答",filters:emptyFilters()},next,p);
  assert.deepEqual(reply.filters?.period,[2001,2010]);
  assert.deepEqual(conversationScope(next,{} as typeof p).filters.period,[2001,2010]);
});
test("a new topic without a period clears inherited years rather than extracting source or version dates",()=>{
  const p=plan(null),next=conversationScope(context(),p);
  assert.equal(next.filters.period,null);
  assert.equal(scopedReply({message:"ERA5 版本说明 2019"},next,p).filters?.period,null);
  assert.deepEqual(scopedReply({message:"旧调用"},context()).filters,undefined);
});
test("invalid or guessed period shapes cannot reach the globe",()=>{
  for(const v of [[2023,2020],[2020],[2020.5,2021],["2020",2023],[900,2020],[2020,9999],{}])
    assert.throws(()=>plan(v),/年份/);
  assert.deepEqual(plan([2041,2060]).conversationPeriod,[2041,2060]);
  assert.deepEqual(plan([2020,2020]).conversationPeriod,[2020,2020]);
});

test("confirmed months use an exact UTC window; changing the year clears the old month",()=>{
  const p=parseDataSearch(JSON.stringify({...fallbackDataSearch("2020年7月"),questionMode:"preserve",
    clarification:"是否还有具体日期？",conversationPeriod:[2020,2020],conversationWindow:["2020-07-01","2020-08-01"]}),"2020年7月");
  const next=conversationScope(context(),p);
  assert.deepEqual(next.filters.utcWindow,[Date.UTC(2020,6,1),Date.UTC(2020,7,1)]);
  assert.deepEqual(scopedReply({message:"回答"},next,p).filters?.utcWindow,next.filters.utcWindow);
  const changed=conversationScope(next,plan([2021,2021]));
  assert.equal(changed.filters.utcWindow,null);
  assert.deepEqual(changed.filters.period,[2021,2021]);
  const annual=conversationScope(next,{...plan([2020,2020]),conversationWindow:null});
  assert.equal(annual.filters.utcWindow,null);
  for(const w of [["2020-02-31","2020-04-01"],["2020-07-01","2020-07-01"],["2020-08-01","2020-07-01"],["2020-07-01","2021-08-01"],["2020-07-01T00:00:00+08:00","2020-08-01"]]){
    assert.throws(()=>parseDataSearch(JSON.stringify({...p,conversationWindow:w}),"原问题"),/研究日期/);
  }
});
