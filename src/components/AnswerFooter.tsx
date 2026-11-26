import {readResearchPdf,saveResearchPdf} from "../domain/session-storage";
import {useState} from "react";
import {ListChecks,Download} from "lucide-react";
import {CopyButton} from "./RunDetails";
import type {AnswerReference,Message} from "../domain/types";
import {doiFor} from "../domain/answer-sources";
export function AnswerFooter({message:m,question,refs,open}:{message:Message;question:string;refs:AnswerReference[];open:()=>void}) {
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  const completionLabel=m.taskLifecycle?.runtimePhase?.phase==="cancelled" ? "已取消" : "完成";
  const name=(question || "OneEarth").slice(0,52).replace(/[\\/:*?"<>|]/g,"")+" · 研究记录.pdf";
  const notes=m.answerNotes;
  const referenceLines=refs.map(ref=>ref.title+" · "+(ref.kind==="web"?ref.url:doiFor(ref.id)||ref.source));
  const record={question,answer:[m.text,notes?.followUp,...(m.research?.rows||[]).map(r=>r.name+"："+r.detail)].filter(Boolean).join("\n\n"),limitation:notes?.limitation||"",references:referenceLines,finished:m.time};
  async function download() {
    if(busy)return;
    setBusy(true);setError("");
    try {
      let pdf=await readResearchPdf(m.id).catch(()=>undefined);
      if(!pdf){
        const response=await fetch("/api/research-record",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(record)});
        if(!response.ok || !response.headers.get("content-type")?.includes("application/pdf"))throw Error();
        pdf=await response.blob();
        await saveResearchPdf(m.id,pdf).catch(()=>{});
      }
      const url=URL.createObjectURL(pdf),a=document.createElement("a");
      a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
    } catch {setError("研究记录生成失败，请重新下载。");} finally {setBusy(false);}
  }
  return <footer className="oe-answer-footer">
    {error && <small role="alert">{error}</small>}
    <div className="oe-meta">
      {!!refs.length && <button className="oe-sources-all" onClick={open}><ListChecks size={13} aria-hidden="true"/>来源与依据 <span>{refs.length}</span></button>}
      <button className="oe-record" title="导出为 PDF" disabled={busy} onClick={download}><Download size={13}/>{busy?"正在导出…":"导出研究记录"}</button>
      <CopyButton text={[record.answer,record.limitation,...referenceLines.map((s,i)=>(i+1)+". "+s)].filter(Boolean).join("\n\n")} label="复制回答"/>
      <time dateTime={new Date(m.time).toISOString()} title={new Date(m.time).toLocaleString("zh-CN")}>
        {new Date(m.time).toLocaleTimeString("zh-CN",{hour:"2-digit",minute:"2-digit"})} {completionLabel}
      </time>
    </div>
  </footer>;
}
