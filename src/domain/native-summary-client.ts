import {EventType,type BaseEvent} from "@ag-ui/core";
import {isNativeAgUiSummaryId} from "./native-agui-summary";
import type {ProviderReasoningSnapshot,RunTrace} from "./types";

// Match the server's public summary limits, including UTF-8 byte counts.
const snapshotLimit=12;
const textByteLimit=8192;
const encoder=new TextEncoder();

function validText(text:unknown):text is string {
  return typeof text==="string" && text.length<=textByteLimit && !!text.trim() &&
    encoder.encode(text).length<=textByteLimit;
}

function snapshot(id:string,text:string):ProviderReasoningSnapshot {
  return {id,kind:"summary",text,revision:1,complete:true};
}

export function nativeSummaryReader(runId:string) {
  const seen=new Set<string>();
  let group:{id:string;next:EventType;text:string}|undefined;
  return (event:BaseEvent):ProviderReasoningSnapshot|undefined=>{
    const id="messageId" in event ? event.messageId : undefined;
    const previous=group;
    group=undefined;
    if(typeof id!=="string" || !isNativeAgUiSummaryId(runId,id) || event.rawEvent!==undefined ||
      ("subagentRunId" in event && event.subagentRunId!==undefined))return;
    if(event.type===EventType.REASONING_START){
      if(seen.size<snapshotLimit && !seen.has(id))group={id,next:EventType.REASONING_MESSAGE_START,text:""};
      return;
    }
    if(previous?.id!==id || (previous.next!==event.type &&
      !(previous.next===EventType.REASONING_MESSAGE_CONTENT && event.type===EventType.REASONING_MESSAGE_END)))return;
    switch(event.type){
      case EventType.REASONING_MESSAGE_START:
        if("role" in event && event.role==="reasoning"){
          group={...previous,next:EventType.REASONING_MESSAGE_CONTENT};
        }
        break;
      case EventType.REASONING_MESSAGE_CONTENT:
        if("delta" in event && typeof event.delta==="string" && event.delta.length<=textByteLimit){
          const text=previous.text+event.delta;
          if(text.length<=textByteLimit && encoder.encode(text).length<=textByteLimit)group={...previous,text};
        }
        break;
      case EventType.REASONING_MESSAGE_END:
        if(validText(previous.text))group={...previous,next:EventType.REASONING_END};
        break;
      case EventType.REASONING_END:
        seen.add(id);
        return snapshot(id,previous.text);
    }
    return;
  };
}

const archivePrefix=(runId:string)=>"archived-summary:"+runId+":";

export function archivedNativeSummaries(runId:string,value:unknown):ProviderReasoningSnapshot[] {
  if(!Array.isArray(value))return [];
  const summaries:ProviderReasoningSnapshot[]=[];
  const seen=new Set<string>();
  for(const candidate of value.slice(0,snapshotLimit)){
    if(!candidate || typeof candidate!=="object" || Array.isArray(candidate))continue;
    const {id,kind,revision,text,complete,truncated}=candidate as Record<string,unknown>;
    if(kind!=="summary" || complete!==true || (truncated!==undefined && truncated!==false) ||
      typeof id!=="string" || !id.startsWith(runId+":") || id.length>160 ||
      typeof revision!=="number" || !Number.isInteger(revision) || revision<1 || revision>24 || !validText(text) || seen.has(id) ||
      Object.keys(candidate).some(key=>!["id","kind","revision","text","complete","truncated"].includes(key)))continue;
    seen.add(id);
    summaries.push(snapshot(archivePrefix(runId)+summaries.length,text));
  }
  return summaries;
}

export function savedNativeSummaries(runId:string,trace?:RunTrace) {
  const reasoning=trace?.providerReasoning;
  if(!Array.isArray(reasoning))return [];
  return reasoning.slice(0,snapshotLimit).filter(item=>
    item?.kind==="summary" && item.complete===true && !item.truncated && validText(item.text) &&
    typeof item.id==="string" && (isNativeAgUiSummaryId(runId,item.id) || item.id.startsWith(archivePrefix(runId))));
}

export function needsArchivedRunProcess(runId:string,trace?:RunTrace) {
  return !trace || (!trace.stages?.length && !trace.calls?.length &&
    !savedNativeSummaries(runId,trace).some(item=>item.id.startsWith(archivePrefix(runId))));
}

/** Archives and wire use different IDs. Reconcile exact text by occurrence and keep the original order. */
export function mergeNativeRunProcess(runId:string,current?:RunTrace,source?:RunTrace):RunTrace|undefined {
  if(!current || !source)return current ?? source;
  const existing=savedNativeSummaries(runId,current);
  const incoming=savedNativeSummaries(runId,source);
  const matched=new Set<number>();
  const reasoning=existing.map(item=>{
    const index=incoming.findIndex((candidate,index)=>!matched.has(index) && candidate.text===item.text);
    if(index<0)return item;
    matched.add(index);
    const match=incoming[index];
    return !item.id.startsWith(archivePrefix(runId)) && match.id.startsWith(archivePrefix(runId)) ? match : item;
  });
  for(const [index,item] of incoming.entries()){
    if(!matched.has(index) && !reasoning.some(existing=>existing.id===item.id) && reasoning.length<snapshotLimit)reasoning.push(item);
  }
  const stages=!current.stages?.length && source.stages?.length ? source.stages : current.stages;
  const calls=!current.calls?.length && source.calls?.length ? source.calls : current.calls;
  if(stages===current.stages && calls===current.calls &&
    reasoning.length===(current.providerReasoning?.length ?? 0) && reasoning.every((item,i)=>item===current.providerReasoning?.[i]))return current;
  return {...current,stages,calls,providerReasoning:reasoning.length ? reasoning : undefined};
}
