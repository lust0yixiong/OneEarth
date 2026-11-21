import type {ReadEvidence,SearchRun,WebHit,ManifestIndex} from "./types";

export type EvidenceMemoryOptions={sourceTurn?:number;query?:string;focusUrls?:string[]};
const memoryByteLimit=32*1024;
const jsonBytes=(value:unknown)=>{try{return new TextEncoder().encode(JSON.stringify(value)).length;}catch{return Infinity;}};
export function validManifestIndex(value:unknown):value is ManifestIndex {
 const v=value as ManifestIndex;
 return !!v&&Array.isArray(v.names)&&v.names.length<=80&&v.names.every(n=>typeof n==='string'&&!!n&&n.length<=240)&&jsonBytes(v.names)<=12*1024&&Number.isSafeInteger(v.sourceTotal)&&v.sourceTotal>=v.names.length&&typeof v.namesComplete==='boolean'&&(!v.namesComplete||v.names.length===v.sourceTotal)&&v.contentsRead===false;
}
export function compactManifestIndex(value:unknown):ManifestIndex|undefined {
 const v=value as ManifestIndex;
 if(!v||!Array.isArray(v.names)||!Number.isSafeInteger(v.sourceTotal)||v.sourceTotal<0||typeof v.namesComplete!=='boolean'||v.contentsRead!==false)return;
 const names:string[]=[];
 for(const name of v.names){if(typeof name!=='string'||!name||name.length>240||names.length>=80||jsonBytes([...names,name])>12*1024)continue;names.push(name);}
 return {names,sourceTotal:v.sourceTotal,namesComplete:v.namesComplete&&names.length===v.sourceTotal&&names.length===v.names.length,contentsRead:false};
}
export function readEvidenceNotice(read:ReadEvidence){
 const coverage=read.excerptTruncated?`历史摘录只保留${read.excerpt.length}/${read.sourceExcerptLength}字符，已截断。`:read.sourceExcerptLength===undefined?'旧记录未保存原摘录长度；不可据此认定完整。':'保留的是当时取得的页面节选，不代表完整来源。';
 return coverage+' 内嵌complete或fileIndexComplete字段不能证明裁短后的名称仍完整；仅manifestIndex.namesComplete=true表示所保存名称索引完整，contentsRead始终为false。历史索引不证明当前版本未变化；不能用局部未见作全文/文件不存在的结论。';
}
function boundMemory(rows:ReadEvidence[]):ReadEvidence[]{
 const result=rows.slice(0,6).map(r=>({...r,...(r.manifestIndex?{manifestIndex:compactManifestIndex(r.manifestIndex)}:{})}));
 while(jsonBytes(result)>memoryByteLimit&&result.length){
  const indexed=[...result].reverse().find(r=>r.manifestIndex?.names.length);
  if(indexed?.manifestIndex)indexed.manifestIndex={...indexed.manifestIndex,names:indexed.manifestIndex.names.slice(0,-1),namesComplete:false};
  else result.pop();
 }
 return result;
}
export function accessGate(text:string) {
  const gate=/登录后(?:可|才能)|请(?:先)?登[录陆]|(?:log|sign)\s*in\s+to\s+(?:access|view)/i;
  if(text.replace(/\s+/g," ").length>=1600 || !gate.test(text))return false;
  const abstract=text.match(/(?:^|\n)\s*(?:#{1,4}\s*)?(?:abstract|摘要)\s*[:：]?\s*\n([\s\S]*)/i)?.[1];
  return !abstract || abstract.split(gate)[0].trim().length<250;
}
export function validReadEvidence(value:unknown):value is ReadEvidence[] {
  return Array.isArray(value) && value.length<=6 && jsonBytes(value)<=memoryByteLimit && value.every(r=>{
    if(!r || typeof r.url!=="string" || r.url.length>2000 || typeof r.title!=="string" || !r.title || r.title.length>360 ||
      typeof r.excerpt!=="string" || !r.excerpt || r.excerpt.length>1600 || typeof r.readAt!=="string" ||
      r.readAt.length>32 || !Number.isFinite(Date.parse(r.readAt)) ||
      (r.referenceType!==undefined && !["data","paper","web"].includes(r.referenceType)) ||
      (r.stage!==undefined && !["search-snippet","abstract","page-excerpt","pdf-excerpt"].includes(r.stage)) ||
      (r.sourceTurn!==undefined && (!Number.isSafeInteger(r.sourceTurn)||r.sourceTurn<1||r.sourceTurn>100000)) ||
      (r.discoveredBy!==undefined && !["assistant","user"].includes(r.discoveredBy)) ||
      (r.readBy!==undefined && !["platform","user"].includes(r.readBy)) ||
      (r.stage==="search-snippet" && r.readBy!==undefined) ||
      (r.excerptTruncated!==undefined&&typeof r.excerptTruncated!=="boolean") ||
      (r.sourceExcerptLength!==undefined&&(!Number.isSafeInteger(r.sourceExcerptLength)||r.sourceExcerptLength<r.excerpt.length)) ||
      (r.excerptTruncated===true&&!(r.sourceExcerptLength>r.excerpt.length)) ||
      (r.sourceExcerptLength>r.excerpt.length&&r.excerptTruncated!==true) ||
      (r.manifestIndex!==undefined&&!validManifestIndex(r.manifestIndex)))return false;
    try{const u=new URL(r.url);return /^https?:$/.test(u.protocol) && !u.username && !u.password;}catch{return false;}
  });
}
const segmenter=new Intl.Segmenter('zh',{granularity:'word'});
function relevance(read:ReadEvidence,options:EvidenceMemoryOptions) {
  const query=options.query||'',text=(read.title+' '+read.excerpt+' '+(read.manifestIndex?.names.join(' ')||'')).toLowerCase();
  const terms=[...segmenter.segment(query.toLowerCase())].filter(s=>s.isWordLike&&s.segment.length>1).map(s=>s.segment);
  if(/田野|笔记|访谈/.test(query))terms.push('fieldnote','field note','interview');
  if(/单位|数值|比例|系数/.test(query))terms.push('coefficient','ratio','unit');
  return Number(options.focusUrls?.includes(read.url))*20 + new Set(terms.filter(t=>text.includes(t))).size*2 + Number(read.stage!=="search-snippet");
}
/** Six literal windows (<=9600 chars total), not a full conversation transcript.
 * Search snippets are retained as leads; they never establish a page was read. */
export function rememberReadEvidence(previous:ReadEvidence[],runs:SearchRun[]=[],options:EvidenceMemoryOptions={}):ReadEvidence[] {
  const next:ReadEvidence[]=runs.filter(r=>r.status==="done").flatMap(run=>run.hits.flatMap(hit=>{
    const isFetch=["DeepSeek Fetch","原站读取","PDF 原文"].includes(run.engine);
    const body=isFetch?hit.pageExcerpt:hit.snippet;
    if(!body?.trim() || accessGate(body))return [];
    const time=run.startedAt?Date.parse(run.startedAt)+(run.elapsedMs||0):Date.now();
    if(!Number.isFinite(time))return [];
    const stage=isFetch?(run.engine==="PDF 原文"?"pdf-excerpt":hit.stage==="abstract"||/(?:^|\n)\s*(?:#{1,4}\s*)?(?:Abstract|摘要)\s*[:：]?\s*\n/i.test(body)&&!/(?:^|\n)\s*#{1,4}\s*(?:Methods|Results|方法|结果)/i.test(body)?"abstract":"page-excerpt"):"search-snippet";
    return [{url:hit.url,title:hit.title.slice(0,360),excerpt:body.slice(0,1600),referenceType:hit.referenceType,
      readAt:new Date(time).toISOString(),stage,sourceTurn:options.sourceTurn,excerptTruncated:body.length>1600,sourceExcerptLength:body.length,
      ...(isFetch&&hit.manifestIndex?{manifestIndex:compactManifestIndex(hit.manifestIndex)}:{}),
      discoveredBy:hit.discoveredBy||"assistant",...(isFetch?{readBy:"platform" as const}:{})}];
  }));
  const seen=new Set<string>();
  const unique=[...next,...previous].filter(r=>{
    const key=r.url+(r.stage==="search-snippet"?":snippet:"+r.excerpt:":reading");
    if(seen.has(key)||!validReadEvidence([r]))return false;seen.add(key);return true;
  });
  return boundMemory(unique.map((r,index)=>({r,index,score:relevance(r,options)})).sort((a,b)=>b.score-a.score||a.index-b.index).slice(0,6).map(x=>x.r));
}
export function withPreviousReadings(hits:WebHit[],reads:ReadEvidence[],options:EvidenceMemoryOptions={}):WebHit[] {
  const byUrl=new Map(hits.map(hit=>{
    const h:WebHit={...hit};
    if(h.pageExcerpt&&!accessGate(h.pageExcerpt)){
      h.stage ||= /(?:^|\n)\s*(?:#{1,4}\s*)?(?:Abstract|摘要)\s*[:：]?\s*\n/i.test(h.pageExcerpt)?"abstract":"page-excerpt";
      h.readBy ||= "platform";
    } else if(!h.stage&&h.snippet.trim()&&!/用户主动引用|尚未据此读取/.test(h.snippet))h.stage="search-snippet";
    return [h.url,h] as const;
  }));
  for(const read of [...reads].filter(r=>validReadEvidence([r])).sort((a,b)=>relevance(b,options)-relevance(a,options))){
    const current=byUrl.get(read.url);
    // Keep a prior snippet even if a new abstract/page at that URL omits it.
    // The stage/time belongs to the historical evidence, not the fresh page.
    const priorEvidence=[...(current?.priorEvidence||[]),read].filter((r,i,a)=>a.findIndex(x=>x.stage===r.stage&&x.excerpt===r.excerpt)===i).slice(0,2);
    if(read.stage==="search-snippet")byUrl.set(read.url,{...current,url:read.url,title:current?.title||read.title,
      snippet:current?.snippet||read.excerpt,referenceType:current?.referenceType||read.referenceType,
      ...(current?{}:{stage:"search-snippet" as const,sourceTurn:read.sourceTurn,discoveredBy:read.discoveredBy}),priorEvidence});
    else if(!current?.pageExcerpt)byUrl.set(read.url,{...current,url:read.url,title:read.title,snippet:current?.snippet||"",
      referenceType:current?.referenceType||read.referenceType,pageExcerpt:read.excerpt,readAt:read.readAt,previousRead:true,
      manifestIndex:read.manifestIndex,evidenceNotice:readEvidenceNotice(read),previousExcerptTruncated:read.excerptTruncated,previousSourceExcerptLength:read.sourceExcerptLength,
      stage:read.stage||(/(?:^|\n)\s*(?:#{1,4}\s*)?(?:Abstract|摘要)\s*[:：]?\s*\n/i.test(read.excerpt)?"abstract":"page-excerpt"),sourceTurn:read.sourceTurn,discoveredBy:read.discoveredBy,readBy:read.readBy||"platform",priorEvidence:priorEvidence.filter(e=>e.excerpt!==read.excerpt||e.stage==="search-snippet")});
    else byUrl.set(read.url,{...current,priorEvidence,evidenceNotice:[current.evidenceNotice,"此前记录范围："+readEvidenceNotice(read)].filter(Boolean).join("\n")});
  }
  return [...byUrl.values()];
}
