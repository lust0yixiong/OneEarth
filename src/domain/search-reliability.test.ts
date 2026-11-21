import test from "node:test";
import assert from "node:assert/strict";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {searchPapers,paperNameMatches} from "../../server/earthnano";
import {parseNativeWebSearch} from "../../server/native-web-search";
import {relevantWebHits,searchSources} from "../../server/web-search";
import type {ToolCall} from "./types";

const plan={name:"",facets:[{need:"冠层",queries:["canopy height"]}],region:["Greater Khingan Mountains"]};
const product={ds_key:"doi:10.1234/gedi",display_name:"GEDI canopy height",n_papers:1};
const usage={ds_key:product.ds_key,paper_id:"paper1",dataset_id:"d1",paper_title:"Recorded forest observations",study_context:"Another study region"};

test("no official metadata is a valid empty result; regional paper misses retain explicitly limited usage evidence",async t=>{
  t.mock.method(Client.prototype,"connect",async()=>{});t.mock.method(Client.prototype,"close",async()=>{});
  const calls:ToolCall[]=[],requests:{name:string;arguments:Record<string,unknown>}[]=[];
  t.mock.method(Client.prototype,"callTool",async (request:{name:string;arguments:Record<string,unknown>})=>{
    requests.push(request);const {name,arguments:args}=request;
    const payload=name==="find_dataset_by_task"?{status:"ok",candidates:[product],pagination:{has_more:false}}:
      name==="search_dataset_usage"?{status:args.region?"no_match":"ok",usages:args.region?[]:[usage]}:
      name==="get_dataset_metadata"?{status:"no_metadata",entity:{ds_key:product.ds_key},fields:{},note:"未绑定 DOI"}:{status:"ok"};
    return {content:[{type:"text",text:JSON.stringify(payload)}]};
  });
  const result=await searchPapers(plan,new AbortController().signal,()=>{},c=>calls.push(c));
  assert.equal(result.records.length,1);assert.deepEqual(result.incomplete,[]);
  assert.ok(calls.some(c=>c.name==="get_dataset_metadata" && c.status==="done"));
  assert.match(result.records[0].need.profile!.limitation,/不能据此证明目标区/);
  assert.equal(result.records[0].need.profile!.area,undefined);
  assert.equal(requests.filter(r=>r.name==="search_dataset_usage").length,2);
  assert.ok(requests.every(r=>["find_dataset_by_task","search_dataset_usage","get_dataset_metadata","search_recipes","get_evidence"].includes(r.name)));
});

test("empty or substring-only product resolution falls back to a genuine independent task search",async t=>{
  t.mock.method(Client.prototype,"connect",async()=>{});t.mock.method(Client.prototype,"close",async()=>{});
  for(const entities of [[],[{...product,display_name:"Merged image",matched_via:"contains"}]]){
    const used:string[]=[];
    t.mock.method(Client.prototype,"callTool",async ({name}:{name:string})=>{
      used.push(name);const payload=name==="resolve_dataset"?{status:"no_match",entities}:
        name==="find_dataset_by_task"?{status:"ok",candidates:[product],has_more:false}:
        name==="search_dataset_usage"?{status:"ok",usages:[usage]}:{status:"ok"};
      return {content:[{type:"text",text:JSON.stringify(payload)}]};
    });
    const result=await searchPapers({...plan,name:"GEDI",region:[]},new AbortController().signal,()=>{});
    assert.equal(result.records.length,1);assert.ok(used.includes("find_dataset_by_task"));
    assert.match(result.notices!.join(" "),/名称匹配/);
  }
  assert.equal(paperNameMatches("GEDI",{display_name:"Merged imagery",matched_via:"contains"}),false);
  assert.equal(paperNameMatches("GEDI",{display_name:"GEDI L2B",matched_via:"contains"}),true);
});

test("real upstream errors keep the server's diagnostic instead of masquerading as no matches",async t=>{
  t.mock.method(Client.prototype,"connect",async()=>{});t.mock.method(Client.prototype,"close",async()=>{});
  t.mock.method(Client.prototype,"callTool",async()=>({content:[{type:"text",text:JSON.stringify({status:"error",note:"invalid English lexical query"})}]}));
  await assert.rejects(()=>searchPapers(plan,new AbortController().signal,()=>{}),/invalid English lexical query/);
});

test("an unresolved exact alias with lexical suggestions is a completed lookup and falls back to the research topic",async t=>{
  t.mock.method(Client.prototype,"connect",async()=>{});t.mock.method(Client.prototype,"close",async()=>{});
  const calls:ToolCall[]=[];const used:string[]=[];
  t.mock.method(Client.prototype,"callTool",async ({name}:{name:string})=>{
    used.push(name);
    const payload=name==="resolve_dataset"?{status:"no_exact_match",fallback:[{ds_key:"unrelated",display_name:"Unrelated geology record",score:-35}],note:"精确别名未命中，以下为词法兜底候选，请人工核对"}:
      name==="find_dataset_by_task"?{status:"ok",candidates:[product],has_more:false}:
      name==="search_dataset_usage"?{status:"ok",usages:[usage]}:{status:"ok"};
    return {content:[{type:"text",text:JSON.stringify(payload)}]};
  });
  const result=await searchPapers({...plan,name:"GEDI"},new AbortController().signal,()=>{},c=>calls.push(c));
  assert.ok(used.includes("find_dataset_by_task"));assert.deepEqual(result.incomplete,[]);
  assert.equal(result.records[0]?.dsKey,product.ds_key);
  assert.ok(result.notices?.some(n=>n.includes("名称匹配")));
  assert.ok(calls.some(c=>c.name==="resolve_dataset" && c.status==="done"));
  assert.ok(!calls.some(c=>c.status==="failed"));
});

test("a valid DOI not_found is zero matches, with an independent topic lookup rather than a source failure",async t=>{
  t.mock.method(Client.prototype,"connect",async()=>{});t.mock.method(Client.prototype,"close",async()=>{});
  const calls:ToolCall[]=[],requests:{name:string;arguments:Record<string,unknown>}[]=[];
  t.mock.method(Client.prototype,"callTool",async (request:{name:string;arguments:Record<string,unknown>})=>{
    requests.push(request);const name=request.name;
    const payload=name==="resolve_dataset"?{status:"not_found",note:"该 DOI 不在库内；DOI 是精确标识符,不做词法兜底"}:
      name==="find_dataset_by_task"?{status:"ok",candidates:[product],has_more:false}:
      name==="search_dataset_usage"?{status:"ok",usages:[usage]}:{status:"ok"};
    return {isError:false,content:[{type:"text",text:JSON.stringify(payload)}]};
  });
  const result=await searchPapers({...plan,name:"10.1594/PANGAEA.765428",region:[]},new AbortController().signal,()=>{},c=>calls.push(c));
  assert.deepEqual(result.incomplete,[]);assert.equal(result.records.length,1);
  assert.ok(calls.some(c=>c.name==="resolve_dataset"&&c.status==="done"));assert.ok(!calls.some(c=>c.status==="failed"));
  assert.deepEqual(requests.find(r=>r.name==="find_dataset_by_task")?.arguments.facets,plan.facets);
  assert.match(result.notices!.join(" "),/不代表该 DOI 已收录/);
});

test("an unknown DOI alone never becomes a lexical topic or an approximate dataset identity",async t=>{
  t.mock.method(Client.prototype,"connect",async()=>{});t.mock.method(Client.prototype,"close",async()=>{});
  const used:string[]=[];
  t.mock.method(Client.prototype,"callTool",async ({name}:{name:string})=>{
    used.push(name);return {isError:false,content:[{type:"text",text:JSON.stringify({status:"not_found",entities:[product]})}]};
  });
  const result=await searchPapers({name:"https://doi.org/10.1234/unknown",facets:[],region:[]},new AbortController().signal,()=>{});
  assert.deepEqual(used,["resolve_dataset"]);assert.deepEqual(result.records,[]);assert.deepEqual(result.incomplete,[]);
  assert.match(result.notices!.join(" "),/不以词法近似条目替代/);
});

test("an unmatched versioned name is a completed exact lookup and never silently becomes the core product",async t=>{
  t.mock.method(Client.prototype,"connect",async()=>{});t.mock.method(Client.prototype,"close",async()=>{});
  const requests:{name:string;arguments:Record<string,unknown>}[]=[],calls:ToolCall[]=[];
  t.mock.method(Client.prototype,"callTool",async (request:{name:string;arguments:Record<string,unknown>})=>{
    requests.push(request);return {isError:false,content:[{type:"text",text:JSON.stringify(request.name==="resolve_dataset"
      ?{status:"not_found",note:"带版本名称未命中，本算子只做词面匹配"}:{status:"ok",candidates:[],has_more:false})}]};
  });
  const facets=[{need:"熔体计算",queries:["melt fraction"]}];
  const result=await searchPapers({name:"alphaMELTS RC12frac",facets,region:[]},new AbortController().signal,()=>{},c=>calls.push(c));
  assert.equal(requests[0].arguments.name,"alphaMELTS RC12frac");assert.deepEqual(requests[1].arguments.facets,facets);
  assert.deepEqual(result.incomplete,[]);assert.deepEqual(result.records,[]);assert.ok(!calls.some(c=>c.status==="failed"));
});

test("candidate verification has a bounded budget without reporting a technical failure",async t=>{
  t.mock.method(Client.prototype,"connect",async()=>{});t.mock.method(Client.prototype,"close",async()=>{});
  let checked=0;
  t.mock.method(Client.prototype,"callTool",async ({name,arguments:args}:{name:string;arguments:Record<string,unknown>})=>{
    let payload:Record<string,unknown>={status:"ok"};
    if(name==="find_dataset_by_task")payload={...payload,candidates:Array.from({length:30},(_,i)=>({...product,ds_key:"k"+i})),has_more:false};
    if(name==="search_dataset_usage"){checked++;payload.usages=[{...usage,ds_key:args.ds_key}];}
    return {content:[{type:"text",text:JSON.stringify(payload)}]};
  });
  const result=await searchPapers({...plan,region:[]},new AbortController().signal,()=>{});
  assert.equal(checked,24);assert.equal(result.records.length,24);assert.equal(result.truncated,true);
  assert.deepEqual(result.incomplete,[]);assert.match(result.notices!.join(" "),/不是全库总量/);
});

test("native evidence comes only from completed search tool records, never model-written links",()=>{
  const event={type:"item.completed",item:{type:"web_search",action:{type:"search",queries:["forest lidar"]},results:[
    {type:"text_result",title:"Published dataset",url:"https://example.org/data",snippet:"Actual snippet"},
    {type:"text_result",title:"Unsafe",url:"javascript:alert(1)"},
    {type:"text_result",title:"Credentials",url:"https://user:pass@example.org/data"},
  ]}};
  const raw=[JSON.stringify({type:"item.completed",item:{type:"agent_message",text:'[{"title":"Invented","url":"https://made-up.example"}]'}}),JSON.stringify(event),JSON.stringify(event)].join("\n");
  const result=parseNativeWebSearch(raw);
  assert.deepEqual(result.queries,["forest lidar"]);assert.equal(result.hits.length,1);
  assert.equal(result.hits[0].url,"https://example.org/data");
  assert.throws(()=>parseNativeWebSearch('{"message":"https://made-up.example"}'),/实际联网检索/);
  assert.equal(parseNativeWebSearch(JSON.stringify({...event,item:{...event.item,results:[]}})).hits.length,0);
});

test("place names alone and product substrings are insufficient web evidence",()=>{
  const hits=[{title:"Greater Khingan Mountains travel",snippet:"Forest tourism guide",url:"https://example.org/travel"},
    {title:"Daxinganling forest canopy height LiDAR observations",snippet:"Recorded forest plots",url:"https://example.org/data"}];
  assert.deepEqual(relevantWebHits(hits,"Daxinganling Greater Khingan Mountains canopy height lidar forest plot data").hits,[hits[1]]);
  assert.equal(relevantWebHits([{title:"Merged imagery",snippet:"",url:"https://example.org/merged"}],"GEDI data").hits.length,0);
});

test("native web fallback fills missing groups once, keeps actual provenance, and leaves public failures visible",async()=>{
  let invoked=0;
  const query={web:"GEDI canopy height",dataset:"GEDI"};
  const options={fetchImpl:(async input=>new URL(String(input)).hostname==="api.datacite.org"
    ?Response.json({data:[],meta:{total:0}}):new Response("offline",{status:503})) as typeof fetch,
    nativeSearch:async(queries:string[])=>{invoked++;assert.deepEqual(queries,[query.web]);return {queries:["GEDI canopy height NASA"],hits:[{title:"GEDI",url:"https://example.org/gedi",snippet:""}]};}};
  const runs=await searchSources([query,query],new AbortController().signal,()=>{},options);
  assert.equal(invoked,1);assert.ok(runs.some(r=>r.engine==="Bing" && r.status==="failed"));
  assert.equal(runs.at(-1)!.engine,"Codex Web");assert.equal(runs.at(-1)!.query,"GEDI canopy height NASA");
  assert.equal(runs.at(-1)!.hits.length,1);
  const success=await searchSources([query],new AbortController().signal,()=>{},{...options,fetchImpl:async input=>new URL(String(input)).hostname==="api.datacite.org"
    ?Response.json({data:[],meta:{total:0}}):new Response('<rss><channel><item><title>GEDI canopy height</title><link>https://example.org/data</link></item></channel></rss>')});
  assert.equal(invoked,1);assert.equal(success.some(r=>r.engine==="Codex Web"),false);
});

test("cancelling during native fallback aborts the request instead of publishing a completed empty result",async()=>{
  const controller=new AbortController();
  let started!:()=>void;const ready=new Promise<void>(resolve=>{started=resolve;});
  const result=searchSources([{web:"GEDI height",dataset:"GEDI"}],controller.signal,()=>{},{
    fetchImpl:async()=>new Response("Unavailable",{status:503}),
    nativeSearch:async(_queries,signal)=>{started();return new Promise((_resolve,reject)=>signal.addEventListener("abort",()=>reject(signal.reason),{once:true}));},
  });
  await ready;controller.abort();await assert.rejects(result,/abort/i);
});

test("successful DeepSeek search satisfies its query group without a redundant model search",async t=>{
  const old=process.env.DEEPSEEK_API_KEY;process.env.DEEPSEEK_API_KEY="test-only";
  t.after(()=>{if(old===undefined)delete process.env.DEEPSEEK_API_KEY;else process.env.DEEPSEEK_API_KEY=old;});
  let calls=0;
  const runs=await searchSources([{web:"GEDI canopy height",dataset:"GEDI"}],new AbortController().signal,()=>{},{
    deepseekTools:{search:true,fetch:false},
    fetchImpl:async input=>new URL(String(input)).hostname==="api.deepseek.com"
      ?Response.json({results:[{title:"GEDI canopy height",url:"https://example.org/gedi",snippet:"Documentation"}]})
      :new URL(String(input)).hostname==="api.datacite.org"?Response.json({data:[],meta:{total:0}}):new Response("offline",{status:503}),
    nativeSearch:async()=>{calls++;return {queries:[],hits:[]};},
  });
  assert.equal(calls,0);
  assert.ok(runs.some(r=>r.engine==="DeepSeek Search" && r.hits.length===1));
  assert.ok(runs.some(r=>r.engine==="Bing" && r.status==="failed"));
  assert.equal(runs.some(r=>r.engine==="DuckDuckGo"),false);
});

test("generic supporting-information words do not verify an unrelated long-title contains match",()=>{
 const target='Supplementary information to "Deep low-frequency earthquakes reveal ongoing magmatic recharge beneath Laacher See Volcano (Eifel, Germany)": Moment tensor inversion report';
 assert.equal(paperNameMatches(target,{matched_via:'contains',display_name:'supplementary information',matched_alias:'supplementary information'}),false);
 assert.equal(paperNameMatches(target,{matched_via:'contains',display_name:'ENTA',matched_alias:'ENTA'}),false);
 assert.equal(paperNameMatches(target,{matched_via:'contains',display_name:target,matched_alias:target}),true);
 assert.equal(paperNameMatches('supplementary information',{matched_via:'contains',display_name:'supplementary information'}),false);
 assert.equal(paperNameMatches('10.5880/gfz.2.1.2019.001',{matched_via:'contains',ds_key:'doi:10.5880/gfz.2.1.2019.001',display_name:'supplementary information'}),true);
});
