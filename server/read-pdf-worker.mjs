// Parse untrusted PDF material outside the request thread. The parent owns all network I/O.
import {parentPort,workerData} from 'node:worker_threads';
import {getDocument, PDFDataRangeTransport} from 'pdfjs-dist/legacy/build/pdf.mjs';

class RemoteRanges extends PDFDataRangeTransport {
  requestDataRange(begin,end){parentPort.postMessage({range:[begin,end]});}
}
/** Pure selection over already extracted pages: no network, no additional pages, no inferred text. */
export function pdfTextWindows(text,focusTerms=[],terms=[],titleTerms=[]){
  const width=700,maxWindows=2,limit=128;
  const focus=new Set(focusTerms),title=new Set(titleTerms),weights=new Map();
  for(const term of title)weights.set(term,.1);
  for(const term of terms)weights.set(term,title.has(term)?.2:1.5);
  for(const term of focus)weights.set(term,6);
  const occurrences=[];
  for(const [term,weight] of weights){
    if(!term||term.length<3)continue;
    const escaped=term.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    const pattern=new RegExp('(?<![a-z0-9])'+escaped+'(?=$|[^a-z0-9])','gi');
    const matches=[...text.matchAll(pattern)];
    // Bound work while retaining late occurrences; do not spend all slots on a title/header.
    const stride=Math.max(1,Math.ceil(matches.length/64));
    for(let i=0;i<matches.length;i+=stride)occurrences.push({at:matches[i].index,length:matches[i][0].length,term,weight});
    if(matches.length)occurrences.push({at:matches.at(-1).index,length:matches.at(-1)[0].length,term,weight});
  }
  const headings=[...text.matchAll(/\b(?:materials(?: and methods?)?|methods?|ground truth(?: data)?|field measurements?|data collection|sampling|appendi(?:x|ces)|annex(?:es)?)\b/gi)].map(m=>m.index);
  const positions=[...new Set([0,Math.max(0,text.length-width),...occurrences.map(m=>Math.max(0,m.at-120)),...headings.map(i=>Math.max(0,i-30))])].sort((a,b)=>a-b);
  const sampled=positions.length<=limit?positions:Array.from({length:limit},(_,i)=>positions[Math.round(i*(positions.length-1)/(limit-1))]);
  const candidates=sampled.map(start=>{
    const end=Math.min(text.length,start+width),seen=new Set();let score=0,focusDistance=0,focusCount=0;
    for(const hit of occurrences)if(hit.at>=start&&hit.at+hit.length<=end){const key=hit.term;if(!seen.has(key)){score+=hit.weight;seen.add(key);if(focus.has(key)){focusDistance+=Math.abs(hit.at+hit.length/2-(start+end)/2);focusCount++;}}}
    if(score>1&&headings.some(i=>i>=start&&i<end))score+=1;
    return {start,end,score,focusDistance:focusCount?focusDistance/focusCount:Infinity,text:text.slice(start,end)};
  }).sort((a,b)=>b.score-a.score||a.focusDistance-b.focusDistance||a.start-b.start);
  const selected=[];
  for(const candidate of candidates){
    if(selected.some(w=>candidate.start<w.end&&candidate.end>w.start))continue;
    selected.push(candidate);if(selected.length===maxWindows)break;
  }
  return selected.sort((a,b)=>a.start-b.start);
}

if(parentPort) {
try {
  const {first,size,chunkSize,terms,focusTerms=terms,titleTerms=[],targetPages=[],outlineQuery=''}=workerData;
  const ranges=new RemoteRanges(size,first);
  parentPort.on('message',({begin,bytes})=>ranges.onDataRange(begin,bytes));
  const source=first.length===size?{data:first}:{range:ranges,length:size,rangeChunkSize:chunkSize};
  const task=getDocument({...source,disableAutoFetch:true,disableStream:true,useSystemFonts:false,isEvalSupported:false,verbosity:0});
  const doc=await task.promise;
  const bookmarkTargets=[];let outlineStatus='no-outline';
  try{
    const outline=await doc.getOutline();
    if(outline?.length){
      outlineStatus='no-matching-destination';
      const keys=new Map();
      for(const term of terms)keys.set(term,1);
      for(const term of focusTerms)keys.set(term,4);
      const aliases=[];
      if(/附录|附表/.test(outlineQuery))aliases.push('appendix','appendices','annex','annexes');
      if(/问卷|调查|提纲|样表|记录表/.test(outlineQuery))aliases.push('questionnaire','survey','forms','form','interview');
      if(/方法|采样|测量/.test(outlineQuery))aliases.push('methods','method','measurements','sampling');
      for(const term of aliases)keys.set(term,3);
      const pending=outline.slice(0,160).map(node=>({node,depth:0})),matches=[];let examined=0;
      while(pending.length&&examined++<160){
        const {node,depth}=pending.shift();
        const title=String(node.title||'').slice(0,240).toLowerCase();
        const score=[...keys].reduce((sum,[term,weight])=>{
          const escaped=term.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
          return sum+(term.length>=3&&new RegExp('(?<![a-z0-9])'+escaped+'(?=$|[^a-z0-9])','i').test(title)?weight:0);
        },0);
        if(score>0&&node.dest)matches.push({node,score});
        if(depth<6&&Array.isArray(node.items))pending.push(...node.items.slice(0,Math.max(0,160-pending.length)).map(child=>({node:child,depth:depth+1})));
      }
      for(const {node} of matches.sort((a,b)=>b.score-a.score).slice(0,8)){
        try{
          const dest=typeof node.dest==='string'?await doc.getDestination(node.dest):node.dest;
          if(!Array.isArray(dest)||!dest.length)continue;
          const index=typeof dest[0]==='number'?dest[0]:await doc.getPageIndex(dest[0]);
          if(!Number.isInteger(index)||index<0||index>=doc.numPages||bookmarkTargets.some(t=>t.pageNo===index+1))continue;
          bookmarkTargets.push({pageNo:index+1,title:String(node.title||'').slice(0,160)});
          if(bookmarkTargets.length===2)break;
        }catch{/* A malformed/external destination never becomes a guessed page number. */}
      }
      if(bookmarkTargets.length)outlineStatus='matched';
    }
  }catch{outlineStatus='outline-read-incomplete';}
  const bookmarkPages=bookmarkTargets.map(t=>t.pageNo);
  const candidates=[],checkedPages=[];
  function excerpt(){
    return candidates.slice().sort((a,b)=>b.score-a.score||a.pageNo-b.pageNo)
      .slice(0,3).sort((a,b)=>a.pageNo-b.pageNo)
      .map(p=>p.windows.map((w,i)=>'[PDF 第 '+p.pageNo+' 页；文本字符 '+(w.start+1)+'–'+w.end+'；局部片段 '+(i+1)+'] '+w.text).join('\n')).join('\n\n')+'\n[检查范围] 实际提取过文本的物理页码 '+checkedPages.join(', ')+'；文档共 '+doc.numPages+' 页。只摘录最多3页的局部文本；未输出的页不表示无相关信息。\n[书签定位] '+JSON.stringify({status:outlineStatus,targets:bookmarkTargets})+'；书签仅定位，不代表目标正文已读；实际提取页见检查范围。无匹配书签不推测印刷页偏移。';
  }
  const pages=[...new Set([...targetPages.filter(n=>n<=doc.numPages),...bookmarkPages,...Array.from({length:Math.min(4,doc.numPages)},(_,i)=>i+1)])].slice(0,8);
  for(const pageNo of pages){
    const page=await doc.getPage(pageNo);
    const content=await page.getTextContent();
    checkedPages.push(pageNo);
    const text=content.items.map(i=>i.str||'').join(' ').replace(/\s+/g,' ').trim();
    page.cleanup();
    if(text.length<60)continue;
    const windows=pdfTextWindows(text,focusTerms,terms,titleTerms);
    const score=(targetPages.includes(pageNo)||bookmarkPages.includes(pageNo)?100:0)+windows.reduce((sum,w)=>sum+w.score,0);
    candidates.push({pageNo,windows,score});
    parentPort.postMessage({partial:excerpt()});
  }
  if(!candidates.length)throw Error('已检查的 PDF 页未提取到可用文本。');
  parentPort.postMessage({excerpt:excerpt()});
} catch(error){parentPort.postMessage({error:error.message});}

}
