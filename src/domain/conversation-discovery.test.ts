import test from "node:test";
import assert from "node:assert/strict";
import {discoverConversation} from "../../server/conversation-discovery";
import {cellAt,emptyFilters,gridSpec} from "./spatial";
import type {DiscoveryContext} from "./types";
const grid=gridSpec("s2",2),point:[number,number]=[103.4,36.7];
const context=():DiscoveryContext=>({caseId:null,filters:emptyFilters(),selection:{grid,id:cellAt(point,grid),point},
  camera:{center:point,zoom:17.4,reason:"定位网格"},gridSystem:"s2",layer:"all",citation:null});
test("a stored S2 level and old navigation text cannot zoom out, change view, or clear a selected research grid",()=>{
  const ctx=context();
  for(const summary of ["用户正在核对S2 L5网格内的资料，保留范围。","用户此前放大查看资料，仍以当前网格为范围。","打开数据目录"]){
    const r=discoverConversation("在当前网格内，哪些资料有空间依据？保持范围。",ctx,summary);
    assert.equal(r.camera,undefined);assert.equal(r.gridSystem,undefined);assert.equal(r.view,undefined);
    assert.equal(r.clearSelection,false);assert.doesNotMatch(r.message,/已按指定网格|已调整球面|已打开/);
  }
  assert.equal(ctx.camera.zoom,17.4);
});
test("an actual grid-level command still acts on the user's requested level rather than the summary",()=>{
  const r=discoverConversation("切换S2 L6",context(),"此前用H3 R2，后改用S2 L5。");
  assert.equal(r.gridSystem,"s2");assert.match(r.camera!.reason,/L6/);
});
test("a short condition reply can resolve its research object without moving the original grid",()=>{
  const r=discoverConversation("只把时间改为2000—2010年",context(),"用户研究北极海冰与PDO同月份关系，当前S2 L5。");
  assert.ok(r.research);assert.equal(r.caseId,"Q08");
  assert.deepEqual(r.filters?.period,[2000,2010]);assert.equal(r.camera,undefined);assert.equal(r.clearSelection,false);
});
