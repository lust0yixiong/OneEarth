import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {PaperEvidenceCard} from "../components/PaperEvidenceCard";
import test from "node:test";
import assert from "node:assert/strict";
import {evidenceGroups,linkedPapers} from "./answer-sources";
import {assets} from "./datasets";
import type {AnswerReference} from "./types";

test("source tabs keep publisher catalogues apart from Haina data and paper evidence",()=>{
  const local=assets.find(a=>a.origins.includes("haina"))!;
  const refs:AnswerReference[]=[
    {kind:"asset",id:"Q05-1",title:"OISST",source:"NOAA NCEI"},
    {kind:"asset",id:local.id,title:local.title,source:local.source},
    {kind:"asset",id:"earthnano:"+"a".repeat(64),title:"Argo",source:"EarthNano"},
    {kind:"web",title:"Documentation",url:"https://example.org"},
    {kind:"asset",id:"unknown",title:"Older saved source",source:"Catalogue"},
  ];
  const groups=evidenceGroups(refs);
  assert.deepEqual(groups.local,[refs[1]]);
  assert.deepEqual(groups.papers,[refs[2]]);
  assert.deepEqual(groups.network,[refs[0],refs[3],refs[4]]);
});

test("public catalogue entries are not assertion evidence merely because they link to papers",()=>{
  const ids=["Q20-1","Q19-2/pangaea:891368","Q14-4","glacier-2"];
  const refs:AnswerReference[]=ids.map(id=>({
    kind:"asset",id,title:assets.find(a=>a.id===id)!.title,source:"公开发布 / 归档",
  }));
  const grouped=evidenceGroups(refs);
  assert.deepEqual(grouped.papers,[]);
  assert.deepEqual(grouped.local,[]);
  assert.deepEqual(grouped.network,refs);
  assert.match(assets.find(a=>a.id==="Q20-1")!.paperSource!.title,/Frontal ablation/);
});

test("Haina data with a paper link belongs only to the local source group",()=>{
  const local=assets.find(a=>a.origins.includes("haina"))!;
  const prior=local.paperSource;
  try{
    local.paperSource={title:"A paper using this local dataset"};
    const ref:AnswerReference={kind:"asset",id:local.id,title:local.title,source:local.source};
    const grouped=evidenceGroups([ref]);
    assert.deepEqual(grouped.local,[ref]);
    assert.deepEqual(grouped.papers,[]);
    assert.deepEqual(grouped.network,[]);
  }finally{local.paperSource=prior;}
});


test("Haina paper links list multiple papers without duplicating a legacy link",()=>{
  const local=assets.find(a=>a.origins.includes("haina"))!;
  const prior=local.paperSources,legacy=local.paperSource;
  try{
    const first={title:"First paper",url:"https://example.org/paper1"};
    local.paperSource=first;
    local.paperSources=[first,{title:"Second paper",url:"https://example.org/paper2"}];
    assert.equal(linkedPapers(local).length,2);
    const ref:AnswerReference={kind:"asset",id:local.id,title:local.title,source:local.source};
    assert.deepEqual(evidenceGroups([ref]).papers,[]);
    assert.deepEqual(evidenceGroups([ref]).local,[ref]);
    const html=renderToStaticMarkup(createElement(PaperEvidenceCard,{reference:ref}));
    assert.match(html,/First paper/);assert.match(html,/Second paper/);
    assert.equal((html.match(/class="oe-paper-study"/g)||[]).length,2);
    assert.ok(!html.includes("海纳目录元数据"),"dataset metadata cannot stand in for paper evidence");

  }finally{local.paperSources=prior;local.paperSource=legacy;}
});
