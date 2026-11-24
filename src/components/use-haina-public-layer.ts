import {useEffect,useState} from "react";
import {fetchPublicLayerManifest,readPublicLayerGrid,readPublicLayerPoints,type PublicLayerGrid,type PublicLayerId,
  type PublicLayerManifest,type PublicLayerPoint,type PublicLayerSelection,type PublicLayerView} from "../domain/haina-public-layer";
import type {GeoImageFrame} from "../globe/geo-image-layer";

export function usePublicLayerManifest(id:PublicLayerId|undefined) {
  const [result,setResult]=useState<{id:PublicLayerId;manifest?:PublicLayerManifest}|null>(null);
  const [attempt,setAttempt]=useState(0);
  useEffect(()=>{
    if(id===undefined)return;
    setResult(null);
    const request=new AbortController();
    void fetchPublicLayerManifest(id,AbortSignal.any([request.signal,AbortSignal.timeout(10000)]))
      .then(manifest=>{if(!request.signal.aborted)setResult({id,manifest});})
      .catch(()=>{if(!request.signal.aborted)setResult({id});});
    return ()=>request.abort();
  },[attempt,id]);
  return {manifest:result?.id===id?result?.manifest:undefined,
    error:!!result&&result.id===id&&!result.manifest,retry:()=>setAttempt(value=>value+1)};
}

async function requireResponse(path:string,signal:AbortSignal) {
  const response=await fetch(path,{signal,redirect:"error"});
  if(!response.ok)throw Error("图层文件暂不可用");
  return response;
}
async function decodeImage(view:Extract<PublicLayerView,{kind:"raster"}>,signal:AbortSignal):Promise<GeoImageFrame> {
  const bitmap=await createImageBitmap(await (await requireResponse(view.image,signal)).blob());
  try {
    if(bitmap.width*bitmap.height>16_000_000)throw Error("图层图像超出显示范围");
    const canvas=document.createElement("canvas");
    canvas.width=bitmap.width;canvas.height=bitmap.height;
    const ctx=canvas.getContext("2d")!;
    ctx.drawImage(bitmap,0,0);
    return {width:canvas.width,height:canvas.height,pixels:ctx.getImageData(0,0,canvas.width,canvas.height).data,bounds:view.bounds};
  }finally{bitmap.close();}
}

export function useHainaPublicLayer(selection:PublicLayerSelection|null) {
  const catalogue=usePublicLayerManifest(selection?.id);
  const {manifest}=catalogue;
  const view=manifest?.views.find(view=>view.id===selection?.view) ?? manifest?.views.find(view=>view.id===manifest.defaultView);
  const [data,setData]=useState<{view:PublicLayerView;points?:PublicLayerPoint[];image?:GeoImageFrame;error?:boolean}|null>(null);
  const [grid,setGrid]=useState<{view:PublicLayerView;value?:PublicLayerGrid}|null>(null);
  const [attempt,retry]=useState(0);
  useEffect(()=>{
    setData(null);setGrid(null);
    if(!view)return;
    const request=new AbortController(), signal=AbortSignal.any([request.signal,AbortSignal.timeout(12000)]);
    const content=view.kind==="points"
      ? requireResponse(view.data,signal).then(response=>response.json()).then(raw=>({view,points:readPublicLayerPoints(raw,view)}))
      : decodeImage(view,signal).then(image=>({view,image}));
    void content.then(next=>{if(!request.signal.aborted)setData(next);})
      .catch(()=>{if(!request.signal.aborted)setData({view,error:true});});
    if(view.kind==="raster"&&view.grid)void requireResponse(view.grid,signal).then(response=>response.json())
      .then(raw=>{if(!request.signal.aborted)setGrid({view,value:readPublicLayerGrid(raw,view)});})
      .catch(()=>{if(!request.signal.aborted)setGrid({view});});
    return ()=>request.abort();
  },[attempt,view]);
  return {catalogue,view,data:data?.view===view?data:null,grid:grid?.view===view?grid:null,retry:()=>retry(value=>value+1)};
}
