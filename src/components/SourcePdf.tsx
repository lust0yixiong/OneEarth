import {useEffect, useRef, useState} from "react";
import {getDocument, GlobalWorkerOptions, PDFDataRangeTransport, type PDFDocumentProxy, type RenderTask} from "pdfjs-dist";
import type {SourceQuote} from "../domain/source-preview";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = workerUrl;
const resources = import.meta.env.DEV ? "/node_modules/pdfjs-dist/" : "/pdf-resources/";

export default function SourcePdf({url,rangeSize,publicUrl,title,onContent,onRetry}: {url:string;rangeSize?:number;publicUrl:string;title:string;onContent?:(quote:SourceQuote|null)=>void;onRetry?:()=>void}) {
  const contentCallback=useRef(onContent);contentCallback.current=onContent;
  const [doc,setDoc] = useState<PDFDocumentProxy>();
  const [number,setNumber] = useState(1);
  const [zoom,setZoom] = useState(1);
  const [width,setWidth] = useState(0);
  const [error,setError] = useState("");
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(()=>{
    let active = true;
    setError("");setDoc(undefined);setNumber(1);
    let timeout: ReturnType<typeof setTimeout>;
    let preparing = true;
    const noteProgress = () => {
      if (!preparing) return;
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        if (active) { setError("PDF 加载超时，可重新读取或打开原文件。"); void task.destroy(); }
      }, 60000);
    };
    const requests=new Set<AbortController>();
    const transport=rangeSize?new PDFDataRangeTransport(rangeSize,null):undefined;
    if(transport){
      transport.requestDataRange=(begin,end)=>{
        const controller=new AbortController();requests.add(controller);
        void fetch(url,{headers:{Range:'bytes='+begin+'-'+(end-1)},signal:controller.signal}).then(async response=>{
          if(!response.ok)throw Error('PDF 分段读取失败。');
          const bytes=new Uint8Array(await response.arrayBuffer());
          if(active){noteProgress();transport.onDataRange(begin,bytes);}
        }).catch(()=>{if(active){setError('PDF 分段读取失败，请重新读取或打开原文件。');void task.destroy();}}).finally(()=>requests.delete(controller));
      };
      transport.abort=()=>{for(const controller of requests)controller.abort();requests.clear();};
    }
    const task = getDocument({...(transport?{range:transport,disableAutoFetch:true,disableStream:true,rangeChunkSize:65536}:{url}), withCredentials:false, isEvalSupported:false,
      cMapUrl:resources+"cmaps/", cMapPacked:true, standardFontDataUrl:resources+"standard_fonts/",
      wasmUrl:resources+"wasm/", iccUrl:resources+"iccs/"});
    noteProgress();
    task.promise.then(pdf=>{if(active)setDoc(pdf);}).catch(reason=>{if(active){console.warn("OneEarth PDF read:",reason);setError("未能读取此 PDF，可打开原文件查看。");}}).finally(()=>{preparing=false;clearTimeout(timeout);});
    return ()=>{active=false;clearTimeout(timeout);void task.destroy();};
  },[url,rangeSize]);
  useEffect(()=>{
    const el = host.current!;
    setWidth(el.clientWidth);
    let timer: ReturnType<typeof setTimeout>;
    const observer = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => setWidth(el.clientWidth), 100);
    });
    observer.observe(el);
    return ()=>{clearTimeout(timer);observer.disconnect();};
  },[]);
  useEffect(()=>{
    const el = canvas.current;
    if(!el || !doc || !width)return;
    let active = true;
    let task:RenderTask | undefined;
    el.style.visibility="hidden";delete el.dataset.page;setError("");
    void doc.getPage(number).then(async page=>{
      if(!active)return;
      const base = page.getViewport({scale:1});
      const viewport = page.getViewport({scale:Math.max(1,width-2)*zoom/base.width});
      const density = Math.min(window.devicePixelRatio || 1,2,4096/Math.max(viewport.width,viewport.height));
      el.width=Math.ceil(viewport.width*density);
      el.height=Math.ceil(viewport.height*density);
      el.style.width=viewport.width+"px";
      el.style.height=viewport.height+"px";
      task=page.render({canvas:el,viewport,transform:[density,0,0,density,0,0]});
      await task.promise;
      if(active){
        el.style.visibility="visible";el.dataset.page=String(number);

      }
    }).catch(()=>{if(active)setError("此页渲染失败，可打开原文件查看。");});
    return ()=>{active=false;task?.cancel();};
  },[doc,number,width,zoom,publicUrl]);
  // Page text is independent of zoom and column width.
  useEffect(() => {
    let active = true;
    contentCallback.current?.(null);
    if (doc) void doc.getPage(number).then(page => page.getTextContent()).then(text => {
      if (!active) return;
      const body = text.items.map(item => "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "").join("").trim();
      if (body) contentCallback.current?.({
        body: body.slice(0,16000), label: "PDF 第 " + number + " 页文字摘录",
        url: publicUrl.split("#")[0] + "#page=" + number, page: number
      });
    }).catch(() => {});
    return () => { active = false; };
  }, [doc, number, publicUrl]);
  return <section className="source-pdf">
    {doc && <nav aria-label="PDF 阅读工具">
      <button disabled={number<=1} onClick={()=>setNumber(number-1)}>上一页</button>
      <span>{number} / {doc.numPages}</span>
      <button disabled={number>=doc.numPages} onClick={()=>setNumber(number+1)}>下一页</button>
      <button aria-label="缩小文档" disabled={zoom<=0.5} onClick={()=>setZoom(zoom-0.25)}>−</button>
      <button aria-label="适合页宽" onClick={()=>setZoom(1)}>{Math.round(zoom*100)}%</button>
      <button aria-label="放大文档" disabled={zoom>=3} onClick={()=>setZoom(zoom+0.25)}>＋</button>
    </nav>}
    {(error || !doc) && <p role="status">{error || "正在读取 PDF…"}</p>}
    {error && <button onClick={onRetry}>重新读取 PDF</button>}
    <div className="source-pdf-page" ref={host}><canvas ref={canvas} aria-label={title+" 第 "+number+" 页"} /></div>
  </section>;
}
