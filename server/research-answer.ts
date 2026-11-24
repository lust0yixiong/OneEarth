import {pickedSamples} from "./question-grid";
import {sourceExcerpts,scopeSourceTabs} from "./evidence-excerpts";
import {rankEvidence} from "./evidence-ranking";
import {mergeWebEvidence} from "./merge-web-evidence";
import type {DataSearchResult} from "./data-search";
import {scopedDiscoverySources} from "./research-evidence";
import type {TurnPlan} from "./turn-planning";
import {rememberReadEvidence,withPreviousReadings} from "../src/domain/read-evidence";
import {conversationReferenceProvenance} from "../src/domain/reference-memory";
import {rememberAssertionEvidence,selectAssertionEvidence,assertionMemoryNotice,type AssertionEvidenceMemory} from "../src/domain/assertion-evidence-memory";
import type {CalculationReport} from "./verified-calculation";
import {reviewAnswerEvidence} from "./review-answer-evidence";
import { paperRecords, type PaperRecord } from "../src/domain/paper-record";
import { combinesSources, expandsSources,onlySource, refersToBatch } from "../src/domain/research-question";
import { synthesizeAnswer, synthesisHistory, synthesisInstructions, synthesisResponseSchema,retainedSourceAnswer,type SynthesisAnswer } from "./scientific-answer";
import type { AnswerReference, SearchRun, WebHit,ToolCall } from "../src/domain/types";
import {webDocumentType,referenceChannel} from "../src/domain/citation-types";
import { assets, assetById, discoverableAsset, type Asset } from "../src/domain/datasets";
import { observationById } from "../src/domain/push-observations";
import type { PushFeed } from "../src/domain/push-observations";
import { caseById, cases, sourceLabels } from "../src/domain/catalog";
import type { DiscoveryContext, DiscoveryResponse } from "../src/domain/types";

import type { researchExecutor } from "./research-executor";
import {SourceReadClaimError,sourceReadReceipts,validateSourceReadClaim} from "./source-read-provenance";
import {materialAccessEvidence,publicMaterialUrl,validateAnswerMaterialClaims} from "./answer-material-guard";
import {webMaterial} from "../src/domain/web-material";
import type { TurnHistoryEntry as Turn } from "./turn-history";
import type { ParentResearchEvidence } from "./parent-research-evidence";
import {withCurrentAssertionReadings,rememberCurrentAssertionReadings,type CurrentAssertionReading} from "./runtime-assertion-evidence";
import {compareSourceReadings,validateSourceChanges,sourceChangeInstructions,sourceChangeSchema,type SourceReadHistory} from "./source-read-comparison";
import {modelTurnContext,type RuntimeTurnContext} from "./runtime-turn-context";
import {modelSafeText} from "./model-context-safety";

// Only bundled public catalogue entries may authorize a structured file URL.
const publishedFileUrls=new Set(cases.flatMap(c=>c.needs.flatMap(n=>
  (n.dataEntities ?? []).flatMap(entity=>publicMaterialUrl(entity.url) ?? []))));

const segmenter = new Intl.Segmenter("zh", {granularity:"word"});
const genericTerms = new Set("想用 数据 数据集 资料 相关 哪些 研究 需要 分析 什么 如何 可以 推荐 方法 是否 估算 分别 哪里 获取 适合 来源 比较 分辨 影响 限制 论文 目录 使用 查看 找到 对比 解释 支持 使用 结合 材料 问题 科学 海纳 地学 目前 可能 提供 进行 这些".split(" "));

function searchTerms(query:string) {
  // Keep identifiers such as ERA5-Land intact and avoid spurious bigrams across Chinese words.
  const normalized=query.toLowerCase().normalize("NFKC");
  const terms=[...(normalized.match(/[a-z][a-z0-9.-]*/g) || [])];
  for(const part of segmenter.segment(normalized)){
    if(part.isWordLike && part.segment.length>1 && !genericTerms.has(part.segment))terms.push(part.segment);
  }
  return [...new Set(terms.filter(t=>t.length>1))];
}
function paperEvidence(record:PaperRecord,query:string,focusQuery=query) {
  const n = record.need;
  const usage = n.tabs.find(t=>t.label==="论文用法（本页）");
  const combinations=n.tabs.find(t=>t.label==="论文研究问题与数据组合");
  return {
    id:record.id, title:n.product, source:n.source, sourceChannel:"assertion" as const, sourceKinds:["论文数据集线索"], url:n.url, summary:n.detail?.slice(0,800),
    coverage:n.profile?.coverage, limitation:n.profile?.limitation, study:record.studyContext?.slice(0,1200), paper:record.paperTitle,
    dsKey:record.dsKey,
    metadata:n.tabs.find(t=>t.label==="官方元数据")?.rows?.filter(row=>["title","version","temporal","spatial","description","formats"].includes(String(row[0])))
      .slice(0,16).map(row=>row.map(v=>String(v ?? "").slice(0,900))),
    researchPaths:record.researchPaths?.slice(0,1).map(path=>({...path,
      members:path.members.slice(0,12),
      steps:path.steps.slice(0,6).map(step=>({...step,purpose:step.purpose.slice(0,240),method:step.method.slice(0,600)})),
      complete:path.complete && path.members.length<=12 && path.steps.length<=6 &&
        path.steps.every(step=>step.purpose.length<=240 && step.method.length<=600),
      omittedMembers:Math.max(0,path.members.length-12),omittedSteps:Math.max(0,path.steps.length-6),
    })),
    evidenceLinks:record.evidenceLinks?.slice(0,2),
    researchQuestions:record.researchQuestions?.slice(0,5).map(q=>({...q,question:q.question.slice(0,1200)})),
    researchCombinations:combinations && {columns:combinations.columns,
      rows:combinations.rows?.slice(0,2).map(row=>row.map(v=>String(v ?? "").slice(0,600)))},
    usage:usage && {columns:usage.columns,rows:usage.rows?.slice(0,2).map(row=>row.map(v=>String(v ?? "").slice(0,300)))},
    ...sourceExcerpts(scopeSourceTabs(n.tabs,[...(record.researchQuestions||[]),...(record.researchPaths||[])],{dsKey:record.dsKey}),query,2600,focusQuery,{dsKey:record.dsKey}),
  };
}
function assetEvidence(a:Asset,query:string,ctx:DiscoveryContext,focusQuery=query) {
  const paper = paperRecords.get(a.id);
  const observation = observationById(a.id);
  const samples = a.tabs.filter(t=>t.kind==="table" && t.rows?.length).map(tab=>({
    label:tab.label,columns:tab.columns,
    rows:tab.rows!.slice(0,2).map(row=>row.map(v=>String(v ?? "").slice(0,180))),
  }));
  return {
    id:a.id, title:a.title, source:a.source, sourceChannel:referenceChannel({kind:"asset",id:a.id,title:a.title,source:a.source},a,observation),origins:a.origins.map(o=>sourceLabels[o]), url:a.url,
    sourceKinds:a.origins.map(o=>o==="paper"?"论文数据集线索":o==="haina"?"海纳数据":o==="constellation"?"星座及时数据":sourceLabels[o]),
    summary:a.description.slice(0,800), kind:a.kind,status:a.status,role:a.profile?.role,
    coverage:a.profile?.coverage, years:a.profile?.years,
    version:a.version, access:a.profile?.access, limitation:a.profile?.limitation,
    samples, rowsMatchingAttachedGrid:pickedSamples(a.tabs,ctx), paperUsage:paper ? paperEvidence(paper,query,focusQuery) : undefined,
    observation:observation && {satellite:observation.satellite,observedAt:observation.observedAt,
      receivedAt:observation.receivedAt,publishedAt:observation.publishedAt,geometryType:observation.geometry.type,
      measurements:observation.measurements,file:observation.file,productUrl:observation.productUrl,test:observation.test},
    ...sourceExcerpts(paper?scopeSourceTabs(a.tabs,[...(paper.researchQuestions||[]),...(paper.researchPaths||[])],{dsKey:paper.dsKey}):a.tabs,query,2600,focusQuery,{dsKey:paper?.dsKey||a.canonicalId||a.datasetId}),
  };
}
export type CatalogueEvidence=ReturnType<typeof sourceExcerpts>&{id:string;title:string;source:string;url?:string;[key:string]:any};
/** Reattach literal cited windows explicitly; never relabel them as a new lookup. */
export function withAssertionMemory(rows:CatalogueEvidence[],memory:AssertionEvidenceMemory[],query:string,source?:string,authorizedParent=false):CatalogueEvidence[] {
  if(source && source!=="paper")return rows;
  if(/(?:换个?话题|换个?问题|另一个课题|新问题|先不谈|不再研究)/.test(query))return rows;
  const continuing=refersToBatch(query)||/它们?|刚才|上述|前面|此前|这[份段批些]|那[份段些]|上[一轮]|你提到/.test(query)||query.length<100&&/研究区|时段|时间|年份|主要看/.test(query);
  const named=(query.match(/[A-Za-z][A-Za-z-]{3,}/g)||[]).filter(t=>!['what','when','where','from','with','this','that','have','does'].includes(t.toLowerCase()));
  const selected=selectAssertionEvidence(memory,{query}).filter(e=>authorizedParent||continuing||named.some(t=>(e.label+' '+e.quote).toLowerCase().includes(t.toLowerCase())));
  const result=rows.map(r=>({...r}));
  for(const e of selected){
    let row=result.find(r=>r.id===e.assetId);
    if(!row){
      const asset=assetById.get(e.assetId);
      row={id:e.assetId,title:asset?.title||e.label,source:"论文研究数据 · 历史摘录",excerpts:[],sourceTextChars:0,includedChars:0,omittedBlocks:0,omittedPages:[],notice:assertionMemoryNotice};
      result.push(row);
    }
    row.historicalExcerpts=[...(row.historicalExcerpts||[]),e];
    row.historicalEvidenceNotice=assertionMemoryNotice;
  }
  return result;
}
function evidence(query:string, ctx:DiscoveryContext, base:DiscoveryResponse, history:Turn[]) {
  const terms=searchTerms(query);
  const followUp=/这|该|那段|那份|上述|其中|刚才|继续|它们?|两份|两套|共同|重叠|上轮|上一轮/.test(query);
  const previous=followUp ? searchTerms(history.filter(t=>t.role==="user").at(-1)?.text || "") : [];
  const priorIds=followUp ? history.filter(t=>t.role==="assistant").flatMap(t=>t.assetIds || []) : [];
  const favored=new Set([...(ctx.attachedScope || []).filter(i=>i.kind==="dataset").map(i=>i.id),...priorIds,...(base.research?.rows.flatMap(row=>row.ids) || []), ...(base.catalogMatch?.ids || []), ...(base.gap?.dataSupport.candidates.map(c=>c.assetId) || [])]);
  const scoped = !!(ctx.selection || ctx.filters.period || ctx.filters.place || ctx.filters.utcWindow || ctx.filters.depth || ctx.filters.maxDem !== null);
  const expand = combinesSources(query) && !refersToBatch(query) && !scoped && !ctx.filters.source && !ctx.filters.type && ctx.filters.need===-1 && !ctx.citation;
  const inBatch = !expand && (ctx.inCandidateScope || !!ctx.candidateIds?.length);
  const batch=(ctx.candidateIds || []).flatMap(id=>assetById.get(id)||[]);
  const relatedCases=new Set([ctx.caseId,...batch.map(asset=>asset.caseId)]);
  // Supporting method and derived-value records remain evidence for the selected datasets.
  const pool=inBatch ? [...batch,...assets.filter(asset=>asset.kind==="clue" && relatedCases.has(asset.caseId))] : assets;
  const documents = pool.filter(a=>(discoverableAsset(a) || a.kind==="clue") && (!scoped || inBatch || favored.has(a.id)) &&
    (!ctx.filters.source || a.origins.includes(ctx.filters.source)) && (!ctx.filters.type || a.categories.includes(ctx.filters.type)))
    .map(a=>({a,title:a.title.toLowerCase(),body:a.description.toLowerCase()}));
  const weightedTerms = terms.map(term=>{
    const frequency = documents.reduce((n,d)=>n+Number(d.title.includes(term) || d.body.includes(term)),0);
    return {term,weight:Math.log1p(documents.length/(1+frequency))};
  });
  return documents.map(({a,title,body})=>{
    const topical=weightedTerms.reduce((score,{term,weight})=>score+weight*(title.includes(term)?3:body.includes(term)?1:0),0);
    const prior=previous.reduce((score,t)=>score+Number(title.includes(t)),0);
    return {a,score:topical+prior,matched:favored.has(a.id)};
  }).filter(r=>r.matched || r.score>0 || inBatch)
    .sort((a,b)=>Number(b.matched)-Number(a.matched) || b.score-a.score).map(r=>r.a);
}

// Budget prompt text, not the number of datasets. Interleave live assertions with ranked catalogue matches.
export function catalogueRows(query:string,ctx:DiscoveryContext,base:DiscoveryResponse,history:Turn[],papers:PaperRecord[],requiredHaina?:Asset[],restriction?:""|"paper"|"haina"|"constellation",focusQuery=query,searchPhrases:string[]=[],onlyIds?:ReadonlySet<string>) {
  const source = restriction ?? (onlySource(query) || (requiredHaina ? "" : ctx.filters.source));
  if (source !== ctx.filters.source) ctx = {...ctx,filters:{...ctx.filters,source}};
  const catalog = onlyIds ? [...onlyIds].flatMap(id=>assetById.get(id)||[]).filter(a=>!source||a.origins.includes(source)) : base.paperOnly ? [] : evidence(query,ctx,base,history);
  const live = !source || source === "paper" ? [...new Map(papers.map(r=>[r.id,r])).values()] : [];
  const promptBudget = 48000;
  const haina=source && source!=="haina" ? [] : requiredHaina || [];
  type Candidate={id:string;title:string;body:string;make:()=>ReturnType<typeof assetEvidence>|ReturnType<typeof paperEvidence>};
  const candidates=new Map<string,Candidate>();
  const excerptQuery=[query,...searchPhrases].join("\n");
  for(const a of [...catalog,...haina])candidates.set(a.id,{id:a.id,title:a.title,body:[a.description,a.profile?.coverage,
    ...(a.origins.includes("paper")?a.tabs.filter(t=>t.kind==="text").map(t=>t.quote):[])].join(" "),make:()=>assetEvidence(a,excerptQuery,ctx,focusQuery)});
  for(const p of live)candidates.set(p.id,{id:p.id,title:p.need.product,body:[p.paperTitle,p.studyContext,p.need.detail,
    ...(p.researchQuestions||[]).map(q=>q.question),...(p.researchPaths||[]).map(q=>q.question),
    ...p.need.tabs.map(t=>t.kind==="text"?t.quote:JSON.stringify(t.rows))].join(" "),make:()=>paperEvidence(p,excerptQuery,focusQuery)});
  const continuing=refersToBatch(query)||/它们?|刚才|上述|前面|这批|那段|那份|两份|两套|上一轮/.test(query);
  const pinned=new Set([...(ctx.attachedScope?.flatMap(s=>s.kind==="dataset"?[s.id]:[])||[]),
    ...(continuing?history.filter(t=>t.role==="assistant").at(-1)?.assetIds||[]:[]),
    ...(continuing?ctx.candidateIds||[]:[])]);
  const ranked=rankEvidence([...candidates.values()],[query,...searchPhrases],r=>r.title,r=>r.body,r=>pinned.has(r.id)).slice(0,32);
  // Reserve a small identity row for every selected candidate BEFORE expanding
  // excerpts. A long unrelated first result cannot consume the whole context.
  const full=ranked.map(r=>r.item.make());
  const thin=(row:typeof full[number])=>({id:row.id,title:row.title,source:row.source,sourceChannel:row.sourceChannel,url:row.url,
    summary:row.summary?.slice(0,240),coverage:row.coverage?.slice(0,240),
    ...("paper" in row?{paper:row.paper,dsKey:row.dsKey}:{}),
    excerpts:[],sourceTextChars:row.sourceTextChars,includedChars:0,omittedBlocks:row.omittedBlocks,
    omittedPages:row.omittedPages,notice:"仅提供候选身份；该来源的原文尚未装入本轮答复，不代表不存在。",
    evidenceSelection:{detail:"identity-only",notice:"尚有未装入本次答复材料的证据，不能据此断言来源没有相关内容。"}});
  const rows:CatalogueEvidence[]=full.map(thin);
  let size=JSON.stringify(rows).length;
  const detailed=Math.min(8,rows.length);
  for(let i=0;i<detailed;i++){
    const allowance=Math.min(8500,Math.floor((promptBudget-size)/(detailed-i))+JSON.stringify(rows[i]).length);
    const row=compactEvidenceRow(full[i],allowance,[focusQuery,excerptQuery]);
    const delta=JSON.stringify(row).length-JSON.stringify(rows[i]).length;
    if(size+delta<=promptBudget){rows[i]={...row,evidenceSelection:{detail:"bounded-excerpts",matchedTerms:ranked[i].rank.matchedTerms,
      notice:"相关性排序不是事实核验；仅按实际节选与其身份判断。"}};size=JSON.stringify(rows).length;}
  }
  while(JSON.stringify(rows).length>promptBudget)rows.pop();
  return rows;
}
function compactEvidenceRow(value:CatalogueEvidence,budget:number,queries:string[]=[]):CatalogueEvidence {
  let row=structuredClone(value);
  if(JSON.stringify(row).length<=budget)return row;
  const omitted:string[]=[];
  // Keep exact selected quotations and their source identities intact. Trim
  // repeated relationship summaries first, without pretending they are complete.
  if(row.paperUsage){row.paperUsage={id:row.paperUsage.id,paper:row.paperUsage.paper,dsKey:row.paperUsage.dsKey,...Object.fromEntries(Object.entries(row.paperUsage).filter(([k])=>["excerpts","includedChars","sourceTextChars"].includes(k)))};omitted.push("paperUsage details");}
  if(row.evidenceLinks){row.evidenceLinks=row.evidenceLinks.slice(0,1).map((l:any)=>({...l,claims:l.claims.slice(0,5),blocks:l.blocks.slice(0,6),hasMore:true}));omitted.push("evidenceLinks");}
  if(row.researchPaths){row.researchPaths=row.researchPaths.slice(0,1).map((p:any)=>({...p,members:p.members.slice(0,4),steps:p.steps.slice(0,3).map((s:any)=>({...s,method:s.method.slice(0,180),purpose:s.purpose.slice(0,100)})),complete:false}));omitted.push("researchPaths");}
  if(row.metadata){row.metadata=row.metadata.slice(0,7).map((r:any[])=>r.map(v=>String(v??"").slice(0,220)));omitted.push("metadata");}
  if(row.usage){row.usage={...row.usage,rows:row.usage.rows?.slice(0,1).map((r:any[])=>r.map(v=>String(v??"").slice(0,180)))};omitted.push("usage");}
  if(row.researchQuestions){row.researchQuestions=row.researchQuestions.slice(0,2).map((q:any)=>({...q,question:q.question.slice(0,300)}));omitted.push("researchQuestions");}
  row.materialCoverage={partial:true,omittedDetails:omitted};
  if(JSON.stringify(row).length<=budget)return row;
  // The compact fallback still contains the genuine selected source excerpts.
  const keep=["id","title","source","sourceChannel","sourceKinds","url","dsKey","paper","coverage","excerpts","sourceTextChars","includedChars","omittedBlocks","omittedPages","notice","materialCoverage"];
  row=Object.fromEntries(Object.entries(row).filter(([key])=>keep.includes(key))) as CatalogueEvidence;
  if(JSON.stringify(row).length>budget){
    const original=row.excerpts,selected:typeof original=[];
    row.excerpts=selected;row.includedChars=0;
    row.materialCoverage={...row.materialCoverage,partial:true,excerptWindowsOmitted:original.length};
    // Reserve space for each ranked source. A large early row must not silently
    // consume the allowance of later sources and leave them as identity only.
    if(JSON.stringify(row).length>budget && row.url)delete row.url;
    for(const entry of rankEvidence(original,queries,e=>e.label,e=>e.quote)){
      const e=entry.item,available=Math.min(e.quote.length,budget-JSON.stringify(row).length-JSON.stringify({...e,quote:""}).length-180);
      if(available<80)continue;
      const quote=e.quote.slice(0,available),end=e.start+quote.length;
      const candidate={...e,quote,end,partial:e.partial||quote.length<e.quote.length,source:{...e.source,end}};
      selected.push(candidate);row.includedChars+=quote.length;
      row.materialCoverage.excerptWindowsOmitted=original.length-selected.length;
      if(JSON.stringify(row).length>budget){selected.pop();row.includedChars-=quote.length;row.materialCoverage.excerptWindowsOmitted=original.length-selected.length;}
    }
    row.materialCoverage.excerptWindowsTruncated=selected.some(e=>original.some(o=>o.start===e.start&&o.source.page===e.source.page&&o.quote.length>e.quote.length));
    const key=(e:typeof original[number])=>JSON.stringify([e.source.paperId,e.source.page,e.block||e.label]);
    const kept=new Set(selected.map(key));
    row.omittedBlocks+=new Set(original.filter(e=>!kept.has(key(e))).map(key)).size;
    const pages=new Set(selected.map(e=>e.source.page));
    const omittedPages=original.filter(e=>!pages.has(e.source.page)).map(e=>({label:e.label,page:e.source.page}));
    row.omittedPages=[...new Map([...row.omittedPages,...omittedPages].map(p=>[p.page,p])).values()];
  }
  return row;
}
export function shouldReviewAnswerEvidence(answer:{message:string;limitation?:string;references:unknown[]},query:string,calculations:CalculationReport[]) {
  if(!answer.references.length)return false;
  const text=[answer.message,answer.limitation].filter(Boolean).join("\n");
  const verifiedExample=calculations.length>0&&calculations.every(c=>c.status==="completed"&&c.scope==="example");
  const explicitMathExample=/(?:数学|合成)(?:示例|例子)|给定(?:换算因子|数值)|我提供的示例/.test(query);
  const sourceClaim=/作者|论文|文中|原文|研究(?:指出|发现|报告|表明)|案例(?:报告|显示)|清单|版本/.test(text);
  if(verifiedExample&&explicitMathExample&&text.length<500&&!sourceClaim)return false;
  return answer.message.length>=300 || /论文|清单|版本|\d/.test(answer.message);
}
export async function modelReply(query:string,context:DiscoveryContext,base:DiscoveryResponse,history:Turn[],executor:ReturnType<typeof researchExecutor>,signal:AbortSignal,onStage?:(stage:string,searches?:SearchRun[])=>void,papers:PaperRecord[]=[],paperTrace="",constellationFeed?:PushFeed,retrieval?:DataSearchResult,onTool?:(call:ToolCall)=>void,turn?:{plan:TurnPlan;searches:SearchRun[];priorEvidence?:ParentResearchEvidence},assertionReadings:CurrentAssertionReading[]=[],sourceHistory:SourceReadHistory={},turnContext?:RuntimeTurnContext) {
    if(retrieval?.questionCheck || retrieval?.clarification || retrieval?.plan.questionMode==="reframe")
      throw Error("转换后的问题尚未得到用户确认，不能生成答复。");
    const start=Date.now();
    const policy=retrieval?.plan.sourcePolicy;
    const restricted=scopedDiscoverySources(retrieval);
    const selectedOnly=turn?new Set(turn.plan.targets.flatMap(t=>t.id?[t.id]:[])):
      restricted?new Set(restricted.includes("constellation")?base.catalogMatch?.ids:[]):undefined;
    const selectedUrls=turn?new Set(turn.plan.targets.flatMap(t=>t.url?[t.url]:[])):undefined;
    if(turn&&!base.gridCoverage){context={...context,filters:{...context.filters,source:onlySource(query)||""}};}
    const expanded=!policy&&!turn&&expandsSources(query);
    const single=restricted?.length===1?restricted[0]:undefined;
    const source = policy ? (single==="web"?undefined:single) :
      expanded?undefined:onlySource(query) || onlySource(retrieval?.plan.conversationContext || "");
    if(expanded){
      context={...context,filters:{...context.filters,source:""}};
      base={...base,filters:{...(base.filters || context.filters),source:""}};
    }
    if (source) {
      context = {...context,filters:{...context.filters,source}};
      if(!turn)base={...base,filters:{...(base.filters || context.filters),source}};
    }
    if (restricted?!restricted.includes("constellation"):context.filters.source && context.filters.source !== "constellation") constellationFeed = undefined;
    const target=[retrieval?.plan.questionMode==="confirmed"?retrieval.plan.dataQuestion:query,
      retrieval?.plan.conversationContext].filter(Boolean).join("\n");
    const searchPhrases=[...(retrieval?.plan.paper.facets.flatMap(f=>f.queries)||[]),...(retrieval?.plan.web.map(q=>q.web)||[]),...(retrieval?.plan.hainaQueries||[])];
    const previousAssertions=history.filter(t=>t.role==="assistant" && t.conversationAssertionEvidence!==undefined).at(-1)?.conversationAssertionEvidence || [];
    const priorAssertions=turn?.priorEvidence?.assertions??(selectedOnly?previousAssertions.filter(r=>selectedOnly.has(r.assetId)):previousAssertions);
    const rows=withCurrentAssertionReadings(withAssertionMemory(catalogueRows(target,context,base,history,
      restricted&&!restricted.includes("paper")?[]:papers,restricted&&!restricted.includes("haina")?[]:retrieval?.haina,
      policy?source||"":source,retrieval?.plan.questionMode==="confirmed"?retrieval.plan.dataQuestion:query,searchPhrases,selectedOnly),
      priorAssertions,query,source||context.filters.source,!!turn?.priorEvidence),assertionReadings,query);
    const previousReadings=history.filter(t=>t.role==="assistant" && t.conversationEvidence!==undefined).at(-1)?.conversationEvidence || [];
    const priorReadings=turn?.priorEvidence?.readings??(selectedUrls?previousReadings.filter(r=>selectedUrls.has(r.url)):previousReadings);
    const modelHistory=synthesisHistory((restricted?history.filter(item=>item.role==="user"):history)
      .map(({conversationEvidence:_,conversationAssertionEvidence:__,...turn})=>turn));
    const searches:SearchRun[]=retrieval?.searches || turn?.searches || [];
    const readReceipts=sourceReadReceipts(searches);
    const webIssue=retrieval?.issues.join("\n") || turn?.searches.filter(r=>r.status==="failed").map(r=>"指定来源未能读取："+(r.error||"尚未取得正文")).join("；") || "";
    const selectedWeb:WebHit[]=turn?turn.plan.targets.flatMap(t=>t.url&&t.kind!=="asset"?[{title:t.title,url:t.url,discoveredBy:t.discoveredBy,snippet:t.kind==="excerpt"?"用户本轮提供的摘录见 workspace.citation；本轮未独立回读完整来源。":"本轮指定的来源身份；身份本身不代表已读正文。"}]:[]):context.attachedScope?.flatMap(i=>i.kind==="reference" && i.reference.kind==="web"?
      [{title:i.reference.title,url:i.reference.url,snippet:"用户主动引用的来源，引用本身不代表已读正文。",referenceType:i.reference.referenceType,discoveredBy:"user" as const}]:[]) || [];
    const userSources=new Set(turn?turn.plan.targets.filter(t=>t.discoveredBy==="user").flatMap(t=>t.url?[t.url]:[]):selectedWeb.map(h=>h.url));
    const fresh=[...new Map([...selectedWeb,...mergeWebEvidence(searches)].map(hit=>[hit.url,hit])).values()]
      .map(h=>userSources.has(h.url)?{...h,discoveredBy:"user" as const}:h);
    const memoryOptions={query:target,focusUrls:[...userSources,...(/刚才|此前|这份|前面|继续|你提到|这个|该/.test(query)?history.filter(t=>t.role==="assistant").at(-1)?.conversationReferences?.flatMap(r=>r.kind==="web"?[r.url]:[])||[]:[])]};
    const webHits=restricted?(restricted.includes("web")?mergeWebEvidence(searches):[]):
      source?[]:withPreviousReadings(fresh,priorReadings,memoryOptions);
    const sourceReadComparisons=compareSourceReadings(webHits,sourceHistory,priorReadings,rows.length);
    const answerSchema=sourceReadComparisons.length?{...synthesisResponseSchema,required:[...synthesisResponseSchema.required,"sourceChanges"],
      properties:{...synthesisResponseSchema.properties,sourceChanges:sourceChangeSchema}}:synthesisResponseSchema;
    const catalogueFileUrls=rows.filter(row=>row.evidenceSelection?.detail==="bounded-excerpts").flatMap(row=>
      (assetById.get(row.id)?.dataEntities ?? []).map(entity=>publicMaterialUrl(entity.url))
        .filter((url):url is string=>!!url && publishedFileUrls.has(url)));
    const accessLinks=materialAccessEvidence(webHits,catalogueFileUrls);
    onStage?.(turn?"正在按本轮目标与已有引用整理答复":"已取得 "+rows.length+" 项目录候选"+(webHits.length?"、"+webHits.length+" 条网络结果":"")+" · 正在整理答复",searches);
    const references:AnswerReference[]=[
      ...rows.map(r=>{const ref={kind:"asset" as const,id:r.id,title:r.title,source:r.source};return {...ref,sourceChannel:r.sourceChannel||referenceChannel(ref,assetById.get(r.id),observationById(r.id))};}),
      ...webHits.map(h=>({kind:"web" as const,title:h.title,url:h.url,referenceType:webDocumentType(h),sourceChannel:"web" as const})),
    ];
    const exactReadRefs=turn?.plan.action==="read"?references.flatMap((ref,index)=>
      ref.kind==="web"&&selectedUrls?.has(ref.url)&&searches.some(run=>run.status==="done"&&run.hits.some(hit=>hit.url===ref.url&&hit.pageExcerpt))
        ? [{url:ref.url,token:"[S"+(index+1)+"]"}]:[]):[];
    const parentCitations=references.flatMap((ref,index)=>{
      const recorded=turn?.priorEvidence?.references.find(parent=>ref.kind==="asset"
        ?parent.kind==="asset"&&parent.id===ref.id:parent.kind==="web"&&parent.url===ref.url);
      return recorded?[{reference:recorded,token:"[S"+(index+1)+"]"}]:[];
    });
    const citedParent=(answer:SynthesisAnswer)=>answer.references.some(ref=>parentCitations.some(({reference})=>ref.kind==="asset"
      ?reference.kind==="asset"&&reference.id===ref.id:reference.kind==="web"&&reference.url===ref.url));
    function verifyExecutionAndReferences(answer:SynthesisAnswer){
      validateSourceReadClaim(answer,readReceipts,!!retrieval);
      validateSourceChanges(answer,sourceReadComparisons);
      validateAnswerMaterialClaims(answer,accessLinks);
      if(exactReadRefs.length&&!answer.references.some(ref=>ref.kind==="web"&&exactReadRefs.some(source=>source.url===ref.url)))
        throw new SourceReadClaimError("定向读取已经返回材料，为核查结论或证据限制加上实际所读原站引用 "+
          exactReadRefs.map(ref=>ref.token).join("、")+"。");
      if(parentCitations.length&&!citedParent(answer))
        throw new SourceReadClaimError("本轮根据已保存材料作答，请对实际采用的证据添加相应引用 "+
          parentCitations.map(ref=>ref.token).join("、")+"。同名材料可能是不同对象，不能把文献记录当作文件或目录原页。");
    }
    const prompt=modelSafeText(synthesisInstructions+(turnContext?"\nturnContext是按原轮次归属的服务器上下文。history.assistantText只是历史答复，不能当执行回执；旧批次只据其原query/conditions引用，不冒称本轮查获。当前工具/新材料仍以本轮executionScope和readAt为准。网页proposed不等于applied；unknown须如实说明，浏览器可见数量不是新检索事实。\n":"")+(context.workspaceView?"\nworkspace.workspaceView 是发问当刻的工作台可见状态。可据此回答当前图层、选择、期次和显示信息；与用户研究附件分开，不把显示标签或图例冒充来源原文、科学观测或QC结论，不声称执行了未记录的切换或外查。\n":"")+(sourceReadComparisons.length?"\n"+sourceChangeInstructions:"")+"\n"+JSON.stringify({question:query,questionMode:retrieval?.plan.questionMode,turnContext:modelTurnContext(turnContext),
      turnAction:turn&&{action:turn.plan.action,goal:turn.plan.goal,evidenceNeed:turn.plan.evidenceNeed,targets:turn.plan.targets.map(({excerpt,...t})=>t),
        rule:"本轮没有执行数据发现检索。只围绕指定对象、已提供摘录和相关历史证据回答；通用原理可解释，但不能伪称本轮查获。未读来源不能说已读，缺少具体事实时明确边界，不补造数据集、论文事实或观测数。不要把本轮问题重新改成找数据。"},
      sourceConstraint:restricted||source?{sources:restricted||[source],rule:"用户明确限定本轮的来源范围。正文、引用和结论只能依据本轮提供的各指定渠道记录。没有匹配材料时说明缺项；如需要扩大来源，询问用户是否同意。"}:undefined,
      researchIntent:retrieval?.plan.researchIntent||turn?.plan.researchIntent,conversationContext:retrieval?.plan.conversationContext||turn?.plan.conversationContext,
      dataQuestion:retrieval?.plan.dataQuestion,dataNeed:retrieval?.plan.dataNeed,mandatorySearches:retrieval?.sourceStatus,history:modelHistory,
      referenceProvenance:restricted?[]:conversationReferenceProvenance(history),
      sourceReadComparisons,
      executionScope:{externalCommunicationAvailable:false,permissionsRequestedByPlatform:false,currentSourceReads:readReceipts,currentAssertionReads:rows.flatMap(row=>row.currentAssertionReadings||[]),discoveryDelegated:!!retrieval,requiredExactSourceReferences:exactReadRefs,
        authorizedParentEvidence:parentCitations.length?{citations:parentCitations,rule:"这些编号来自可追溯的父研究记录。回答所用的事实应逐项引用实际支持它的历史摘录，区分文献资产、目录和实际文件。即便名相同，也必须按具体来源和取得层级判断。不得声称本轮执行了读取，也不得从正文补猜链接。"}:undefined,
        sourceReadRule:"currentAssertionReads是本轮新取得的断言节选，独立保留readAt与论文/数据集/block身份；不表示打开网页、PDF或完整论文，引用只能据实际提供的窗口。本轮网页动作以 currentSourceReads 为准。历史摘录标明是以前取得，不能称本轮已打开；搜索摘要也不是读取。没有读取回执不描述本轮打开网页。失败只能说尝试未取得正文；节选不证明完整原文已读。discoveryDelegated 为 false 时不得声称发过定向检索或补充检索。定向读取有返回时，以 requiredExactSourceReferences 的编号注明来源，即使正文不足也可用它说明核对边界。",
        notice:"本请求的工具链只含目录/网页/文献资料读取及显式记录的本地核算，不含联系人员、发邮件或取得社群许可。用户提供或论文记载的许可不能说成平台取得。"},
      materialSelection:{considered:papers.length+(retrieval?.haina.length||0),included:rows.length,
        notice:"身份行与有界节选分别标记；未装入原文不代表来源不存在，候选有论文记录不等于与本题相关。"},workspace:{
      userAttachments:context.attachedScope,case:caseById(context.caseId)?.title,selection:context.selection,filters:context.filters,center:context.attachedScope?context.selection?.point:context.camera.center,
      citation:context.citation,expectedVersions:context.candidateVersions,dataView:context.dataView,visualization:context.visualization,
      ...(context.workspaceView?{workspaceView:context.workspaceView}:{})
    },catalogue:rows.map((r,i)=>({...r,ref:"S"+(i+1)})),
    webResults:webHits.map((h,i)=>({...h,linkMaterial:webMaterial(h.url),ref:"S"+(rows.length+i+1)})),
    documentedDataAccessLinks:[...accessLinks].filter(([url])=>publicMaterialUrl(url)).map(([url,kinds])=>({url,kinds:[...kinds]})),
    searchStatus:{paper:paperTrace || undefined,paperNotices:retrieval?.paperNotices,
      webChecks:retrieval?.webChecks,webIssue:webIssue || undefined, web:searches.map(r=>({engine:r.engine,query:r.query,status:r.status,hits:r.hits.length,total:r.total,error:r.error,warning:r.warning,cacheStoredAt:r.cacheStoredAt}))},
    constellationStatus:constellationFeed && {configured:constellationFeed.configured,checkedAt:constellationFeed.checkedAt,
      scope:base.pushFeed ? "按 lookup.conditions 查询接收库" : "仅刷新最新接收目录；不能据此判定任意地点和时段的匹配数量",
      matched:base.pushFeed ? base.pushFeed.records.length : undefined},
    constellation:base.pushFeed && {configured:base.pushFeed.configured,count:base.pushFeed.records.length,
      limit:50,latestObservedAt:base.pushFeed.records[0]?.observedAt},
    lookup:{summary:base.message,research:base.research?.rows,conditions:base.catalogMatch?.conditions,
      gridCoverage:base.gridCoverage&&{status:base.gridCoverage.status,
        count:base.gridCoverage.status==="ready"?base.gridCoverage.count:undefined,
        revision:base.gridCoverage.revision,
        rule:"所附范围的覆盖结论以本字段为准。未知须写覆盖未知，不能写零。文献和目录线索可独立说明，不能当作该格的覆盖或现场观测。"},
      lookups:base.catalogMatch?.lookups?.map(l=>({matched:l.matched,point:l.point})),gap:base.gap?.missing}}));
    let repaired=false,repairFailed=false,repairInput="";
    const actualCalculations:CalculationReport[]=[];
    let answer:SynthesisAnswer;
    try{answer=await synthesizeAnswer(prompt,references,webHits,p=>executor.model(p,{outputSchema:answerSchema}),signal,
      diagnostic=>{repaired=true;repairInput=JSON.stringify(diagnostic);onStage?.("正在重新核对回答中的资料引用",searches);onTool?.({id:"synthesis-repair",kind:"tool",name:"回答引用与结构核对",status:"running",input:repairInput});},
      calculation=>{actualCalculations.push(calculation);onStage?.(calculation.status==="completed"?"已完成受控数值核算，正在核对解释":"数值核算条件未通过，保留待核边界",searches);
        onTool?.({id:"calculation-"+crypto.randomUUID(),kind:"tool",name:"受控数值核算",input:calculation.arguments||"未提供有效参数",status:calculation.status==="completed"?"done":"failed",output:JSON.stringify(calculation),...(calculation.error?{error:calculation.error}:{})});},
      {validateAnswer:verifyExecutionAndReferences,enforceCalculations:true,onCalculationPlan:status=>{onStage?.(status==="running"?"正在核对具体演算的计算参数":status==="failed"?"核算参数准备未完成，正在保留已有内容":status==="done"?"已形成核算请求，继续处理答复":"未形成新增演算请求，继续整理答复",searches);onTool?.({id:"calculation-plan",kind:"tool",name:"核对数值演算参数",input:"草稿含具体演算，先形成有界计算请求",status:status==="running"?"running":status==="done"?"done":status==="failed"?"failed":"partial",...(status!=="running"?{output:status==="done"?"已形成计算请求；计算状态见受控数值核算记录。":status==="failed"?"核算参数准备未完成，保留已有内容。":"未形成新增演算请求；继续回答原问题，来源报告的指标仍按原出处保留。"}:{})});},
      onNodeFailure:({node,error,retained})=>{
        if(node==="answer-repair")repairFailed=true;
        const id=node==="answer-repair"?"synthesis-repair":node==="calculation-plan"?"calculation-plan":"answer-generation";
        onStage?.(retained?"后续核对未完成，正在保留已有答复内容":"回答整理未完成，正在保留已取得的资料线索",searches);
        onTool?.({id,kind:"tool",name:node==="answer-repair"?"回答引用与结构核对":node==="calculation-plan"?"核对数值演算参数":"回答整理",input:node==="answer-repair"?repairInput:"依据本轮已取得材料处理",status:"failed",error:error instanceof Error?error.message:"本步骤未完成。",output:retained?"已保留此前通过结构及引用校验的内容，不保留未核验的新计算结果。":"未取得可直接恢复的正文，将仅保留实际取得的来源线索。"});
      }});
    }catch(error){
      signal.throwIfAborted();const retained=retainedSourceAnswer(references,webHits);if(!retained)throw error;
      if(repaired){repairFailed=true;onTool?.({id:"synthesis-repair",kind:"tool",name:"回答引用与结构核对",input:repairInput,status:"failed",error:error instanceof Error?error.message:"答复校验未完成。"});}
      onTool?.({id:"answer-generation",kind:"tool",name:"回答整理",input:"根据本轮已取得资料生成答复",status:"failed",error:error instanceof Error?error.message:"回答整理未完成。",output:"没有发布未通过校验的草稿；已保留实际来源条目与读取记录。"});
      onStage?.("回答整理未完成，已保留本轮取得的来源线索",searches);answer=retained;
    }
    if(repaired&&!repairFailed)onTool?.({id:"synthesis-repair",kind:"tool",name:"回答引用与结构核对",input:repairInput,status:"done",output:"已按原材料修正并通过编号与结构校验；不代表科学判断全部已核。"});
    // Keep the experimental second model pass opt in: live checks are not yet
    // reliable enough to add its latency and incomplete-review notices to every answer.
    if(process.env.ONEEARTH_ANSWER_EVIDENCE_AUDIT==="1" && shouldReviewAnswerEvidence(answer,query,actualCalculations)){
      onStage?.("正在对照具体陈述与已取得的来源",searches);
      const reviewed=await reviewAnswerEvidence({parsedAnswer:answer,catalogue:rows,references,webHits,sourceReadComparisons,question:query,originalSynthesisPrompt:prompt,
        calculations:actualCalculations,parentSignal:signal,
        run:(p,schema,reviewSignal)=>executor.model(p,{outputSchema:schema===synthesisResponseSchema?answerSchema:schema},reviewSignal),onTool});
      signal.throwIfAborted();
      try{verifyExecutionAndReferences(reviewed.answer);answer=reviewed.answer;}
      catch(error){onTool?.({id:"source-read-provenance",kind:"tool",name:"核对来源访问记录",input:"核对模型审读生成的动作描述",
        status:"failed",error:error instanceof Error?error.message:"来源访问记录不相符。"});}
    }
    const {message,sources,webSources}=answer;
    return {...base,message,researchIntent:retrieval?.plan.researchIntent||turn?.plan.researchIntent,conversationContext:retrieval?.plan.conversationContext||turn?.plan.conversationContext,
      conversationEvidence:rememberReadEvidence(previousReadings,searches,memoryOptions),modelExecutor:executor.name,modelIds:sources.map(s=>s.id),
      conversationAssertionEvidence:rememberCurrentAssertionReadings(previousAssertions,rows,sources.map(s=>s.id),target),
      answerNotes:{researchNotes:answer.researchNotes,references:answer.references,sources,searches,webSources,limitation:[answer.limitation,webIssue].filter(Boolean).join("\n"),followUp:answer.followUp,reviewed:rows.length,
        elapsedMs:Date.now()-start,executor:executor.name==="codex"?"Codex":"Claude Code"}};

}
