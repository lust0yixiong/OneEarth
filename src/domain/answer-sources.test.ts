import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {PaperEvidenceCard} from "../components/PaperEvidenceCard";
import test from "node:test";
import assert from "node:assert/strict";
import {citationDetails,evidenceGroups,linkedPapers} from "./answer-sources";
import {assets} from "./datasets";
import {paperRecords} from "./paper-record";
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


test("a grid catalogue citation does not advertise excerpts bundled with its exact record",()=>{
  const ref={kind:"asset",id:"earthnano:"+"6".repeat(64),title:"A saved catalogue record",source:"文献资料"} as const;
  paperRecords.set(ref.id,{id:ref.id,dsKey:"fixture:catalogue-only",papers:1,paperTitle:"Paper",studyContext:"",points:[],
    need:{name:"Record",type:"资料",product:ref.title,status:"已保存",source:ref.source,detail:"",
      tabs:[{kind:"text",label:"原文 · 方法",quote:"A quotation from a different reading step."}]}});
  try{
    assert.equal(citationDetails(ref).evidence,"原文摘录");
    const scoped=citationDetails({...ref,evidenceLevel:"catalogue-record"});
    assert.equal(scoped.type,"paper");
    assert.equal(scoped.evidence,"所附网格内可定位的已保存目录条目");
  }finally{paperRecords.delete(ref.id);}
});
