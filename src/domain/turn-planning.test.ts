import {researchExecutor} from "../../server/research-executor";
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {parseTurnPlan,prepareTurn,turnTargets,turnMetadata,turnPlanOutputContract,turnPlanningInstructions,type TurnAction,type TurnInput} from '../../server/turn-planning';
import {readPlannedSources} from '../../server/turn-reading';
import {requiredDataSearch,type DataSearchPlan} from '../../server/data-search';
import {catalogueRows,modelReply} from '../../server/chat-executor';
import {emptyFilters} from './spatial';
import type {DiscoveryContext,ToolCall,SearchRun} from './types';
const context=():DiscoveryContext=>({caseId:null,filters:emptyFilters(),selection:null,gridSystem:'h3',layer:'all',camera:{center:[105,25],zoom:1,reason:'test'},citation:null});
const input=(question:string):TurnInput=>({question,context:context(),history:[]});
function route(i:TurnInput,action:TurnAction,keys:string[]=[],extra:Record<string,unknown>={}){
 return {action,goal:i.question,evidenceNeed:({respond:keys.length?'existing':'none',read:'read',search:'discover',clarify:'unclear',workspace:'none'})[action],targets:keys,reason:'依据本轮目标和已提供对象决定动作',clarification:action==='clarify'?'你说的这片森林具体在哪里？':null,...turnMetadata(i.question,i),evidenceGap:action==='search'?i.question:null,...extra};
}
const retrievalPlan:DataSearchPlan={questionMode:'preserve',dataQuestion:'查找冰川物质平衡的数据来源',dataNeed:'高程与气象数据',hainaQueries:['高程模型'],paper:{name:'',facets:[{need:'高程',queries:['glacier elevation']}],region:[],scenario:[]},web:[{web:'glacier mass balance datasets',dataset:'glacier elevation'}]};
async function prepared(i:TurnInput,p:unknown){let searches=0,planning=0;const r=await prepareTurn(i,new AbortController().signal,{run:async()=>{planning++;return JSON.stringify(p)},stage:()=>{},report:()=>{},search:async()=>{searches++;throw Error('Unexpected discovery');}});return {...r,searches,planning};}

test('ordinary explanation, provided quotations, execution-history questions, clarification and workspace actions do not start discovery',async()=>{
 const quote=input('只解释我引用这段的含义，不要补充新资料');quote.context.citation={title:'指定段落',scope:'第2页',body:'位移以稳定参考点为基准，不代表绝对位置。'};
 const previous=input('刚才的读取记录能支持什么？');previous.history=[{role:'assistant',text:'已核对该页片段。',conversationReferences:[{kind:'web',title:'文档',url:'https://example.org/guide'}],conversationEvidence:[{title:'文档',url:'https://example.org/guide',excerpt:'实际读取的有界段落。',readAt:'2026-11-16T00:00:00Z',stage:'page-excerpt',discoveredBy:'assistant',readBy:'platform'}]}];
 const cases:[TurnInput,TurnAction,string[]][]=[[input('你好'),'respond',[]],[input('什么是参考框架？'),'respond',[]],[quote,'respond',['citation']],[previous,'respond',['web:https://example.org/guide']],[input('这片森林的树高有多少？'),'clarify',[]],[input('切换到S2'),'workspace',[]]];
 for(const [i,a,keys] of cases){const r=await prepared(i,route(i,a,keys));assert.equal(r.plan.action,a);assert.equal(r.searches,0);assert.equal(r.retrieval,undefined);}
});

test('an attachment is a possible object rather than automatic permission to read or search',async()=>{
 const i=input('你好');i.context.attachedScope=[{kind:'reference',number:1,messageId:'previous',reference:{kind:'web',title:'未读取的论文',url:'https://example.org/study.pdf'}}];
 const r=await prepared(i,route(i,'respond'));let reads=0;
 assert.equal(r.searches,0);assert.deepEqual(await readPlannedSources(r.plan,i.question,new AbortController().signal,{read:async()=>{reads++;throw Error('must not read')},stage:()=>{},report:()=>{}}),[]);assert.equal(reads,0);
});

test('an exact-source reading reads only that identity, preserves provenance, and records failures without broad fallback',async()=>{
 const i=input('读取这个网页的正文：https://example.org/guide');const key='web:https://example.org/guide';const r=await prepared(i,route(i,'read',[key]));let calls=0;const traces:ToolCall[]=[];
 const runs=await readPlannedSources(r.plan,i.question,new AbortController().signal,{read:async target=>{calls++;assert.equal(target.url,'https://example.org/guide');return {engine:'原站读取',hits:[{url:target.url!,title:target.title,snippet:'',pageExcerpt:'Actual bounded source paragraph.'}],requestUrl:target.url!,warning:'仅节选'}},stage:()=>{},report:c=>traces.push(c)});
 assert.equal(calls,1);assert.equal(r.searches,0);assert.equal(runs[0].status,'done');assert.equal(runs[0].hits[0].stage,'page-excerpt');assert.ok(traces.some(c=>c.status==='done'));
 const failed=await readPlannedSources(r.plan,i.question,new AbortController().signal,{read:async()=>{throw Error('HTTP 403')},stage:()=>{},report:()=>{}});assert.equal(failed[0].status,'failed');assert.deepEqual(failed[0].hits,[]);assert.equal(r.searches,0);
});

test('a discovery turn delegates the research gap, and the discovery provider plans its own channels',async()=>{
 const i=input(retrievalPlan.dataQuestion),executed:string[]=[];let plans=0,discoveryPlans=0;
 const r=await prepareTurn(i,new AbortController().signal,{run:async()=>{plans++;return JSON.stringify(route(i,'search'))},stage:()=>{},report:()=>{},search:p=>{
  assert.equal(p.evidenceGap,i.question);
  assert.equal(Object.hasOwn(p,'searchPlan'),false);
  return requiredDataSearch(i.question,new AbortController().signal,{
   plan:async()=>{discoveryPlans++;return JSON.stringify(retrievalPlan)},stage:()=>{},report:()=>{},
   paper:async()=>{executed.push('paper');return {records:[],tools:[],incomplete:[]}},haina:()=>{executed.push('haina');return {assets:[],total:0,synced:'',endpoint:'',warning:''}},web:async()=>{executed.push('web');return []},
  });
 }});
 assert.equal(plans,1);assert.equal(discoveryPlans,1);assert.deepEqual(executed,['paper','haina','web']);assert.equal(r.retrieval?.sourceStatus.length,3);assert.equal(r.retrieval?.plan.dataQuestion,i.question);
});

test('a proposed question transformation still stops before any source call',async()=>{
 const i=input('先将我的研究问题改写成数据问题供我确认'),executed:string[]=[];
 const r=await prepareTurn(i,new AbortController().signal,{run:async()=>JSON.stringify(route(i,'search')),stage:()=>{},report:()=>{},search:()=>requiredDataSearch(i.question,new AbortController().signal,{
  plan:async()=>JSON.stringify({...retrievalPlan,questionMode:'reframe',dataQuestion:'需要哪些高程数据？'}),stage:()=>{},report:()=>{},paper:async()=>{executed.push('paper');return {records:[],tools:[],incomplete:[]}},haina:()=>{executed.push('haina');return {assets:[],total:0,synced:'',endpoint:'',warning:''}},web:async()=>{executed.push('web');return []},
 })});assert.ok(r.retrieval?.questionCheck);assert.deepEqual(executed,[]);
});

test('invented objects, hidden retrieval parameters and unrequested workspace actions cannot pass the route boundary',()=>{
 const i=input('为什么切换到S2？');assert.throws(()=>parseTurnPlan(JSON.stringify(route(i,'read',['web:https://invented.example/x'])),i),/对象无效/);
 assert.throws(()=>parseTurnPlan(JSON.stringify(route(i,'respond',[],{searchPlan:retrievalPlan})),i),/不能附带内部检索参数/);
 assert.throws(()=>parseTurnPlan(JSON.stringify(route(input('找冰川数据'),'search',[],{evidenceGap:null})),input('找冰川数据')),/说明本轮缺少的证据/);
 assert.throws(()=>parseTurnPlan(JSON.stringify(route(i,'workspace')),i),/没有明确授权/);
 assert.throws(()=>parseTurnPlan(JSON.stringify(route(i,'read',[])),i),/确切对象/);
});

test('cancelled turns never start planning or source reading',async()=>{
 let calls=0;const c=new AbortController();c.abort();const i=input('你好');await assert.rejects(prepareTurn(i,c.signal,{run:async()=>{calls++;return ''},search:async()=>{calls++;throw Error('must not')},stage:()=>{},report:()=>{}}));assert.equal(calls,0);
});

test('reply evidence can be restricted to exact selected IDs without searching the ambient catalogue',()=>{
 const ctx=context();assert.deepEqual(catalogueRows('所有数据',ctx,{message:''},[],[],undefined,undefined,'所有数据',[],new Set()),[]);
 const rows=catalogueRows('解释这份资料',ctx,{message:''},[],[],undefined,undefined,'解释这份资料',[],new Set(['wind-0']));assert.deepEqual(rows.map(r=>r.id),['wind-0']);
 assert.deepEqual(catalogueRows('解释这份资料',ctx,{message:''},[],[],undefined,'paper','解释这份资料',[],new Set(['wind-0'])),[]);
});

test('the actual reply builder uses provided context and never labels an unrequested search as failed or empty',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'oneearth-direct-reply-')),oldPath=process.env.PATH;
 try{
  const body='#!'+process.execPath+`\nlet input='';process.stdin.on('data',b=>input+=b);process.stdin.on('end',()=>{const p=JSON.parse(input.slice(input.lastIndexOf('\\n{"question":')+1));if(!p.turnAction||p.turnAction.action!=='respond'||p.catalogue.length||p.mandatorySearches!==undefined)process.exit(2);process.stdout.write(JSON.stringify({message:'这段文字是在说明参考基准。',sections:[],limitation:'仅解释所给内容。',followUp:'',researchNotes:[],calculationRequests:[]}))});\n`;
  await writeFile(path.join(dir,'codex'),body,{mode:0o755});process.env.PATH=dir+path.delimiter+oldPath;
  const i=input('解释我引用这段的含义');i.context.citation={title:'片段',scope:'第2页',body:'相对稳定点的位移。'};
  const plan=parseTurnPlan(JSON.stringify(route(i,'respond',['citation'])),i);const stages:string[]=[];
  const r=await modelReply(i.question,i.context,{message:'无新检索'},[],researchExecutor({executor:'codex',model:''},undefined,new AbortController().signal),new AbortController().signal,s=>stages.push(s),[],'',undefined,undefined,undefined,{plan,searches:[]});
  assert.equal(r.answerNotes?.reviewed,0);assert.deepEqual(r.answerNotes?.searches,[]);assert.ok(stages.every(s=>!s.includes('0 项目录候选')));assert.equal(r.researchIntent?.task,i.question);
 }finally{if(oldPath===undefined)delete process.env.PATH;else process.env.PATH=oldPath;await rm(dir,{recursive:true,force:true})}
});

test('explicit discovery cannot be downgraded, and explicit provided-only work cannot be expanded',()=>{
 const find=input('请帮我查找新的地表形变数据资料');assert.throws(()=>parseTurnPlan(JSON.stringify(route(find,'respond')),find),/必要检索/);
 const only=input('只解释引用这段，不需要查找数据或新资料');only.context.citation={title:'引文',scope:'片段',body:'原始摘录'};
 assert.equal(parseTurnPlan(JSON.stringify(route(only,'respond',['citation'])),only).action,'respond');assert.throws(()=>parseTurnPlan(JSON.stringify(route(only,'search')),only),/限定只处理/);
 const extract=input('找出这段引用中描述的观测变量，不需要查找新资料');extract.context.citation=only.context.citation;
 assert.equal(parseTurnPlan(JSON.stringify(route(extract,'respond',['citation'])),extract).action,'respond');
 const read=input('只解释这篇指定论文，不需要查找新资料：https://example.org/paper.pdf');
 assert.equal(parseTurnPlan(JSON.stringify(route(read,'read',['web:https://example.org/paper.pdf'])),read).action,'read');
});

test('selecting a previously introduced source does not relabel its discovery as the user',async()=>{
 const i=input('重读我引用的这个来源');i.context.attachedScope=[{kind:'reference',number:1,messageId:'previous',reference:{kind:'web',title:'先前来源',url:'https://example.org/study'}}];
 i.history=[{role:'assistant',text:'先前引用过该来源',conversationReferences:[{kind:'web',title:'先前来源',url:'https://example.org/study'}],conversationEvidence:[{url:'https://example.org/study',title:'先前来源',excerpt:'当时读取的片段',readAt:'2026-11-16T00:00:00Z',stage:'page-excerpt',discoveredBy:'assistant',readBy:'platform'}]}];
 const plan=parseTurnPlan(JSON.stringify(route(i,'read',['web:https://example.org/study'])),i);
 const runs=await readPlannedSources(plan,i.question,new AbortController().signal,{stage:()=>{},report:()=>{},read:async t=>({engine:'原站读取',hits:[{title:t.title,url:t.url!,snippet:'',pageExcerpt:'本次实际读取的片段'}],requestUrl:t.url!,warning:''})});
 assert.equal(runs[0].hits[0].discoveredBy,'assistant');assert.equal(runs[0].status,'done');
});

test('an explicit map move is a workspace action even when the model explains it',async()=>{
 const fly=input('飞到杭州市');assert.equal(parseTurnPlan(JSON.stringify(route(fly,'workspace')),fly).action,'workspace');
 const routed=await prepared(input('定位到杭州市'),route(input('定位到杭州市'),'respond'));
 assert.equal(routed.plan.action,'workspace');assert.equal(routed.searches,0);
});

test('a greeting plan with null summary fields is repaired instead of failing the turn',()=>{
 const i=input('你好');
 const plan=parseTurnPlan(JSON.stringify({action:'respond',goal:'回应问候',evidenceNeed:'none',reason:'只是一句问候',clarification:null,
   researchIntent:{purpose:null,task:null,region:null,time:null,months:[]},conversationContext:''}),i);
 assert.equal(plan.action,'respond');
 assert.equal(plan.researchIntent.purpose,'回应问候');
 assert.equal(plan.researchIntent.task,'回应问候');
 assert.deepEqual(plan.targets,[]);
 assert.ok(plan.conversationContext.length>0);
 const read=input('读取这个来源');
 assert.throws(()=>parseTurnPlan(JSON.stringify({action:'read',goal:'读取来源',evidenceNeed:'read',reason:'需要原文',clarification:null,
   researchIntent:{purpose:'读取来源',task:'读取来源',region:null,time:null,months:[]},conversationContext:'读取来源'}),read),/确切对象/);
});

test('the planning prompt ends with the turn-plan contract so weaker models cannot mistake search parameters for the plan itself',()=>{
 assert.ok(turnPlanningInstructions.endsWith(turnPlanOutputContract));
 assert.ok(/evidenceGap/.test(turnPlanOutputContract));
 assert.doesNotMatch(turnPlanningInstructions,/hainaQueries|searchPlan/);
 assert.throws(()=>parseTurnPlan(JSON.stringify({questionMode:'preserve',dataQuestion:'定位到杭州市',dataNeed:null,hainaQueries:['杭州市']}),input('定位到杭州市')),/检索计划/);
});

test('a named-channel catalogue question cannot be replaced by reading a prior citation',()=>{
 const i=input('海纳内部有哪些这类数据？'),url='https://example.org/old-reference';
 i.history=[{role:'assistant',text:'以前取得的资料',conversationReferences:[{kind:'web',title:'原引用',url}]}];
 assert.throws(()=>parseTurnPlan(JSON.stringify(route(i,'read',['web:'+url])),i),/必要检索/);
 assert.equal(parseTurnPlan(JSON.stringify(route(i,'search',['web:'+url])),i).action,'search');
 const explain=input('解释这段海纳目录资料里的单位，不需再检索');
 assert.equal(parseTurnPlan(JSON.stringify(route(explain,'respond')),explain).action,'respond');
});
