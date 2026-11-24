import {rankEvidence} from "./evidence-ranking";
import {modelSafeText,modelSafeValue} from "./model-context-safety";

export const synthesisPromptByteLimit=192*1024;
export const synthesisTimeLimitMs=110000;
type Row=Record<string,any>&{ref:string};
export type RetainedEvidence={ref:string;identity:string;title:string;quote?:string;level:string;sourceGroup:string;quality:number;score:number;mentionsRequestedYear:boolean;relevant:boolean;pinned:boolean};
type PackOptions={question:string;matchHints?:string[];areaTerms?:string[];time?:string|null;pinnedRefs?:string[];maxBytes?:number};
const serialize=(instructions:string,payload:unknown)=>modelSafeText(instructions+"\n"+JSON.stringify(payload));
const byteLength=(value:unknown)=>Buffer.byteLength(typeof value==="string"?value:JSON.stringify(value));
export function utf8Prefix(value:string,bytes:number){
  if(Buffer.byteLength(value)<=bytes)return value;
  let lo=0,hi=value.length;
  while(lo<hi){const middle=Math.ceil((lo+hi)/2);if(Buffer.byteLength(value.slice(0,middle))<=bytes)lo=middle;else hi=middle-1;}
  if(lo>0&&/[\uD800-\uDBFF]/u.test(value[lo-1]))lo--;
  return value.slice(0,lo);
}

/** Literal source windows only; a selected window remains partial, not a coverage assertion. */
function window(text:string,queries:string[],limit:number){
  if(Buffer.byteLength(text)<=limit)return {text,start:0,end:text.length,partial:false};
  const chunks:Array<{text:string;start:number}>=[];let start=0;
  for(const part of text.split(/(?<=\n)/u)){
    for(let from=0;from<part.length;from+=500)chunks.push({text:part.slice(from,from+700),start:start+from});
    start+=part.length;
  }
  const best=rankEvidence(chunks,queries,()=>"",entry=>entry.text)[0];
  const from=best?.rank.score?best.item.start:0,selected=utf8Prefix(text.slice(from),limit);
  return {text:selected,start:from,end:from+selected.length,partial:true};
}
const excerptKeys=new Set(["quote","excerpt","pageExcerpt"]);
const literalKeys=new Set(["ref","id","url","dsKey","paperId","rqId","datasetId","assetId","block","readAt","version","unit","units","sourceChannel","stage","previousRead","sourceChars","sourceTextChars","sourceExcerptLength"]);
function compact(value:any,key:string,quota:number,queries:string[],depth=0):any{
  if(value===null||value===undefined||typeof value==="number"||typeof value==="boolean")return value;
  if(typeof value==="string")return literalKeys.has(key)?value:utf8Prefix(value,excerptKeys.has(key)?quota:key==="title"||key==="paper"?480:400);
  if(Array.isArray(value)){
    const cap=key==="excerpts"||key==="historicalExcerpts"?3:key==="currentAssertionReadings"?3:key==="metadata"?8:key==="researchPaths"?1:4;
    const entries=key==="excerpts"||key==="historicalExcerpts"?rankEvidence(value,queries,e=>e.label||"",e=>e.quote||"").map(entry=>entry.item):value;
    return entries.slice(0,cap).map(item=>compact(item,key,quota,queries,depth+1));
  }
  if(typeof value!=="object"||depth>9)return undefined;
  const result:Record<string,any>={};
  for(const [field,item] of Object.entries(value)){
    if(["paperUsage","samples","researchCombinations","evidenceLinks"].includes(field))continue;
    result[field]=compact(item,field,quota,queries,depth+1);
  }
  if(typeof value.quote==="string"&&result.quote!==value.quote){
    result.partial=true;
    if(Number.isFinite(value.start))result.end=value.start+result.quote.length;
    if(result.source&&Number.isFinite(value.source?.start))result.source={...result.source,end:value.source.start+result.quote.length};
  }
  if(typeof value.pageExcerpt==="string"){
    const selected=window(value.pageExcerpt,queries,quota);result.pageExcerpt=selected.text;
    if(selected.partial){result.excerptTruncated=true;result.sourceExcerptLength=value.sourceExcerptLength??value.pageExcerpt.length;
      result.excerptWindow={start:selected.start,end:selected.end,sourceChars:value.pageExcerpt.length,partial:true};}
  }
  if(Array.isArray(value.steps)&&result.steps?.length<value.steps.length||Array.isArray(value.members)&&result.members?.length<value.members.length)result.complete=false;
  return result;
}
function identity(row:Row){
  return Object.fromEntries(["ref","id","title","source","sourceChannel","sourceKinds","url","paper","dsKey","stage","previousRead","readAt"].filter(key=>row[key]!==undefined).map(key=>[key,row[key]]));
}
function core(payload:Record<string,any>){
  const clone={...payload};delete clone.catalogue;delete clone.webResults;delete clone.sourceReadComparisons;
  clone.history=payload.history?.slice(-3).map((entry:any)=>({...entry,text:utf8Prefix(entry.text||"",650)}));
  if(payload.workspace){
    const view=payload.workspace.workspaceView,active=view?.activeLayer;
    clone.workspace={...payload.workspace,citation:payload.workspace.citation?{...payload.workspace.citation,body:utf8Prefix(payload.workspace.citation.body||"",1800),partial:true}:undefined,
      ...(view?{workspaceView:{...view,activeLayer:active?{...active,controls:active.controls?.map(({options:_,...control}:any)=>control)}:undefined}}:{})};
  }
  if(payload.turnContext)clone.turnContext={...payload.turnContext,history:payload.turnContext.history?.map(({assistantText:_,...entry}:any)=>entry)};
  clone.documentedDataAccessLinks=payload.documentedDataAccessLinks?.slice(0,24);
  return clone;
}

export function packSynthesisContext(instructions:string,input:Record<string,any>,options:PackOptions){
  const payload=modelSafeValue(input),original=serialize(instructions,payload);
  const requested=options.maxBytes??synthesisPromptByteLimit;
  const limit=Number.isFinite(requested)?Math.min(synthesisPromptByteLimit,requested):synthesisPromptByteLimit;
  const rows:Row[]=[...(payload.catalogue||[]),...(payload.webResults||[])],pinned=new Set(options.pinnedRefs||[]);
  const queries=[options.question,payload.researchIntent?.task,...(options.matchHints||[])].filter((value):value is string=>typeof value==="string"&&!!value);
  const ranked=rankEvidence(rows,queries,row=>row.title||"",row=>JSON.stringify(row),row=>pinned.has(row.ref));
  const normalize=(text:string)=>text.normalize("NFKD").replace(/\p{M}/gu,"").toLowerCase().replace(/[^\p{L}\p{N}]+/gu," ").trim();
  const requestedArea=[...new Set((options.areaTerms||[]).map(normalize).filter(Boolean))];
  // These are existing supplied region aliases used only to rank literal text;
  // a rarer alias must not suppress another correctly matching spelling.
  const area=requestedArea;
  const doi=(value:unknown)=>typeof value==="string"?value.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i,"").replace(/^doi:/i,"").trim().toLowerCase():"";
  const relation=(row:Row,kind:string)=>Array.isArray(row.relatedIdentifiers)?row.relatedIdentifiers
    .filter((entry:any)=>entry.relationType===kind&&entry.relatedIdentifierType==="DOI").map((entry:any)=>doi(entry.relatedIdentifier)):[];
  function sourceIdentity(row:Row):string{
    if(row.id)return "asset:"+row.id;
    const own=doi(row.doi);
    if(!own)return "web:"+row.url+"@"+(row.version||"");
    const children=[...new Set(relation(row,"HasVersion"))];
    // Fold a concept landing page only into its one explicitly linked version
    // present here, with a reciprocal relation. Never merge distinct versions.
    if(children.length===1){
      const versions=rows.filter(other=>doi(other.doi)===children[0]&&relation(other,"IsVersionOf").includes(own));
      if(versions.length&&new Set(versions.map(other=>other.version||"")).size===1)return "doi:"+children[0]+"@"+(versions[0].version||"");
    }
    return "doi:"+own+"@"+(row.version||"");
  }
  const years=(options.time||"").match(/(?:19|20)\d{2}/g)?.map(Number)||[];
  const earliest=Math.min(...years),latest=Math.max(...years);
  const retained=ranked.map(({item,rank}):RetainedEvidence=>{
    // Retrieval provenance may repeat the requested region even for an unrelated result.
    // Match literal source fields and supplied excerpts, never the enclosing search receipt.
    const sourceExcerpts=[...(item.currentAssertionReadings||[]).flatMap((entry:any)=>entry.excerpts||[]),
      ...(item.excerpts||[]),...(item.historicalExcerpts||[])];
    const sourceText=[item.title,item.snippet,item.pageExcerpt,item.coverage,item.summary,item.study,item.paper,
      ...sourceExcerpts.map((entry:any)=>entry.quote)].filter(value=>typeof value==="string").join("\n");
    const content=normalize(sourceText);
    const areaMatched=!requestedArea.length||area.some(name=>content.includes(name));
    const snippet=typeof item.pageExcerpt!=="string"||!item.pageExcerpt||item.stage==="search-snippet";
    const quote=!snippet?window(item.pageExcerpt,queries,1600).text:typeof item.snippet==="string"?window(item.snippet,queries,650).text:
      sourceExcerpts.find((entry:any)=>typeof entry.quote==="string")?.quote;
    return {ref:item.ref,identity:sourceIdentity(item),title:item.title||"已取得来源",quote:quote?utf8Prefix(quote,!snippet?1600:650):undefined,
      level:typeof item.snippet==="string"&&snippet?"仅检索摘要，未读正文":typeof item.pageExcerpt==="string"?(item.previousRead?"历史已读片段":item.stage==="abstract"?"已读摘要":item.stage==="pdf-excerpt"?"已读PDF片段":"已读网页或元数据片段"):quote?(item.sourceChannel==="assertion"?"文献资料已提供片段":"目录资料已提供片段"):"目录身份",
      sourceGroup:item.sourceChannel||(!item.id?"web":"catalogue"),
      quality:!snippet?2:typeof item.snippet==="string"?0:1,score:rank.score,
      mentionsRequestedYear:!!years.length&&[item.title,item.snippet,item.pageExcerpt].filter(Boolean).join(" ").match(/(?:19|20)\d{2}/g)?.some(year=>+year>=earliest&&+year<=latest)||false,
      relevant:rank.score>0&&areaMatched,pinned:rank.pinned};
  });
  const stats=(selected:Row[],prompt:string,partial:boolean)=>({originalPromptBytes:byteLength(original),promptBytes:byteLength(prompt),limitBytes:limit,partial,
    considered:rows.length,included:selected.length,omitted:rows.length-selected.length,includedRefs:selected.map(row=>row.ref),instructionsBytes:Buffer.byteLength(instructions)});
  if(byteLength(original)<=limit)return {prompt:original,payload,allowedRefs:new Set(rows.map(row=>row.ref)),retained,stats:stats(rows,original,false),blocked:false};
  const chosen:Row[]=[],add=(row:Row)=>{if(!chosen.some(item=>item.ref===row.ref))chosen.push(row);};
  ranked.filter(entry=>entry.rank.pinned).forEach(entry=>add(entry.item));
  const localWeb=retained.filter(entry=>entry.relevant&&entry.sourceGroup==="web").sort((a,b)=>Number(b.mentionsRequestedYear)-Number(a.mentionsRequestedYear)||b.quality-a.quality||b.score-a.score||(b.quote?.length||0)-(a.quote?.length||0));
  for(const entry of localWeb)if(!chosen.some(row=>sourceIdentity(row)===entry.identity)){
    add(rows.find(row=>row.ref===entry.ref)!);if(chosen.filter(row=>!row.id).length>=2)break;
  }
  const dominated=(row:Row)=>!pinned.has(row.ref)&&retained.some(other=>other.ref!==row.ref&&other.identity===sourceIdentity(row)&&
    (other.quality>(retained.find(entry=>entry.ref===row.ref)?.quality??-1)));
  const groups=new Set<string>();
  for(const entry of ranked){const group=entry.item.sourceChannel||("pageExcerpt" in entry.item||entry.item.url&&!entry.item.id?"web":"catalogue");
    if(entry.rank.score>0&&!dominated(entry.item)&&!groups.has(group)){groups.add(group);add(entry.item);}}
  for(const entry of ranked)if(chosen.length<8&&entry.rank.score>0&&!dominated(entry.item))add(entry.item);
  if(!chosen.length)ranked.slice(0,3).forEach(entry=>add(entry.item));
  const selectedRefs=new Set(chosen.map(row=>row.ref)),base=core(payload);
  let packed:Record<string,any>=base,prompt="";
  for(const quota of [2600,1600,900,450,180,0]){
    const views=chosen.map(row=>({...identity(row),...(quota?compact(row,"",!row.id&&row.pageExcerpt&&row.stage!=="search-snippet"&&retained.find(entry=>entry.ref===row.ref)?.relevant?Math.max(1800,quota):quota,queries):{}),
      contextBudget:{partial:true,notice:"仅为原材料的有界窗口；未装入不等于不存在，目录身份不证明目标覆盖或原文件已读。"}}));
    packed={...base,catalogue:views.filter(row=>payload.catalogue?.some((item:Row)=>item.ref===row.ref)),
      webResults:views.filter(row=>payload.webResults?.some((item:Row)=>item.ref===row.ref)),
      sourceReadComparisons:(payload.sourceReadComparisons||[]).filter((entry:any)=>selectedRefs.has(entry.ref)).map((entry:any)=>({...entry,
        omittedHistory:entry.omittedHistory+Math.max(0,entry.history.length-2),
        history:entry.history.slice(0,2).map((old:any)=>({...old,excerpt:utf8Prefix(old.excerpt,Math.max(450,quota)),truncated:old.truncated||Buffer.byteLength(old.excerpt)>Math.max(450,quota)})),
        current:entry.current.slice(0,2).map((now:any)=>({...now,excerpt:utf8Prefix(now.excerpt,Math.max(450,quota)),truncated:now.truncated||Buffer.byteLength(now.excerpt)>Math.max(450,quota)}))})),
      contextBudget:{partial:true,omittedSources:rows.length-chosen.length,notice:"保留原目的/条件与可核身份。节选不完整时仅给有限结论；不得将省略、目录关键词或部分时空相交当作完整适用性证据。"}};
    prompt=serialize(instructions,packed);if(byteLength(prompt)<=limit)break;
  }
  const blocked=byteLength(prompt)>limit;
  return {prompt:blocked?"":prompt,payload:packed,allowedRefs:selectedRefs,retained:retained.filter(row=>selectedRefs.has(row.ref)),
    stats:{...stats(chosen,blocked?"":prompt,true),...(blocked?{rejectedPromptBytes:byteLength(prompt)}:{})},blocked};
}

/** One original answer deadline shared by generation, repair and calculation planning. */
export function answerTimeBudget(parent:AbortSignal,requestedMs=synthesisTimeLimitMs){
  const milliseconds=Math.max(1,Math.min(synthesisTimeLimitMs,requestedMs)),controller=new AbortController(),deadline=Date.now()+milliseconds;
  const timer=setTimeout(()=>controller.abort(Error("回答整理已达到本轮预算，已停止后续模型调用。")),milliseconds);
  const signal=AbortSignal.any([parent,controller.signal]);
  return {signal,remainingMs:()=>Math.max(0,deadline-Date.now()),close:()=>clearTimeout(timer),
    async run<T>(operation:(signal:AbortSignal)=>Promise<T>):Promise<T>{
      signal.throwIfAborted();let stop:()=>void=()=>{};
      try{return await Promise.race([operation(signal),new Promise<never>((_,reject)=>{stop=()=>reject(signal.reason);signal.addEventListener("abort",stop,{once:true});if(signal.aborted)stop();})]);}
      finally{signal.removeEventListener("abort",stop);}
    }};
}
