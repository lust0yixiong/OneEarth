import assert from "node:assert/strict";
import test from "node:test";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import express from "express";
import {dataAccessIndex,dataAccessRouter} from "./data-access";
import {assetById,registerPapers,type Asset} from "../src/domain/datasets";
import {paperCatalogSummary,type PaperRecord} from "../src/domain/paper-record";
import type {AccessCatalogues,AccessQuery} from "../src/domain/data-access";

const query:AccessQuery={section:"clues",query:"",type:"",source:"",page:0,limit:30};
const publication:AccessCatalogues={paper:{state:"ready",revision:"controlled-a",total:60000,checkedAt:"2026-11-25T00:00:00Z"},haina:{state:"unavailable"}};
function asset(i:number,origin="public"):Asset{return {id:"catalogue-load-"+i,datasetId:"doi:10.9999/synthetic-"+i,caseId:"synthetic",needIndex:0,title:"Synthetic "+String(i).padStart(5,"0"),type:"Dataset",categories:["Dataset"],status:"Catalogue only",fit:"Catalogue",why:"",source:origin,origins:[origin],url:"https://example.org/"+i,description:"temperature region "+i,profile:{role:"data",spatial:"coverage",coverage:"Synthetic",access:"Public",limitation:""},kind:"dataset",tabs:[]};}

test("a shared DOI finds the same dataset under each source even when the public row uses a local alias",()=>{
 const index=dataAccessIndex(":memory:");
 try {
  const doi="10.9999/shared-dataset";
  const indexed={...asset(1,"haina"),datasetId:"doi:"+doi};
  const publicRow={...asset(2),datasetId:"public:local-alias",url:"https://doi.org/"+doi};
  index.replace([indexed,publicRow]);
  for(const source of ["","haina","public"]){
   const result=index.search({...query,query:doi,source});
   assert.equal(result.total,1);
   assert.equal(result.rows[0].key,"doi:"+doi);
   assert.deepEqual(result.rows[0].relatedIds.slice().sort(),[indexed.id,publicRow.id].sort());
  }
 } finally {index.close();}
});

test("60k background WAL replacement serves one whole prior generation until commit and survives restart",async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),"oneearth-access-60k-")),file=path.join(dir,"index.sqlite");
 let index=dataAccessIndex(file);
 const app=express();app.use(express.json());app.use(dataAccessRouter(index,()=>{}));
 const server=app.listen(0,"127.0.0.1");await new Promise(r=>server.once("listening",r));
 const address=server.address();assert.ok(address&&typeof address!=="string");const url="http://127.0.0.1:"+address.port+"/search";
 async function read(changes:Partial<AccessQuery>={}){const response=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...query,...changes})});assert.equal(response.status,200);return response.json();}
 try{
  index.replace([asset(-1)]);const before=index.search(query).revision;
  const records=Array.from({length:60000},(_,i)=>asset(i,i%2?"public":"haina"));
  const started=performance.now();let done=false;
  const pending=index.replaceAsync(records,undefined,publication).then(()=>{done=true;});
  const during=await read();assert.equal(done,false);assert.equal(during.total,1);assert.equal(during.revision,before);assert.equal(during.rows[0].asset.id,"catalogue-load--1");
  await pending;
  const first=await read(),last=await read({page:1999}),named=await read({query:"region 59999"});
  assert.equal(first.total,60000);assert.equal(first.rows[0].asset.id,"catalogue-load-0");assert.equal(last.rows.at(-1).asset.id,"catalogue-load-59999");assert.equal(last.page,1999);
  assert.equal(named.total,1);assert.equal(named.rows[0].asset.id,"catalogue-load-59999");
  assert.equal((await read({source:"public"})).total,30000);assert.equal((await read({source:"haina"})).total,30000);
  assert.deepEqual(index.snapshot(),publication);assert.ok(first.revision>before);
  console.log(JSON.stringify({syntheticRows:60000,buildAndQueriesMs:performance.now()-started,duringRows:during.total,afterRows:first.total,oldRevision:before,newRevision:first.revision}));
  const finalRevision=first.revision;index.close();index=dataAccessIndex(file);
  assert.equal(index.initialized(),true);assert.equal(index.search(query).total,60000);assert.equal(index.search(query).revision,finalRevision);assert.deepEqual(index.snapshot(),publication);
 }finally{server.closeAllConnections();server.close();index.close();await rm(dir,{recursive:true,force:true});}
});

test("a failed staged index update rolls back rows, FTS, revision and publication together",async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),"oneearth-access-rollback-")),index=dataAccessIndex(path.join(dir,"index.sqlite"));
 try{
  index.replace([asset(0)],undefined,publication);const before=index.search(query);
  const records=Array.from({length:1000},(_,i)=>asset(i));records[999]={...records[999],description:"UncommittedOnlyText"};records.push({...asset(1001),description:null as unknown as string});
  await assert.rejects(index.replaceAsync(records,undefined,{...publication,paper:{...publication.paper,revision:"bad"}}));
  assert.deepEqual(index.snapshot(),publication);assert.equal(index.search(query).revision,before.revision);assert.equal(index.search(query).total,1);assert.equal(index.search({...query,query:"UncommittedOnlyText"}).total,0);
 }finally{index.close();await rm(dir,{recursive:true,force:true});}
});

test("an unavailable publisher cannot delete its persisted whole-source rows while another source advances",async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),"oneearth-access-source-")),index=dataAccessIndex(path.join(dir,"index.sqlite"));
 try{
  index.replace([asset(0,"haina"),asset(1)]);await index.replaceAsync([asset(2)],undefined,undefined,["haina"]);
  assert.equal(index.search(query).total,2);assert.equal(index.search({...query,source:"haina"}).rows[0].asset.id,"catalogue-load-0");assert.equal(index.search({...query,source:"public"}).rows[0].asset.id,"catalogue-load-2");
 }finally{index.close();await rm(dir,{recursive:true,force:true});}
});

test("metadata-only published entries remain searchable without a fabricated paper use or reading receipt",()=>{
 const metadata:PaperRecord={id:"earthnano:"+"e".repeat(64),dsKey:"doi:10.9999/metadata-only-fixture",assertionCatalogKind:"metadata-only",papers:0,paperTitle:"",studyContext:"",points:[],researchQuestions:[],need:{name:"Dataset",product:"Metadata-only fixture",type:"Dataset",source:"文献资料",status:"有数据集元数据",detail:"source metadata",url:"https://doi.org/10.9999/metadata-only-fixture",profile:{role:"data",spatial:"coverage",coverage:"Source declared region",years:[2020,2021],access:"DOI only",limitation:"Original files not obtained"},tabs:[{kind:"table",label:"数据集时空元数据",rows:[["Identity","metadata-only","Source metadata"]]}]}};
 registerPapers([paperCatalogSummary(metadata)],false);const index=dataAccessIndex(":memory:");
 try{index.replace([assetById.get(metadata.id)!]);
  const page=index.search({...query,source:"paper",query:"Metadata-only"});assert.equal(page.total,1);assert.equal(page.rows[0].papers,0);assert.deepEqual(page.rows[0].evidenceKinds,["数据集元数据"]);
  assert.equal(index.search({...query,scope:{period:[2020,2020]} as AccessQuery["scope"]}).total,1);assert.equal(index.search({...query,scope:{period:[2023,2023]} as AccessQuery["scope"]}).total,0);
  assert.equal("tabs" in page.rows[0].asset,false);assert.equal(page.rows[0].asset.profile?.access,"DOI only");assert.equal(page.rows[0].asset.profile?.limitation,"Original files not obtained");
 }finally{index.close();}
});
