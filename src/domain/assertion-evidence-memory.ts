/** Literal windows that were actually supplied to synthesis and cited. These are
 * assertion-library excerpts, never web reads, a fresh MCP lookup, or full text. */
export type AssertionEvidenceMemory={
 stage:"assertion-excerpt";assetId:string;dsKey?:string;paperId?:string;rqId?:string;datasetId?:string;
 label:string;block?:string;quote:string;start:number;end:number;sourceLength:number;partial:boolean;
 recordedAt:string;sourceTurn?:number;excerptTruncated?:boolean;originalQuoteLength?:number;
};
export type AssertionEvidenceRow={id:string;excerpts?:Array<{
 label:string;block?:string;quote:string;start:number;end:number;sourceLength:number;partial:boolean;
 source?:{dsKey?:string;paperId?:string;rqId?:string;datasetId?:string};
}>};
export type AssertionMemoryOptions={query?:string;assetIds?:string[];recordedAt?:string;sourceTurn?:number};
const maxBytes=16*1024,maxQuotes=4800;
const bytes=(x:unknown)=>{try{return new TextEncoder().encode(JSON.stringify(x)).length;}catch{return Infinity;}};
const optional=(v:unknown,n:number)=>v===undefined||typeof v==='string'&&!!v.trim()&&v.length<=n;
export function validAssertionEvidenceMemory(value:unknown):value is AssertionEvidenceMemory[] {
 return Array.isArray(value)&&value.length<=6&&bytes(value)<=maxBytes&&value.reduce((s,r)=>s+(typeof r?.quote==='string'?r.quote.length:0),0)<=maxQuotes&&value.every(r=>r&&r.stage==='assertion-excerpt'&&/^earthnano:[a-f0-9]{64}$/.test(r.assetId)&&
  typeof r.label==='string'&&!!r.label.trim()&&r.label.length<=360&&optional(r.block,360)&&['dsKey','paperId','rqId','datasetId'].every(k=>optional(r[k],500))&&
  typeof r.quote==='string'&&!!r.quote.trim()&&r.quote.length<=1200&&Number.isSafeInteger(r.start)&&r.start>=0&&Number.isSafeInteger(r.end)&&r.end-r.start===r.quote.length&&Number.isSafeInteger(r.sourceLength)&&r.sourceLength>=r.end&&typeof r.partial==='boolean'&&
  typeof r.recordedAt==='string'&&r.recordedAt.length<=32&&Number.isFinite(Date.parse(r.recordedAt))&&
  (r.sourceTurn===undefined||Number.isSafeInteger(r.sourceTurn)&&r.sourceTurn>0&&r.sourceTurn<=100000)&&
  (r.excerptTruncated===undefined||typeof r.excerptTruncated==='boolean')&&
  (r.originalQuoteLength===undefined||Number.isSafeInteger(r.originalQuoteLength)&&r.originalQuoteLength>=r.quote.length)&&
  (!r.excerptTruncated||r.partial&&r.originalQuoteLength>r.quote.length));
}
const segmenter=new Intl.Segmenter('zh',{granularity:'word'});
function relevance(r:AssertionEvidenceMemory,o:AssertionMemoryOptions){
 const q=o.query||'',text=(r.label+' '+(r.block||'')+' '+r.quote).toLowerCase();
 const terms=[...segmenter.segment(q.toLowerCase())].filter(p=>p.isWordLike&&p.segment.length>1).map(p=>p.segment);
 if(/田野|笔记/.test(q))terms.push('field notes','fieldnote');if(/会议/.test(q))terms.push('meeting');if(/转述|听说/.test(q))terms.push('reports','reported','told');
 const blocks=q.match(/\bB\d{3,6}\b/gi)||[];
 return Number(o.assetIds?.includes(r.assetId))*20+Number(blocks.some(b=>r.block?.toLowerCase().startsWith(b.toLowerCase())))*40+new Set(terms.filter(t=>text.includes(t))).size*2;
}
function bounded(entries:AssertionEvidenceMemory[],o:AssertionMemoryOptions){
 const seen=new Set<string>(),selected:AssertionEvidenceMemory[]=[];
 const ranked=entries.map((r,i)=>({r,i,score:relevance(r,o)})).sort((a,b)=>b.score-a.score||a.i-b.i);
 for(const {r} of ranked){
  const key=JSON.stringify([r.assetId,r.paperId,r.rqId,r.datasetId,r.block,r.start,r.end]);
  if(seen.has(key)||!validAssertionEvidenceMemory([r]))continue;seen.add(key);
  if(validAssertionEvidenceMemory([...selected,r]))selected.push(r);
 }
 return selected;
}
/** Select existing literal memories; no parsing or lookup can invent a source. */
export function selectAssertionEvidence(memory:AssertionEvidenceMemory[],options:AssertionMemoryOptions={}):AssertionEvidenceMemory[]{return bounded(memory,options);}
export function rememberAssertionEvidence(previous:AssertionEvidenceMemory[],rows:AssertionEvidenceRow[],citedIds:string[],options:AssertionMemoryOptions={}):AssertionEvidenceMemory[]{
 const cited=new Set(citedIds),next:AssertionEvidenceMemory[]=[];
 for(const row of rows){
  if(!cited.has(row.id)||!/^earthnano:[a-f0-9]{64}$/.test(row.id))continue;
  for(const e of row.excerpts||[]){
   if(typeof e.quote!=='string')continue;
   const quote=e.quote.slice(0,1200),cut=quote.length<e.quote.length;
   next.push({stage:'assertion-excerpt',assetId:row.id,...e.source,label:e.label,block:e.block,quote,start:e.start,end:e.start+quote.length,sourceLength:e.sourceLength,partial:e.partial||cut,
    recordedAt:options.recordedAt||new Date().toISOString(),...(options.sourceTurn===undefined?{}:{sourceTurn:options.sourceTurn}),excerptTruncated:cut,originalQuoteLength:e.quote.length});
  }
 }
 return bounded([...next,...previous],options);
}
export const assertionMemoryNotice='以下是此前实际提供给答复且被引用的文献资料原文窗口，不是本轮新请求MCP，也不是网页已读或完整论文。按assetId/paperId/rqId/datasetId/block/位置区别片段；partial/excerptTruncated表示仍有省略。当前未选入某段不证明以前没有，不得用另一段撤回未回查的旧事实。';
