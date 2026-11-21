import {useEffect,useState} from "react";

export function useFeed<T>(url:string,interval:number,paused:boolean,identity:(data:T)=>unknown){
  const [data,setData]=useState<T>();
  const [failed,setFailed]=useState(false);
  useEffect(()=>{
    if(paused)return;
    const abort=new AbortController();
    let timer:ReturnType<typeof setTimeout>;
    async function refresh(){
      let delay=interval;
      try{
        const response=await fetch(url,{signal:abort.signal});
        if(!response.ok)throw Error();
        const next:T=await response.json();
        if(!abort.signal.aborted){
          setData(old=>old && identity(old)===identity(next)?old:next);
          setFailed(false);
        }
      }catch{delay=Math.min(interval,15000);if(!abort.signal.aborted)setFailed(true);}
      finally{if(!abort.signal.aborted)timer=setTimeout(refresh,delay);}
    }
    void refresh();
    return ()=>{abort.abort();clearTimeout(timer);};
  },[url,interval,paused,identity]);
  return {data,failed};
}

