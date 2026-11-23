import {researchExecutor} from "../../server/research-executor";
import test from "node:test";
import assert from "node:assert/strict";
import {continuationSourcePolicy,requiredDataSearch,parseDataSearch,fallbackDataSearch,recoverDataSearch,dataSearchSchema,type DataSearchPlan} from "../../server/data-search";
import {searchHaina,type HainaSearchResult} from "../../server/haina-search";
import {isWorkspaceCommand} from "./research-question";
import {assets} from "./datasets";
import {catalogueRows} from "../../server/chat-executor";
import {emptyFilters} from "./spatial";
import type {ToolCall,DiscoveryContext} from "./types";
import type {PaperRecord} from "./paper-record";

const plan:DataSearchPlan={
  questionMode:"preserve",dataNeed:null,
  dataQuestion:"为什么城市里更热",
  hainaQueries:["地表温度","land surface temperature"],
  paper:{name:"",facets:[{need:"温度",queries:["land surface temperature"]}],region:[],scenario:["urban heat"]},
  web:[{web:"urban heat island observation datasets",dataset:"land surface temperature"}],
};
const emptyHaina:HainaSearchResult={assets:[],total:0,synced:"2026-11-13T00:00:00Z",endpoint:"https://haina.example/datasetList",warning:""};
test("general and follow-up questions are not implicit workspace operations",()=>{
  for(const q of ["为什么城市里更热","Retrieve atmospheric variables from satellite radiometer and sounder data products",
    "继续比较这两份数据","这些值是实测还是推算的？","你好","查看这些数据是否足够验证这个结论"])
    assert.equal(isWorkspaceCommand(q),false,q);
  for(const q of ["打开第一份资料","展示全球风场可视化","比较第一份和第二份","返回候选列表","飞到杭州市","把地图定位到杭州","导航到上海","带我去莫干山"])
    assert.equal(isWorkspaceCommand(q),true,q);
});

test("an explicitly requested discovery executes all three sources and one failure does not cancel the others",async()=>{
  const calls:ToolCall[]=[],executed:string[]=[];
  const result=await requiredDataSearch("为什么城市里更热",new AbortController().signal,{
    plan:async()=>JSON.stringify(plan),report:c=>calls.push(c),stage:()=>{},
    paper:async()=>{executed.push("paper");throw Error("MCP connection failed");},
    haina:()=>{executed.push("haina");return emptyHaina;},
    web:async()=>{executed.push("web");return [{engine:"DataCite",query:"surface temperature",status:"done",hits:[]}];},
  });
  assert.deepEqual(executed,["paper","haina","web"]);
  assert.equal(result.plan.dataQuestion,plan.dataQuestion);
  assert.equal(result.sourceStatus.length,3);
  assert.equal(result.sourceStatus.find(s=>s.source.includes("文献资料"))?.status,"failed");
  assert.equal(result.sourceStatus.find(s=>s.source.includes("海纳"))?.status,"done");
  assert.match(result.issues.join(" "),/MCP connection failed/);
  for(const id of ["source-paper","source-haina","source-web"])
    assert.ok(calls.some(c=>c.id===id && c.status!=="running"));
});

test("invalid planning never sends invalid Chinese assertion parameters, while public Chinese web and Haina remain independent",async()=>{
  const executed:string[]=[];
  const result=await requiredDataSearch("哪些观测支持这个判断",new AbortController().signal,{
    plan:async()=>"{invalid",report:()=>{},stage:()=>{},
    paper:async p=>{assert.ok(p.facets.length);executed.push("paper");return {records:[],tools:[],incomplete:[]};},
    haina:terms=>{assert.ok(terms.length);executed.push("haina");return emptyHaina;},
    web:async terms=>{assert.ok(terms.length);executed.push("web");return [{engine:"Bing",query:"observations",status:"failed",hits:[],error:"offline"}];},
  });
  assert.deepEqual(executed,["haina","web"]);
  assert.match(result.sourceStatus.find(s=>s.source==='文献资料检索')!.detail,/未请求/);
  assert.equal(result.plan.dataQuestion,"哪些观测支持这个判断");
  assert.equal(result.plan.questionMode,"unresolved");
  assert.equal(result.plan.dataNeed,null);
  assert.ok(result.issues.some(i=>i.includes("offline")));
  assert.equal(result.sourceStatus.find(s=>s.source==="网络检索")?.status,"failed");
  assert.throws(()=>parseDataSearch(JSON.stringify({...plan,hainaQueries:[]}),"原问题"));
  assert.ok(fallbackDataSearch("English task").web[0].dataset.length<=80);
});

test("Haina searches operate on the actual Haina snapshot and all-source evidence survives source and candidate filters",()=>{
  const matches=searchHaina(["ERA5"]);
  assert.ok(matches.length);
  assert.ok(matches.every(a=>a.origins.includes("haina")));
  assert.ok(matches.some(a=>/ERA5/i.test(a.title)));
  const context={caseId:null,filters:{...emptyFilters(),source:"public"},selection:null,
    candidateIds:["Q02-0"],inCandidateScope:true} as DiscoveryContext;
  const paper={id:"earthnano:"+"c".repeat(64),need:{product:"ERA5 used in a paper",source:"EarthNano",detail:"Usage",tabs:[]},studyContext:"",paperTitle:"Study"} as unknown as PaperRecord;
  const rows=catalogueRows("ERA5",context,{message:""},[],[paper],matches.slice(0,1));
  assert.ok(rows.some(r=>r.id===paper.id));
  assert.ok(rows.some(r=>r.id===matches[0].id));
  assert.ok(assets.some(a=>a.id===matches[0].id));
});

test("structured auxiliary needs and scalar region names do not discard a valid plan or rewrite the question",()=>{
  const original="研究大兴安岭2020—2023年的森林结构，想找树高和样地资料。";
  const parsed=parseDataSearch(JSON.stringify({...plan,dataNeed:{region:"大兴安岭",variables:["树高"]},
    paper:{name:"",facets:[{need:"树高",queries:["canopy height"]}],region:"Greater Khingan Mountains"}}),original);
  assert.equal(parsed.dataQuestion,original);
  assert.deepEqual(parsed.paper.region,["Greater Khingan Mountains"]);
  assert.deepEqual(JSON.parse(parsed.dataNeed!),{region:"大兴安岭",variables:["树高"]});
});

test("invalid English phrases get one bounded parameter repair before retrieval",async()=>{
  let attempts=0;const calls:ToolCall[]=[];
  const original="解释城市热岛与观测的关系";
  const result=await requiredDataSearch(original,new AbortController().signal,{
    plan:async correction=>{
      attempts++;
      if(!correction)return JSON.stringify({...plan,paper:{...plan.paper,facets:[{need:"温度",queries:["完整中文问题"]}]}});
      assert.match(correction.issue,/英文词/);assert.match(correction.previous,/完整中文问题/);
      return JSON.stringify(plan);
    },
    paper:async p=>{assert.deepEqual(p,plan.paper);return {records:[],tools:[],incomplete:[]};},
    haina:()=>emptyHaina,web:async()=>[],report:c=>calls.push(c),stage:()=>{},
  });
  assert.equal(attempts,2);assert.equal(result.plan.dataQuestion,original);
  assert.ok(calls.some(c=>c.id==="data-question" && c.status==="done"));
});

test("usable source results with failed subrequests are partial rather than failed",async()=>{
  const calls:ToolCall[]=[];
  const result=await requiredDataSearch(plan.dataQuestion,new AbortController().signal,{
    plan:async()=>JSON.stringify(plan),paper:async()=>({records:[],tools:[],incomplete:[]}),
    haina:()=>emptyHaina,web:async()=>[
      {engine:"Bing",query:"forest",status:"failed",hits:[],error:"offline"},
      {engine:"Bing",query:"tree",status:"failed",hits:[],error:"offline"},
      {engine:"Codex Web",query:"forest",status:"done",hits:[{title:"Actual record",url:"https://example.org/data",snippet:""}]},
    ],report:c=>calls.push(c),stage:()=>{},
  });
  assert.equal(result.sourceStatus.find(s=>s.source==="网络检索")?.status,"partial");
  assert.equal(result.sourceStatus.find(s=>s.source==="网络检索")?.detail,"Bing offline");
  assert.ok(calls.some(c=>c.id==="source-web" && c.status==="partial" && /offline/.test(c.error!)));
});

test('necessary clarification stops before source retrieval and preserves the original question',async()=>{
  const question='这些数据能一起用吗？',asked='你指哪几份数据？想配合分析，还是拼接成同一序列？';
  const result=await requiredDataSearch(question,new AbortController().signal,{
    plan:async()=>JSON.stringify({questionMode:'preserve',dataQuestion:question,clarification:asked,
      conversationContext:'用户想判断多份数据能否联合使用，数据对象与联合方式尚不明确。'}),
    report:()=>{},stage:()=>{},
    paper:async()=>{throw Error('must not query before clarification');},
    haina:()=>{throw Error('must not query before clarification');},
    web:async()=>{throw Error('must not query before clarification');},
  });
  assert.equal(result.clarification,asked);assert.equal(result.plan.dataQuestion,question);
  assert.equal(result.questionCheck,undefined);assert.equal(result.plan.dataNeed,null);
  assert.deepEqual(result.sourceStatus,[]);assert.deepEqual(result.issues,[]);
  await assert.rejects(()=>import('../../server/chat-executor').then(m=>m.modelReply(question,{} as never,{message:''},[],researchExecutor({executor:'codex',model:''},undefined,new AbortController().signal),
    new AbortController().signal,undefined,[],'',undefined,result)),/尚未得到用户确认/);
});

test('short answers retain conversation context on an older or failed planner response',async()=>{
  const context='用户研究大兴安岭森林是否变矮，时期2020—2023年。';
  for(const broken of [false,true]){
    const result=await requiredDataSearch('只把年份改成2018—2020年',new AbortController().signal,{
      conversationContext:context,plan:async()=>broken?'invalid':JSON.stringify(plan),
      paper:async()=>({records:[],tools:[],incomplete:[]}),haina:()=>emptyHaina,web:async()=>[],report:()=>{},stage:()=>{},
    });
    assert.ok(result.plan.conversationContext?.includes(context));if(broken)assert.match(result.plan.conversationContext!,/本轮用户原话.*2018—2020/);assert.equal(result.plan.dataQuestion,'只把年份改成2018—2020年');
    assert.equal(result.clarification,undefined);
  }
  assert.throws(()=>parseDataSearch(JSON.stringify({...plan,conversationContext:'a'.repeat(1601)}),'原问题'),/上下文/);
  assert.throws(()=>parseDataSearch(JSON.stringify({...plan,clarification:''}),'原问题'),/追问/);
});

test('an explicitly cleared context does not revive the previous topic',async()=>{
  const result=await requiredDataSearch('换个话题，解释ERA5',new AbortController().signal,{
    conversationContext:'大兴安岭森林，2020—2023年。',plan:async()=>JSON.stringify({...plan,conversationContext:''}),
    paper:async()=>({records:[],tools:[],incomplete:[]}),haina:()=>emptyHaina,web:async()=>[],report:()=>{},stage:()=>{},
  });
  assert.equal(result.plan.conversationContext,'');
});

function fakeDeps(raw:string|((correction?:{issue:string;previous:string})=>string),extra:Record<string,unknown>={}){
  const executed:string[]=[],calls:ToolCall[]=[];
  return {executed,calls,deps:{plan:async(c?:{issue:string;previous:string})=>typeof raw==='function'?raw(c):raw,
    paper:async(p:DataSearchPlan['paper'])=>{executed.push('paper');assert.ok(p.name||p.facets.length);assert.ok(p.facets.every(f=>f.queries.every(q=>!/[\u3400-\u9fff]/.test(q)&&q.split(/\s+/).length<=3)));return {records:[],tools:[],incomplete:[]};},
    haina:()=>{executed.push('haina');return emptyHaina;},web:async()=>{executed.push('web');return [];},report:(c:ToolCall)=>calls.push(c),stage:()=>{},...extra}};
}
test('initial and bounded repair attempts have independent raw/validation trace outcomes',async()=>{
  const s=fakeDeps(c=>JSON.stringify(c?plan:{...plan,paper:{...plan.paper,facets:[{need:'温度',queries:['complete long English phrase exceeding three words']}]}}));
  await requiredDataSearch('解释城市热岛',new AbortController().signal,s.deps);
  assert.ok(s.calls.some(c=>c.id==='data-question-initial'&&c.status==='failed'&&c.output?.includes('complete long English')));
  assert.ok(s.calls.some(c=>c.id==='data-question-repair'&&c.status==='done'));
  assert.ok(s.calls.some(c=>c.id==='data-question'&&c.status==='done'));assert.equal(s.executed.length,3);
});
test('two failed plans preserve the research task/current years and recover only actual English context, not the last Chinese reply as a new topic',async()=>{
  const previousResearchIntent={purpose:'比较流域蒸散能量平衡与经验估算',task:'对照气象和通量资料',region:'鄱阳湖流域',time:'2020—2023年',months:[]};
  const s=fakeDeps('{invalid',{previousResearchIntent,conversationContext:'蒸散估算，范围尚未指定。',history:[{role:'user',text:'Compare evapotranspiration energy balance methods and flux observations.'},{role:'assistant',text:'改研究 tree height',researchIntent:previousResearchIntent}]});
  const r=await requiredDataSearch('范围就看鄱阳湖流域，只把年份改成2018—2020年',new AbortController().signal,s.deps);
  assert.deepEqual(r.plan.conversationPeriod,[2018,2020]);assert.match(r.plan.researchIntent!.purpose,/蒸散/);assert.match(r.plan.researchIntent!.time!,/2018/);
  assert.match(JSON.stringify(r.plan.paper),/evapotranspiration/);assert.doesNotMatch(JSON.stringify(r.plan.paper),/tree height/);
  assert.match(r.plan.conversationContext!,/本轮用户原话.*鄱阳湖/);assert.equal(s.executed.length,3);
});
test('valid parsed fields and overlong English phrases survive final parameter failure without fabricated translation',()=>{
  const raw=JSON.stringify({...plan,researchIntent:{purpose:'判断 CO2e 与 GWP 换算',task:'核对单位和时间基准',region:null,time:null,months:[]},paper:{name:'',facets:[{need:'换算依据',queries:['carbon dioxide equivalent global warming potential assessment']}],region:[],scenario:[]}});
  const r=recoverDataSearch([raw],'沿用刚才的换算，要核对什么字段？');
  assert.equal(r.dataQuestion,'沿用刚才的换算，要核对什么字段？');assert.match(r.researchIntent!.purpose,/CO2e/);
  assert.deepEqual(r.paper.facets[0].queries,['carbon dioxide equivalent','global warming potential','assessment']);assert.equal(r.skippedSources?.paper,undefined);
});
test('no credible English means assertion request is explicitly absent while Chinese public theme is still searched',async()=>{
  const s=fakeDeps('not JSON',{previousResearchIntent:{purpose:'比较河流地貌证据',task:'核对原始资料',region:null,time:null,months:[]}});
  const r=await requiredDataSearch('先说有哪些方法',new AbortController().signal,s.deps);
  assert.deepEqual(s.executed,['haina','web']);const status=r.sourceStatus.find(s=>s.source==='文献资料检索')!;
  assert.equal(status.status,'not_requested');assert.match(status.detail,/未请求/);assert.doesNotMatch(JSON.stringify(r.plan.paper),/research data|先说/);
  assert.match(r.plan.web[0].web,/河流地貌/);
});

test("named catalogue bounds are enforced before lookup, including zero results and channel failure",async()=>{
  for(const [question,fails] of [
    ["海纳内部有哪些这类数据？",false],["只查海纳，有哪些地表温度产品？",true],["能在海纳找到这类数据吗？",false],
  ] as const){
    const actual:string[]=[];
    const fixture=fakeDeps(JSON.stringify(plan),{haina:()=>{actual.push("haina");if(fails)throw Error("fixture offline");return emptyHaina;}});
    const result=await requiredDataSearch(question,new AbortController().signal,fixture.deps);
    assert.deepEqual(actual,["haina"]);
    assert.deepEqual(fixture.executed,[]);
    assert.deepEqual(result.plan.sourcePolicy,{mode:"restricted",sources:["haina"]});
    assert.deepEqual(result.plan.paper.facets,[]);assert.deepEqual(result.plan.web,[]);
    assert.deepEqual(result.sourceStatus.find(row=>row.source==="海纳专区检索"),fails
      ? {source:"海纳专区检索",status:"failed",count:0,detail:"fixture offline"}
      : {source:"海纳专区检索",status:"done",count:0,detail:""});
    assert.ok(result.sourceStatus.filter(row=>row.source!=="海纳专区检索").every(row=>row.status==="not_requested"));
    assert.ok(!fixture.calls.some(call=>["source-paper","source-web"].includes(call.id)));
  }
});

test("preferred sources start first, named source comparisons stay bounded, and a mention alone keeps discovery open",async()=>{
  for(const [question,expected,mode] of [
    ["优先查海纳，找适合的地表温度数据",["haina","paper","web"],"preferred"],
    ["对照海纳和论文，找可用的地表温度资料",["haina","paper"],"restricted"],
    ["优先海纳，再看论文里的地表温度资料",["haina","paper"],"restricted"],
    ["先查海纳，再查论文",["haina","paper"],"restricted"],
    ["我之前见过海纳，帮我找几份可用的地表温度数据",["paper","haina","web"],undefined],
  ] as const){
    const fixture=fakeDeps(JSON.stringify(plan));
    const result=await requiredDataSearch(question,new AbortController().signal,fixture.deps);
    assert.deepEqual(fixture.executed,expected);
    assert.equal(result.plan.sourcePolicy?.mode,mode);
  }
});

test("restricted plans need no paper or web terms and repair cannot broaden a recovered or persisted limit",async()=>{
  const policy={mode:"restricted",sources:["haina"]} as const;
  const question="看看目录中的地表温度";
  const restricted={...plan,sourcePolicy:policy,paper:{},web:[]};
  const minimal=fakeDeps(JSON.stringify(restricted));
  const parsed=await requiredDataSearch(question,new AbortController().signal,minimal.deps);
  assert.deepEqual(parsed.plan.sourcePolicy,policy);assert.deepEqual(minimal.executed,["haina"]);
  const recovered=fakeDeps(c=>JSON.stringify(c?plan:{...restricted,hainaQueries:[]}));
  await requiredDataSearch(question,new AbortController().signal,recovered.deps);
  assert.deepEqual(recovered.executed,["haina"]);
  const broken=fakeDeps("{invalid");
  await requiredDataSearch("只查海纳，这类观测有哪些？",new AbortController().signal,broken.deps);
  assert.deepEqual(broken.executed,["haina"]);
  const continuation=fakeDeps(JSON.stringify({...plan,sourcePolicy:{mode:"restricted",sources:["paper","haina"]}}),
    {lockedSourcePolicy:policy,lockQuestion:true});
  assert.deepEqual((await requiredDataSearch(question,new AbortController().signal,continuation.deps)).plan.sourcePolicy,policy);
  assert.deepEqual(continuation.executed,["haina"]);
});

test("nullable planning fallback keeps the selected channel and validates meaningful fallback conditions",async()=>{
  const question="请先找 USGS 官方说明并读取地表温度换算依据";
  for(const source of ["web","haina"] as const){
    const fixture=fakeDeps(JSON.stringify({...plan,dataQuestion:question,
      sourcePolicy:{mode:"restricted",sources:[source],fallback:null}}));
    const result=await requiredDataSearch(question,new AbortController().signal,fixture.deps);
    assert.deepEqual(result.plan.sourcePolicy,{mode:"restricted",sources:[source]});
    assert.deepEqual(fixture.executed,[source]);
    assert.ok(fixture.calls.some(c=>c.id==="data-question-initial"&&c.status==="done"));
    assert.ok(!fixture.calls.some(c=>c.id==="data-question-repair"));
  }
  const conditional={mode:"restricted",sources:["haina","paper"],fallback:"no_match"};
  const controlled=fakeDeps(JSON.stringify({...plan,sourcePolicy:conditional}));
  const result=await requiredDataSearch(question,new AbortController().signal,controlled.deps);
  assert.deepEqual(result.plan.sourcePolicy,conditional);
  assert.deepEqual(controlled.executed,["haina","paper"]);
  for(const sourcePolicy of [
    {...conditional,sources:["web"]},{...conditional,mode:"preferred"},{...conditional,fallback:"always"},
    {...conditional,fallback:null,sources:[]},{...conditional,fallback:null,sources:["unknown"]},
    {...conditional,fallback:null,sources:["web","web"]},{...conditional,fallback:null,extra:true},
  ])assert.throws(()=>parseDataSearch(JSON.stringify({...plan,sourcePolicy}),question),/发现来源范围格式无效/);
});

test("a named fallback waits for confirmed zero hits, including when web is the leading source",async()=>{
  for(const status of ["hit","zero","failed"] as const){
    let start!:()=>void,finish!:(value:typeof emptyHaina)=>void,fail!:(reason:Error)=>void;
    const entered=new Promise<void>(resolve=>{start=resolve;});
    const pending=new Promise<typeof emptyHaina>((resolve,reject)=>{finish=resolve;fail=reject;});
    const actual:string[]=[];
    const fixture=fakeDeps(JSON.stringify(plan),{
      haina:()=>{actual.push("haina");start();return pending;},
      paper:async()=>{actual.push("paper");return {records:[],tools:[],incomplete:[]};},
    });
    const running=requiredDataSearch("优先海纳，找不到再看论文",new AbortController().signal,fixture.deps);
    await entered;
    assert.deepEqual(actual,["haina"]);assert.deepEqual(fixture.executed,[]);
    if(status==="failed")fail(Error("upstream unavailable"));
    else finish({...emptyHaina,assets:status==="hit"?searchHaina(["ERA5"]).slice(0,1):[]});
    const result=await running;
    assert.deepEqual(actual,status==="zero"?["haina","paper"]:["haina"]);
    assert.deepEqual(fixture.executed,[]);
    assert.deepEqual(result.plan.sourcePolicy,{mode:"restricted",sources:["haina","paper"],fallback:"no_match"});
    assert.equal(result.sourceStatus.find(row=>row.source==="网络检索")?.status,"not_requested");
    assert.equal(result.sourceStatus.find(row=>row.source==="文献资料检索")?.status,status==="zero"?"done":"not_requested");
  }
  const fixture=fakeDeps(JSON.stringify(plan),{
    web:async()=>[{engine:"Bing",query:"surface temperature",status:"done",hits:[{title:"Record",url:"https://example.org/source",snippet:""}]}],
    refineWeb:async()=>JSON.stringify({checks:[],discoveryQueries:[]}),
  });
  const result=await requiredDataSearch("先查公开网络，找不到再查论文",new AbortController().signal,fixture.deps);
  assert.deepEqual(fixture.executed,[]);
  assert.equal(result.sourceStatus.find(row=>row.source==="文献资料检索")?.status,"not_requested");
});

test("a same-turn supplement inherits only the conditional channels actually opened by its parent",async()=>{
  const question="优先海纳，找不到再看论文";
  const parentResults=["hit","zero","failed"] as const;
  for(const status of parentResults){
    const parentFixture=fakeDeps(JSON.stringify(plan),{haina:()=>{
      if(status==="failed")throw Error("fixture outage");
      return {...emptyHaina,assets:status==="hit"?searchHaina(["ERA5"]).slice(0,1):[]};
    }});
    const parent=await requiredDataSearch(question,new AbortController().signal,parentFixture.deps);
    const lockedSourcePolicy=continuationSourcePolicy(JSON.parse(JSON.stringify(parent)),question);
    const sources=status==="zero"?["haina","paper"]:["haina"];
    assert.deepEqual(lockedSourcePolicy,{mode:"restricted",sources});
    const supplement=fakeDeps(JSON.stringify({...plan,sourcePolicy:null}),{lockedSourcePolicy,lockQuestion:true});
    const child=await requiredDataSearch(question,new AbortController().signal,supplement.deps);
    assert.deepEqual(child.plan.sourcePolicy,lockedSourcePolicy);
    assert.deepEqual(supplement.executed,sources);
    assert.equal(child.sourceStatus.find(row=>row.source==="海纳专区检索")?.count,0);
    assert.equal(child.sourceStatus.find(row=>row.source==="网络检索")?.status,"not_requested");
  }
});

test("preferred search completes its leading lookup before deciding whether to use other channels",async()=>{
  for(const [question,status,expected] of [
    ["优先海纳","hit",["haina"]],
    ["优先海纳","zero",["haina","paper","web"]],
    ["优先海纳","failed",["haina","paper","web"]],
    ["先查海纳，再查论文","hit",["haina","paper"]],
  ] as const){
    let start!:()=>void,finish!:(value:HainaSearchResult)=>void,fail!:(reason:Error)=>void;
    const entered=new Promise<void>(resolve=>{start=resolve;});
    const pending=new Promise<HainaSearchResult>((resolve,reject)=>{finish=resolve;fail=reject;});
    const actual:string[]=[];
    const fixture=fakeDeps(JSON.stringify(plan),{
      haina:()=>{actual.push("haina");start();return pending;},
      paper:async()=>{actual.push("paper");return {records:[],tools:[],incomplete:[]};},
      web:async()=>{actual.push("web");return [];},
    });
    const running=requiredDataSearch(question,new AbortController().signal,fixture.deps);
    await entered;
    assert.deepEqual(actual,["haina"]);
    if(status==="failed")fail(Error("fixture outage"));
    else finish({...emptyHaina,assets:status==="hit"?searchHaina(["ERA5"]).slice(0,1):[]});
    const result=await running;
    assert.deepEqual(actual,expected);
    if(expected.length===1)assert.ok(result.sourceStatus.filter(row=>row.source!=="海纳专区检索")
      .every(row=>row.status==="not_requested" && row.detail.includes("优先来源已返回候选")));
  }
});

test("natural follow-ups retain an earlier limit even when the planner outputs null, until released or formally changed",async()=>{
  const old={mode:"restricted",sources:["haina"]} as const;
  const history=[{role:"user",text:"海纳内部有哪些地表温度数据？"},{role:"assistant",text:"已在海纳核对。"}];
  for(const question of ["还有别的时段吗？","换个话题，找能做水温对照的数据","这次不限来源，再找一些同类数据"]){
    const fixture=fakeDeps(JSON.stringify({...plan,sourcePolicy:null}),{history});
    const result=await requiredDataSearch(question,new AbortController().signal,fixture.deps);
    assert.deepEqual(result.plan.sourcePolicy,question.startsWith("还有")?old:undefined);
    assert.deepEqual(fixture.executed,question.startsWith("还有")?["haina"]:["paper","haina","web"]);
  }
  const original="只查海纳，有哪些地表温度资料？";
  for(const choice of ["proposed","edited"] as const){
    const approved="这轮改为只查论文里的地表温度资料";
    const fixture=fakeDeps(JSON.stringify(plan),{history,lockedSourcePolicy:old});
    const result=await requiredDataSearch(original,new AbortController().signal,fixture.deps,
      {checkMessageId:"check",originalQuestion:original,choice,dataQuestion:approved});
    assert.equal(result.plan.questionMode,"confirmed");assert.deepEqual(fixture.executed,["paper"]);
  }
});
test('fallback public queries do not include private sample measurements',()=>{
  const r=fallbackDataSearch('我的私有样本数值是 123.456, 987.654，请说明误差核对原则',{previousResearchIntent:{purpose:'核对传感器标定误差',task:'解释方法',region:null,time:null,months:[]}});
  assert.doesNotMatch(JSON.stringify([r.web,r.hainaQueries]),/123|456|987|654/);assert.match(r.dataQuestion,/123.456/);
});
test('a real reframe is never executed even if metadata/queries remain malformed',async()=>{
  const s=fakeDeps(JSON.stringify({questionMode:'reframe',dataQuestion:'是否改为下载某个区域的样本？',researchIntent:'invalid',paper:{facets:[{need:'坏参数',queries:['中文']}]}}));
  const r=await requiredDataSearch('先提出一种数据研究问题让我选',new AbortController().signal,s.deps);
  assert.ok(r.questionCheck);assert.deepEqual(s.executed,[]);
});
test('choosing original question turns a non-question execution promise into actual retrieval',async()=>{
  const question='请推荐两个社会和地理背景不同的同名习俗案例，能找到原材料来对读。';
  const s=fakeDeps(JSON.stringify({...plan,dataQuestion:question,clarification:'这个比较目标已经明确；我会先检索两个有原材料的候选案例供你选择。'}));
  const r=await requiredDataSearch(question,new AbortController().signal,s.deps,{checkMessageId:'check',originalQuestion:question,dataQuestion:question,choice:'original'});
  assert.equal(r.clarification,undefined);assert.equal(r.questionCheck,undefined);assert.equal(s.executed.length,3);
});
test('a bounded same-task paraphrase does not reopen approval, while added region or causal task still does',async()=>{
  const question='我还没选定具体习俗，也没有候选地点。你先帮我选两个同名习俗的案例吧，社会和地理背景要有明显差别，能找到原材料来对读就行。';
  const s=fakeDeps(JSON.stringify({...plan,questionMode:'reframe',dataQuestion:'如何选择两个社会与地理背景明显不同、且有可对读原材料的同名习俗案例？'}));
  const r=await requiredDataSearch(question,new AbortController().signal,s.deps);assert.equal(r.questionCheck,undefined);assert.equal(s.executed.length,3);assert.equal(r.plan.dataQuestion,question);
  const changed=fakeDeps(JSON.stringify({...plan,questionMode:'reframe',dataQuestion:'如何选择两个北京2020年的习俗案例并证明环境导致习俗差异？'}));
  const rr=await requiredDataSearch(question,new AbortController().signal,changed.deps);assert.ok(rr.questionCheck);assert.deepEqual(changed.executed,[]);
});
test('unknown identity does not block the requested general method or evidence boundary',async()=>{
  const s=fakeDeps(JSON.stringify({...plan,clarification:'你方便提供库名、链接、DOI，或一条数据记录截图吗？'}),{history:[{role:'user',text:'我暂时不知道具体库名，也没有链接。'}]});
  const r=await requiredDataSearch('先说说通常要查哪些说明和资料，以及不知道库名时哪些判断还做不了吧。',new AbortController().signal,s.deps);
  assert.equal(r.clarification,undefined);assert.equal(s.executed.length,3);
});
test('a question about assistant actual reads does not become a question about user own actions',async()=>{
  const s=fakeDeps(JSON.stringify({...plan,clarification:'你手头已经读过哪些文件？请先提供记录。'}));
  const r=await requiredDataSearch('你刚才实际读取了哪些文件，哪些还没读？',new AbortController().signal,s.deps);
  assert.equal(r.clarification,undefined);assert.equal(s.executed.length,3);
});
test('schema requires complete nullable metadata and restricts English assertion queries to at most three words',()=>{
  assert.ok(dataSearchSchema.required.includes('researchIntent'));assert.ok(dataSearchSchema.required.includes('clarification'));
  const pattern=new RegExp(dataSearchSchema.properties.paper.properties.facets.items.properties.queries.items.pattern);
  assert.ok(pattern.test('global warming potential'));assert.ok(!pattern.test('global warming potential climate factors'));assert.ok(!pattern.test('全球变暖潜势'));
  assert.deepEqual(dataSearchSchema.properties.clarification.type,['string','null']);
});

test('degraded year recovery distinguishes research conditions from product version/publication chronology and open-ended dates',()=>{
  const previousResearchIntent={purpose:'研究降雨变化',task:'核对资料',region:'鄱阳湖流域',time:'2018—2020年',months:[]};
  for(const q of ['核对2024年版产品','研究2020—2023年版产品的算法','核对2026年发布的资料','解释这份发表于2026年的研究','这份文档成文于2026年，方法是什么','比较2020—2023年出版的报告','观测自2014年以来的变化','研究2014年以后的变化','研究2020年7月的降雨','分析2020-07-01的观测']){
    const r=fallbackDataSearch(q,{previousResearchIntent});assert.equal(r.researchIntent?.time,'2018—2020年',q);assert.deepEqual(r.conversationPeriod,[2018,2020],q);assert.match(r.conversationContext!,/本轮用户原话/);
    assert.equal(fallbackDataSearch(q).researchIntent?.time,null,q);
  }
  for(const q of ['研究2020—2023年的降雨变化','只把年份改成2018—2020年','筛选2021年的观测资料','只看2022年']){
    const r=fallbackDataSearch(q);assert.notEqual(r.researchIntent?.time,null,q);
  }
  const mixed=fallbackDataSearch('使用2024年版产品，研究2018—2020年的降雨');assert.deepEqual(mixed.conversationPeriod,[2018,2020]);
  assert.equal(fallbackDataSearch('比较2018年和2020年的变化').researchIntent?.time,null,'separate years are not manufactured into one closed interval');
});
test('an explicit answer to a time clarification is recognized, while an unexplained document year is not',()=>{
  const r=fallbackDataSearch('2020—2023年',{history:[{role:'assistant',text:'研究哪段时段？'}]});assert.deepEqual(r.conversationPeriod,[2020,2023]);
  assert.equal(fallbackDataSearch('2024年资料').researchIntent?.time,null);
});
test('degraded old summaries are explicitly historical and current user text remains authoritative',()=>{
  const r=fallbackDataSearch('区域就看鄱阳湖流域',{conversationContext:'尚未指定区域和时段。'});
  assert.match(r.conversationContext!,/历史摘要（可能过时，当前以本轮原话为准）/);assert.match(r.conversationContext!,/本轮用户原话.*鄱阳湖/);
});

test('prior open-ended research time remains textual and never becomes a one-year filter',()=>{
  for(const time of ['自2014年以来','2014年以后','since 2014','2020年、2023年']){
    const previousResearchIntent={purpose:'研究变化',task:'核对方法',region:null,time,months:[]};
    const r=fallbackDataSearch('继续核对资料',{previousResearchIntent});assert.equal(r.researchIntent?.time,time);assert.equal(r.conversationPeriod,null,time);
  }
});
test('failed parsed publication metadata cannot overwrite the established research time',()=>{
  const previousResearchIntent={purpose:'研究降雨',task:'核对资料',region:'鄱阳湖流域',time:'2018—2020年',months:[]};
  const raw=JSON.stringify({...plan,researchIntent:{...previousResearchIntent,time:'2024年'},conversationPeriod:[2024,2024],paper:{facets:[{need:'降雨',queries:['中文']}],name:'',region:[]}});
  const r=recoverDataSearch([raw],'研究2024年版产品的方法',{previousResearchIntent});assert.equal(r.researchIntent?.time,'2018—2020年');assert.deepEqual(r.conversationPeriod,[2018,2020]);
  const unknown=recoverDataSearch([raw],'研究2024年版产品的方法');assert.equal(unknown.researchIntent?.time,null);assert.equal(unknown.conversationPeriod,null);
});

test("network findings are published while assertion retrieval is still pending",async()=>{
  let releasePaper!:()=>void, webArrived!:()=>void;
  const paperWait=new Promise<void>(resolve=>{releasePaper=resolve;});
  const observed=new Promise<void>(resolve=>{webArrived=resolve;});
  const findings:import("./types").SearchFinding[]=[];
  let finished=false;
  const work=requiredDataSearch("为什么城市里更热",new AbortController().signal,{
    plan:async()=>JSON.stringify(plan),report:()=>{},stage:()=>{},
    finding:f=>{findings.push(f);if(f.id==="web")webArrived();},
    paper:async()=>{await paperWait;return {records:[],tools:[],incomplete:[]};},
    haina:()=>emptyHaina,
    web:async()=>[{engine:"Bing",query:"surface temperature",status:"done",hits:[{title:"Observed temperature",url:"https://example.org/temperature",snippet:"Result snippet"}]}],
    refineWeb:async()=>"{}",
  }).then(result=>{finished=true;return result;});
  await observed;
  assert.equal(finished,false);
  assert.equal(findings.find(f=>f.id==="web")?.items[0].title,"Observed temperature");
  assert.match(findings.find(f=>f.id==="web")!.items[0].detail!,/检索结果摘要/);
  releasePaper();
  await work;
  assert.equal(finished,true);
  assert.ok(findings.some(f=>f.id==="paper"));
  assert.ok(findings.some(f=>f.id==="haina"));
});
