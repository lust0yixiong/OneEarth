/** Literal source windows; missing excerpts never establish absence in the full source. */
export type EvidenceScope={dsKey?:string;paperId?:string;rqId?:string;datasetId?:string;language?:string;region?:string;role?:string};
export type TextTab={kind?:string;label:string;quote?:string;source?:EvidenceScope};
export type EvidenceExcerpt={label:string;block?:string;quote:string;start:number;end:number;sourceLength:number;partial:boolean;source:EvidenceScope&{page:number;pageKind:"tab-index";label:string;block?:string;start:number;end:number}};

/** Resolve ownership only from an exact source-title join to explicit identities.
 * Multiple RQs/instances retain the unique paper but do not pick an arbitrary RQ.
 * Titles absent from the structured owners stay unknown, rather than inheriting
 * the first paper of a multi-paper product record. */
export function scopeSourceTabs(tabs:TextTab[],owners:Array<{paperId:string;paperTitle:string;rqId?:string;datasetId?:string}>,base:EvidenceScope={}) {
 return tabs.map(tab=>{
  if(tab.kind!=="text")return tab;
  const title=tab.label.replace(/^原文\s*[·:]\s*/,"").trim();
  const matches=owners.filter(o=>o.paperTitle.trim()===title);
  const unique=(key:"paperId"|"rqId"|"datasetId")=>{const values=[...new Set(matches.map(o=>o[key]).filter((x):x is string=>!!x))];return values.length===1?values[0]:undefined;};
  // Base may contain dataset identity/role, never an assumed paper/RQ identity.
  const {paperId:_,rqId:__,...common}=base;
  return {...tab,source:{...common,...(matches.length?{paperId:unique("paperId"),rqId:unique("rqId"),datasetId:unique("datasetId")||common.datasetId}:{}),...tab.source}};
 });
}

const segmenter=new Intl.Segmenter('zh',{granularity:'word'});
const concepts:[RegExp,string[]][]=[
 [/实测|直接|测量|估算|估计|推导|派生|反演|输入/,['measured','observed','estimated','estimate','derived','inferred','only','downward','upward']],
 [/误差|不确定|限制|假设|精度|校准/,['uncertainty','uncertain','error','accuracy','calibration','assumed','assumption','however','only','invalid']],
 [/亲缘|性状|树形|拓扑|系统发育/,['phylogenetic','character','sister','topological','topologies','matrix','supported']],
 [/数值|点估计|系数|比例|百分|比值|增长|降低|复算|重算|\d\s*[%％]/,['coefficient','ratio','percent','percentage','raw','running mean','moving average','point estimate','slope','increase','decrease']],
 [/滑动|移动平均|平滑|聚合/,['running mean','moving average','smoothed','raw time series']],
 [/量纲|单位/,['unit','units','per','degree','concentration']],
];
function terms(query:string){
 const s=query.toLowerCase().normalize('NFKC');
 return [...new Set([...segmenter.segment(s)].filter(p=>p.isWordLike&&p.segment.length>1).map(p=>p.segment)
  .concat(concepts.flatMap(([re,words])=>re.test(s)?words:[])))];
}
const quantitativeQuestion=/(?:[+-]?\d+\.\d+|\d\s*[%％]|数值|点估计|系数|比例|百分|比值|量纲|单位|复算|重算)/;
function quotedTerms(query:string){
 return [...query.matchAll(/[“"「]([^”"」]{8,160})[”"」]/g)].map(m=>m[1].toLowerCase());
}
export function sourceExcerpts(tabs:TextTab[],query:string,budget=2600,focusQuery=query,scope:EvidenceScope={}){
 const pages=tabs.map((t,index)=>({...t,page:index})).filter(t=>t.kind==='text'&&t.quote?.trim());
 const focusKeywords=[...new Set([...terms(focusQuery),...quotedTerms(focusQuery)])];
 const keywords=[...new Set([...terms(query),...focusKeywords])];
 const requestedBlocks=new Set((focusQuery.match(/\bB\d{3,6}\b/gi)||[]).map(id=>id.toUpperCase()));
 const numericFocus=quantitativeQuestion.test(focusQuery);
 const windows:Array<EvidenceExcerpt&{score:number;page:number;order:number;blockId:number}>=[];
 const maxWindow=Math.min(1500,Math.max(200,Math.floor(budget/Math.max(1,pages.length))));
 let blockId=0,totalChars=0;
 for(const tab of pages){
  const text=tab.quote!;totalChars+=text.length;
  for(const m of text.matchAll(/[^\n](?:[\s\S]*?)(?=\n\s*\n|$)/g)){
   const raw=m[0],offset=m.index||0,heading=/^(B\d+\s*[·:]\s*[^\n]*)\n/.exec(raw),bodyOffset=heading?.[0].length||0;
   const starts=new Set([0]);
   if(raw.length>maxWindow){
    starts.add(raw.length-maxWindow);
    // Inspect all bounded keyword occurrences, rather than anchoring on the first 'measured'.
    const low=raw.toLowerCase();
    for(const term of [...keywords,'however','estimated','only','except']){
     let from=bodyOffset;
     for(let n=0;n<20;n++){
      const at=low.indexOf(term,from);if(at<0)break;from=at+Math.max(1,term.length);
      starts.add(Math.max(0,Math.min(raw.length-maxWindow,at-Math.floor(maxWindow*.35))));
     }
    }
   }
   for(const start of starts){
    const end=Math.min(raw.length,start+maxWindow),quote=raw.slice(start,end);
    const content=(start===0?quote.slice(bodyOffset):quote).toLowerCase();
    const matched=keywords.filter(t=>content.includes(t)),focused=focusKeywords.filter(t=>content.includes(t));
    // A current numeric/quotation follow-up is more specific than its broader
    // conversation context. Keep literal evidence, not a recomputed claim.
    const blockRequested=!!heading && requestedBlocks.has(heading[1].split(/\s/)[0].toUpperCase());
    const numericValues=numericFocus?new Set(content.match(/(?<![\w.])[+-]?\d+\.\d+(?:e[+-]?\d+)?(?![\w.])/g)||[]):new Set();
    const numericComparison=numericValues.size>1 && /\b(raw|running|moving|versus|compared|increase|decrease|ratio|coefficient|slope)\b/.test(content);
    const score=matched.length*.6+focused.length*2+matched.filter(t=>/^[a-z].*[a-z]$/.test(t)&&!['only','however'].includes(t)).length*.25
     +Number(/\b(however|estimated|except|only|uncertain|assumed)\b/.test(content))*.4
     +Number(blockRequested)*30+(numericFocus?Math.min(4,numericValues.size)*.5+Number(numericComparison)*2:0);
    windows.push({label:tab.label,block:heading?.[1],quote,start:offset+start,end:offset+end,sourceLength:text.length,
     partial:start>0||end<raw.length,source:{...scope,...tab.source,page:tab.page,pageKind:"tab-index",label:tab.label,block:heading?.[1],start:offset+start,end:offset+end},score,page:tab.page,order:offset,blockId});
   }
   blockId++;
  }
 }
 const ranked=[...windows].sort((a,b)=>b.score-a.score||a.page-b.page||a.order-b.order||a.start-b.start);
 const selected:typeof windows=[],seen=new Set<string>();let used=0;
 const add=(w:typeof windows[number])=>{
  const identity=JSON.stringify([w.source.paperId,w.source.rqId,w.source.datasetId,w.page,w.start,w.end]);
  if(seen.has(identity)||used+w.quote.length>budget)return false;
  if(selected.some(x=>x.page===w.page&&x.blockId===w.blockId&&Math.max(0,Math.min(x.end,w.end)-Math.max(x.start,w.start))>Math.min(x.quote.length,w.quote.length)*.6))return false;
  selected.push(w);seen.add(identity);used+=w.quote.length;return true;
 };
 for(const page of [...new Set(ranked.map(w=>w.page))]){const best=ranked.find(w=>w.page===page);if(best)add(best);}
 for(const w of ranked)add(w);
 const included=new Set(selected.map(w=>w.page)),selectedBlocks=new Set(selected.map(w=>w.blockId));
 return {excerpts:selected.sort((a,b)=>a.page-b.page||a.start-b.start).map(({score:_,page:__,order:___,blockId:____,...x})=>x),
  sourceTextChars:totalChars,includedChars:used,omittedBlocks:blockId-selectedBlocks.size,
  omittedPages:pages.filter(p=>!included.has(p.page)).map(p=>({label:p.label,page:p.page})),
  notice:'source.page是输入tabs的零基索引(pageKind=tab-index)，不是PDF印刷页码。source中的paperId/rqId/datasetId为显式归属，缺省不推断；跨论文/项目不得移植年份、地域、验证角色或语言。以下为有出处与位置的原文节选；未选入的内容不能视为不存在。partial 为真表示该原文段仍有省略；不同片段不可当作连续原文。'};
}
