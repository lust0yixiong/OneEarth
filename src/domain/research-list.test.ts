import test from "node:test";
import assert from "node:assert/strict";
import { candidates } from "./results";
import { caseById, cases } from "./catalog";
import { cellAt, emptyFilters, gridSpec } from "./spatial";
import type { CandidateSet } from "./types";
import { createResearchList, parseResearchList, unavailableItems, listMarkdown } from "./research-list";

function scope(id: string | null): CandidateSet {
  const filters=emptyFilters();
  return {title:caseById(id)?.title || "全库",caseId:id,filters,
    ids:candidates(id,filters,"all",null).map(a=>a.id),selection:null,gridSystem:"h3",layer:"all",camera:{center:[10,46],zoom:2,reason:"test"}};
}
test("all 20 tasks, exploration cases and the entire catalog round-trip through portable JSON",()=>{
  for(const id of [null,...cases.map(c=>c.id)]) {
    const snapshot=createResearchList(scope(id));
    const restored=parseResearchList(JSON.stringify(snapshot));
    assert.deepEqual(restored,JSON.parse(JSON.stringify(snapshot)));
    assert.deepEqual(unavailableItems(restored),[]);
    assert(listMarkdown(restored).includes(snapshot.items[0].title));
  }
});
test("invalid role, displaced cell coordinate, dangling evidence and inconsistent edition cannot silently restore",()=>{
  const saved=createResearchList(scope("Q08"));
  const invalid=structuredClone(saved); invalid.batch.filters.need=781;
  assert.throws(()=>parseResearchList(JSON.stringify(invalid)));
  const grid=gridSpec("h3",2);
  const offset=structuredClone(saved);
  offset.batch.selection={grid,id:cellAt([10,46],grid),point:[-145,62]};
  assert.throws(()=>parseResearchList(JSON.stringify(offset)));
  const dangling=structuredClone(saved);
  dangling.assessment.findings[0].evidenceIds.push("bogus");
  assert.throws(()=>parseResearchList(JSON.stringify(dangling)));
  const stale=structuredClone(saved); stale.items[0].version="old other edition";
  assert.deepEqual(unavailableItems(stale).map(i=>i.id),[saved.items[0].id]);
});
