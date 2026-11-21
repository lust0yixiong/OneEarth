import {useEffect,useState} from "react";
import {catalogRevision} from "../domain/datasets";
import type {CandidateSet,Filters,Selection} from "../domain/types";
import type {CoverageResponse} from "../domain/coverage";
import {coverageBatchKey} from "../domain/coverage";
const cache=new Map<string,ReadonlySet<string>>();
export function useGridMembership(enabled:boolean,selection:Selection,filters:Filters,batch?:CandidateSet|null) {
  const key=JSON.stringify([catalogRevision(),selection.grid.key,selection.id,filters,coverageBatchKey(batch)]);
  const [result,setResult]=useState<{key:string;members:ReadonlySet<string>|null;error:string}>({key:"",members:null,error:""});
  const [retry,setRetry]=useState(0);
  const members=cache.get(key) || (result.key===key?result.members:null);
  useEffect(()=>{
    if(!enabled || cache.has(key))return;
    const controller=new AbortController();
    let timer:ReturnType<typeof setTimeout>|undefined,scope:string|undefined;
    setResult({key,members:null,error:""});
    async function post(path:string,body:unknown) {
      const response=await fetch("/api/coverage/"+path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body),signal:controller.signal});
      if(!response.ok){if(response.status===404)scope=undefined;throw Error("格内定位关系暂时无法读取，请重试。");}
      return response.json();
    }
    async function read() {
      try{
        scope??=(await post("scopes",{filters,batch})).id;
        const data:CoverageResponse=await post("cells",{id:scope,grid:selection.grid,cells:[selection.id],includeProducts:true});
        if(controller.signal.aborted)return;
        if(!Array.isArray(data.ready)||!Array.isArray(data.cells)||!Number.isSafeInteger(data.pending))throw Error("格内定位关系返回格式有误，请重试。");
        if(!data.ready.includes(selection.id)){
          if(data.pending<=0)throw Error("格内定位关系尚未核实，请重试。");
          timer=setTimeout(()=>void read(),120);return;
        }
        const row=data.members?.find(([cell])=>cell===selection.id);
        const count=new Map(data.cells).get(selection.id)||0;
        if(!row || !Array.isArray(row[1]) || !row[1].every(v=>typeof v==="string") || new Set(row[1]).size!==count)throw Error("格内定位名单与计数不一致，请重试。");
        const loaded=new Set(row[1]);cache.set(key,loaded);
        if(cache.size>16)cache.delete(cache.keys().next().value!);
        setResult({key,members:loaded,error:""});
      }catch(error){if(!controller.signal.aborted)setResult({key,members:null,error:error instanceof Error?error.message:"格内定位关系暂时无法读取。"});}
    }
    void read();
    return ()=>{controller.abort();clearTimeout(timer);};
  },[enabled,key,retry]);
  return {members,error:result.key===key?result.error:"",retry:()=>setRetry(n=>n+1)};
}
