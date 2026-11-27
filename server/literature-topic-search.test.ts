import test from "node:test";
import assert from "node:assert/strict";
import {setTimeout as delay} from "node:timers/promises";
import {requiredDataSearch} from "./data-search";
import {literatureTopics,searchLiteratureTopics,type PaperBranchResult} from "./literature-topic-search";
import type {PaperPlan} from "./earthnano";
import {delegatedResearchProgress,mergeResearchProgress,readResearchProgressFact,settleResearchProgress,type ResearchProgressFact} from "./research-progress";
import {readResearchProgress,type ResearchProgress} from "../src/domain/native-agui-research-progress";
import type {PaperRecord} from "../src/domain/paper-record";

const paper=(tag:string,ids:string[],title="Seasonal temperature study"):PaperRecord=>({
  id:"earthnano:"+tag.repeat(64),dsKey:"dataset:"+tag,papers:987,paperTitle:title,studyContext:"",points:[],
  need:{name:"数据集",product:"Controlled dataset "+tag,type:"fixture",source:"文献资料",status:"",detail:"",
    profile:{role:"data",spatial:"coverage",coverage:"fixture",access:"fixture",limitation:""},
    tabs:[{kind:"table",label:"论文用法（本页）",rows:ids.map((id,i)=>[title,"","","",id,"D"+i])}]},
});
const metadata:PaperRecord={...paper("e",[]),dsKey:"doi:10.1234/metadata",assertionCatalogKind:"metadata-only",papers:0,paperTitle:"",
  need:{...paper("e",[]).need,tabs:[{kind:"table",label:"数据集时空元数据",rows:[]}]}};
const latch=()=>{let resolve!:()=>void;const promise=new Promise<void>(done=>resolve=done);return {resolve,promise};};
const result=(records:PaperRecord[]=[],changes:Partial<PaperBranchResult>={}):PaperBranchResult=>({records,incomplete:[],tools:[],...changes});
const facet=(need:string,query:string)=>({need,queries:[query]});
const plan:PaperPlan={name:"",facets:[facet("海温","sea temperature"),facet("温盐关系","ocean salinity"),
  facet("空检索","empty ocean"),facet("无用法元数据","ocean height"),facet("最后的主题","energy balance")],
  region:["North Sea"],scenario:["sea circulation"]};

test("literature topics are serial, expose only verified materials after publication and retain partial results",async()=>{
  const facts:ResearchProgressFact[]=[],published=new Set<string>(),starts:string[]=[];
  const a=paper("a",["P1","P1"]),b=paper("b",["P1"]),c=paper("c",["P2","P3"]),unnamed=paper("f",["Unnamed-ID"],"");
  const blockedPublication=latch(),readyToPublish=latch();
  let active=0,peak=0,time=0;
  const work=searchLiteratureTopics(plan,literatureTopics(plan)!,new AbortController().signal,async (sub,topic)=>{
    assert.ok(topic);
    assert.deepEqual(sub.region,plan.region);
    assert.equal(sub.facets.length,1);
    assert.deepEqual(sub.scenario,[]);
    const name=sub.facets[0].need;
    starts.push(name);
    peak=Math.max(peak,++active);
    try{
      if(name==="海温"){
        readyToPublish.resolve();
        await blockedPublication.promise;
        published.add(a.id);published.add(b.id);
        return result([a,b],{notices:["同一条限制"]});
      }
      if(name==="温盐关系"){
        assert.ok(facts.some(f=>f.topic==="海温"&&f.status==="done"&&f.evidence?.[0].assetId===a.id));
        await delay(0);
        published.add(c.id);
        return result([a,c],{timedOut:true,incomplete:["get_evidence"],notices:["同一条限制"]});
      }
      if(name==="空检索")return result();
      if(name==="无用法元数据"){
        time=27_000;
        return result([metadata,unnamed],{truncated:true});
      }
      return assert.fail("remaining time was insufficient");
    }finally{active--;}
  },fact=>{
    for(const link of fact.evidence??[])assert.ok(published.has(link.assetId));
    facts.push(fact);
  },{totalMs:30_000,minimumMs:11_000,maximumMs:13_000,now:()=>time});
  await readyToPublish.promise;
  assert.ok(!facts.some(f=>f.status==="done"||f.evidence));
  blockedPublication.resolve();
  const found=await work;
  assert.deepEqual(starts,plan.facets.slice(0,4).map(f=>f.need));assert.equal(peak,1);
  assert.deepEqual(found.records.map(record=>record.id),[a.id,b.id,c.id]);
  assert.equal(found.notices?.filter(n=>n==="同一条限制").length,1);
  assert.ok(found.notices?.some(n=>n.includes("未启动")));
  assert.ok(found.timedOut);
  assert.deepEqual(facts.slice(0,5).map(f=>f.status),Array(5).fill("queued"));
  const ended=facts.filter(f=>!["queued","running"].includes(f.status));
  assert.deepEqual(ended.map(f=>[f.status,f.count,f.evidence?.length]),[
    ["done",1,2],["partial",3,2],["done",0,undefined],["partial",undefined,undefined],["not_started",undefined,undefined],
  ]);
});

test("actual deadline and failed publication never become empty or clickable, cancellation stops later themes",async()=>{
  const scope={...plan,facets:plan.facets.slice(0,3)};
  const controller=new AbortController(),facts:ResearchProgressFact[]=[];
  let current=0;
  const attempted=await searchLiteratureTopics(scope,literatureTopics(scope)!,controller.signal,async (_sub,topic)=>{
    assert.ok(topic);current++;
    if(current===1)return new Promise((_resolve,reject)=>{
      topic.deadline.addEventListener("abort",()=>reject(topic.deadline.reason),{once:true});
      // Keep the process alive for the real abort timer, which is unref'ed.
      const pin=setTimeout(()=>{},300);
      topic.deadline.addEventListener("abort",()=>clearTimeout(pin),{once:true});
    });
    if(current===2)throw Error("private failure from the publication transaction");
    return result();
  },fact=>facts.push(fact),{totalMs:1000,minimumMs:80,maximumMs:90});
  assert.deepEqual(facts.filter(f=>!["queued","running"].includes(f.status)).map(f=>[f.status,f.count,f.evidence]),[
    ["timeout",undefined,undefined],["failed",undefined,undefined],["done",0,undefined],
  ]);
  assert.ok(attempted.timedOut);
  assert.doesNotMatch(JSON.stringify(facts),/private/);

  const begun=latch(),cancelled=new AbortController();
  current=0;
  const work=searchLiteratureTopics(scope,literatureTopics(scope)!,cancelled.signal,async()=>{
    current++;begun.resolve();
    await delay(300,undefined,{signal:cancelled.signal});
    return result();
  });
  await begun.promise;
  const reason=new DOMException("original run cancelled","AbortError");
  cancelled.abort(reason);
  await assert.rejects(work,error=>error===reason);assert.equal(current,1);
});

test("named, single and redundant topics retain existing matching and restricted source rules",async()=>{
  const variants=[
    {...plan,name:"10.1234/explicit"},
    {...plan,facets:plan.facets.slice(0,1)},
    {...plan,facets:[plan.facets[0],facet("重复","SEA TEMPERATURE")]},
  ];
  const question="核对海洋资料";
  let calls=0;
  const execute=(paperPlan:PaperPlan,policy?:object)=>requiredDataSearch(question,new AbortController().signal,{
    plan:async()=>JSON.stringify({questionMode:"preserve",dataQuestion:question,dataNeed:null,paper:paperPlan,sourcePolicy:policy,
      web:[{web:"ocean evidence",dataset:"ocean evidence"}],hainaQueries:["海洋"]}),
    paper:async (actual,topic)=>{
      calls++;assert.equal(topic,undefined);assert.deepEqual(actual,paperPlan);
      return result([paper("d",["existing-id"])]);
    },
    web:async()=>[],haina:()=>({assets:[],total:0,synced:"",endpoint:"",warning:""}),stage:()=>{},report:()=>{},
  });
  for(const variant of variants)assert.equal((await execute(variant)).papers.length,1);
  assert.equal((await execute(plan,{mode:"restricted",sources:["web"]})).papers.length,0);
  assert.equal(calls,3);
});

test("native topic facts have stable order, keep immutable labels and exact safe evidence at settlement",()=>{
  const base={id:"source-paper-1",area:"literature",topic:"海洋温度",status:"queued"} as const;
  const allow=new Set<ResearchProgressFact["area"]>(["literature"]);
  const delegate=(value:unknown)=>delegatedResearchProgress("old-request",value,allow)!;
  let state:ResearchProgress|undefined;
  const update=(fact:ResearchProgressFact)=>state=mergeResearchProgress(state,"run",delegate(fact))!;
  update(base);
  update({...base,id:"source-paper-2",topic:"盐度"});
  update({...base,status:"running"});
  assert.equal(mergeResearchProgress(state,"run",delegate({...base,topic:"改写标签",status:"done"})),undefined);
  const evidence=[{assetId:paper("a",["P1"]).id,title:"已取得的论文"}];
  update({...base,status:"done",count:1,evidence});
  const done=settleResearchProgress(state)!;
  assert.deepEqual(done.actions.map(({order,status,count,evidence})=>({order,status,count,evidence})),[
    {order:1,status:"done",count:1,evidence},{order:2,status:"not_started",count:undefined,evidence:undefined},
  ]);
  assert.deepEqual(readResearchProgress(done,"run"),done);
  assert.equal(readResearchProgressFact({...base,topic:"Authorization: hidden"}),undefined);
  assert.equal(readResearchProgressFact({...base,area:"web"}),undefined);
  assert.equal(readResearchProgressFact({...base,status:"done",evidence:[...evidence,...evidence]}),undefined);
  assert.equal(readResearchProgressFact({...base,status:"done",count:0,evidence}),undefined);
  assert.equal(readResearchProgressFact({...base,status:"done",evidence:[{assetId:"paper:made-up",title:"未验证"}]}),undefined);
  assert.equal(readResearchProgressFact({...base,status:"done",evidence:[{...evidence[0],title:"file:///private/host"}]}),undefined);
  assert.deepEqual(readResearchProgressFact({...base,status:"done",evidence:[{...evidence[0],diagnostics:"hidden"}]})?.evidence,evidence);
});

const pgBin=process.env.ONEEARTH_A2A_TEST_PG_BIN,fixtureDb=process.env.ONEEARTH_SERIAL_LITERATURE_TEST_DATABASE_URL;
test("actual MCP topic loop and exact-ID PostgreSQL HTTP publication work before the next lookup completes",
  {skip:!pgBin&&!fixtureDb&&"set local PostgreSQL binaries or a dedicated serial literature test DB",timeout:20_000},async t=>{
  const {execFileSync}=await import("node:child_process");
  const {mkdtempSync,rmSync}=await import("node:fs");
  const {join}=await import("node:path");
  const {once}=await import("node:events");
  const {default:express}=await import("express");
  const {Pool}=await import("pg");
  const {Server}=await import("@modelcontextprotocol/sdk/server/index.js");
  const {SSEServerTransport}=await import("@modelcontextprotocol/sdk/server/sse.js");
  const {CallToolRequestSchema}=await import("@modelcontextprotocol/sdk/types.js");
  const {postgresPaperCatalog}=await import("./postgres-paper-catalog");
  const {paperCatalogRoutes}=await import("./paper-catalog");
  const {paperCatalogAccess}=await import("./paper-catalog-access");
  const {publishedPaperLookup}=await import("./literature-topic-search");
  let db:InstanceType<typeof Pool>;
  if(fixtureDb){
    const url=new URL(fixtureDb);
    assert.match(url.pathname,/^\/serial_literature_test_[a-z0-9_]+$/u);
    assert.ok(["localhost","127.0.0.1"].includes(url.hostname));
    db=new Pool({connectionString:fixtureDb,connectionTimeoutMillis:1000});
  }else{
    assert.ok(pgBin);
    const state=mkdtempSync("/tmp/oe-lit-pg-"),data=join(state,"db");
    const pg=(name:string,args:string[])=>execFileSync(join(pgBin,name),args,{encoding:"utf8",stdio:"pipe"});
    let postgresRunning=false;
    t.after(()=>{
      if(postgresRunning)pg("pg_ctl",["-D",data,"-m","fast","-w","stop"]);
      rmSync(state,{recursive:true,force:true});
    });
    pg("initdb",["-D",data,"-U","lit_fixture","-A","trust","--no-locale","--encoding=UTF8"]);
    // Unique Unix socket directory and disabled TCP keep this independent of any running DB.
    pg("pg_ctl",["-D",data,"-l",join(state,"pg.log"),"-o",'-c listen_addresses= -k "'+state+'"',"-w","start"]);
    postgresRunning=true;
    db=new Pool({host:state,database:"postgres",user:"lit_fixture",connectionTimeoutMillis:1000});
  }
  assert.equal((await db.query("SELECT to_regclass('paper_catalog_head') AS existing")).rows[0].existing,null);
  const catalog=await postgresPaperCatalog(db);
  assert.ok(await catalog.initializeEmpty());
  const app=express();app.use(express.json());
  app.use("/api/paper-records",paperCatalogRoutes(paperCatalogAccess(catalog)));
  const sessions=new Map<string,InstanceType<typeof SSEServerTransport>>();
  const secondStarted=latch(),releaseSecond=latch();
  const providerTopics:string[]=[];
  const arrivedUsage=new Set<unknown>();
  const rateLimitedTopic="原文慢";
  let active=0,peak=0;
  app.get("/mcp",async (_request,response)=>{
    const transport=new SSEServerTransport("/mcp/messages",response);
    const mcp=new Server({name:"controlled assertion fixture",version:"1.0.0"},{capabilities:{tools:{}}});
    sessions.set(transport.sessionId,transport);
    response.once("close",()=>{sessions.delete(transport.sessionId);void mcp.close();});
    mcp.setRequestHandler(CallToolRequestSchema,async ({params:{name,arguments:args}},context)=>{
      const key=args?.ds_key;
      let value:object;
      if(name==="find_dataset_by_task"){
        const facets=args?.facets as PaperPlan["facets"];
        const label=facets[0].need;
        assert.equal(facets.length,1);
        assert.deepEqual(args?.scenario_queries,[]);
        providerTopics.push(label);
        peak=Math.max(peak,++active);
        try{
          if(label==="温盐关系"){secondStarted.resolve();await releaseSecond.promise;}
          value={status:"ok",entities:label==="海温"?[{ds_key:"fixture-fast",display_name:"Controlled sea data",n_papers:52}]
            :label===rateLimitedTopic?[{ds_key:"fixture-partial",display_name:"Controlled partial sea data",n_papers:1}]:[],
            pagination:{has_more:false}};
        }finally{active--;}
      }else if(name==="search_dataset_usage"){
        assert.deepEqual(args?.region,["North Sea"]);
        arrivedUsage.add(key);
        value={status:"ok",usages:[{ds_key:key,paper_title:"Controlled North Sea study",paper_id:"fixture-paper",dataset_id:"d1",
          variables:"temperature",study_context:"North Sea",roles:[]}]};
      }else if(name==="get_evidence"){
        assert.ok(arrivedUsage.has(key),"do not expand originals before usage");
        if(key==="fixture-partial")await delay(1800,undefined,{signal:context.signal});
        value={status:"ok",row:{ds_key:key,paper_id:"fixture-paper",dataset_id:"d1"},
          evidence:[{block_id:"b1",section:"Methods",quote:"Measured near the coast."}],pagination:{has_more:false}};
      }else {
        assert.ok(["search_recipes","get_dataset_metadata"].includes(name),name);
        assert.ok(arrivedUsage.has(key),"do not start ancillary work before usage");
        value={status:"ok"};
      }
      return {content:[{type:"text",text:JSON.stringify(value)}]};
    });
    await mcp.connect(transport);
  });
  app.post("/mcp/messages",async (request,response)=>{
    const transport=typeof request.query.sessionId==="string"?sessions.get(request.query.sessionId):undefined;
    if(!transport){response.sendStatus(404);return;}
    await transport.handlePostMessage(request,response,request.body);
  });
  const http=app.listen(0,"127.0.0.1");
  await once(http,"listening");
  const address=http.address();
  assert.ok(address&&typeof address!=="string");
  const httpOrigin="http://127.0.0.1:"+address.port;
  const original=process.env.ONEEARTH_EARTHNANO_URL;
  process.env.ONEEARTH_EARTHNANO_URL=httpOrigin+"/mcp";
  const signal=new AbortController();
  const cleanup=async ()=>{
    signal.abort();releaseSecond.resolve();
    http.closeAllConnections();
    await new Promise<void>(resolve=>http.close(()=>resolve()));
    await db.end();
    if(original===undefined)delete process.env.ONEEARTH_EARTHNANO_URL;else process.env.ONEEARTH_EARTHNANO_URL=original;
  };
  const facts:ResearchProgressFact[]=[];
  const query="只查询论文断言库，核对海洋研究资料";
  const work=requiredDataSearch(query,signal.signal,{
    plan:async()=>JSON.stringify({questionMode:"preserve",dataQuestion:query,dataNeed:null,paper:{...plan,facets:[...plan.facets.slice(0,2),facet(rateLimitedTopic,"coastal methods")]},
      sourcePolicy:{mode:"restricted",sources:["paper"]},hainaQueries:[],web:[]}),
    paper:publishedPaperLookup(catalog,signal.signal,()=>{},()=>{}),
    haina:()=>assert.fail("restricted"),web:async()=>assert.fail("restricted"),stage:()=>{},report:()=>{},progress:fact=>facts.push(fact),
    paperTopicTiming:{totalMs:5000,minimumMs:850,maximumMs:1100},
  });
  try{
    await Promise.race([secondStarted.promise,work.then(()=>assert.fail("second controlled query did not start"))]);
    const first=facts.find(f=>f.topic==="海温"&&f.status==="done");
    assert.ok(first);
    assert.equal(first.count,1,"paper ID count does not use the upstream total of 52");
    const id=first.evidence?.[0].assetId;
    assert.ok(id);
    const lookup=await fetch(httpOrigin+"/api/paper-records?ids="+id,{signal:AbortSignal.timeout(1000)});
    assert.equal(lookup.status,200);
    const exact=await lookup.json() as PaperRecord[];
    assert.equal(exact[0].id,id);
    assert.equal(exact[0].paperTitle,"Controlled North Sea study");
    assert.ok(exact[0].need.tabs.some(tab=>tab.quote?.includes("Measured near the coast.")));
    assert.equal(facts.at(-1)?.status,"running","the later topic has not yet finished");
    releaseSecond.resolve();
    const finished=await work;
    assert.equal(finished.papers[0].id,id);
    assert.equal(finished.papers[1].dsKey,"fixture-partial");
    assert.ok(!finished.papers[1].need.tabs.some(tab=>tab.kind==="text"),"late original evidence is not cited");
    assert.deepEqual(facts.find(fact=>fact.topic==="温盐关系"&&fact.status==="done"),
      {area:"literature",id:"source-paper-2",topic:"温盐关系",status:"done",count:0});
    assert.equal(facts.at(-1)?.status,"partial");
    assert.equal(facts.at(-1)?.evidence?.[0].assetId,finished.papers[1].id);
    assert.equal(peak,1);
    assert.deepEqual(providerTopics,["海温","温盐关系",rateLimitedTopic]);
  }finally{
    await cleanup();
    await work.catch(()=>{});
  }
});
