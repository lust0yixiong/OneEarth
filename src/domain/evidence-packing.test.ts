import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {catalogueRows} from "../../server/chat-executor";
import {emptyFilters} from "./spatial";
import type {PaperRecord} from "./paper-record";
import type {DiscoveryContext} from "./types";

const saved=JSON.parse(readFileSync(new URL("./fixtures/sn463-evidence-budget.json",import.meta.url),"utf8")) as {
  question:string;context:string;phrases:string[];target:string;records:PaperRecord[];
};
test("saved ethnographic photographs are not crowded out by the first long unrelated records",()=>{
  const rows=catalogueRows(saved.question+"\n"+saved.context,{caseId:null,filters:emptyFilters(),selection:null} as DiscoveryContext,
    {message:"",paperOnly:true},[],saved.records,undefined,"paper",saved.question,saved.phrases);
  const actual=rows.find(r=>r.id===saved.target)!;
  assert.equal(rows[0].id,saved.target);
  assert.ok(actual.includedChars>0);
  assert.match(JSON.stringify(actual.excerpts),/in situ|photograph/i);
  assert.ok(JSON.stringify(rows).length<=48000);
  // All four identities remain available; this is not a claim that their raw
  // photographs are public or that every fetched document is relevant.
  assert.deepEqual(new Set(rows.map(r=>r.id)),new Set(saved.records.map(r=>r.id)));
  const record=saved.records.find(r=>r.id===saved.target)!;
  for(const e of actual.excerpts){
    const original=record.need.tabs.find(t=>t.kind==="text"&&t.label===e.label);
    assert.equal(e.quote,original?.quote?.slice(e.start,e.end));
  }
});
