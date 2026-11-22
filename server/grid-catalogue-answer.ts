import type {GridCoverageEvidence} from "../src/domain/grid-coverage";
import {paperId,type PaperRecord} from "../src/domain/paper-record";
import type {AnswerReference,DiscoveryResponse} from "../src/domain/types";
import type {Asset} from "../src/domain/datasets";
import {referenceChannel} from "../src/domain/citation-types";
import {gridCoverageSummary} from "./question-grid";
import {parseSynthesis} from "./scientific-answer";

export type GridCatalogueQuestion="count"|"catalogue";
export const gridCatalogueLimit=20;

/** Explicit tool prohibitions are capability limits, not an intent classifier.
 * Scientific purpose is decided by the existing structured turn planner. */
export function gridQueryLimits(question:string){
  const q=question.replace(/“[^”]*”|「[^」]*」|`[^`]*`/g,"");
  return {currentCoverageOnly:/(?:只|仅)(?:看|读取|读|核对)(?:当前|已有)?(?:的)?(?:覆盖结果|目录结果)/.test(q),
    noDiscovery:/(?:不要|无需|不必|不用|禁止)[^。！？；\n]{0,20}(?:搜索|检索)|\b(?:do not|no) (?:additional )?(?:search|discovery)\b/i.test(q)};
}

export function gridCataloguePaperIds(evidence:GridCoverageEvidence):string[]{
  return evidence.status==="ready"&&evidence.summary&&evidence.count>0
    ?[...new Set(evidence.sourceIds)].filter(paperId).slice(0,gridCatalogueLimit):[];
}

/** The spatial service proves membership; exact records supply only identities.
 * No generated scientific prose is promoted to a verified catalogue fact. */
export function gridCatalogueAnswer(evidence:GridCoverageEvidence,mode:GridCatalogueQuestion,papers:PaperRecord[],assets:Asset[]=[],archivedIds:readonly string[]=[]):DiscoveryResponse{
  if(evidence.status!=="ready"||!evidence.summary)return {
    message:evidence.status==="ready"?"覆盖未知。暂时无法核实所引网格的权威范围，请重新选用范围。":gridCoverageSummary(evidence),
    clarification:true,gridCoverage:evidence,
  };
  const ids=gridCataloguePaperIds(evidence),byId=new Map(papers.filter(p=>!p.catalogSummary&&ids.includes(p.id)).map(p=>[p.id,p]));
  const selected=mode==="catalogue"?ids.flatMap(id=>byId.get(id)||[]):[];
  const other=mode==="catalogue"&&evidence.count>0?[...new Map(assets.filter(a=>!paperId(a.id)&&evidence.sourceIds.includes(a.id)).map(a=>[a.id,a])).values()].slice(0,gridCatalogueLimit-selected.length):[];
  const references:AnswerReference[]=[...selected.map(p=>({kind:"asset" as const,id:p.id,title:p.paperTitle||p.need.product,source:p.need.source,sourceChannel:"assertion" as const,evidenceLevel:"catalogue-record" as const})),
    ...other.map(a=>{const ref={kind:"asset" as const,id:a.id,title:a.title,source:a.source,evidenceLevel:"catalogue-record" as const};return {...ref,sourceChannel:referenceChannel(ref,a)};})];
  // Titles are literal metadata, never citation tokens, Markdown or instructions.
  const title=(text:string)=>text.replace(/[\[\]〔〕`<>*_\\]/g,"").replace(/\s+/g," ").slice(0,300);
  const units=evidence.summary.metric==="scenes"?"条影像目录记录":"种目录数据集";
  const lines=["所附网格在已确认筛选范围内匹配 "+evidence.count+" "+units+"。"];
  const limits=["这是目录定位结果，不代表当地有效观测；本轮未读取论文原文或原始数据文件。"];
  if(mode==="catalogue"&&evidence.count>0){
    const entries=[...selected.map((p,i)=>"- "+(p.paperTitle?"论文："+title(p.paperTitle)+"；":"")+"数据产品："+title(p.need.product)+
        "；目录类型："+title(p.need.type)+"；来源："+title(p.need.source)+(p.need.profile?.years?"；目录时段："+p.need.profile.years.join("—"):"")+" [S"+(i+1)+"]"),
      ...other.map((a,i)=>"- 目录对象："+title(a.title)+" [S"+(selected.length+i+1)+"]")];
    if(entries.length)lines.push("可核对的精确版本目录条目：\n"+entries.join("\n"));
    if(selected.some(p=>archivedIds.includes(p.id)))limits.push("部分精确版本目录记录来自同会话已归档材料；沿用原版本，不代表重新核实了当前发布状态。");
    const missing=ids.filter(id=>!byId.has(id));
    if(missing.length)limits.push("以下覆盖来源的精确版本目录记录暂未取得（缺项、已撤下或服务不可用均不代表零覆盖），未按同名或当前版本替换："+missing.join("、")+"。");
    const unrepresented=[...new Set(evidence.sourceIds)].filter(id=>!ids.includes(id)&&!other.some(a=>a.id===id));
    if(unrepresented.length)limits.push("本轮最多展开 "+gridCatalogueLimit+" 个已核对目录身份；另有 "+unrepresented.length+" 个覆盖来源未在本轮展开（尚未取得相应目录记录或已达上限），不是完整条目清单。这不改变权威覆盖数量。");
    if(!evidence.sourceIds.length)limits.push("覆盖结果未提供可核对的稳定来源身份，无法列出或构造目录出处。");
  }
  const parsed=parseSynthesis(JSON.stringify({message:lines.join("\n\n"),limitation:limits.join("\n"),followUp:"",researchNotes:[],calculationRequests:[]}),references,[]);
  return {message:parsed.message,gridCoverage:evidence,modelIds:parsed.sources.map(s=>s.id),
    ...(selected.length?{paperRecords:selected}:{}),
    answerNotes:{references:parsed.references,sources:parsed.sources,researchNotes:[],searches:[],webSources:[],
      limitation:parsed.limitation,followUp:"",reviewed:selected.length,elapsedMs:0,executor:""}};
}
