import test from "node:test";
import assert from "node:assert/strict";
import fixture from "./fixtures/assertion-path-response.json";
import {readResearchPath} from "../../server/assertion-relations";
import {complementInput,complementPlan,complementSchema} from "../../server/web-complement";
import type {Asset} from "./datasets";
import {pagesToRead} from "../../server/fetch-pages";
import {searchSources} from "../../server/web-search";
import {requiredDataSearch,type DataSearchPlan} from "../../server/data-search";
import type {PaperRecord} from "./paper-record";
import type {SearchRun,ToolCall} from "./types";

const doi="10.5285/115d5e4ebf7148ec941423ec86fa9f26",paperId="d7f607af-4592-45f3-8c86-5567dd98c67b";
const path=readResearchPath(fixture["recipe-detail"],paperId,"RQ8","doi:"+doi,[{paper_id:paperId,dataset_id:"D18",ds_key:"doi:"+doi}])!;
const record={id:"earthnano:"+"a".repeat(64),dsKey:"doi:"+doi,papers:1,paperTitle:path.paperTitle,studyContext:"Climate extremes",
  points:[],researchPaths:[path],need:{product:"HadEX3 v3.0.4",url:"https://doi.org/"+doi,tabs:[
    {label:"论文用法（本页）",kind:"table",rows:[[path.paperTitle,"TXx derived from annual maximum temperature","TXx","global land",paperId,"D18","10.5194/essd-16-2625-2024"]]},
    {label:"原文",kind:"text",quote:"B001 · Methods\nAnnual maximum temperature is averaged over land excluding Antarctica."},
  ]}} as unknown as PaperRecord;
const queries=[{web:"HadEX3 TXx method baseline",dataset:"HadEX3"}];
const haina={assets:[],total:0,synced:"",endpoint:"https://example.org/catalogue",warning:""};
const plan:DataSearchPlan={questionMode:"preserve",dataQuestion:"核对TXx方法",dataNeed:null,hainaQueries:["TXx"],
  paper:{name:"",facets:[{need:"TXx方法",queries:["climate extremes"]}],region:[],scenario:[]},web:queries};

test("complement planning receives real method steps and keeps dataset and paper identities separate",()=>{
  const input=complementInput("核对TXx方法","全球陆地",queries,"",[record],[],[]);
  const dataset=input.entities.find(e=>e.kind==="dataset")!,paper=input.entities.find(e=>e.kind==="paper")!;
  assert.equal(dataset.doi,doi);assert.equal(paper.doi,"10.5194/essd-16-2625-2024");
  assert.match(JSON.stringify(dataset.paths),/RQ8_S1/);assert.match(JSON.stringify(dataset.paths),/0.52/);
  const result=complementPlan(JSON.stringify({checks:[{entityId:paper.id,goal:"method",terms:"TXx baseline offset",reason:"核对路径中的基准期平移方法"}]}),input);
  assert.equal(result.targets[0].referenceType,"paper");assert.equal(result.targets[0].doi,paper.doi);
  assert.deepEqual(result.queries,[],"a known original paper address needs a read, not rediscovery");
  assert.equal(result.strict,false);assert.equal(input.question,"核对TXx方法");
});
test("named prior and first-pass DOI records can be checked when assertions do not contain the target",()=>{
  const doi="10.5061/dryad.76hdr7t90",title="Data from: Quantifying and comparing diel dynamics of fish communities using eDNA metabarcoding";
  const runs:SearchRun[]=[{engine:"DataCite",query:"fish",status:"done",hits:[{title,url:"https://doi.org/"+doi,doi,snippet:"metadata"}]}];
  for(const sources of [runs,[]]){
    const input=complementInput("刚才那个昼夜鱼类数据集有对照读数吗",undefined,queries,"Quantifying and comparing diel dynamics of fish communities",[],[],sources,
      [{kind:"web",url:"https://datadryad.org/dataset/doi:"+doi,title,referenceType:"data"}]);
    const entity=input.entities.find(e=>e.doi===doi)!;
    assert.ok(entity);assert.equal(entity.pinned,true);
    const enumIds=complementSchema(input).properties.checks.items.properties.entityId.enum;
    assert.ok(enumIds?.includes(entity.id));
    const result=complementPlan(JSON.stringify({checks:[{entityId:entity.id,goal:"files",terms:"negative control reads",reason:"核对目标归档中的对照记录"}]}),input);
    assert.equal(result.strict,true);assert.deepEqual(result.queries,[]);assert.equal(result.targets[0].doi,doi);
  }
  const explicit=complementInput("核对论文DOI 10.1234/paper",undefined,[],"",[],[],[]);
  assert.equal(complementPlan(undefined,explicit).targets[0].referenceType,undefined,"a bare DOI does not establish data vs paper type");
});
test("file checks stay on chosen records and catalogue portal pages are not fetched a second time",()=>{
  const input=complementInput("看具体原图文件",undefined,queries,"",[record],[],[]),entity=input.entities.find(e=>e.kind==="dataset")!;
  const focus=complementPlan(JSON.stringify({checks:[{entityId:entity.id,goal:"files",terms:"image index",reason:"核对文件"}]}),input);
  assert.equal(focus.strict,false,"an assistant candidate is a read target, not a user-imposed identity restriction");
  const portal="https://example.org/portal/dataset?id=3";
  const asset={id:"haina:3",title:"Satellite GRD",url:portal,description:"Catalogue already read",origins:["haina"]} as Asset;
  const context=complementInput("核对该景覆盖",undefined,queries,"",[],[asset],[]);
  const plan=complementPlan(JSON.stringify({checks:[{entityId:context.entities[0].id,goal:"coverage",terms:"acquisition footprint",reason:"需查发布方观测记录"}]}),context);
  assert.equal(plan.targets.length,0);assert.equal(plan.queries.length,1);
  assert.deepEqual(pagesToRead([{engine:"Bing",query:"GRD",status:"done",hits:[{title:asset.title,url:portal,snippet:"GRD acquisition footprint"}]}],plan.queries,plan),[]);
  const shared=complementInput("核对HadEX3",undefined,queries,"",[record],[{...asset,canonicalId:"doi:"+doi}],[]);
  const canonical=shared.entities.find(e=>e.doi===doi)!;
  assert.deepEqual(canonical.sourceIds,[record.id,asset.id]);
  assert.equal(canonical.queryOnly,false);assert.equal(canonical.url,"https://doi.org/"+doi);
  assert.match(JSON.stringify(canonical.paths),/RQ8_S1/);
});
test("a named follow-up retains its known dataset DOI for assertion lookup and does not read an unrelated cited paper",async()=>{
  const title="Quantifying and comparing diel dynamics of fish communities using eDNA metabarcoding",doi="10.5061/dryad.76hdr7t90";
  const references=[{kind:"web" as const,title,url:"https://doi.org/"+doi,referenceType:"data" as const},
    {kind:"web" as const,title:"Another eDNA controls study",url:"https://doi.org/10.1234/other",referenceType:"paper" as const}];
  const input=complementInput("刚才那份资料的对照读数",undefined,queries,title,[],[],[],references);
  const target=input.entities.find(e=>e.doi===doi)!,other=input.entities.find(e=>e.doi==="10.1234/other")!;
  const result=complementPlan(JSON.stringify({checks:[{entityId:target.id,goal:"files",terms:"control reads",reason:"核对指定归档"},
    {entityId:other.id,goal:"method",terms:"threshold",reason:"查看另一研究"}]}),input);
  assert.deepEqual(result.targets.map(t=>t.doi),[doi]);
  const original="刚才那份昼夜鱼类资料的阴性对照有多少读数？";
  const found=await requiredDataSearch(original,new AbortController().signal,{
    references,plan:async()=>JSON.stringify({...plan,paper:{...plan.paper,name:title}}),
    paper:async p=>{assert.equal(p.name,doi);assert.equal(p.requestedName,title);return {records:[],tools:[],incomplete:[]};},
    haina:()=>haina,web:async()=>[],stage:()=>{},report:()=>{},
  });
  assert.equal(found.plan.dataQuestion,original);
});
test("encoded publisher and resolver URLs for the same DOI consume only one read slot",()=>{
  const hits=[
    {title:"Controls on Lost City mineral formation",url:"https://example.org/doi/full/10.1029%2F2023GC011010",snippet:"methods data"},
    {title:"Controls on Lost City mineral formation - article viewer",url:"https://example.net/viewer?doi=10.1029%2F2023GC011010",snippet:"methods data"},
  ];
  assert.equal(pagesToRead([{engine:"Bing",query:"Lost City",status:"done",hits}],[{web:"Lost City methods data",dataset:"Lost City"}]).length,1);
});
test("unknown model entities and invented URLs are rejected; a pinned identifier survives planner failure or omission",()=>{
  const input=complementInput("继续核对 DOI "+doi,undefined,queries,"",[record],[],[]);
  assert.throws(()=>complementPlan(JSON.stringify({checks:[{entityId:"dataset:invented",goal:"files",terms:"README",reason:"核对"}]}),input),/对象/);
  assert.throws(()=>complementPlan(JSON.stringify({checks:[{entityId:input.entities[0].id,goal:"files",terms:"https://invented.org/",reason:"核对"}]}),input),/方向/);
  for(const raw of [undefined,'{"checks":[]}']){
    const result=complementPlan(raw,input);
    assert.equal(result.strict,true);assert.equal(result.targets[0].doi,doi);
    assert.equal(result.targets[0].pageExcerpt,undefined,"a read target is not already-read evidence");
  }
});
test("pinned reads cannot be displaced by a similar paper or another DOI version",()=>{
  const target={title:"Target eDNA dataset",doi:"10.5061/dryad.target",url:"https://doi.org/10.5061/dryad.target",snippet:""};
  const run:SearchRun={engine:"DataCite",query:"eDNA",status:"done",hits:[
    {title:"Target eDNA dataset",doi:"10.5061/dryad.other",url:"https://doi.org/10.5061/dryad.other",snippet:"negative controls read counts"},
    {...target,landingUrl:"https://example.org/target",snippet:"Metadata for exact target"},
  ]};
  const selected=pagesToRead([run],[{web:"eDNA negative controls read counts",dataset:target.doi}],{targets:[target],strict:true});
  assert.equal(selected.length,1);assert.equal(selected[0].hit.doi,target.doi);
  assert.deepEqual(selected[0].urls,["https://example.org/target",target.url]);
  const missing=pagesToRead([{...run,hits:run.hits.slice(0,1)}],queries,{targets:[target],strict:true});
  assert.deepEqual(missing.map(p=>p.hit.url),[target.url]);
});
test("initial searches run in parallel; real assertion results guide the second phase without rewriting the question",async()=>{
  const events:string[]=[],calls:ToolCall[]=[];
  let release!:(r:{records:PaperRecord[];incomplete:string[];tools:string[]})=>void;
  const paper=new Promise<{records:PaperRecord[];incomplete:string[];tools:string[]}>(resolve=>{release=resolve;});
  const result=requiredDataSearch("核对TXx方法",new AbortController().signal,{
    plan:async()=>JSON.stringify(plan),report:c=>calls.push(c),stage:()=>{},
    paper:async()=>{events.push("paper");return paper;},haina:()=>{events.push("haina");return haina;},
    web:async(_queries,options)=>{events.push(options?.readPages===false?"search":"read");return options?.initialRuns||[];},
    refineWeb:async input=>{
      events.push("refine");assert.match(JSON.stringify(input.entities),/RQ8_S1/);
      return JSON.stringify({checks:[{entityId:input.entities.find(e=>e.kind==="paper")!.id,goal:"method",terms:"TXx baseline offset",reason:"独立核实方法与基准期"}]});
    },
  });
  await new Promise(r=>setImmediate(r));
  assert.deepEqual(events,["paper","haina","search"]);
  release({records:[record],incomplete:[],tools:[]});
  const done=await result;
  assert.deepEqual(events,["paper","haina","search","refine","read"]);
  assert.equal(done.plan.dataQuestion,"核对TXx方法");assert.equal(done.sourceStatus.length,3);
  assert.equal(done.webChecks?.checks.length,1);
  assert.ok(calls.some(c=>c.id==="web-complement"&&c.status==="done"));
});
test("failed complement planning retains first-pass evidence and reads the exact target; cancellation starts no reads",async()=>{
  const target={web:"HadEX3 documentation",dataset:doi};
  const initial:SearchRun[]=[{engine:"DataCite",query:doi,status:"done",hits:[{title:"HadEX3",url:"https://doi.org/"+doi,doi,snippet:"real metadata"}]}];
  for(const cancel of [false,true]){
    const controller=new AbortController();let read=0;
    const job=requiredDataSearch("核对这个产品",controller.signal,{
      plan:async()=>JSON.stringify({...plan,web:[target]}),paper:async()=>({records:[],incomplete:[],tools:[]}),
      haina:()=>haina,report:()=>{},stage:()=>{},
      refineWeb:async()=>{if(cancel)controller.abort();throw Error("model unavailable");},
      web:async(_q,opts)=>{
        if(opts?.readPages===false)return initial;
        read++;assert.equal(opts?.focus?.strict,false);assert.equal(opts?.focus?.targets[0].doi,doi);
        assert.deepEqual(opts?.initialRuns,initial);return initial;
      },
    });
    if(cancel){await assert.rejects(job,/abort/i);assert.equal(read,0);}
    else {const result=await job;assert.deepEqual(result.searches,initial);assert.equal(read,1);assert.match(result.issues.join(),/规划未完成/);}
  }
});
test("ordinary official webpages can be selected without borrowing an unrelated dataset title",()=>{
  const url="https://www.gov.example/policy/action-plan.html";
  const input=complementInput("核对区域治理的牵头与执行职责",undefined,[{web:"regional governance implementation policy",dataset:"regional governance"}],"",[],[],[
    {engine:"DeepSeek Search",query:"regional governance",status:"done",hits:[{title:"区域治理行动方案",url,snippet:"牵头机关与执行任务的官方通知"}]},
  ]);
  const page=input.entities.find(e=>e.url===url)!;assert.ok(page);assert.equal(page.kind,"source");
  const plan=complementPlan(JSON.stringify({checks:[{entityId:page.id,action:"read",goal:"method",terms:"implementation responsibilities",reason:"读取原通知职责条款"}]}),input);
  assert.equal(plan.targets[0].url,url);assert.deepEqual(plan.queries,[]);
});
test("explicit exclusions and contradictory irrelevant reasons do not execute candidate checks",()=>{
  const input=complementInput("杭州填埋场地下水调查",undefined,[{web:"Hangzhou landfill groundwater monitoring",dataset:"groundwater"}],"",[record],[],[]);
  const candidate=input.entities.find(e=>e.kind==="dataset")!;
  for(const action of ["exclude","read"]){
    const plan=complementPlan(JSON.stringify({checks:[{entityId:candidate.id,action,goal:"identity",terms:"climate indices",reason:"与填埋场地下水没有实际关联，不应安排核查"}]}),input);
    assert.equal(plan.checks.length,0);assert.equal(plan.targets.length,0);assert.equal(plan.queries.length,0);assert.equal(plan.excludedChecks?.length,1);
  }
});
test("an independent discovery query can fill the original method gap without being anchored to a candidate",()=>{
  const input=complementInput("PROSAIL联合反演的可辨识性",undefined,[{web:"PROSAIL joint inversion identifiability",dataset:"PROSAIL"}],"",[record],[],[]);
  const plan=complementPlan(JSON.stringify({checks:[],discoveryQueries:[{web:"PROSAIL joint inversion parameter identifiability field validation",dataset:"PROSAIL inversion",reason:"补实际联合反演方法缺口"}]}),input);
  assert.equal(plan.strict,false);assert.equal(plan.discoveryQueries?.length,1);assert.match(plan.queries[0].web,/^PROSAIL/);assert.doesNotMatch(plan.queries[0].web,/HadEX|10\.5285/);
  assert.throws(()=>complementPlan(JSON.stringify({checks:[],discoveryQueries:[{web:"unrelated cryptocurrency exchange",dataset:"cryptocurrency",reason:"另查"}]}),input),/偏离/);
});
test("a planned DOI alone does not become a user selection, while an explicit identifier remains protected",()=>{
  const planned=complementInput("大气变量资料有哪些",undefined,[{web:"atmospheric variables",dataset:doi}],"",[],[],[]);
  assert.equal(complementPlan(undefined,planned).strict,false);
  const explicit=complementInput("核对DOI "+doi,undefined,[],"",[],[],[]);
  const entity=explicit.entities[0];const focus=complementPlan(JSON.stringify({checks:[{entityId:entity.id,action:"exclude",goal:"identity",terms:"",reason:"无关"}]}),explicit);
  assert.equal(focus.strict,true);assert.equal(focus.targets[0].doi,doi);assert.ok(!focus.excludeUrls?.includes(entity.url));
});
test("phased web lookup reuses completed keyword calls and spends its read budget on exact targets",async t=>{
  const key=process.env.DEEPSEEK_API_KEY;process.env.DEEPSEEK_API_KEY="test-only";
  t.after(()=>{if(key===undefined)delete process.env.DEEPSEEK_API_KEY;else process.env.DEEPSEEK_API_KEY=key;});
  const calls:string[]=[],reads:string[]=[];
  const fetchImpl:typeof fetch=async(input,init)=>{
    const url=new URL(String(input));
    if(url.hostname==="www.bing.com"){
      calls.push("Bing:"+url.searchParams.get("q"));
      return new Response('<rss><channel><item><title>HadEX3 methods and documentation</title><link>https://example.org/unrelated</link></item></channel></rss>');
    }
    if(url.hostname==="api.datacite.org"){calls.push("DataCite:"+url.searchParams.get("query"));return Response.json({data:[],meta:{total:0}});}
    assert.equal(url.pathname,"/v1/tools/fetch");
    const page=JSON.parse(String(init?.body)).url;reads.push(page);
    return Response.json({content:"HadEX3 product methods. Annual temperature extremes and baseline documentation."});
  };
  const options={fetchImpl,deepseekTools:{search:false,fetch:true},originRead:false as const,archiveRead:false as const};
  const initial=await searchSources(queries,new AbortController().signal,()=>{},{...options,readPages:false});
  assert.equal(reads.length,0);assert.equal(calls.length,2);
  const focus=complementPlan(undefined,complementInput("核对 DOI "+doi,undefined,queries,"",[],[],initial));
  const result=await searchSources(queries,new AbortController().signal,()=>{},{...options,initialRuns:initial,focus});
  assert.equal(calls.filter(c=>c==="Bing:"+queries[0].web).length,1);
  assert.equal(calls.filter(c=>c==="DataCite:"+queries[0].dataset).length,1);
  assert.deepEqual(reads,["https://doi.org/"+doi]);
  assert.equal(result.filter(r=>r.engine==="DeepSeek Fetch").length,1);
  assert.equal(initial.some(r=>r.engine==="DeepSeek Fetch"),false,"initial trace is retained without later mutation");
});
