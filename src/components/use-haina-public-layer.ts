import {useCallback,useEffect,useMemo,useState} from "react";
import {readPublicLayerGrid,readPublicLayerPoints,type PublicBounds,type PublicLayerGrid,type PublicLayerId,
  type PublicLayerPoint,type PublicLayerSelection,type PublicLayerView} from "../domain/haina-public-layer";
import {coverageFramePath,fetchHainaPublication,hainaPatchView,patchForHainaView,viirsCamera,
  type HainaPublication} from "../domain/haina-published-raster";
import type {GeoImageFrame} from "../globe/geo-image-layer";

export function usePublicLayerManifest(id:PublicLayerId|undefined) {
  const [result,setResult]=useState<{id:PublicLayerId;manifest?:HainaPublication}|null>(null);
  const [attempt,setAttempt]=useState(0);
  useEffect(()=>{
    if(id===undefined)return;
    setResult(null);
    const request=new AbortController();
    void fetchHainaPublication(id,AbortSignal.any([request.signal,AbortSignal.timeout(10000)]))
      .then(manifest=>{if(!request.signal.aborted)setResult({id,manifest});})
      .catch(()=>{if(!request.signal.aborted)setResult({id});});
    return ()=>request.abort();
  },[attempt,id]);
  const manifest=result?.id===id?result?.manifest:undefined;
  const error=!!result&&result.id===id&&!result.manifest;
  const retry=useCallback(()=>setAttempt(value=>value+1),[]);
  return useMemo(()=>({manifest,error,retry}),[manifest,error,retry]);
}

async function requireResponse(path:string,signal:AbortSignal) {
  const response=await fetch(path,{signal,redirect:"error"});
  if(!response.ok)throw Error("图层文件暂不可用");
  return response;
}

export async function loadHainaImage(path:string,bounds:PublicBounds,signal:AbortSignal,expectedSize?:number):Promise<GeoImageFrame> {
  const bitmap=await createImageBitmap(await (await requireResponse(path,signal)).blob());
  try {
    if(bitmap.width*bitmap.height>16_000_000||expectedSize&&(bitmap.width!==expectedSize||bitmap.height!==expectedSize))
      throw Error("图层图像尺寸与发布清单不一致");
    const canvas=document.createElement("canvas");
    canvas.width=bitmap.width;canvas.height=bitmap.height;
    const ctx=canvas.getContext("2d")!;
    ctx.drawImage(bitmap,0,0);
    return {width:canvas.width,height:canvas.height,pixels:ctx.getImageData(0,0,canvas.width,canvas.height).data,bounds};
  }finally{bitmap.close();}
}

type DisplayView=PublicLayerView
  | (ReturnType<typeof viirsCamera> & {kind:"tiles";bounds:PublicBounds})
  | (Omit<Extract<PublicLayerView,{kind:"raster"}>,"kind"|"image"|"grid"> & {kind:"patch";image?:string;month:string});

export function useHainaPublicLayer(selection:PublicLayerSelection|null) {
  const catalogue=usePublicLayerManifest(selection?.id);
  const {manifest}=catalogue;
  const coverage=manifest?.mode==="coverage" ? manifest : undefined;
  const requestedView=selection?.view;
  const patchId=requestedView ? patchForHainaView(requestedView) : coverage?.defaultPatch;
  const patch=coverage?.patches.find(item=>item.id===patchId);
  const month=coverage ? selection?.month ?? (requestedView==="patch-000186"?"2025-04":coverage.defaultMonth) : undefined;
  const viirsView=manifest?.mode==="viirs"&&(requestedView==="nyc"||requestedView==="tokyo")?requestedView:undefined;
  const legacyView=manifest?.mode==="legacy"
    ? manifest.views.find(view=>view.id===requestedView) ?? manifest.views.find(view=>view.id===manifest.defaultView)
    : undefined;
  const view=useMemo<DisplayView|undefined>(()=>{
    if(manifest?.mode==="viirs")return {...viirsCamera(manifest,viirsView),kind:"tiles",bounds:manifest.sourceBounds};
    if(coverage&&patch&&month)return {id:hainaPatchView(patch.id),label:patch.id,kind:"patch",
      bounds:patch.bounds,center:patch.center,zoom:2200,month,
      ...(patch.months.includes(month)?{image:coverageFramePath(coverage.revision,patch.id,month)}:{})};
    return legacyView;
  },[manifest,coverage,patch,month,viirsView,legacyView]);
  const [data,setData]=useState<{view:DisplayView;points?:PublicLayerPoint[];image?:GeoImageFrame;error?:boolean}|null>(null);
  const [grid,setGrid]=useState<{view:DisplayView;value?:PublicLayerGrid}|null>(null);
  const [attempt,retry]=useState(0);
  useEffect(()=>{
    setData(null);setGrid(null);
    if(!view||view.kind==="tiles"||view.kind==="patch"&&!view.image)return;
    const request=new AbortController(), signal=AbortSignal.any([request.signal,AbortSignal.timeout(12000)]);
    const content=view.kind==="points"
      ? requireResponse(view.data,signal).then(response=>response.json()).then(raw=>({view,points:readPublicLayerPoints(raw,view)}))
      : loadHainaImage(view.image!,view.bounds,signal).then(image=>({view,image}));
    void content.then(next=>{if(!request.signal.aborted)setData(next);})
      .catch(()=>{if(!request.signal.aborted)setData({view,error:true});});
    if(view.kind==="raster"&&view.grid)void requireResponse(view.grid,signal).then(response=>response.json())
      .then(raw=>{if(!request.signal.aborted)setGrid({view,value:readPublicLayerGrid(raw,view)});})
      .catch(()=>{if(!request.signal.aborted)setGrid({view});});
    return ()=>request.abort();
  },[attempt,view]);
  const currentData=data?.view===view?data:null;
  const currentGrid=grid?.view===view?grid:null;
  const retryFrame=useCallback(()=>retry(value=>value+1),[]);
  return useMemo(()=>({catalogue,view,patch,month,data:currentData,grid:currentGrid,retry:retryFrame}),
    [catalogue,view,patch,month,currentData,currentGrid,retryFrame]);
}

export type HainaPublicLayer=ReturnType<typeof useHainaPublicLayer>;
