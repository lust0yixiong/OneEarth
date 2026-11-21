import test from "node:test";
import assert from "node:assert/strict";
import {literatureText,literatureDisplay} from "./literature-label";
import {registerPapers,assetById} from "./datasets";
import {validPaperRecord,type PaperRecord} from "./paper-record";

test("public source prose uses one name while IDs and links retain their targets",()=>{
  assert.equal(literatureText("EarthNano 论文断言库 · EarthNano 断言库 · 论文断言库 · 断言库 · EarthNano"),
    "文献资料 · 文献资料 · 文献资料 · 文献资料 · 文献资料");
  const id="earthnano:"+"a".repeat(64),url="https://example.org/EarthNano/dataset";
  const original={id,url,text:"已查询论文断言库",trace:{source:"EarthNano",output:'{"source":"EarthNano 论文断言库"}'}};
  const shown=literatureDisplay(original);
  assert.equal(shown.id,id);
  assert.equal(shown.url,url);
  assert.equal(shown.text,"已查询文献资料");
  assert.equal(shown.trace.output,'{"source":"文献资料"}');
  assert.equal(original.trace.source,"EarthNano");
});

test("legacy and newly labeled records can be restored with the same identity",()=>{
  const record:PaperRecord={
    id:"earthnano:"+"123abc".repeat(10)+"1234",dsKey:"test:literature-label",papers:1,
    paperTitle:"Study",studyContext:"",points:[],
    need:{name:"论文研究数据",product:"Dataset",type:"data",status:"used",
      source:"EarthNano 论文断言库",detail:"用法来自断言库",datasetId:"test:literature-label",
      profile:{role:"data",spatial:"nonspatial",coverage:"未提供坐标",access:"见断言库",limitation:""},
      tabs:[{kind:"table",label:"论文用法（本页）",rows:[["Study","Usage","","","paper-id","dataset-id"]]}]},
  };
  assert.ok(validPaperRecord(record));
  assert.ok(validPaperRecord({...record,need:{...record.need,source:"文献资料"}}));
  registerPapers([record],false);
  const asset=assetById.get(record.id)!;
  assert.equal(asset.source,"文献资料");
  assert.equal(asset.description,"用法来自文献资料");
  assert.equal(asset.profile?.access,"见文献资料");
  assert.equal(record.need.source,"EarthNano 论文断言库");
});
