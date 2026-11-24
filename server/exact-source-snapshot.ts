import type {SourceResponse} from "./source-fetch";
import {publicPage} from "./fetch-pages";
import {researchPdfByteBudget} from "./pdf-ranges";

type Snapshot = {response:SourceResponse;cacheStoredAt:string};
export type ExactSourceSnapshot = {get():Snapshot|undefined;keep(response:SourceResponse):void};
const ttlMs=90_000, maxBytes=16*1024*1024, maxOriginEntry=4*1024*1024;
const entries=new Map<string,Snapshot>();
let bytes=0;
function forget(key:string){
  const old=entries.get(key);
  if(old){bytes-=old.response.bytes.length;entries.delete(key);}
}

/** Only the runtime's already authorized exact-source claims may obtain a task-local cache handle. */
export function exactSourceSnapshot(researchTaskId:string|undefined,rawUrl:string,format:"origin"|"pdf"):ExactSourceSnapshot|undefined {
  const url=publicPage(rawUrl);
  if(!researchTaskId||!url)return;
  const key=researchTaskId+"\0"+format+"\0"+url;
  const maxEntry=format==="pdf"?researchPdfByteBudget:maxOriginEntry;
  return {
    get(){
      const entry=entries.get(key);
      if(!entry)return;
      if(Date.now()-Date.parse(entry.cacheStoredAt)>=ttlMs){forget(key);return;}
      entries.delete(key);entries.set(key,entry);
      return entry;
    },
    keep(response){
      if(response.truncated||response.bytes.length===0||response.bytes.length>maxEntry)return;
      forget(key);
      const cacheStoredAt=new Date().toISOString();
      entries.set(key,{response,cacheStoredAt});bytes+=response.bytes.length;
      while(entries.size>32||bytes>maxBytes)forget(entries.keys().next().value!);
    },
  };
}
