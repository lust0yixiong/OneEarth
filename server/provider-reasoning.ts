import {StringDecoder} from "node:string_decoder";
import type {ProviderReasoningSnapshot} from "../src/domain/types";
import {modelSafeText,assertModelContextSafe} from "./model-context-safety";

export const providerReasoningLimits={textBytes:8192,rawBytes:1048576,revisions:24,snapshots:12,totalBytes:98304,frameBytes:1048576,segments:12} as const;
export type ProviderReasoningSink={taskId:string;onSnapshot:(snapshot:ProviderReasoningSnapshot)=>void};
type Segment={text:string;revision:number;complete:boolean;truncated:boolean};
type TextState={id:string;kind:ProviderReasoningSnapshot["kind"];raw:string;bytes:number;at:number;complete:boolean;capped:boolean;segments:Map<number,Segment>};
const prefix=(text:string,bytes:number)=>{let out="",size=0;for(const char of text){size+=Buffer.byteLength(char);if(size>bytes)break;out+=char;}return out;};

/** Incomplete lexical tails never leave memory: credentials and signed URLs
 * can straddle arbitrary transport and public-delta boundaries. */
function visibleText(raw:string,finished:boolean){
 let end=finished?raw.length:0;
 if(!finished)for(const match of raw.matchAll(/[\s，。；！？、（）【】]/gu))end=match.index!+match[0].length;
 let text=raw.slice(0,end);const begin=text.indexOf("-----BEGIN");
 if(begin>=0&&!/-----END (?:[A-Z ]+ )?PRIVATE KEY-----/u.test(text.slice(begin)))text=text.slice(0,begin)+(finished?"[redacted private key]":"");
 text=modelSafeText(text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu,""));
 assertModelContextSafe(text);return text;
}

/** Constant-memory structural string scanner. Display limits never disable
 * this independent tool guard, and quoted prose is not parsed as JSON fields. */
class ToolTypeGuard{
 private quoted=false;private escaped=false;private token="";private large=false;private key:string|undefined;private valueKey:string|undefined;private last:string|undefined;
 feed(text:string){
  for(const char of text){
   if(this.quoted){
    if(!this.large){this.token+=char;if(this.token.length>256){this.large=true;this.token="";}}
    if(this.escaped){this.escaped=false;continue;}
    if(char==="\\"){this.escaped=true;continue;}
    if(char==='"'){
     let value:string|undefined;try{if(!this.large)value=JSON.parse(this.token);}catch{}
     if(this.valueKey==="type"&&value&&/^(?:(?:function_call|custom_tool_call|web_search_call|tool_search_call)(?:$|_)|response\.(?:function_call|custom_tool_call|web_search_call|tool_search_call)(?:[._]|$))/u.test(value))return false;
     this.quoted=false;this.last=value;this.valueKey=undefined;
    }
   }else if(char==='"'){this.quoted=true;this.token='"';this.large=false;this.valueKey=this.key;this.key=undefined;}
   else if(char===":"){this.key=this.last;this.last=undefined;}
   else if(!/\s/u.test(char)){this.key=undefined;this.last=undefined;}
  }
  return true;
 }
}

/** Only named public text is copied; reasoning items/encrypted content,
 * output text, tool arguments, metadata and complete bodies are never stored. */
export class ProviderReasoningObserver{
 private decoder=new StringDecoder("utf8");private pending="";private skipping=false;private sequence=-1;private states=new Map<string,TextState>();private stopped=false;private guard=new ToolTypeGuard();
 constructor(private id:string,private emit:(snapshot:ProviderReasoningSnapshot)=>void){}
 feed(bytes:Buffer){
  if(this.stopped)return false;const text=this.decoder.write(bytes);
  if(!this.guard.feed(text)){this.stopped=true;return false;}
  this.pending+=text;
  for(;;){const match=/\r?\n\r?\n/u.exec(this.pending);if(!match)break;
   const frame=this.pending.slice(0,match.index);this.pending=this.pending.slice(match.index+match[0].length);
   if(!this.skipping&&Buffer.byteLength(frame)<=providerReasoningLimits.frameBytes)this.frame(frame);
   else for(const state of this.states.values())state.capped=true;
   this.skipping=false;
  }
  if(Buffer.byteLength(this.pending)>providerReasoningLimits.frameBytes){this.pending=this.pending.slice(-3);this.skipping=true;for(const state of this.states.values())state.capped=true;}
  return true;
 }
 private frame(frame:string){
  let name="";const data:string[]=[];
  for(const line of frame.split(/\r?\n/u)){if(line.startsWith("event:"))name=line.slice(6).trim();else if(line.startsWith("data:"))data.push(line.slice(5).trimStart());}
  if(!data.length)return;let event:any;try{event=JSON.parse(data.join("\n"));}catch{return;}
  const type=event?.type;if(typeof type!=="string"||name&&name!==type)return;
  if(!Number.isSafeInteger(event.sequence_number)||event.sequence_number<0||event.sequence_number<=this.sequence)return;
  this.sequence=event.sequence_number;
  const kind=type==="response.reasoning_text.delta"||type==="response.reasoning_text.done"?"deepseek-thinking":
    ["response.reasoning_summary_text.delta","response.reasoning_summary_text.done","response.reasoning_summary_part.done"].includes(type)?"summary":undefined;
  if(!kind){if(type==="response.completed")for(const state of this.states.values())this.publish(state,true);return;}
  if(typeof event.item_id!=="string"||event.item_id.length>160||!Number.isSafeInteger(event.output_index)||event.output_index<0)return;
  const part=kind==="summary"?event.summary_index:event.content_index;if(!Number.isSafeInteger(part)||part<0)return;
  const text=type.endsWith(".delta")?event.delta:type==="response.reasoning_summary_part.done"&&event.part?.type==="summary_text"?event.part.text:event.text;
  if(typeof text!=="string")return;
  const key=kind+":"+event.item_id+":"+event.output_index+":"+part;let state=this.states.get(key);
  if(!state){if(this.states.size>=2)return;state={id:this.id+":"+this.states.size,kind,raw:"",bytes:0,at:0,complete:false,capped:false,segments:new Map()};this.states.set(key,state);}
  if(state.complete)return;const done=type.endsWith(".done");
  if(done&&state.raw&&!text.startsWith(state.raw))return;
  if(!state.capped){const incoming=Buffer.byteLength(text),nextBytes=done?incoming:state.bytes+incoming;
   if(nextBytes>providerReasoningLimits.rawBytes){state.raw=prefix(done?text:state.raw+text,providerReasoningLimits.rawBytes);state.capped=true;state.bytes=providerReasoningLimits.rawBytes;}
   else {state.raw=done?text:state.raw+text;state.bytes=nextBytes;}
  }
  this.publish(state,done);
 }
 private publish(state:TextState,done:boolean){
  if(state.complete||!done&&state.at&&Date.now()-state.at<500)return;
  state.at=Date.now();let safe:string;try{safe=visibleText(state.raw,done&&!state.capped);}catch{return;}
  if(!safe)return;
  const segments:string[]=[];let part="",size=0;
  for(const char of safe){const bytes=Buffer.byteLength(char);if(size+bytes>providerReasoningLimits.textBytes){segments.push(part);part="";size=0;}part+=char;size+=bytes;}if(part)segments.push(part);
  const overflow=segments.length>providerReasoningLimits.segments;
  if(overflow)segments.splice(providerReasoningLimits.segments-1,segments.length-providerReasoningLimits.segments+1,segments.slice(providerReasoningLimits.segments-1).join(""));
  if(overflow){const tail=Array.from(segments.at(-1)!);let bytes=0,start=tail.length;while(start>0&&bytes+Buffer.byteLength(tail[start-1])<=providerReasoningLimits.textBytes)bytes+=Buffer.byteLength(tail[--start]);segments[segments.length-1]=tail.slice(start).join("");}
  for(const [index,text] of segments.entries()){
   const old=state.segments.get(index),truncated=state.capped||overflow&&index===segments.length-1,complete=done&&!truncated;
   if(old&&(text===old.text&&complete===old.complete&&truncated===old.truncated||old.revision>=providerReasoningLimits.revisions||!done&&old.revision>=providerReasoningLimits.revisions-1))continue;
   const next={text,complete,truncated,revision:(old?.revision||0)+1};state.segments.set(index,next);
   try{this.emit({id:state.id+":"+index,kind:state.kind,text,revision:next.revision,...(complete?{complete:true}:{}),...(truncated?{truncated:true}:{})});}catch{/* A display sink cannot change the response. */}
  }
  if(done)state.complete=true;
 }
 close(){this.stopped=true;this.pending="";for(const state of this.states.values())state.raw="";this.states.clear();}
}

/** The bounded display archive is never used as model history or evidence. */
export function providerReasoningArchive(taskId:string,initial:ProviderReasoningSnapshot[]=[],emit:(snapshot:ProviderReasoningSnapshot)=>void){
 const values:ProviderReasoningSnapshot[]=[];
 const accept=(snapshot:ProviderReasoningSnapshot,notify:boolean)=>{
  if(!snapshot.id.startsWith(taskId+":")||snapshot.id.length>160||!Number.isInteger(snapshot.revision)||snapshot.revision<1||snapshot.revision>providerReasoningLimits.revisions||
    !["summary","deepseek-thinking"].includes(snapshot.kind)||typeof snapshot.text!=="string"||!snapshot.text||Buffer.byteLength(snapshot.text)>providerReasoningLimits.textBytes)return;
  let index=values.findIndex(old=>old.id===snapshot.id);const old=values[index];
  if(old&&(snapshot.revision<=old.revision||old.complete||old.kind!==snapshot.kind))return;
  let text:string;try{text=modelSafeText(snapshot.text);assertModelContextSafe(text);}catch{return;}
  let evicted=false;
  while(index<0&&values.length>=providerReasoningLimits.snapshots||values.reduce((sum,item)=>sum+Buffer.byteLength(item.text),0)-(old?Buffer.byteLength(old.text):0)+Buffer.byteLength(text)>providerReasoningLimits.totalBytes){
   const at=values.findIndex(item=>item.id!==snapshot.id);if(at<0)return;values.splice(at,1);index=values.findIndex(item=>item.id===snapshot.id);evicted=true;
  }
  const truncated=snapshot.truncated||evicted||old?.truncated;
  const next={id:snapshot.id,revision:snapshot.revision,kind:snapshot.kind,text,...(snapshot.complete===true&&!truncated?{complete:true}:{}),...(truncated?{truncated:true}:{})};
  if(index<0)values.push(next);else values[index]=next;if(notify)emit(next);
 };
 for(const snapshot of initial)accept(snapshot,false);
 return {values,accept:(snapshot:ProviderReasoningSnapshot)=>accept(snapshot,true)};
}
