import {taskIdPattern,type ConversationHistoryTurn,type TaskStatus} from "./task-store";
import {modelSafeValue} from "./model-context-safety";
import {rankEvidence} from "./evidence-ranking";

export type HistoryTurn=ConversationHistoryTurn;
export const conversationTokenLimit=8000;
/** Cross-provider estimate, not a native tokenizer: CJK=1, ASCII alphanumeric
 * runs=ceil(chars/4), ASCII punctuation=1, whitespace runs=ceil(chars/4),
 * other Unicode=ceil(UTF-8 bytes/2). Includes all JSON keys and delimiters. */
export function estimatedHistoryTokens(value:unknown):number{
 const text=(typeof value==="string"?value:JSON.stringify(value))||"";let total=0;
 for(const match of text.matchAll(/[A-Za-z0-9]+|\s+|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|[^\sA-Za-z0-9]/gu)){
  const part=match[0];total+=/^[A-Za-z0-9\s]+$/.test(part)?Math.ceil(part.length/4):/^[\x00-\x7f]$/.test(part)?1:/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]$/u.test(part)?1:Math.ceil(Buffer.byteLength(part)/2);
 }return total;
}
export type HistorySelection={taskId:string;turnId:string|null;blockIds:string[]};
export type HistoryBlock={id:string;role:"user"|"assistant";text:string;start:number;end:number};
export type HistorySummary={taskId:string;turnId:string|null;blockIds:string[];text:string};
type StoredTurn=HistoryTurn&{order:number;blocks:HistoryBlock[]};
export type ConversationProjection={source:"same-conversation-server";turns:Array<{order:number;taskId:string;turnId?:string;submittedAt:number;taskState:TaskStatus;observationRestricted:boolean;references:HistoryTurn["references"];blocks:HistoryBlock[];complete:boolean}>;
 index:Array<{order:number;taskId:string;turnId?:string;submittedAt:number;taskState:TaskStatus;blockIds:string[];blocks:{id:string;role:string;start:number;end:number;kind:"paragraph"|"table";estimatedTokens:number}[];question?:string;observationRestricted:boolean;referenceCount:number;blockCount?:number;partial?:true;references:HistoryTurn["references"];omittedReferences:number}>;
 summaryStatus?:string;
 summaries:Array<HistorySummary&{kind:"model-summary";complete:false}>;
 readback?:{state:"loaded"|"partial"|"unavailable";requested:HistorySelection[];reason?:string};
 budget:{estimatedTokens:number;limit:8000;utf8Bytes:number;method:string;omittedTurns:number;omittedBlocks:number;indexComplete:boolean};notice:string};
const method="CJK=1; ASCII alphanumeric/whitespace runs=ceil(chars/4); ASCII punctuation=1; other Unicode=ceil(UTF8/2); JSON included; approximate, not provider tokenizer";
const notice="仅服务端本会话已受理的问答。旧答复是说过的内容，不是检索/读取/计算/地图操作回执；引用仍是当轮来源及证据层，不冒充本轮新取得。缺块和摘要不证明原档没有；block位置属于已脱敏会话文本，不是论文或文件原文。观测受限轮仅占位。";
function blocks(text:string,role:HistoryBlock["role"]):HistoryBlock[]{
 let offset=0,index=0;return text.split(/(\r?\n[ \t]*\r?\n)/u).flatMap((part,i)=>{const start=offset;offset+=part.length;return i%2||!part.trim()?[]:[{id:(role==="user"?"q":"a")+(++index),role,text:part,start,end:offset}];});
}
const closed=(properties:Record<string,unknown>)=>({type:"object",additionalProperties:false,required:Object.keys(properties),properties});
const selections={type:"array",minItems:1,maxItems:3,items:closed({taskId:{type:"string"},turnId:{type:["string","null"]},blockIds:{type:"array",maxItems:64,items:{type:"string"}}})};
export const historySummarySchema=closed({summaries:{type:"array",maxItems:16,items:closed({taskId:{type:"string"},turnId:{type:["string","null"]},blockIds:{type:"array",minItems:1,maxItems:64,items:{type:"string"}},text:{type:"string",maxLength:2000}})}});
export const historyReadSchema=closed({kind:{type:"string",enum:["history-read"]},selections});
export function historyReadSelections(raw:string):HistorySelection[]|undefined{
 const value=JSON.parse(raw.trim().replace(/^```(?:json)?\s*|\s*```$/gi,""));if(value?.decide?.kind!=="history-read")return;
 const d=value.decide;
 if(Object.keys(d).length!==2||!Array.isArray(d.selections)||!d.selections.length||d.selections.length>3)throw Error("旧轮查阅需要一至三个确切的同会话选择。");
 for(const s of d.selections)if(!s||typeof s!=="object"||Object.keys(s).length!==3||!taskIdPattern.test(s.taskId)||
  !(s.turnId===null||typeof s.turnId==="string")||!Array.isArray(s.blockIds)||s.blockIds.length>64||!s.blockIds.every((id:unknown)=>typeof id==="string"&&/^[qa][1-9]\d*$/.test(id))||new Set(s.blockIds).size!==s.blockIds.length)
  throw Error("旧轮查阅只接受已列任务/轮次/段块身份，不接受URL或任意内容。");
 if(new Set(d.selections.map((s:HistorySelection)=>s.taskId)).size!==d.selections.length)throw Error("同一次旧轮查阅不能重复任务。");return d.selections;
}
export class RuntimeConversationHistory{
 readonly turns:StoredTurn[];
 private selectedTaskIds=new Set<string>();
 private originalReferences=new Map<string,HistoryTurn["references"]>();
 summaries:HistorySummary[]=[];
 private summarySources=new Map<string,Set<string>>();
 constructor(rows:HistoryTurn[],currentTaskId:string){
  for(const row of rows)if(row&&!row.observationRestricted&&!row.references?.some(ref=>ref.kind==="asset"&&ref.evidenceLevel==="observation-file")&&row.taskId!==currentTaskId&&taskIdPattern.test(row.taskId))this.originalReferences.set(row.taskId,row.references);
  const seen=new Set<string>();this.turns=rows.filter(row=>row&&taskIdPattern.test(row.taskId)&&row.taskId!==currentTaskId&&!seen.has(row.taskId)&&!!seen.add(row.taskId)&&Number.isFinite(row.submittedAt)&&typeof row.question==="string")
   .map((row,order)=>{
    const safe=modelSafeValue(row.observationRestricted||row.references?.some(ref=>ref.kind==="asset"&&ref.evidenceLevel==="observation-file")?{taskId:row.taskId,turnId:row.turnId,submittedAt:row.submittedAt,taskState:row.taskState,question:"此前观测轮由独立授权路径管理，本历史区未提供正文和出处。",observationRestricted:true}:row);
    return {...safe,order,blocks:[...blocks(safe.question,"user"),...blocks(safe.assistantText||"","assistant")]};
   });
 }
 sourceTargets(question:string){
  const ranked=rankEvidence(this.turns.filter(turn=>!turn.observationRestricted),[question],turn=>turn.question,turn=>turn.assistantText||"");
  return [...ranked.filter(({item})=>this.selectedTaskIds.has(item.taskId)),...ranked.filter(({item})=>!this.selectedTaskIds.has(item.taskId))].flatMap(({item})=>(this.originalReferences.get(item.taskId)||[]).map(reference=>({reference,taskId:item.taskId,turnId:item.turnId}))).slice(0,32);
 }
 private project(limit:number,selections?:HistorySelection[]):ConversationProjection{
  const selected=new Map<string,Set<string>>(),requested=selections||[],missing:string[]=selections&&!selections.length?["旧轮查阅请求格式无效"]:[];
  for(const s of requested){const turn=this.turns.find(turn=>turn.taskId===s.taskId);if(!turn||s.turnId!==null&&s.turnId!==turn.turnId||turn.observationRestricted){missing.push("原轮不存在、受限或轮次不符");continue;}
   if(s.blockIds.some(id=>!turn.blocks.some(block=>block.id===id))){missing.push("原轮没有该段块");continue;}
   selected.set(s.taskId,new Set(s.blockIds.length?s.blockIds:turn.blocks.map(b=>b.id)));
  }
  const result:ConversationProjection={source:"same-conversation-server",turns:[],index:[],summaries:[],...(selections?{readback:{state:missing.length?"unavailable":"loaded",requested, ...(missing.length?{reason:[...new Set(missing)].join("；")}: {})}}:{}),
   budget:{estimatedTokens:0,limit:8000,utf8Bytes:0,method,omittedTurns:0,omittedBlocks:0,indexComplete:true},notice};
  const measure=()=>{for(let i=0;i<3;i++){result.budget.estimatedTokens=estimatedHistoryTokens(result);result.budget.utf8Bytes=Buffer.byteLength(JSON.stringify(result));}return estimatedHistoryTokens(result);};
  const fits=()=>measure()<=Math.max(0,limit);
  const full=this.turns.map(turn=>({order:turn.order,taskId:turn.taskId,turnId:turn.turnId,submittedAt:turn.submittedAt,taskState:turn.taskState,observationRestricted:turn.observationRestricted,references:turn.references||[],blocks:turn.blocks,complete:true}));
  const allFit=estimatedHistoryTokens({...result,turns:full})+40<=limit;
  const recent=this.turns.slice(-3),desired=Math.min(1600,Math.max(500,estimatedHistoryTokens(this.summaries)+Math.min(900,this.turns.length*90)));
  const recentCost=estimatedHistoryTokens({...result,turns:full.slice(-3)});
  const reserve=allFit?0:recentCost<=limit-desired?desired:recentCost<=limit-300?Math.max(250,limit-recentCost-32):Math.min(800,desired);
  const compactRecent=recent.filter(turn=>estimatedHistoryTokens(turn.blocks)<=(limit-reserve)/3),largeRecent=recent.filter(turn=>!compactRecent.includes(turn));
  const priority=[...this.turns.filter(turn=>selected.has(turn.taskId)),...(allFit?[...recent].reverse():[...compactRecent].reverse().concat([...largeRecent].reverse())),...(allFit?this.turns.slice(0,-3).reverse():[])];
  const included=new Set<string>();
  for(const turn of priority){if(included.has(turn.taskId))continue;included.add(turn.taskId);
   const row={order:turn.order,taskId:turn.taskId,turnId:turn.turnId,submittedAt:turn.submittedAt,taskState:turn.taskState,observationRestricted:turn.observationRestricted,references:turn.references||[],blocks:[] as HistoryBlock[],complete:false};
   result.turns.push(row);if(!fits()){result.turns.pop();continue;}
   const wanted=selected.get(turn.taskId);
   for(const block of turn.blocks){if(wanted&&!wanted.has(block.id))continue;row.blocks.push(block);if(measure()>limit-(selected.has(turn.taskId)?0:reserve))row.blocks.pop();}
   row.complete=row.blocks.length===turn.blocks.length;
   if(!row.blocks.length){result.turns.pop();included.delete(turn.taskId);}
  }
  result.turns.sort((a,b)=>a.order-b.order);
  // Recent raw turns first, then actual semantic summaries and origin indices.
  for(const summary of this.summaries){result.summaries.push({...summary,kind:"model-summary",complete:false});if(!fits())result.summaries.pop();}
  for(const turn of this.turns){if(result.turns.some(row=>row.taskId===turn.taskId&&row.complete))continue;
   const entry={order:turn.order,taskId:turn.taskId,turnId:turn.turnId,submittedAt:turn.submittedAt,taskState:turn.taskState,blockIds:turn.blocks.map(block=>block.id),
    blocks:turn.blocks.map(block=>({id:block.id,role:block.role,start:block.start,end:block.end,kind:/^\s*\|[^\n]*\|/m.test(block.text)?"table" as const:"paragraph" as const,estimatedTokens:estimatedHistoryTokens(block.text)})),
    references:turn.references?.slice(0,8)||[],omittedReferences:Math.max(0,(turn.references?.length||0)-8),
    ...(estimatedHistoryTokens(turn.question)<=120?{question:turn.question}:{}),observationRestricted:turn.observationRestricted,referenceCount:turn.references?.length||0};
   result.index.push(entry);if(!fits()){
      result.index.pop();result.budget.indexComplete=false;
      const light={...entry,question:undefined,blocks:entry.blocks.slice(0,8),blockIds:entry.blockIds.slice(0,8),blockCount:entry.blocks.length,partial:true as const,references:[],omittedReferences:entry.referenceCount};
      result.index.push(light);if(!fits())result.index.pop();
    }
  }
  // Only remaining capacity can restore older literal blocks after origins and summaries.
  for(const turn of this.turns.slice(0,-3)){
    if(result.turns.some(row=>row.taskId===turn.taskId))continue;
    const row={order:turn.order,taskId:turn.taskId,turnId:turn.turnId,submittedAt:turn.submittedAt,taskState:turn.taskState,observationRestricted:turn.observationRestricted,references:turn.references||[],blocks:[] as HistoryBlock[],complete:false};
    result.turns.push(row);if(!fits()){result.turns.pop();continue;}
    for(const block of turn.blocks){row.blocks.push(block);if(!fits())row.blocks.pop();}
    row.complete=row.blocks.length===turn.blocks.length;if(!row.blocks.length)result.turns.pop();
    if(row.complete){result.index=result.index.filter(old=>old.taskId!==turn.taskId);result.summaries=result.summaries.filter(summary=>summary.taskId!==turn.taskId);}
  }
  result.turns.sort((a,b)=>a.order-b.order);
  const known=new Map(result.turns.map(turn=>[turn.taskId,turn]));result.budget.omittedTurns=this.turns.filter(turn=>!known.get(turn.taskId)?.complete).length;
  result.budget.omittedBlocks=this.turns.reduce((n,turn)=>n+turn.blocks.length-(known.get(turn.taskId)?.blocks.length||0),0);
  if(selections&&!missing.length&&requested.some(s=>{const old=this.turns.find(turn=>turn.taskId===s.taskId)!;return (s.blockIds.length?s.blockIds:old.blocks.map(b=>b.id)).some(id=>!known.get(s.taskId)?.blocks.some(b=>b.id===id));}))result.readback={state:"partial",requested,reason:"请求的整段或整表超过本次历史预算；没有裁断段/表，未装入部分保持未知。"};
  measure();while(!fits()&&result.index.length)result.index.pop();while(!fits()&&result.summaries.length)result.summaries.pop();while(!fits()&&result.turns.length)result.turns.shift();measure();
  if(!fits())throw Error("历史区的必要状态超过本次可用估算预算，未向模型发送超限历史。");return result;
 }
 projection(limit=conversationTokenLimit){return this.project(limit);}
 read(selections:HistorySelection[],limit=conversationTokenLimit){
  this.selectedTaskIds=new Set(selections.filter(s=>this.turns.some(turn=>turn.taskId===s.taskId&&!turn.observationRestricted&&(s.turnId===null||s.turnId===turn.turnId)&&s.blockIds.every(id=>turn.blocks.some(block=>block.id===id)))).map(s=>s.taskId));
  return this.project(limit,selections);
 }
 summaryInput(question:string,limit=5000){
  const recent=new Set(this.turns.slice(-3).map(turn=>turn.taskId)),rows=this.turns.filter(turn=>!recent.has(turn.taskId)&&!turn.observationRestricted);
  const selected:Array<{taskId:string;turnId:string|null;blocks:HistoryBlock[];references:HistoryTurn["references"]}>=[];this.summarySources.clear();
  const ranked=rankEvidence(rows,[question],row=>row.question,row=>row.assistantText||"");
  for(const {item} of ranked){const row={taskId:item.taskId,turnId:item.turnId??null,blocks:[] as HistoryBlock[],references:item.references||[]};selected.push(row);
   for(const block of item.blocks){row.blocks.push(block);if(estimatedHistoryTokens(selected)>limit)row.blocks.pop();}
   if(!row.blocks.length)selected.pop();else this.summarySources.set(row.taskId,new Set(row.blocks.map(b=>b.id)));
  }return selected;
 }
 acceptSummary(raw:string){
  const value=JSON.parse(raw.trim().replace(/^```(?:json)?\s*|\s*```$/gi,""));if(!Array.isArray(value?.summaries)||value.summaries.length>16)throw Error("历史摘要结构无效。");
  const accepted:HistorySummary[]=[],seen=new Set<string>();
  for(const s of value.summaries){const turn=this.turns.find(turn=>turn.taskId===s?.taskId),allowed=this.summarySources.get(s?.taskId);
   if(!turn||turn.observationRestricted||s.turnId!==(turn.turnId??null)||seen.has(s.taskId)||!allowed||!Array.isArray(s.blockIds)||!s.blockIds.length||
    !s.blockIds.every((id:string)=>allowed.has(id))||typeof s.text!=="string"||!s.text.trim()||s.text.length>2000)throw Error("历史摘要未绑定实际提供的原轮段块。");
   seen.add(s.taskId);accepted.push(modelSafeValue({taskId:s.taskId,turnId:s.turnId,blockIds:s.blockIds,text:s.text}));
  }this.summaries=accepted;
 }
}
