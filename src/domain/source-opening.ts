export interface SourceOpening {
  url:string;
  disposition:"preview"|"external";
}

const cache=new Map<string,{at:number;value:SourceOpening}>();
const pending=new Map<string,Promise<SourceOpening>>();
let active=0;
const queue:(()=>void)[]=[];
const keyFor=(url:string)=>{const key=new URL(url);key.hash="";return key.href;};

export function knownSourceOpening(url:string) {
  const record=cache.get(keyFor(url));
  return record && Date.now()-record.at<600000?record.value:undefined;
}

export function prepareSourceOpening(raw:string):Promise<SourceOpening> {
  const url=keyFor(raw),known=knownSourceOpening(url);
  if(known)return Promise.resolve(known);
  if(pending.has(url))return pending.get(url)!;
  const task=(async()=>{
    if(active>=3)await new Promise<void>(resolve=>queue.push(resolve));
    active++;
    try{
      const response=await fetch("/api/source-preview/check",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({url}),signal:AbortSignal.timeout(8000)});
      const value=await response.json();
      if(!response.ok || !value || !["preview","external"].includes(value.disposition))throw Error("检查尚未完成");
      const result:SourceOpening={url,disposition:value.disposition};
      cache.set(url,{at:Date.now(),value:result});
      if(cache.size>256)cache.delete(cache.keys().next().value!);
      return result;
    }catch{
      // An unconfirmed destination keeps its ordinary external-link action.
      return {url,disposition:"external" as const};
    }finally{active--;queue.shift()?.();pending.delete(url);}
  })();
  pending.set(url,task);
  return task;
}
