import test from "node:test";
import assert from "node:assert/strict";
import {mergeWebEvidence} from "../../server/merge-web-evidence";
import type {SearchRun,WebHit} from "./types";
const hit=(snippet:string,extra:Partial<WebHit>={}):WebHit=>({url:"https://example.org/supplement",title:"Supplement",snippet,...extra});
const run=(query:string,hits:WebHit[],engine:SearchRun["engine"]="DeepSeek Search"):SearchRun=>({engine,query,status:"done",hits});

test("same URL keeps complementary product and output clues with literal provenance, without claiming full text",()=>{
  const snippets=["Heatwave observations.","We also analyze SST data from MGDsST.","WRF outputs are archived in Zenodo."];
  const [r]=mergeWebEvidence(snippets.map((s,i)=>run("query "+i,[hit(s)])));
  assert.equal(r.snippet,snippets.join("\n\n"));
  assert.deepEqual(r.snippetSources.map(s=>s.origins[0].query),["query 0","query 1","query 2"]);
  for(const [i,s] of r.snippetSources.entries())assert.equal(r.snippet.slice(s.start,s.end),snippets[i]);
  assert.equal(r.pageExcerpt,undefined);assert.match(r.snippetNotice,/不能视为已读网页正文/);
});
test("duplicate snippets retain distinct search origins and later search does not erase a real page excerpt",()=>{
  const [r]=mergeWebEvidence([run("first",[hit("Same clue")]),run("second",[hit("Same clue")],"Bing"),
    run("https://example.org/supplement",[hit("Fetched summary",{pageExcerpt:"Actual read page excerpt",doi:"10.1234/data.v1"})],"DeepSeek Fetch"),
    run("third",[hit("Another search clue")])]);
  assert.equal(r.snippetSources.length,3);assert.equal(r.snippetSources[0].origins.length,2);
  assert.equal(r.pageExcerpt,"Actual read page excerpt");assert.equal(r.doi,"10.1234/data.v1");
});
test("different URLs and conflicting exact DOI versions do not share snippets or metadata",()=>{
  const result=mergeWebEvidence([run("first",[hit("Version one",{doi:"10.1234/data.v1"})]),
    run("second",[hit("Version two",{doi:"10.1234/data.v2",pageExcerpt:"Other version page"}),hit("Other URL",{url:"https://example.org/other"})])]);
  assert.equal(result.length,2);assert.equal(result[0].snippet,"Version one");
  assert.equal(result[0].doi,"10.1234/data.v1");assert.equal(result[0].identityConflicts,1);
  assert.equal(result[0].pageExcerpt,undefined);assert.equal(result[1].snippet,"Other URL");
});
test("same DOI with conflicting explicit version fields does not mix summaries or read text",()=>{
  const [r]=mergeWebEvidence([run("version one",[hit("Version one clue",{doi:"10.1234/data",version:"1.0",pageExcerpt:"Read version one"})]),
    run("version two",[hit("Version two clue",{doi:"10.1234/data",version:"2.0",pageExcerpt:"Read version two"})])]);
  assert.equal(r.version,"1.0");assert.equal(r.snippet,"Version one clue");
  assert.equal(r.pageExcerpt,"Read version one");assert.equal(r.identityConflicts,1);
  assert.deepEqual(r.snippetSources[0].origins.map(o=>o.query),["version one"]);
});
test("summary and provenance packing has an overall budget and explicit omissions",()=>{
  const runs=Array.from({length:20},(_,i)=>run("query "+i,[hit("literal "+i+" "+"x".repeat(3000))]));
  const [r]=mergeWebEvidence(runs,2500);
  const packedCost=r.snippet.length+r.snippetSources.reduce((n,s)=>n+JSON.stringify(s).length,0);
  assert.ok(packedCost<=2500);assert.ok(r.omittedSnippets>0);
  for(const s of r.snippetSources){assert.ok(s.partial);assert.equal(s.sourceLength,3010+(s.origins[0].query.length>7?1:0));}
  const empty=mergeWebEvidence(runs,0)[0];assert.equal(empty.snippet,"");assert.equal(empty.omittedSnippets,20);
});
test("failed runs cannot contribute successful summary evidence",()=>{
  assert.deepEqual(mergeWebEvidence([{...run("failed",[hit("not evidence")]),status:"failed"}]),[]);
});
