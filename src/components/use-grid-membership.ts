import {useEffect,useState} from "react";
import {catalogRevision} from "../domain/datasets";
import type {CandidateSet,Filters,Selection} from "../domain/types";
import type {CoverageResponse} from "../domain/coverage";
import {coverageBatchKey} from "../domain/coverage";
type Membership={members:ReadonlySet<string>;referenceIds:string[]};
const cache=new Map<string,Membership>();
export function useGridMembership(enabled:boolean,selection:Selection,filters:Filters,batch?:CandidateSet|null,includeReferences=false,publicationRevision?:string) {
  const key=JSON.stringify([includeReferences,publicationRevision??(includeReferences?"references":catalogRevision()),selection.grid.key,selection.id,filters,coverageBatchKey(batch)]);
  const [result,setResult]=useState<{key:string;membership:Membership|null;error:string}>({key:"",membership:null,error:""});
  const [retry,setRetry]=useState(0);
  const membership=cache.get(key) || (result.key===key?result.membership:null);
  useEffect(()=>{
    if(!enabled || cache.has(key))return;
    const controller=new AbortController();
    let timer:ReturnType<typeof setTimeout>|undefined,scope:string|undefined,revision:string|undefined;
    setResult({key,membership:null,error:""});
    async function post(path:string,body:unknown) {
      const response=await fetch("/api/coverage/"+path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body),signal:controller.signal});
      if(!response.ok){if(response.status===404 || response.status===410)scope=undefined;throw Error("格内定位关系暂时无法读取，请重试。");}
      return response.json();
    }
    async function read() {
      try{
        if(!scope){
          const issued=await post("scopes",{filters,batch});
          scope=issued.id;revision=issued.revision;
        }
        const data:CoverageResponse=await post("cells",{id:scope,revision,grid:selection.grid,cells:[selection.id],includeProducts:true,
          ...(includeReferences?{includeReferences:true}:{})});
        if(controller.signal.aborted)return;
        if(!Array.isArray(data.ready)||!Array.isArray(data.cells)||!Number.isSafeInteger(data.pending))throw Error("格内定位关系返回格式有误，请重试。");
        if(!data.ready.includes(selection.id)){
          if(data.pending<=0)throw Error("格内定位关系尚未核实，请重试。");
          timer=setTimeout(()=>void read(),120);return;
        }
        const row=data.members?.find(([cell])=>cell===selection.id);
        const count=new Map(data.cells).get(selection.id)||0;
        if(!row || !Array.isArray(row[1]) || !row[1].every(v=>typeof v==="string") || new Set(row[1]).size!==count)throw Error("格内定位名单与计数不一致，请重试。");
        const references=includeReferences?data.references?.find(([cell])=>cell===selection.id)?.[1]:[];
        if(!Array.isArray(references) || references.some(ref=>!Array.isArray(ref[1]) || !ref[1].every(id=>typeof id==="string")))
          throw Error("格内来源名单暂时无法核对，请重试。");
        const loaded={members:new Set(row[1]),referenceIds:[...new Set(references.flatMap(([,ids])=>ids))]};
        cache.set(key,loaded);
        if(cache.size>16)cache.delete(cache.keys().next().value!);
        setResult({key,membership:loaded,error:""});
      }catch(error){if(!controller.signal.aborted)setResult({key,membership:null,error:error instanceof Error?error.message:"格内定位关系暂时无法读取。"});}
    }
    void read();
    return ()=>{controller.abort();clearTimeout(timer);};
  },[enabled,key,retry]);
  return {members:membership?.members??null,referenceIds:membership?.referenceIds,error:result.key===key?result.error:"",retry:()=>setRetry(n=>n+1)};
}
