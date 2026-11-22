import {literatureText} from "./literature-label";
import {assetById,type Asset} from "./datasets";
import {paperRecords} from "./paper-record";
import {observationById} from "./push-observations";
import type {AnswerReference,Message,CitationType,AnswerNotes} from "./types";
import {referenceCitationType} from "./citation-types";
import {hasReadWebExcerpt,webEvidenceStage} from "./web-preview";
import {webMaterial} from "./web-material";

export interface CitationDetails {type:CitationType;channel:string;evidence:string;nature?:string;material?:string}
export function citationDetails(ref:AnswerReference,notes?:Partial<AnswerNotes>):CitationDetails{
  if(ref.kind==="web"){
    const matches=notes?.searches?.filter(run=>run.hits.some(h=>h.url===ref.url)) || [];
    const search=matches.find(run=>run.engine==="DataCite") || matches[0];
    const hit=notes?.webSources?.find(h=>h.url===ref.url) || search?.hits.find(h=>h.url===ref.url);
    const dataCite=search?.engine==="DataCite";
    const read=hasReadWebExcerpt(hit);
    const previous=read && hit.previousRead;
    const excerpt=read ? (hit.stage ? webEvidenceStage(hit.stage) : "网页摘录（采集阶段未记录）") : "";
    const evidence=previous ? "此前已读摘录 · "+excerpt+(hit.readAt?" · "+hit.readAt:"") :
      read ? (dataCite?"数据集 DOI 元数据、":"")+excerpt :
      dataCite ? "数据集 DOI 元数据" : hit?.snippet ? "网页检索摘要" : "标题与来源链接";
    const material=webMaterial(ref.url)?.label;
    return {type:"web",channel:previous?"会话已读记录":dataCite?"DataCite":search || hit?"网页检索":"公开网页",evidence,
      ...(material?{material}:{})};
  }
  const a=assetById.get(ref.id),record=paperRecords.get(ref.id),tabs=record?.need.tabs || a?.tabs || [];
  const type=referenceCitationType(ref,a,observationById(ref.id));
  if(type==="paper"){
    const evidence=[tabs.some(t=>t.label==="官方元数据" && t.rows?.length)?"官方元数据":"",
      tabs.some(t=>t.label==="论文用法（本页）" && t.rows?.length)?"论文用法":"",
      tabs.some(t=>t.label.startsWith("原文") && t.quote)?"原文摘录":""].filter(Boolean).join("、");
    return {type:"paper",channel:"文献依据",evidence:evidence || "文献与数据关联记录"};
  }
  if(a?.origins.includes("haina") || ref.id.startsWith("haina:"))return {type,channel:"海纳",evidence:type==="data"?"海纳实体数据目录（访问按授权）":"海纳公开目录说明"};
  if(a?.origins.includes("constellation") || ref.id.startsWith("constellation:"))return {type,channel:"星座及时数据",evidence:type==="data"?"已接收数据实体或观测值":"观测目录与产品链接",nature:"观测记录"};
  return {type,channel:a?.holding?.channelName || (a?"公开资料目录":literatureText(ref.source || "资料目录")),
    ...(type==="data" && a?.profile?.role==="derived"?{nature:"派生数据"}:{}),
    ...(type==="data" && a?.datasetId==="gfs-wind"?{nature:"模式预报"}:{}),
    evidence:type==="data"?"已接入实体数据目录与附带资料":"公开目录元数据与资料说明"};
}

export function sourcesFor(m:Message) {
  const notes=m.answerNotes;
  const inline:AnswerReference[]=notes?.references ?? (notes?.webSources || []).map(h=>({kind:"web",title:h.title,url:h.url}));
  const refs=inline.slice();
  const keys=new Set(refs.map(ref=>ref.kind==="asset"?ref.id:ref.url));
  const used=[...(notes?.sources.map(s=>s.id)||[]),...(m.research?.rows.flatMap(row=>[...row.ids,...(row.references||[])])||[]),...(m.dataSupport?.candidates.map(c=>c.assetId)||[])];
  for(const id of used) if(!keys.has(id)) {
    keys.add(id);const a=assetById.get(id);refs.push({kind:"asset",id,title:a?.title||id,source:a?.source||""});
  }
  return {inline,refs};
}
export type AssetReference=Extract<AnswerReference,{kind:"asset"}>;
export function linkedPapers(asset:Asset|undefined) {
  const papers=new Map<string,import("./types").PaperSource>();
  for(const paper of [...(asset?.paperSources||[]),...(asset?.paperSource?[asset.paperSource]:[])])
    if(paper.title.trim())papers.set(paper.url || paper.title,paper);
  return [...papers.values()];
}
export function evidenceGroups(refs:AnswerReference[]) {
  const papers:AssetReference[]=[],local:AssetReference[]=[],network:AnswerReference[]=[];
  for(const ref of refs){
    const type=citationDetails(ref).type;
    if(type==="data" && ref.kind==="asset")local.push(ref);
    else if(type==="paper" && ref.kind==="asset")papers.push(ref);
    else network.push(ref);
  }
  return {papers,local,network};
}
export function doiFor(id:string) {
  const record=paperRecords.get(id);
  return record?.dsKey.match(/^doi:(10\.\S+)/i)?.[1] || assetById.get(id)?.url?.match(/^https?:\/\/(?:dx\.)?doi\.org\/(10\.\S+)/i)?.[1];
}
export function paperCards(id:string) {
  const tabs=paperRecords.get(id)?.need.tabs || assetById.get(id)?.tabs || [];
  const cards:{title:string;type:"原文"|"数据用法";section?:string;text:string;doi?:string}[]=[];
  const rows=tabs.find(t=>t.label==="论文用法（本页）")?.rows || [];
  for(const row of rows) {
    const title=String(row[0]||row[4]||"论文"), text=[row[1],row[2],row[3]].filter(Boolean).join("\n");
    if(text)cards.push({title,type:"数据用法",text,doi:String(row[6]||row[4]||"").match(/(?:^|doi:|doi\.org\/)(10\.\S+)/i)?.[1]});
  }
  for(const tab of tabs.filter(t=>t.kind==="text" && t.label.startsWith("原文") && t.quote)) {
    const title=tab.before || tab.label.replace(/^原文\s*·\s*/,"");
    const doi=cards.find(c=>c.title===title)?.doi;
    for(const part of tab.quote!.split(/\n\n(?=[^\n]{1,160}\n)/)) {
      const line=part.indexOf("\n");
      cards.push({title,type:"原文",section:line>=0?part.slice(0,line):undefined,text:line>=0?part.slice(line+1):part,doi});
    }
  }
  return cards;
}


// Keep product variants distinguishable while full titles stay in the source drawer.
export function citationLabel(title:string):string {
  const version=title.match(/\b(?:Version\s*|V)(\d+(?:\.\d+)+)/i)?.[1];
  if (/CLIMCAPS/i.test(title)) {
    const platform=title.match(/AQUA|Suomi NPP|JPSS-\d+/i)?.[0] || "";
    const channels=/IR-only/i.test(title)?"IR-only":/IR \+ MW/i.test(title)?"IR+MW":"";
    return [platform,"CLIMCAPS",channels,version && "V"+version].filter(Boolean).join(" ");
  }
  if (/PATMOS-x/i.test(title)) return "PATMOS-x"+(version?" V"+version:"");
  if (/Cloud_cci/i.test(title)) {
    const sensor=title.match(/AVHRR-PM|ATSR2-AATSR/i)?.[0] || "";
    return ["Cloud_cci",sensor,version && "V"+version].filter(Boolean).join(" ");
  }
  if (/GIIRS/i.test(title)) {
    const platform=title.match(/FY-4[AB]/i)?.[0] || "";
    const variable=title.match(/NH3|Ozone/i)?.[0] || "";
    return [platform,"GIIRS",variable].filter(Boolean).join(" ");
  }
  return title.length>30?title.slice(0,29).trimEnd()+"…":title;
}
