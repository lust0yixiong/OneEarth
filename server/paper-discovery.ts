import { paperId, type PaperRecord } from "../src/domain/paper-record";
import type { DiscoveryContext, DiscoveryResponse } from "../src/domain/types";
import type { ChatModel } from "../src/domain/chat-model";
import { asksResearchQuestion, asksPaperUsageOnly, onlySource, refersToBatch } from "../src/domain/research-question";
import { runExecutor } from "./chat-executor";
import { readPaperPlan, searchPapers } from "./earthnano";

export function paperIntent(query: string, ctx: DiscoveryContext) {
  const source = onlySource(query);
  if (source && source !== "paper") return;
  if (ctx.selection || ctx.filters.period || ctx.filters.depth || ctx.filters.utcWindow || ctx.filters.place || ctx.filters.maxDem!==null) return;
  const requested = source || ctx.filters.source;
  if (requested && requested!=="paper") return;
  if (requested==="paper" || asksPaperUsageOnly(query)) return "paper";
  if (ctx.filters.type || ctx.filters.need !== -1 || ctx.observationSource) return;
  if ((ctx.inCandidateScope || ctx.candidateIds?.length) && refersToBatch(query)) return;
  if (asksResearchQuestion(query)) return "mixed";
}

export async function paperLookup(query:string, config:ChatModel, signal:AbortSignal, stage:(message:string)=>void, history:{role:string;text:string}[], current:PaperRecord[], report?:(call:import("../src/domain/types").ToolCall)=>void) {
  const simple = query.match(/^(?:哪些论文用过|哪些文献使用了|查询(?:文献资料|断言库)[：:]?\s*|查找论文用法[：:]?\s*)\s*([a-z0-9][a-z0-9 ./_-]{0,150})[？?。]?$/i);
  const prior = current.length===1 && /这份|该数据|它|这个数据/.test(query) ? current[0] : undefined;
  let plan;
  if (prior || simple) {
    plan = {name:prior?.dsKey.replace(/^doi:/,"") || simple![1].trim(), facets:[], region:[]};
  } else {
    stage("正在整理文献资料检索词");
    const raw = await runExecutor(config,"为用户原问题整理 文献资料 检索参数，不改写问题，不把解释、比较或证据判断转成找数据的需求。仅返回 JSON 对象 {name,facets,region,scenario}。用户明确提到数据集名称/DOI 时将英文名称写入 name，否则留空。按实际检索主题给出零到六个 facet，每个为 {need:中文检索主题,queries:一到三个英文短语数组}；name 为空时至少一个主题，不强行拆成多项需求。scenario 写与原问题相关的英文短语。region 仅放用户明确要求限定的英文地区名，否则 []。不要发明标识符或研究条件。以下是问题和供解析指代的上下文："+JSON.stringify({query,history:history.filter(t=>t.role==="user").slice(-2),current:current.map(r=>r.need.product)}),signal);
    try { plan = readPaperPlan(raw); } catch { throw Error("未能生成论文检索词，请补充数据集名称或研究主题。"); }
  }
  return searchPapers(plan,signal,stage,report);
}

export function paperResult(query:string, records:PaperRecord[], tools:string[]): DiscoveryResponse {
  const count=records.length;
  const trace="文献资料 MCP · "+tools.join(" → ");
  const sources=records.map(r=>({id:r.id,reason:r.need.detail}));
  return {
    message:count?"本次从文献资料取回 "+count+" 个有实际用法记录的候选数据集。":"文献资料本次检索未返回匹配的用法记录。",
    paperOnly:true,paperRecords:records,modelIds:sources.map(s=>s.id),
    catalogMatch:{ids:sources.map(s=>s.id),conditions:["文献资料",query],rejected:[],sampleWindow:false,period:null},
    answerNotes:{sources,executor:"文献资料 MCP",reviewed:count,elapsedMs:0,limitation:"",followUp:"",paperTrace:trace},
  };
}

export const cachedPaperIds = (ctx:DiscoveryContext) => (Array.isArray(ctx.candidateIds) ? ctx.candidateIds : []).filter(paperId);
