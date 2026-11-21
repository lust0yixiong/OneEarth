import test from "node:test";
import assert from "node:assert/strict";
import fixture from "./fixtures/assertion-path-response.json";
import {readResearchPath,readEvidenceLinks,recipeUsages} from "../../server/assertion-relations";
import {validResearchPath,validAssertionEvidenceLinks} from "./assertion-relations";
const key="doi:10.5285/115d5e4ebf7148ec941423ec86fa9f26";
const paper="d7f607af-4592-45f3-8c86-5567dd98c67b";
const uses=[{paper_id:paper,dataset_id:"D18",ds_key:key}];

test("real recipe details preserve dataset-to-step relations and native method order without inferring edges",()=>{
 const path=readResearchPath(fixture["recipe-detail"],paper,"RQ8",key,uses)!;
 assert.ok(validResearchPath(path));
 assert.equal(path.complete,true);
 assert.equal(path.members.length,3);
 assert.deepEqual(path.members[0].stepIds,["RQ8_S1","RQ8_S2"]);
 assert.deepEqual(path.steps.map(s=>s.order),[1,2]);
 assert.match(path.steps[0].method,/0.52/);
 assert.equal(readResearchPath(fixture["recipe-detail"],paper,"RQ9",key,uses),undefined);
 assert.equal(readResearchPath(fixture["recipe-detail"],paper,"RQ8",key,[{...uses[0],dataset_id:"D99"}]),undefined);
});
test("multiple instances of the same dataset within a paper are associated only through returned instance IDs",()=>{
 const source={paper_id:paper,members:[{ds_key:key,dataset_id:"D18"}]};
 const two=[...uses,{...uses[0],dataset_id:"D99"}];
 assert.deepEqual(recipeUsages(source,two,key),uses);
 assert.deepEqual(recipeUsages({paper_id:paper,members:[{ds_key:key}]},two,key),[]);
 assert.deepEqual(recipeUsages({paper_id:paper,members:[{ds_key:key}]},uses,key),uses);
});
test("evidence claim kinds and original handles survive with explicit pagination",()=>{
 const links=readEvidenceLinks(fixture["evidence-detail"],paper,"D18");
 assert.ok(validAssertionEvidenceLinks(links));
 assert.equal(links.totalBlocks,14);
 assert.equal(links.blocks.length,8);
 assert.equal(links.hasMore,true);
 assert.ok(links.claims.some(c=>c.kind==="derivation"&&c.ref==="DV29"));
 assert.deepEqual(links.claims.find(c=>c.kind==="rq")?.blockIds,["B0521","B0528","B0543","B0544"]);
 assert.ok(links.blocks[0].supports.some(c=>c.kind==="step"&&c.ref==="1"));
 assert.ok(!links.blocks[0].supports.some(c=>c.ref==="RQ8_S1"),"original evidence references must not be relabelled by guessing order");
});
