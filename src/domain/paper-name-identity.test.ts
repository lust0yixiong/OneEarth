import test from "node:test";
import assert from "node:assert/strict";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {paperNameIdentity} from "../../server/paper-name-identity";
import {readPaperPlan,paperNameMatches,searchPapers} from "../../server/earthnano";
const doi="10.5880/gfz.2.1.2019.001";
const sn144='Supplementary information to "Deep low-frequency earthquakes reveal ongoing magmatic recharge beneath Laacher See Volcano (Eifel, Germany)": Moment tensor inversion report (DOI: 10.5880/gfz.2.1.2019.001)';
const plan=(name:string)=>({name,facets:[],region:[]});

test("SN144's title and its one explicit DOI resolve to the precise identity before title truncation",()=>{
 assert.deepEqual(paperNameIdentity(sn144),{kind:"unique",dois:[doi],doi});
 const parsed=readPaperPlan(JSON.stringify(plan("Long descriptive title ".repeat(20)+sn144)));
 assert.equal(parsed.name,doi);assert.ok(parsed.requestedName?.startsWith("Long descriptive title"));
});

test("DOI resolver URLs ignore URL parameters, decode paths and trim enclosing punctuation without dropping suffix versions",()=>{
 for(const input of ["(https://dx.doi.org/10.5880/GFZ.2.1.2019.001).","报告 DOI：10.5880/gfz.2.1.2019.001。","DOI：10.5880/gfz.2.1.2019.001．","“10.5880/gfz.2.1.2019.001”！","（DOI：10.5880/gfz.2.1.2019.001）","\'10.5880/gfz.2.1.2019.001\'","https://doi.org/10.5880%2Fgfz.2.1.2019.001?download=1#table"])
  assert.equal(paperNameIdentity(input).kind==="unique"&&(paperNameIdentity(input) as {doi:string}).doi,doi);
 assert.deepEqual(paperNameIdentity("Dataset (DOI:10.6084/m9.figshare.1234.v2);"),{kind:"unique",dois:["10.6084/m9.figshare.1234.v2"],doi:"10.6084/m9.figshare.1234.v2"});
 assert.equal((paperNameIdentity("10.1234/sample(2024).") as {doi:string}).doi,"10.1234/sample(2024)");
});

test("repeated spellings of one DOI are one identity; two DOIs or versions remain ambiguous even beyond 240 characters",()=>{
 assert.equal(paperNameIdentity(`${doi.toUpperCase()} https://doi.org/${doi}`).kind,"unique");
 for(const name of [`${doi};10.1234/other`,`https://doi.org/${doi};https://doi.org/10.1234/other`,`${doi} ${"title ".repeat(60)} 10.1234/other`,"10.6084/m9.figshare.1234.v1 10.6084/m9.figshare.1234.v2"]){
  assert.equal(paperNameIdentity(name).kind,"ambiguous");
  assert.equal(paperNameIdentity(readPaperPlan(JSON.stringify(plan(name))).name).kind,"ambiguous");
 }
});

test("a non-DOI versioned name is not reduced to a core product",()=>{
 const parsed=readPaperPlan(JSON.stringify(plan("alphaMELTS RC12frac")));
 assert.equal(parsed.name,"alphaMELTS RC12frac");assert.equal(paperNameIdentity(parsed.name).kind,"none");
});

test("an explicit DOI constrains every resolver match label, including claimed exact matches",()=>{
 for(const matched_via of ["contains","exact","doi",undefined]){
  assert.equal(paperNameMatches(sn144,{ds_key:"doi:"+doi.toUpperCase(),matched_via}),true);
  assert.equal(paperNameMatches(sn144,{ds_key:"doi:10.17632/kbzymp8szc.1",display_name:sn144,matched_via}),false);
 }
 assert.equal(paperNameMatches(`${doi} 10.1234/other`,{ds_key:"doi:"+doi,matched_via:"exact"}),false);
});

test("the complete SN144 title is sent as only its DOI and unrelated resolver entities never trigger usage expansion",async t=>{
 t.mock.method(Client.prototype,"connect",async()=>{});t.mock.method(Client.prototype,"close",async()=>{});
 const requests:{name:string;arguments:Record<string,unknown>}[]=[];
 const correct={ds_key:"doi:"+doi,display_name:"Moment tensor inversion report",n_papers:1,matched_via:"exact"};
 t.mock.method(Client.prototype,"callTool",async (request:{name:string;arguments:Record<string,unknown>})=>{
  requests.push(request);const {name,arguments:a}=request;
  const payload=name==="resolve_dataset"?{status:"ok",entities:[{...correct,ds_key:"doi:10.17632/kbzymp8szc.1",n_papers:99},correct]}:
   name==="search_dataset_usage"?{status:"ok",usages:[{ds_key:a.ds_key,paper_id:"p1",dataset_id:"D1",paper_title:"Laacher See observations"}]}:{status:"ok"};
  return {isError:false,content:[{type:"text",text:JSON.stringify(payload)}]};
 });
 const result=await searchPapers(plan(sn144),new AbortController().signal,()=>{});
 assert.equal(requests[0].arguments.name,doi);assert.deepEqual(result.records.map(r=>r.dsKey),["doi:"+doi]);
 assert.ok(!requests.some(r=>JSON.stringify(r.arguments).includes("kbzymp8szc")));
});

test("an unknown DOI embedded in a weak title never turns into a generic lexical replacement",async t=>{
 t.mock.method(Client.prototype,"connect",async()=>{});t.mock.method(Client.prototype,"close",async()=>{});
 const requests:{name:string;arguments:Record<string,unknown>}[]=[];
 t.mock.method(Client.prototype,"callTool",async (request:{name:string;arguments:Record<string,unknown>})=>{
  requests.push(request);return {isError:false,content:[{type:"text",text:JSON.stringify({status:"not_found",entities:[{ds_key:"doi:10.1234/unrelated",display_name:"supplementary information",n_papers:1}]})}]};
 });
 const result=await searchPapers(readPaperPlan(JSON.stringify(plan("Supplementary information (https://doi.org/10.1234/missing.v2)."))),new AbortController().signal,()=>{});
 assert.deepEqual(requests.map(r=>r.name),["resolve_dataset"]);assert.equal(requests[0].arguments.name,"10.1234/missing.v2");
 assert.deepEqual(result.records,[]);assert.deepEqual(result.incomplete,[]);assert.match(result.notices!.join(" "),/不以词法近似/);
});

test("ambiguous DOI input performs no upstream lookup or independent topic expansion",async t=>{
 let connected=false;t.mock.method(Client.prototype,"connect",async()=>{connected=true;});
 const result=await searchPapers({...readPaperPlan(JSON.stringify(plan(`${doi} and 10.1234/other`))),facets:[{need:"inversion",queries:["moment tensor"]}]},new AbortController().signal,()=>{});
 assert.equal(connected,false);assert.deepEqual(result.records,[]);assert.deepEqual(result.tools,[]);assert.match(result.notices!.join(" "),/多个不同 DOI/);
});

test("an external title version remains traceable and is not treated as verified by a concept DOI lookup",async t=>{
 t.mock.method(Client.prototype,"connect",async()=>{});t.mock.method(Client.prototype,"close",async()=>{});
 const requests:{arguments:{name?:string}}[]=[];
 t.mock.method(Client.prototype,"callTool",async (r:{arguments:{name?:string}})=>{requests.push(r);return {content:[{type:"text",text:JSON.stringify({status:"not_found"})}]};});
 const parsed=readPaperPlan(JSON.stringify(plan("Dataset version 2.0 (DOI:10.1234/concept)")));
 assert.match(parsed.requestedName!,/version 2.0/);
 const result=await searchPapers(parsed,new AbortController().signal,()=>{});
 assert.equal(requests[0].arguments.name,"10.1234/concept");assert.match(result.notices!.join(" "),/版次仍需/);
});

test("a DOI attached to the named dataset survives planning without taking an article DOI elsewhere",async()=>{
  const {explicitDatasetName}=await import("../../server/paper-name-identity");
  const id="10.5285/115d5e4ebf7148ec941423ec86fa9f26";
  assert.equal(explicitDatasetName("HadEX3 v3.0.4（DOI: "+id+"）与ERA5的研究路径","HadEX3 v3.0.4"),id);
  assert.equal(explicitDatasetName("论文 DOI: "+id+" 中的 HadEX3 如何使用","HadEX3"),"HadEX3");
  assert.equal(explicitDatasetName("HadEX3（DOI: "+id+"）和 10.1234/other 比较","HadEX3"),"HadEX3");
  assert.equal(explicitDatasetName("一般方法 DOI: "+id,""),"");
});
