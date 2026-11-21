import { useEffect, useRef, useState } from "react";
import { paperRecords } from "../domain/paper-record";
import type { PaperRecord } from "../domain/paper-record";

type Question=NonNullable<PaperRecord["researchQuestions"]>[number];
const key=(question:Question)=>JSON.stringify([question.paperId,question.rqId,question.datasetId]);
export function PaperResearchQuestions({assetId}:{assetId:string}) {
  const record=paperRecords.get(assetId);
  const [items,setItems]=useState(record?.researchQuestions||[]);
  const [cursor,setCursor]=useState<string|null>("");
  const [loading,setLoading]=useState(false),[error,setError]=useState("");
  const request=useRef<AbortController|null>(null);
  useEffect(()=>()=>request.current?.abort(),[]);
  if(record?.questionSource!=="postgres-readonly")return null;
  async function load() {
    if(loading || cursor===null)return;
    const controller=new AbortController();request.current=controller;
    setLoading(true);setError("");
    try {
      const response=await fetch("/api/paper-records/"+encodeURIComponent(assetId)+"/questions?cursor="+encodeURIComponent(cursor||""),{signal:controller.signal});
      if(!response.ok)throw Error("关联研究问题暂时无法读取，请重试。");
      const result=await response.json();
      if(!Array.isArray(result.items) || !result.items.every((question:any)=>question && [question.paperId,question.rqId,question.datasetId,question.paperTitle,question.question].every(value=>typeof value==="string")) ||
        !(result.nextCursor===null || typeof result.nextCursor==="string"))throw Error("研究问题记录格式有误。");
      setItems(old=>[...new Map([...old,...result.items].map(question=>[key(question),question])).values()]);setCursor(result.nextCursor);
    } catch(cause) {if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:"研究问题未能读取。");}
    finally {if(!controller.signal.aborted)setLoading(false);}
  }
  return <details className="paper-research-questions">
    <summary>关联论文研究问题（已载入 {items.length} 条）</summary>
    <ol>{items.map(question=><li key={key(question)}><strong>{question.question}</strong><p>{question.paperTitle}</p>
      <small>{question.rqId} · 文内数据集 {question.datasetId}</small></li>)}</ol>
    {!items.length && !loading && <p>当前样本尚未列出研究问题，可继续读取关联记录。</p>}
    {error && <p role="status">{error}</p>}
    {cursor!==null && <button onClick={()=>void load()} disabled={loading}>{loading?"正在读取研究问题…":error?"重试读取":"查看更多研究问题"}</button>}
  </details>;
}
