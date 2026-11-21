import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { AnswerReferenceError,parseSynthesis,synthesizeAnswer,synthesisHistory,synthesisResponseSchema,needsVerifiedCalculation } from "../../server/scientific-answer";
import { catalogueRows, validHistory,shouldReviewAnswerEvidence } from "../../server/chat-executor";
import { paperIntent } from "../../server/paper-discovery";
import { observationIntent } from "./observation-intent";
import {expandsSources} from "./research-question";
import { discover } from "./discovery";
import { searchPapers } from "../../server/earthnano";
import { AnswerContent } from "../components/AnswerContent";
import { assets, discoverableAsset } from "./datasets";
import type { PaperRecord } from "./paper-record";
import { cellAt, emptyFilters, gridSpec } from "./spatial";
import type { AnswerReference, DiscoveryContext } from "./types";

const scope={caseId:null,filters:emptyFilters(),selection:null} as DiscoveryContext;
const hit={title:"Publisher documentation",url:"https://example.org/dem",snippet:"Publication metadata."};
const assetRefs:AnswerReference[]=Array.from({length:6},(_,i)=>({kind:"asset",id:"id"+i,title:"Data "+i,source:i===3?"论文断言库":"海纳"}));
const refs:AnswerReference[]=[...assetRefs,{kind:"web",title:hit.title,url:hit.url}];

test("one claim can cite web, paper and catalogue evidence, in first-citation order, beyond four",()=>{
  const answer=parseSynthesis(JSON.stringify({message:"范围可核对。[S7][S4]",sections:[{heading:"怎样验证变化",text:"分期交叉核对。[S7][S1][S2][S3][S5][S6]"}]}),refs,[hit]);
  assert.equal(answer.references.length,7);
  assert.equal(answer.sources.length,6);
  assert.deepEqual(answer.webSources,[hit]);
  assert.ok(answer.message.includes("〔1〕〔2〕"));
  assert.ok(answer.message.includes("〔1〕〔3〕〔4〕〔5〕〔6〕〔7〕"));
  const html=renderToStaticMarkup(createElement(AnswerContent,{text:answer.message,references:answer.references,inspect() {}}));
  assert.match(html,/<h3>怎样验证变化<\/h3>/);
  assert.equal((html.match(/<button /g)||[]).length,6);
  assert.equal((html.match(/href="https:\/\/example.org\/dem"/g)||[]).length,2);
});

test("unmatched questions can use no references and invented evidence numbers cannot become citations",()=>{
  assert.deepEqual(parseSynthesis('{"message":"当前样本缺少第二期高程。","sections":[]}',[],[]).references,[]);
  for(const ref of ["[S8]","[S0]","[S1,S8]","[S1oops]","〔2〕"])
    assert.throws(()=>parseSynthesis(JSON.stringify({message:"缺少实测。"+ref}),refs,[hit]),/引用/);
});

test("tables, emphasis and ordered steps retain citations and render supplied markup as text",()=>{
  const message="**可配对。[S1]**\n\n| 资料 | 匹配范围 |\n| --- | --- |\n| DEM | 高程样本 [S7] |\n\n1. 保留原始日期。[S1]\n2. [获取说明](https://example.org/dem)\n\n<img src=x onerror=alert(1)>\n[错误入口](javascript:alert)";
  const answer=parseSynthesis(JSON.stringify({message}),refs,[hit]);
  const html=renderToStaticMarkup(createElement(AnswerContent,{text:answer.message,references:answer.references,inspect() {}}));
  assert.match(html,/<strong>可配对。<span class="citation-inline-group"><button/);
  assert.match(html,/<table\b/);
  assert.match(html,/<td[^>]*>高程样本 <span class="citation-inline-group"><a[^>]*aria-label="依据 2/);
  assert.match(html,/<ol start="1"><li>/);
  assert.ok(!html.includes("<img") && !html.includes('href="javascript:'));
  assert.match(html,/&lt;img/);
});

test("assertion matches preserve catalogue samples and follow-ups retain cited assets",()=>{
  const asset=assets.find(a=>discoverableAsset(a) && a.tabs.some(t=>t.kind==="table" && t.rows?.length))!;
  const paper={id:"earthnano:"+"a".repeat(64),dsKey:asset.datasetId,paperTitle:"Related study",studyContext:"Study area",
    need:{product:asset.title,source:"EarthNano 论文断言库",detail:"Author used this dataset",tabs:[]}} as unknown as PaperRecord;
  const rows=catalogueRows("比较这批数据",{...scope,candidateIds:[asset.id]},{message:""},[],[paper]);
  const local=rows.find(r=>r.id===asset.id)!;
  assert.ok("samples" in local && local.samples.length>0);
  assert.ok(rows.some(r=>r.id===paper.id));
  const history=[{role:"assistant" as const,text:"上一轮选定的资料",assetIds:[asset.id]}];
  assert.ok(validHistory(history));
  assert.ok(!validHistory([{...history[0],assetIds:[9]}]));
  const followup=catalogueRows("它们有哪些共同年份？",scope,{message:""},history,[]);
  assert.equal(followup[0].id,asset.id);
});

test("derived research evidence reaches the answer with its actual role while remaining a clue",()=>{
  const rows=catalogueRows("湖终止型冰川的湖泊水深",{...scope,candidateIds:["Q20-3"]},{message:""},[],[]);
  const depth=rows.find(r=>r.id==="Q20-3");
  assert.ok(depth && "samples" in depth);
  assert.equal(depth.kind,"clue");
  assert.ok(JSON.stringify(depth.samples).includes("91"));
  assert.ok(JSON.stringify(depth.samples).includes("364"));
  assert.match(depth.summary,/推算/);
  const followup=catalogueRows("Mendenhall 和 Alsek 有可用的水深估计值吗？这些值是实测还是推算的？",
    {...scope,candidateIds:["Q20-1","Q20-2","Q20-4"],inCandidateScope:true},{message:""},[],[]);
  assert.ok(followup.some(r=>r.id==="Q20-3"));
  const emptyBatch=catalogueRows("请再核对这两条冰川的作者表，有没有末端潜在水深的具体数值？",
    {...scope,caseId:"Q20",filters:{...scope.filters,place:"Mendenhall"},candidateIds:[],inCandidateScope:true},{message:""},[],[]);
  assert.ok(emptyBatch.some(r=>r.id==="Q20-3"));
});

test("the same scientific request can draw on multiple sources while explicit scopes stay narrow",()=>{
  assert.equal(paperIntent("结合海纳和论文分析冰川质量变化",scope),"mixed");
  assert.equal(paperIntent("结合论文证据，冰川为何加速消融？",scope),"mixed");
  assert.equal(paperIntent("如何估算冰川质量平衡？",scope),"mixed");
  assert.equal(paperIntent("哪些论文用过 ERA5？",scope),"paper");
  assert.equal(paperIntent("如何估算冰川质量平衡？",{...scope,filters:{...scope.filters,source:"haina"}}),undefined);
  const chosen=assets.filter(discoverableAsset).filter(a=>a.origins.includes("haina")).slice(0,8);
  assert.equal(chosen.length,8);
  const records=catalogueRows("比较这批数据",{...scope,candidateIds:chosen.map(a=>a.id)},{message:""},[],[]);
  assert.equal(records.length,8);
  assert.ok(records.every(r=>chosen.some(a=>a.id===r.id)));
});

test("cross-source answers do not become paper-only searches or failed constellation filters",()=>{
  for (const query of [
    "结合论文断言库和星座及时数据回答",
    "论文断言库和星座数据有什么差别？",
    "结合论文断言库和大模型推理回答",
    "结合海纳和星座及时数据回答",
    "结合海纳、论文断言库、星座及时数据和大模型推理，解释冰川数据如何选取",
  ]) {
    assert.equal(paperIntent(query,scope),"mixed",query);
    assert.equal(observationIntent(query,false),null,query);
    assert.equal(observationIntent(query,true),null,query);
  }
  assert.equal(paperIntent("仅从论文断言库查 ERA5，海纳先不用",scope),"paper");
  assert.equal(paperIntent("只查海纳中的冰川数据，论文记录先不看",scope),undefined);
  assert.equal(observationIntent("只用星座观测，不查论文",false),"new");
  assert.equal(paperIntent("只用星座观测，不查论文",scope),undefined);
  assert.equal(paperIntent("只看论文和海纳中的数据",scope),"mixed");
  assert.equal(paperIntent("只看论文研究数据和海纳专区",scope),"mixed");
  assert.equal(paperIntent("只看论文线索、海纳数据和星座观测",scope),"mixed");
  assert.equal(paperIntent("不只用论文，还要结合星座观测",scope),"mixed");
});

test("an explicit source restriction excludes unrelated catalogues and live assertions",()=>{
  const chosen=assets.filter(discoverableAsset).filter(a=>a.origins.includes("haina")).slice(0,8);
  const paper={id:"earthnano:"+"b".repeat(64),need:{product:"A paper clue",source:"EarthNano",detail:"Paper usage",tabs:[]}} as unknown as PaperRecord;
  const context={...scope,candidateIds:chosen.map(a=>a.id)};
  const rows=catalogueRows("只用海纳，论文暂不查",context,{message:""},[],[paper]);
  assert.equal(rows.length,chosen.length);
  assert.ok(rows.every(row=>chosen.some(asset=>asset.id===row.id)));
  assert.deepEqual(catalogueRows("仅用星座观测，不查论文",context,{message:""},[],[paper]),[]);
  const restricted=catalogueRows("只用论文研究数据，沿用地下水对象",context,{message:""},[],[paper],chosen);
  assert.deepEqual(restricted.map(row=>row.id),[paper.id]);
  assert.deepEqual(catalogueRows("继续核对刚才的用法",context,{message:""},[],[paper],chosen,"paper").map(row=>row.id),[paper.id]);
  assert.ok(catalogueRows("沿用刚才的条件",context,{message:""},[],[paper],chosen,"haina").every(row=>chosen.some(a=>a.id===row.id)));
  assert.equal(expandsSources("恢复全部来源，也看看海纳"),true);
  assert.equal(expandsSources("不只用论文"),true);
  assert.equal(expandsSources("不要全部来源，只用论文研究数据"),false);
});

test("mentioning Haina in a combined follow-up preserves the study source and selected grid",()=>{
  const grid=gridSpec("h3",3), point:[number,number]=[-134.5,58.4];
  const context:DiscoveryContext={...scope,caseId:"Q20",selection:{grid,id:cellAt(point,grid),point},
    layer:"all",gridSystem:"h3",camera:{center:point,zoom:10,reason:"Mendenhall"},citation:null};
  const reply=discover("结合海纳、论文断言库和星座数据，当前资料有哪些共同年份？",context);
  assert.equal(reply.filters?.source || "","");
  assert.ok(!reply.clearSelection);
  const single=discover("只看海纳来源",context);
  assert.equal(single.filters?.source,"haina");
});

test("assertion search verifies distinct candidates beyond the first four, continues across pages, and retains partial successes",async t=>{
  t.mock.method(Client.prototype,"connect",async()=>{});
  t.mock.method(Client.prototype,"close",async()=>{});
  const offsets:number[]=[];
  t.mock.method(Client.prototype,"callTool",async ({name,arguments:args}:{name:string;arguments:Record<string,unknown>})=>{
    let payload:Record<string,unknown>={status:"ok"};
    if(name==="resolve_dataset") {
      const offset=Number(args.offset||0); offsets.push(offset);
      const keys=offset===0?[1,2,3,4,5]:[5,6,7,8];
      payload={entities:keys.map(n=>({ds_key:"k"+n,n_papers:1,display_name:"Product "+n})),next_offset:offset===0?5:null};
    } else if(name==="search_dataset_usage") {
      if(args.ds_key==="k2")throw Error("unavailable");
      payload.usages=args.ds_key==="k3"?[]:[{ds_key:args.ds_key,paper_id:"p",dataset_id:args.ds_key,paper_title:"Observed"}];
    }
    return {content:[{type:"text",text:JSON.stringify(payload)}]};
  });
  const result=await searchPapers({name:"test",facets:[],region:[]},new AbortController().signal,()=>{});
  assert.deepEqual(offsets,[0,5]);
  assert.deepEqual(result.records.map(r=>r.dsKey),["k1","k4","k5","k6","k7","k8"]);
  assert.deepEqual(result.incomplete,["search_dataset_usage"]);
});


test("satellite product links and literal code are not mistaken for numbered evidence",()=>{
  const message="Retrieve atmospheric variables from satellite radiometer and sounder data products.\n[Satellite sounder products](https://example.org/sounder) [S1]\n[Sentinel data](https://example.org/sentinel) [S7]\n`[S999]`\n```text\n〔9〕 [S999]\n```";
  const answer=parseSynthesis(JSON.stringify({message}),refs,[hit]);
  assert.deepEqual(answer.references,[refs[0],refs[6]]);
  assert.match(answer.message,/\[Satellite sounder products\]\(https:\/\/example.org\/sounder\) 〔1〕/);
  assert.match(answer.message,/\[Sentinel data\]\(https:\/\/example.org\/sentinel\) 〔2〕/);
  assert.ok(answer.message.includes("`[S999]`"));
  assert.ok(answer.message.includes("〔9〕 [S999]"));
});

test("grouped citations use current materials and preserve first-citation order",()=>{
  const answer=parseSynthesis(JSON.stringify({message:"范围 [S7, S4]；对照 [S4、S1]；重复 [S1,S1]。"}),refs,[hit]);
  assert.deepEqual(answer.references,[refs[6],refs[3],refs[0]]);
  assert.equal(answer.message,"范围 〔1〕〔2〕；对照 〔2〕〔3〕；重复 〔3〕。");
  assert.throws(()=>parseSynthesis(JSON.stringify({message:"错误 [S1,S99]"}),refs,[hit]),error=>error instanceof AnswerReferenceError && error.problem==="out-of-range");
  assert.throws(()=>parseSynthesis(JSON.stringify({message:"旧引用 〔1〕"}),refs,[hit]),error=>error instanceof AnswerReferenceError && error.problem==="format");
});

test("followups keep material identities and titles without recycling prior display numbers",()=>{
  const history=[{role:"assistant",text:"温度 〔2〕（Sounder product）[S7]。",assetIds:["sounder"]},{role:"user",text:"继续比较温度与湿度"}];
  const clean=synthesisHistory(history);
  assert.equal(clean[0].text,"温度 （Sounder product）。");
  assert.deepEqual(clean[0].assetIds,["sounder"]);assert.equal(clean[1],history[1]);
  assert.ok(history[0].text.includes("〔2〕"),"history stored for the user is unchanged");
});

test("one automatic repair receives the failed draft, actual reference error and allowed IDs",async()=>{
  const calls:string[]=[],controller=new AbortController();let repairs=0;
  const answer=await synthesizeAnswer("本轮材料",refs,[hit],async prompt=>{
    calls.push(prompt);return JSON.stringify({message:calls.length===1?"未核对 [S99]":"本轮资料 [S2]"});
  },controller.signal,()=>repairs++);
  assert.equal(calls.length,2);assert.equal(repairs,1);
  assert.match(calls[1],/out-of-range/);assert.match(calls[1],/S99/);assert.match(calls[1],/allowedReferences/);
  assert.match(calls[1],/previousReply/);assert.ok(!calls[1].includes('"S8"'));
  assert.deepEqual(answer.references,[refs[1]]);
  let attempts=0;
  await assert.rejects(()=>synthesizeAnswer("材料",refs,[hit],async()=>{attempts++;return JSON.stringify({message:"仍有错误 [S99]"});},controller.signal),AnswerReferenceError);
  assert.equal(attempts,2,"invalid evidence is never silently accepted after bounded repair");
});

test("cancelling after a malformed draft prevents a second model request",async()=>{
  const controller=new AbortController();let attempts=0;
  await assert.rejects(()=>synthesizeAnswer("材料",refs,[],async()=>{attempts++;controller.abort();return '{"message":"[S99]"}';},controller.signal),{name:"AbortError"});
  assert.equal(attempts,1);
});

test('useful follow-up questions are retained separately and bounded conversation summaries survive history cleaning',()=>{
  const answer=parseSynthesis(JSON.stringify({message:'可以先比较两期高度。',followUp:'你指哪片森林和哪几年？'}),[],[]);
  assert.equal(answer.followUp,'你指哪片森林和哪几年？');assert.equal(answer.message,'可以先比较两期高度。');
  const history=[{role:'assistant',text:'高度资料〔1〕',conversationContext:'大兴安岭，研究树高变化，2020—2023年。'}];
  assert.ok(validHistory(history));assert.equal(synthesisHistory(history)[0].conversationContext,history[0].conversationContext);
  assert.ok(!validHistory([{...history[0],conversationContext:'a'.repeat(1601)}]));
  assert.ok(!validHistory([{...history[0],role:'user'}]));
  assert.throws(()=>parseSynthesis(JSON.stringify({message:'原理',followUp:'a'.repeat(501)}),[],[]),/追问/);
});

test('SN489 official document numbers survive citation validation and history cleaning without weakening citation guards',()=>{
 const text='杭政函〔2026〕123号已列成文日期。[S1]；国发〔2026〕20号另列机关。[S7]';
 const parsed=parseSynthesis(JSON.stringify({message:text,limitation:'浙政发〔2026〕18号仍需核施行条款。[S1]',followUp:'是否继续核杭政函〔2026〕123号？'}),refs,[hit]);
 assert.equal(parsed.references.length,2);assert.match(parsed.message,/杭政函〔2026〕123号/);assert.match(parsed.limitation,/浙政发〔2026〕18号/);
 assert.equal(synthesisHistory([{role:'assistant',text:parsed.message}])[0].text,'杭政函〔2026〕123号已列成文日期。；国发〔2026〕20号另列机关。');
 for(const token of ['〔1〕','〔2026〕','[S99]','杭政函〔2026〕123号〔1〕'])assert.throws(()=>parseSynthesis(JSON.stringify({message:token}),refs,[hit]),AnswerReferenceError);
});

test('bounded citation repair reports only the actual token/problem/available diagnostic',async()=>{
 let seen:unknown;let count=0;
 await synthesizeAnswer('sources',refs,[hit],async()=>JSON.stringify({message:++count===1?'[S99]':'杭政函〔2026〕123号[S1]'}),new AbortController().signal,diagnostic=>seen=diagnostic);
 assert.deepEqual(seen,{code:'invalid_answer_references',kind:'reference',token:'[S99]',problem:'out-of-range',available:refs.length});
 assert.ok(!JSON.stringify(seen).includes('sources'));
});


test('native structured output requires every object property, including an empty calculation request list',async()=>{
 const {dataSearchSchema}=await import('../../server/data-search');
 const {webComplementSchema}=await import('../../server/web-complement');
 const check=(schema:any,location:string)=>{
  if(!schema||typeof schema!=='object')return;
  if(schema.type==='object'){
   assert.equal(schema.additionalProperties,false,location);
   assert.deepEqual([...schema.required].sort(),Object.keys(schema.properties).sort(),location);
  }
  for(const [key,value]of Object.entries(schema)){
   if(Array.isArray(value))value.forEach((v,i)=>check(v,location+'.'+key+i));
   else if(value&&typeof value==='object')check(value,location+'.'+key);
  }
 };
 for(const [name,schema] of Object.entries({synthesisResponseSchema,dataSearchSchema,webComplementSchema}))check(schema,name);
 let calls=0;
 const answer=await synthesizeAnswer('fixture',[],[],async()=>{calls++;return JSON.stringify({message:'No computation was requested.',calculationRequests:[]});},new AbortController().signal);
 assert.equal(calls,1);assert.equal(answer.message,'No computation was requested.');
});

test('concrete substitutions trigger one bounded calculation plan rather than accepting unrecorded mental arithmetic',async()=>{
 const calls:string[]=[],reports:unknown[]=[],plans:string[]=[];
 const first={message:'4000 × 0.0068948 = 27.597 MPa，按源值换算。[S1]',calculationRequests:[]};
 const planned={message:'核对换算参数。',calculationRequests:[{operation:'arithmetic',arguments:JSON.stringify({expression:'4000*0.0068948'}),scope:'source',sourceRefs:['S1']}]};
 const final={message:'按所给因子，4000 × 0.0068948 = 27.5792 MPa；数学核算不证明原始因子或源读数适用。[S1]',calculationRequests:[]};
 const replies=[first,planned,final];
 const answer=await synthesizeAnswer('evidence fixture',refs,[hit],async p=>{calls.push(p);return JSON.stringify(replies.shift());},new AbortController().signal,undefined,r=>reports.push(r),{enforceCalculations:true,onCalculationPlan:s=>plans.push(s)});
 assert.equal(calls.length,3);assert.equal(replies.length,0);assert.deepEqual(plans,['running','done']);
 assert.equal((reports[0] as any).result.value,27.5792);assert.match(answer.message,/27\.5792/);assert.match(calls[2],/已实际执行的受控核算/);
 assert.equal(needsVerifiedCalculation({message:'研究2020—2023年，论文2024年发布。[S1]'}),false);
 assert.equal(needsVerifiedCalculation({message:'这份资料列出5个站和3个变量。[S1]'}),false);
 assert.equal(needsVerifiedCalculation({message:'合成示例：A(80,10)、B(60,20)，min-max归一化后等权得分相同。'}),true);
});

test('an unfulfilled calculation plan is bounded and does not create a false successful tool record',async()=>{
 let calls=0;const reports:unknown[]=[],plans:string[]=[];
 const answer=await synthesizeAnswer('fixture',[],[],async()=>{calls++;return JSON.stringify({message:'4000 × 0.0068948 = 27.5792 MPa。',calculationRequests:[]});},new AbortController().signal,undefined,r=>reports.push(r),{enforceCalculations:true,onCalculationPlan:s=>plans.push(s)});
 assert.equal(calls,4);assert.equal(reports.length,0);assert.deepEqual(plans,['running','partial']);assert.match(answer.limitation,/未取得成功的受控核算结果/);assert.doesNotMatch(answer.message,/27\.5792/);
});

test('a short verified mathematical example does not run a redundant source audit, while source factual claims still do',()=>{
 const calculation={operation:'arithmetic' as const,scope:'example' as const,sourceRefs:[],status:'completed' as const,result:{value:27.5792}};
 const example={message:'4000 × 0.0068948 = 27.5792 MPa。这是数学合成示例，不是实测或经验关系验证。',references:refs};
 assert.equal(shouldReviewAnswerEvidence(example,'请核算一个数学示例。',[calculation]),false);
 assert.equal(shouldReviewAnswerEvidence(example,'请核算一个数学示例。',[]),true,'unrecorded computation is not exempt');
 assert.equal(shouldReviewAnswerEvidence({...example,message:example.message+'作者报告另一处样本有30株。'},'请核算一个数学示例。',[calculation]),true);
 assert.equal(shouldReviewAnswerEvidence(example,'原论文中的经验参数是多少？',[{...calculation,scope:'source'}]),true);
});
