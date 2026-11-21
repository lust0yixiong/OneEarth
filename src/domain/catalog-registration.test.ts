import test from "node:test";
import assert from "node:assert/strict";
import {assetById,assets,catalogRevision,registerObservations,registerPapers,subscribeCatalog} from "./datasets";
import {answerEvidence} from "./answer-map";
import {emptyFilters} from "./spatial";
import type {CandidateSet} from "./types";
import type {PaperRecord} from "./paper-record";
import type {Observation} from "./push-observations";
const batch=(id:string):CandidateSet=>({title:"saved answer",ids:[id],caseId:null,filters:emptyFilters(),selection:null,layer:"all",gridSystem:"h3",camera:{center:[105,25],zoom:1,reason:"world"}});
test("loading a referenced paper invalidates cached map evidence without adding it to the catalogue feed",()=>{
  const record:PaperRecord={id:"earthnano:"+"f".repeat(64),dsKey:"test:late-paper",papers:1,paperTitle:"paper",studyContext:"study is not data coverage",points:[],need:{name:"data",product:"data",datasetId:"test:late-paper",type:"test",source:"EarthNano 论文断言库",status:"used",detail:"metadata",profile:{role:"data",spatial:"coverage",coverage:"official envelope",areaBasis:"bounding-box",area:{type:"Polygon",coordinates:[[[130,20],[130,40],[150,40],[150,20],[130,20]]]},access:"public",limitation:"metadata only"},tabs:[{kind:"table",label:"论文用法（本页）",rows:[["","","","","paper","question"]]}]}};
  const b=batch(record.id);assert.equal(answerEvidence(b).size,0);
  let changes=0;const stop=subscribeCatalog(()=>changes++),before=catalogRevision();
  try {
    registerPapers([record],false);
    assert.equal(catalogRevision(),before+1);assert.equal(changes,1);
    assert.equal(answerEvidence(b).get(record.id)?.kind,"range");
    assert.equal(answerEvidence(b).get(record.id)?.coverageGeometries?.length,1);
    assert.ok(assetById.has(record.id));assert.ok(!assets.some(a=>a.id===record.id));
    registerPapers([record],false);assert.equal(changes,1,"reloading the same record does not trigger another redraw");
  } finally {stop();}
});
test("loading a referenced observation invalidates its cached position without changing the working feed",()=>{
  const record:Observation={key:"b".repeat(64),sourceId:"test",sourceName:"test",test:false,collection:"test",id:"one",revision:1,title:"point",satellite:"test",observedAt:"2026-01-01T00:00:00Z",publishedAt:null,receivedAt:"2026-01-02T00:00:00Z",geometry:{type:"Point",coordinates:[130,30]},measurements:[],productUrl:null,file:null};
  const id="constellation:"+record.key,b=batch(id);assert.equal(answerEvidence(b).size,0);
  const before=catalogRevision();registerObservations([record],false);
  assert.equal(catalogRevision(),before+1);assert.equal(answerEvidence(b).get(id)?.kind,"local");
  assert.ok(!assets.some(a=>a.id===id));
});
