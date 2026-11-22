import type {AnswerReference,EvidenceDocument,EvidenceStage,EvidenceTab,Message,ReadEvidence,WebHit} from "./types";
import {accessGate} from "./read-evidence";

export function webUrl(raw?:string) {
  try {
    const url=new URL(raw || "");
    return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url : null;
  } catch {return null;}
}
export function previewableTab(tab:EvidenceTab) {
  return tab.kind!=="web" || !!webUrl(tab.url);
}
export function webDocument(url:URL,title:string,snippet?:string):EvidenceDocument {
  return {id:"web:"+url.href,title:title || url.hostname,scope:"来源网页",source:url.hostname,url:url.href,
    tabs:[{kind:"web",label:"网页",url:url.href,body:snippet}]};
}

export function webEvidenceStage(stage?: EvidenceStage) {
  switch(stage) {
    case "abstract": return "摘要";
    case "page-excerpt": return "网页摘录";
    case "pdf-excerpt": return "PDF 摘录";
    case "search-snippet": return "检索摘要（未读取原页）";
    default: return "未记录";
  }
}

export function hasReadWebExcerpt(hit?: WebHit): hit is WebHit & {pageExcerpt:string} {
  return hit?.stage!=="search-snippet" && typeof hit?.pageExcerpt==="string" &&
    !!hit.pageExcerpt.trim() && !accessGate(hit.pageExcerpt);
}

function savedTab(
  url: string, label: string, description: string, quote: string,
  info: {stage?: EvidenceStage; readAt?: string; truncated?: boolean; publisherUrl?: string},
): EvidenceTab {
  const time=info.readAt && Number.isFinite(Date.parse(info.readAt)) ? info.readAt : "未记录";
  return {
    kind:"text",label,url,quote,savedWebExcerpt:{publisherUrl:info.publisherUrl},
    before:description+" · 采集阶段 "+webEvidenceStage(info.stage)+" · 采集时间 "+time,
    after:info.truncated===true?"保存的摘录有截断。":
      info.truncated===false?"该段保存时未截断。":"未记录该段是否截断。",
  };
}

export function savedWebDocument(reference: AnswerReference, message: Message): EvidenceDocument | undefined {
  if (reference.kind !== "web") return;
  const url=webUrl(reference.url);
  if (!url) return;
  const {href}=url;
  const hit=message.answerNotes?.webSources?.find(item=>webUrl(item.url)?.href===href && hasReadWebExcerpt(item));
  if (!hasReadWebExcerpt(hit)) return;
  const excerpt=hit.pageExcerpt;
  const landing=webUrl(hit.landingUrl);
  const publisherUrl=landing && landing.href!==href ? landing.href : undefined;
  const tabs=[savedTab(href,"作答时提供的资料",hit.previousRead?"作答时提供的资料（此前读取）":"作答时提供的资料",excerpt,
    {stage:hit.stage,readAt:hit.readAt,truncated:hit.previousExcerptTruncated,publisherUrl})];
  const savedKeys=new Set([JSON.stringify([excerpt,hit.stage,hit.readAt,hit.previousExcerptTruncated])]);
  function addSavedMaterials(records: ReadEvidence[] | undefined, label: string) {
    let index=0;
    for (const row of records ?? []) {
      if (webUrl(row.url)?.href!==href || typeof row.excerpt!=="string" || !row.excerpt.trim() ||
          (row.stage!=="search-snippet" && accessGate(row.excerpt))) continue;
      const key=JSON.stringify([row.excerpt,row.stage,row.readAt,row.excerptTruncated]);
      if (savedKeys.has(key)) continue;
      savedKeys.add(key);
      index++;
      tabs.push(savedTab(href,label+" "+index+" · "+webEvidenceStage(row.stage),label,row.excerpt,
        {stage:row.stage,readAt:row.readAt,truncated:row.excerptTruncated,publisherUrl}));
    }
  }
  addSavedMaterials(hit.priorEvidence,"此前记录");
  addSavedMaterials(message.conversationEvidence,"另存材料");
  return {id:"saved-web:"+message.id+":"+href,title:reference.title || url.hostname,
    scope:"已保存依据",source:url.hostname,url:href,tabs};
}
