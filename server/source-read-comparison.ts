import type {DiscoveryResponse,ReadEvidence,SearchRun,WebHit,AnswerReference} from "../src/domain/types";
import {SourceReadClaimError} from "./source-read-provenance";

export type SourceReadHistory={record?:DiscoveryResponse;searches?:SearchRun[]};
type Window={id:string;url:string;stage:string;readAt:string|null;origin:string;excerpt:string;sourceChars:number;truncated:boolean;pageMarkers:string[]};
export type SourceReadComparison={ref:string;identity:string;history:Window[];current:Window[];omittedHistory:number;
  difference:{kind:"literal-text-only";currentTextSeenBefore:boolean;historyTextPresentNow:boolean;notice:string}};
export type SourceChangeAssessment={ref:string;statement:string;status:"already_known"|"reverified"|"added_in_supplied_material"|"unknown";
  historyWindow:string|null;historyQuote:string|null;currentWindow:string|null;currentQuote:string|null};
const normalized=(text:string)=>text.normalize("NFKC").replace(/(?<=\p{L})\s*-\s*(?=\p{L})/gu,"-").replace(/\s+/g," ").trim().toLowerCase();
const includes=(text:string,quote:string)=>!!normalized(quote)&&normalized(text).includes(normalized(quote));
/** Only PDF page fragments share a document identity. Queries/versions and web app hash routes stay distinct. */
export function readSourceIdentity(raw:string,stage?:string){
  try{const url=new URL(raw);if((stage==="pdf-excerpt"||/\.pdf(?:\/content)?$/i.test(url.pathname))&&/^#page=\d+$/i.test(url.hash))url.hash="";return url.href;}
  catch{return raw;}
}
type Reading=Pick<WebHit,"url"|"pageExcerpt"|"stage"|"readAt"|"previousExcerptTruncated"|"previousSourceExcerptLength">;
function window(hit:Reading,origin:string):Omit<Window,"id">|undefined{
  if(!hit.pageExcerpt?.trim()||hit.stage==="search-snippet")return;
  const excerpt=hit.pageExcerpt.slice(0,16000);
  let hash="";try{hash=new URL(hit.url).hash;}catch{}
  return {url:hit.url,stage:hit.stage||"unknown",readAt:hit.readAt||null,origin,excerpt,sourceChars:hit.previousSourceExcerptLength??hit.pageExcerpt.length,truncated:!!hit.previousExcerptTruncated||excerpt.length<hit.pageExcerpt.length,
    pageMarkers:[...new Set([...(hit.pageExcerpt.match(/\[PDF[^\]\n]{0,150}\]/g)||[]),...(hash.match(/^#page=\d+$/i)||[])])].slice(0,16)};
}
export function compareSourceReadings(hits:WebHit[],sourceHistory:SourceReadHistory={},memories:ReadEvidence[]=[],offset=0):SourceReadComparison[]{
  const prior:Array<Omit<Window,"id">>=[];
  const add=(hit:Reading,origin:string)=>{const saved=window(hit,origin);if(saved)prior.push(saved);};
  for(const hit of sourceHistory.record?.answerNotes?.webSources||[])add(hit,"parent.answerNotes.webSources");
  for(const run of [...(sourceHistory.record?.answerNotes?.searches||[]),...(sourceHistory.record?.runTrace?.searches||[]),...(sourceHistory.searches||[])]){
    if(run.status==="done")for(const hit of run.hits)add(hit,"parent.acquired-searches");
  }
  for(const read of sourceHistory.record?.conversationEvidence||[])add({url:read.url,pageExcerpt:read.excerpt,stage:read.stage,readAt:read.readAt,previousExcerptTruncated:read.excerptTruncated,previousSourceExcerptLength:read.sourceExcerptLength},"parent.conversationEvidence");
  for(const read of memories)add({url:read.url,pageExcerpt:read.excerpt,stage:read.stage,readAt:read.readAt,previousExcerptTruncated:read.excerptTruncated,previousSourceExcerptLength:read.sourceExcerptLength},"conversation-memory");
  return hits.flatMap((hit,index)=>{
    const current=window(hit,"current-acquired-excerpt");if(!current||hit.previousRead)return [];
    const identity=readSourceIdentity(hit.url,hit.stage),seen=new Set<string>();
    const matched=prior.filter(old=>readSourceIdentity(old.url,old.stage)===identity).sort((a,b)=>b.sourceChars-a.sourceChars);
    const unique=matched.filter(old=>{const key=normalized(old.excerpt);if(seen.has(key))return false;seen.add(key);return true;});
    if(!unique.length)return [];
    const history=unique.slice(0,3).map((old,i)=>({...old,id:"H"+(i+1)}));
    return [{ref:"S"+(offset+index+1),identity,history,current:[{...current,id:"C1"}],omittedHistory:Math.max(0,unique.length-history.length),difference:{kind:"literal-text-only" as const,
      currentTextSeenBefore:history.some(old=>includes(old.excerpt,current.excerpt)),historyTextPresentNow:history.some(old=>includes(current.excerpt,old.excerpt)),
      notice:"字面相同/不同只比较这里实际提供的新旧窗口，不判断语义新增。重读是执行事实，不证明任何事实首次补齐；旧档较长节选优先，未提供、裁短或不同采样位置不能证明过去没有该信息。按具体事实判断已有、重新核实、相对所给旧档新增或未知。"}}];
  });
}

export const sourceChangeSchema={type:"array",maxItems:12,items:{type:"object",additionalProperties:false,
  required:["ref","statement","status","historyWindow","historyQuote","currentWindow","currentQuote"],properties:{
    ref:{type:"string",pattern:"^S[1-9][0-9]*$"},statement:{type:"string",minLength:1,maxLength:1200},
    status:{type:"string",enum:["already_known","reverified","added_in_supplied_material","unknown"]},
    historyWindow:{type:["string","null"],maxLength:40},historyQuote:{type:["string","null"],maxLength:2400},
    currentWindow:{type:["string","null"],maxLength:40},currentQuote:{type:["string","null"],maxLength:2400},
  }}};
export function parseSourceChanges(value:unknown):SourceChangeAssessment[]|undefined{
  if(value===undefined)return;
  if(!Array.isArray(value)||value.length>12||!value.every(v=>v&&/^S[1-9]\d*$/.test(v.ref)&&typeof v.statement==="string"&&v.statement.trim()&&v.statement.length<=1200&&
    ["already_known","reverified","added_in_supplied_material","unknown"].includes(v.status)&&
    [v.historyWindow,v.currentWindow].every(x=>x===null||typeof x==="string"&&x.length>0&&x.length<=40)&&
    [v.historyQuote,v.currentQuote].every(x=>x===null||typeof x==="string"&&x.trim().length>0&&x.length<=2400)))
    throw new SourceReadClaimError("新旧材料判断缺少有效的来源、原句或状态。");
  return value;
}
export function validateSourceChanges(answer:{message:string;limitation:string;followUp:string;references:AnswerReference[];sourceChanges?:SourceChangeAssessment[]},comparisons:SourceReadComparison[]){
  const text=[answer.message,answer.limitation,answer.followUp].join("\n"),changes=answer.sourceChanges||[];
  for(const comparison of comparisons){
    if(!answer.references.some(ref=>ref.kind==="web"&&readSourceIdentity(ref.url)===comparison.identity))continue;
    const assessed=changes.filter(change=>change.ref===comparison.ref);
    if(!assessed.length)throw new SourceReadClaimError("同一来源存在历史与本轮重读窗口；请在原合成中用sourceChanges对实际采用的事实给出已有、重新核实、新增或未知判断，并保留相应出处，不能把重读自动当成事实首次补齐。");
    for(const change of assessed){
      if(!text.includes(change.statement))throw new SourceReadClaimError("新旧材料判断必须对应答复实际陈述。");
      const old=comparison.history.find(v=>v.id===change.historyWindow),current=comparison.current.find(v=>v.id===change.currentWindow);
      if(change.historyQuote!==null&&(!old||!includes(old.excerpt,change.historyQuote))||change.currentQuote!==null&&(!current||!includes(current.excerpt,change.currentQuote)))
        throw new SourceReadClaimError("新旧材料判断的引句不在所绑定的实际窗口内。");
      if(["already_known","reverified"].includes(change.status)&&(!old||!change.historyQuote))throw new SourceReadClaimError("已有或重新核实的判断需要对应历史窗口的实际依据。");
      if(["reverified","added_in_supplied_material"].includes(change.status)&&(!current||!change.currentQuote))throw new SourceReadClaimError("本轮核实或新增的判断需要本轮实际取得的窗口依据。");
      if(change.status==="added_in_supplied_material"&&comparison.history.some(v=>includes(v.excerpt,change.currentQuote!)))
        throw new SourceReadClaimError("来源"+comparison.ref+"的本轮引文已存在于提供的历史窗口中，不能把这条旧事实说成首次补齐。请对照原新旧材料判断重新核实或差别未知。");
      if(change.status==="added_in_supplied_material"&&(comparison.omittedHistory>0||!comparison.history.some(v=>!v.truncated&&v.origin.startsWith("parent."))))
        throw new SourceReadClaimError("历史材料仍有未提供或裁短的窗口，不能仅据当前缺见判断事实新增；请保留已有材料并说明差别未知。");
    }
  }
}
export const sourceChangeInstructions="sourceReadComparisons按同一URL/原PDF身份保留历史与本轮重读窗口；历史较长档案优先，保留读层/时间/原页码，不用重读时间覆盖旧取得时间。逐条按实际采用的事实判断already_known、reverified、added_in_supplied_material或unknown；字面不同、采样页变化、当前首次出现或工具成功都不证明事实新增。声称新增须有具体本轮事实及与所给旧档可核对的差别，仅限定相对当前可见归档；历史缺页/截断/语义差别不确定用unknown，不强行判新增。同一来源旧档已有的事实应称已有或本轮重新核实。凡引用sourceReadComparisons的来源，在原答复JSON增加sourceChanges数组，每项ref用原S编号，statement为答复实际陈述的一段不含引用编号的原话；historyWindow/currentWindow用H/C窗口ID，引句仅用其实际文字（允许换行空格差异），缺省为null。不能新增查询或另发模型分类。";
