import test from "node:test";
import assert from "node:assert/strict";
import {onlySource,expandsSources} from "./research-question";
import {discoverConversation} from "../../server/conversation-discovery";
import {emptyFilters} from "./spatial";
import type {DiscoveryContext} from "./types";

test("negating an exclusive source request does not impose the opposite restriction",()=>{
  for(const q of ["不要只用论文，海纳和发布方资料也看看。","不是只看论文，海纳也要。","别仅用海纳，论文和发布方也看看。",
    "不希望只从断言库查资料。","不应该只用星座数据。","不要只用论文"]){
    assert.equal(onlySource(q),undefined,q);assert.equal(expandsSources(q),true,q);
  }
  assert.equal(onlySource("只用论文，海纳暂不查"),"paper");
  assert.equal(onlySource("不要把论文当实测，这轮只看海纳"),"haina");
  assert.equal(onlySource("不要只用论文，改为只用海纳"),"haina");
});

test("R2 in a model evaluation question is not a grid navigation command, even without a selected cell",()=>{
  const context:DiscoveryContext={caseId:null,filters:emptyFilters(),selection:null,gridSystem:"s2",layer:"all",citation:null,
    camera:{center:[105,25],zoom:12,reason:"用户浏览"}};
  for(const q of ["水文模型训练集上的 R2 是0.8，能保证换个时段也准确吗？","H3 R5与S2 L6有什么区别，数据量能直接比较吗？","为什么切换到H3 R5后数量不同？"]){
    const r=discoverConversation(q,context,"用户在核对模型与数据的适用性。");
    assert.equal(r.gridSystem,undefined,q);assert.equal(r.camera,undefined,q);
    assert.notEqual(r.clearSelection,true,q);assert.doesNotMatch(r.message,/已按指定网格|已切换网格/);
  }
  const command=discoverConversation("切换H3 R5",context,"当前正在比较模型指标。");
  assert.equal(command.gridSystem,"h3");assert.match(command.camera!.reason,/R5/);
  const polite=discoverConversation("可以帮我把网格切换到 H3 R5 吗？",context,"当前正在比较模型指标。");
  assert.equal(polite.gridSystem,"h3");assert.match(polite.camera!.reason,/R5/);
});
