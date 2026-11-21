import {useEffect,useSyncExternalStore} from "react";
import {parseChatHomeConfig,parseHomeQuestions,type ChatHomeConfig} from "../domain/chat-home";

let snapshot:{config:ChatHomeConfig|null;loading:boolean;error:string}={config:null,loading:true,error:""};
const listeners=new Set<()=>void>();
const subscribe=(listener:()=>void)=>{listeners.add(listener);return ()=>{listeners.delete(listener);};};
const getSnapshot=()=>snapshot;
const publish=(next:typeof snapshot)=>{snapshot=next;for(const listener of listeners)listener();};
let pending:Promise<void>|null=null,generation=0;
async function readResponse(response:Response){
  const value=await response.json();
  if(!response.ok)throw Error(value.error || "无法读取首页问题配置。");
  return parseChatHomeConfig(value);
}
export function reloadChatHome(){
  if(pending)return pending;
  const request=++generation;
  publish({...snapshot,loading:true,error:""});
  pending=(async()=>{
    try{
      const config=await readResponse(await fetch("/api/settings/chat-home",{cache:"no-store",signal:AbortSignal.timeout(10000)}));
      if(request===generation)publish({config,loading:false,error:""});
    }catch(error){if(request===generation)publish({...snapshot,loading:false,error:error instanceof Error?error.message:"首页问题读取失败。"});}
    finally{pending=null;}
  })();
  return pending;
}
export async function saveChatHome(questions:string[],revision:string){
  const response=await fetch("/api/settings/chat-home",{method:"PUT",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({questions:parseHomeQuestions(questions),revision}),signal:AbortSignal.timeout(10000)});
  if(response.status===409)void reloadChatHome();
  const config=await readResponse(response);
  generation++;publish({config,loading:false,error:""});return config;
}
export function useChatHome(){
  const value=useSyncExternalStore(subscribe,getSnapshot,getSnapshot);
  useEffect(()=>{
    void reloadChatHome();
    const refresh=()=>{if(document.visibilityState==="visible")void reloadChatHome();};
    window.addEventListener("focus",refresh);document.addEventListener("visibilitychange",refresh);
    return ()=>{window.removeEventListener("focus",refresh);document.removeEventListener("visibilitychange",refresh);};
  },[]);
  return value;
}
