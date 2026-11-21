import test from "node:test";
import assert from "node:assert/strict";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {searchPapers} from "../../server/earthnano";
import {catalogueRows} from "../../server/chat-executor";
import {emptyFilters} from "./spatial";
import type {DiscoveryContext} from "./types";

test("assertion research questions and dataset combinations reach the answer with matched paper and dataset identities",async t=>{
  const key="doi:10.5285/115d5e4ebf7148ec941423ec86fa9f26";
  t.mock.method(Client.prototype,"connect",async()=>{});
  t.mock.method(Client.prototype,"close",async()=>{});
  t.mock.method(Client.prototype,"callTool",async(request:{name:string;arguments:Record<string,unknown>})=>{
    const payload=request.name==="resolve_dataset"
      ?{status:"ok",has_more:false,entities:[{ds_key:key,display_name:"HadEX3",n_papers:1}]}
      :request.name==="search_dataset_usage"
      ?{status:"ok",usages:[{ds_key:key,paper_id:"p1",dataset_id:"D1",paper_title:"Climate indicators",variables:"TXx",roles:[{role:"input",desc:"Temperature extremes comparison"}]}]}
      :request.name==="search_recipes" && request.arguments.rq_id
      ?{status:"ok",recipe:{paper_id:"p1",rq_id:"RQ8",paper_title:"Climate indicators",
        task:"How do datasets compare for global annual maximum temperature?",n_members:1,n_steps:1,
        members:[{ds_key:key,dataset_id:"D1",display_name:"HadEX3",enters_steps:["RQ8_S1"]}],
        steps:[{step_id:"RQ8_S1",order:1,type:"variable_derivation",name:"Derive TXx",purpose:"Compare anomalies",method:"Compute anomalies using the reported reference period."}]}}
      :request.name==="search_recipes"
      ?{status:"ok",companion_overview:[],recipes:[
        {paper_id:"p1",rq_id:"RQ8",paper_title:"Climate indicators",task:"How do datasets compare for global annual maximum temperature?",
          members:[{name:"HadEX3",ds_key:key},{name:"ERA5",ds_key:"name:ERA5"},{name:"Berkeley Earth",ds_key:"name:Berkeley"}],n_steps:2},
        {paper_id:"other",rq_id:"RQ9",task:"Unrelated paper question",members:[{name:"HadEX3",ds_key:key}]},
        {paper_id:"p1",rq_id:"RQ10",task:"Unrelated dataset question",members:[{name:"Other",ds_key:"doi:10.1234/other"}]},
      ]}
      :request.name==="get_evidence"
      ?{status:"ok",row:{ds_key:key,paper_id:"p1",dataset_id:"D1"},claims:[{kind:"step",ref:"1",evidence_blocks:["B0001"]}],
        evidence:[{block_id:"B0001",section:"Methods",quote:"We compared annual maximum temperature across three datasets.",supports:[{kind:"step",ref:"1"}]}],
        pagination:{total_hits:1,has_more:false}}
      :{status:"ok"};
    return {content:[{type:"text",text:JSON.stringify(payload)}]};
  });
  const found=await searchPapers({name:key.slice(4),facets:[],region:[]},new AbortController().signal,()=>{});
  assert.equal(found.records.length,1);
  const record=found.records[0];
  assert.equal(record.researchQuestions?.length,1);
  assert.deepEqual(record.researchQuestions?.[0],{
    paperId:"p1",rqId:"RQ8",datasetId:"D1",paperTitle:"Climate indicators",
    question:"How do datasets compare for global annual maximum temperature?",
  });
  assert.deepEqual(record.researchPaths?.[0].members[0].stepIds,["RQ8_S1"]);
  assert.equal(record.researchPaths?.[0].steps[0].type,"variable_derivation");
  assert.deepEqual(record.evidenceLinks?.[0].claims[0].blockIds,["B0001"]);
  const context={caseId:null,filters:emptyFilters(),selection:null} as DiscoveryContext;
  const material=catalogueRows("Compare annual maximum temperature",context,{message:"",paperOnly:true},[],found.records,undefined,"paper")[0];
  assert.ok("researchQuestions" in material && "researchCombinations" in material);
  assert.equal(material.researchQuestions?.[0].rqId,"RQ8");
  assert.ok("researchPaths" in material && "evidenceLinks" in material);
  assert.equal(material.researchPaths?.[0].steps[0].stepId,"RQ8_S1");
  assert.equal(material.evidenceLinks?.[0].blocks[0].supports[0].ref,"1");
  assert.equal(material.excerpts.filter(e=>e.label.startsWith("原文")).length,material.excerpts.length,
    "compiled method descriptions must not be presented as literal paper quotations");
  assert.match(JSON.stringify(material.researchCombinations),/HadEX3.*ERA5.*Berkeley/s);
  assert.doesNotMatch(JSON.stringify(material),/Unrelated paper question|Unrelated dataset question/);
  assert.match(JSON.stringify(material),/B0001.*We compared annual maximum temperature/s);
});
