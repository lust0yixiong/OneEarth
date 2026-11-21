import {useEffect,useState} from "react";
import {administrativeLabel,administrativeLevel,type AdminLocation} from "../domain/admin-orientation";

type Orientation=typeof import("../data/evidence/geo-orientation.mjs");
const cached=new Map<string,AdminLocation>();
const basic=()=>"经纬度定位";
/** Only the settled workspace camera triggers a small lookup; polygons stay on the server. */
export function useGeoOrientation(point:[number,number],scale:number) {
  const [atlas,setAtlas]=useState<Orientation|null>(null);
  const [detail,setDetail]=useState<{position:string;result?:AdminLocation;pending:boolean;error?:string}>({position:"",pending:false});
  useEffect(()=>{
    let cancelled=false;
    import("../data/evidence/geo-orientation.mjs").then(module=>{if(!cancelled)setAtlas(module);}).catch(()=>{});
    return ()=>{cancelled=true;};
  },[]);
  const country=atlas?.geoCountry(point) as {id:string;name:string}|null|undefined;
  const level=administrativeLevel(scale),position=country?country.id+":"+point.join(","):"";
  const result=detail.position===position?detail.result:undefined;
  const covered=!!result && !result.partial && (result.requestedLevel>=level || result.availableLevels.every(n=>n<=result.requestedLevel || n>level));
  const nextLevel=result ? result.availableLevels.find(n=>n>result.requestedLevel && n<=level) ?? Math.min(level,result.requestedLevel) : Math.min(level,1);
  useEffect(()=>{
    if(!country || !level || covered)return;
    const key=position+"/"+nextLevel,previous=cached.get(key);
    if(previous){setDetail({position,result:previous,pending:false});return;}
    const controller=new AbortController();let cancelled=false;
    const timer=setTimeout(()=>{
      setDetail(old=>({position,result:old.position===position?old.result:undefined,pending:true}));
      const params=new URLSearchParams({country:country.id,lon:String(point[0]),lat:String(point[1]),level:String(nextLevel)});
      fetch("/api/orientation?"+params,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(110000)])})
        .then(async response=>{
          if(!response.ok)throw Error("细分区划暂不可用");
          const value=await response.json() as AdminLocation;
          if(value.country!==country.id || value.point?.[0]!==point[0] || value.point?.[1]!==point[1] || !Array.isArray(value.areas))throw Error("区划位置未能核对");
          if(cancelled)return;
          if(!value.partial){if(cached.size>=256)cached.delete(cached.keys().next().value!);cached.set(key,value);}
          setDetail({position,result:value,pending:false});
        }).catch(()=>{if(!cancelled)setDetail(old=>({position,result:old.position===position?old.result:undefined,pending:false,error:"细分区划暂不可用"}));});
    },450);
    return ()=>{cancelled=true;clearTimeout(timer);controller.abort();};
  },[position,level,nextLevel,covered]);
  const locate=atlas?.geoOrientation || basic;
  const areas=result?.areas.filter(area=>area.level<=level) || [];
  return {locate,label:country && areas.length?administrativeLabel(country.name,areas,level):locate(point,{scale}).replace(/（.*?）/g,""),
    areas,availableLevels:result?.availableLevels || [],pending:!!country && !!level && (detail.position!==position || detail.pending || (!detail.error && !covered && (!result || nextLevel>result.requestedLevel))),
    requestedLevel:level,partial:!!level && (result?.partial || false),error:level && detail.position===position?detail.error:undefined,country:country?.name};
}
