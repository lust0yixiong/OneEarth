import type {AnswerReference,Message} from "./types";

const limit=24;
const byteLimit=16*1024;
function jsonBytes(value:unknown) {
  try{return new TextEncoder().encode(JSON.stringify(value)).length;}catch{return Infinity;}
}
function validUrl(value:unknown):value is string {
  if(typeof value!=="string" || value.length>2000)return false;
  try{const url=new URL(value);return /^https?:$/.test(url.protocol)&&!url.username&&!url.password;}catch{return false;}
}
export function validConversationReferences(value:unknown):value is AnswerReference[] {
  return Array.isArray(value)&&value.length<=limit&&jsonBytes(value)<=byteLimit&&value.every(ref=>ref&&
    typeof ref.title==="string"&&!!ref.title.trim()&&ref.title.length<=360&&
    (ref.referenceType===undefined||["data","paper","web"].includes(ref.referenceType))&&
    (ref.sourceChannel===undefined||["local","assertion","web"].includes(ref.sourceChannel))&&
    (ref.kind!=="web"||ref.sourceChannel===undefined||ref.sourceChannel==="web")&&
    (ref.kind==="web"?validUrl(ref.url):ref.kind==="asset"&&typeof ref.id==="string"&&
      !!ref.id&&ref.id.length<=500&&typeof ref.source==="string"&&ref.source.length<=300));
}

// These identities do not establish that a page or file has been read.
// Successful reading is kept separately in conversationEvidence.
export function rememberConversationReferences(previous:AnswerReference[],references:AnswerReference[]):AnswerReference[] {
  const incoming=(Array.isArray(references)?references:[]).flatMap(ref=>{
    if(!ref||typeof ref!=="object"||!["web","asset"].includes(ref.kind))return [];
    const title=typeof ref.title==="string"?ref.title.trim().slice(0,360):"";
    const referenceType=ref.referenceType==="data"||ref.referenceType==="paper"||ref.referenceType==="web"?ref.referenceType:undefined;
    const sourceChannel=ref.kind==="web"?"web" as const:ref.sourceChannel;
    const r=ref.kind==="web"?{kind:"web" as const,title,url:ref.url,referenceType,sourceChannel}:
      {kind:"asset" as const,title,id:ref.id,source:typeof ref.source==="string"?ref.source.slice(0,300):"",referenceType,sourceChannel};
    return validConversationReferences([r])?[r]:[];
  });
  const seen=new Set<string>();
  let bytes=2;
  return [...incoming.reverse(),...previous].filter(ref=>{
    if(!validConversationReferences([ref]))return false;
    const key=ref.kind==="asset"?"asset:"+ref.id:"web:"+ref.url;
    if(seen.has(key))return false;
    const cost=jsonBytes(ref)+1;if(bytes+cost>byteLimit)return false;
    seen.add(key);bytes+=cost;return true;
  }).slice(0,limit);
}
function entryLinks(text:string):AnswerReference[] {
  const prose=text.replace(/```[\s\S]*?```|`[^`\n]*`/g,"");
  const pattern=/\[([^\]\n]+)\]\((https?:\/\/)/g,links:AnswerReference[]=[];
  for(const match of prose.matchAll(pattern)){
    if(prose[match.index!-1]==="!")continue;
    const start=match.index!+match[0].length-match[2].length;
    let end=start,depth=1;
    for(;end<prose.length;end++){
      const char=prose[end];
      if(/\s/.test(char))break;
      if(char==="\\"&&/[()\\]/.test(prose[end+1]||"")){end++;continue;}
      if(char==="(")depth++;else if(char===")"&&!--depth)break;
    }
    if(depth===0)links.push({kind:"web",title:match[1],url:prose.slice(start,end).replace(/\\([()\\])/g,"$1")});
  }
  return links;
}
export function conversationReferenceMemory(messages:Message[]):AnswerReference[] {
  let memory:AnswerReference[]=[];
  for(const message of messages){
    if(message.role!=="assistant"||message.failed)continue;
    const links=entryLinks(message.text);
    const stored=message.answerNotes?.references;
    const references=(Array.isArray(stored)?stored:[]).filter(ref=>ref&&typeof ref==="object").map(ref=>{
      if(ref.kind!=="web")return ref;
      const link=links.find(l=>l.kind==="web"&&l.url===ref.url);
      // Keep the name used in the reply as well as a registry/search title.
      const useful=link&&link.title.length>=3&&!/^(?:原文|链接|入口|查看|下载|这里|产品入口|数据入口|here|link|download|source|pdf)$/i.test(link.title);
      return useful&&link.title!==ref.title?{...ref,title:link.title+" · "+ref.title}:ref;
    });
    memory=rememberConversationReferences(memory,[...links,...references]);
  }
  return memory;
}

/** Who actually introduced an entry is separate from its identity and reading
 * status. This records the visible message role, not an unseen global origin.
 * Message IDs survive truncated history; never derive global turns from
 * a sliced array. User mentions do not by themselves imply reading or execution. */
export type ReferenceProvenance={reference:AnswerReference;sourceMessageId?:string;sourceTurn?:number;introducedBy:"assistant"|"user";basis:"entry-link"|"reply-citation"};
export function conversationReferenceProvenance(messages:Array<{id?:string;role:"assistant"|"user";text:string;failed?:boolean;answerNotes?:{references?:AnswerReference[]}}>,sourceTurns:Record<string,number>={}):ReferenceProvenance[] {
  const entries:ReferenceProvenance[]=[];
  for(const message of messages){
    if(message.failed)continue;
    const links=entryLinks(message.text),stored=message.role==="assistant"?message.answerNotes?.references||[]:[];
    for(const ref of rememberConversationReferences([], [...links,...stored])){
      const key=ref.kind==="web"?ref.url:ref.id;
      if(entries.some(e=>e.introducedBy===message.role&&(e.reference.kind==="web"?e.reference.url:e.reference.id)===key))continue;
      const sourceTurn=message.id?sourceTurns[message.id]:undefined;
      entries.push({reference:ref,...(message.id?{sourceMessageId:message.id}:{}),introducedBy:message.role,
        ...(typeof sourceTurn==="number"&&Number.isSafeInteger(sourceTurn)&&sourceTurn>0?{sourceTurn}:{}),basis:stored.some(s=>(s.kind==="web"?s.url:s.id)===key)?"reply-citation":"entry-link"});
    }
  }
  const identities=rememberConversationReferences([],entries.map(e=>e.reference));
  return entries.filter(e=>identities.some(r=>r.kind===e.reference.kind&&(r.kind==="web"?r.url:r.id)===(e.reference.kind==="web"?e.reference.url:e.reference.id))).slice(-24);
}
