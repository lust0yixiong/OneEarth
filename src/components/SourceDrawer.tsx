import {useWebPreview} from "./use-web-preview";
import {useEffect,useMemo,useRef,useState,type CSSProperties} from "react";
import {createPortal} from "react-dom";
import {X,ArrowLeft,ArrowUpRight} from "lucide-react";
import type {AnswerReference,CitationType,Message} from "../domain/types";
import {assetById} from "../domain/datasets";
import {citationDetails,doiFor,type AssetReference} from "../domain/answer-sources";
import {answerEvidence,answerMapBatch,evidenceAction} from "../domain/answer-map";
import {useCatalogRevision} from "./use-catalog-revision";
import {EntityVisualization} from "./EntityVisualization";
import {regionalForDataset} from "../domain/regional-cases";
import {useWorkspace} from "../domain/store";
import {emptyFilters} from "../domain/spatial";
import {PaperEvidenceCard} from "./PaperEvidenceCard";
import {paperId} from "../domain/paper-record";
import {CitationIcon} from "./CitationIcon";
import {citationTypeLabels} from "../domain/citation-types";
import {useSourcePreviewHost,usePreviewPosition} from "./SourcePreviewHost";
import {savedWebDocument} from "../domain/web-preview";
import {observationAttachment,useObservationCatalogue} from "./ObservationMaterialPicker";
import {ObservationFileEvidence} from "./ObservationFileEvidence";

function safeUrl(raw:string|undefined) {
  try{
    const url=new URL(raw||"");
    return /^https?:$/.test(url.protocol) && !url.username && !url.password?url:undefined;
  }catch{return undefined;}
}

const categories:{type:CitationType;name:string}[]=(['data','paper','web'] as const).map(type=>({type,name:citationTypeLabels[type]}));

function SavedPaperEvidence({assetId,entries}:{assetId:string;entries:Message["conversationAssertionEvidence"]}) {
  const saved=(Array.isArray(entries)?entries:[]).filter(entry=>entry?.stage==="assertion-excerpt" && entry.assetId===assetId &&
    typeof entry.quote==="string" && entry.quote.trim());
  if (!saved.length) return <small>此研究记录未保存这条来源的文献摘录。</small>;
  return <details className="oe-paper" aria-label="已保存文献依据">
    <summary>查看已保存依据</summary>
    {saved.map(entry=><article className="oe-paper-study"
      key={JSON.stringify([entry.paperId,entry.rqId,entry.datasetId,entry.block,entry.start,entry.end])}>
      <h3>{entry.label}</h3>
      {entry.block && <small>{entry.block}</small>}
      <blockquote><p>{entry.quote}</p></blockquote>
      <small>保存时间 {Number.isFinite(Date.parse(entry.recordedAt))?entry.recordedAt:"未记录"}
        {entry.sourceTurn!==undefined && " · 第 "+entry.sourceTurn+" 轮"}
        {entry.excerptTruncated?" · 保存时截断":entry.partial?" · 原文有省略":""}
      </small>
    </article>)}
  </details>;
}

export function SourceDrawer({refs,title,message,archived,question,close}:{refs:AnswerReference[];title:string;message:Message;archived:boolean;question?:string;close:()=>void}) {
  const previewHost=useRef<HTMLDivElement>(null);
  const {setHost,frame}=useSourcePreviewHost();
  const previewPosition=usePreviewPosition();
  const previewVariables=previewPosition?{
    "--source-preview-left":previewPosition.left+"px",
    "--source-preview-top":previewPosition.top+"px",
    "--source-preview-width":previewPosition.width+"px",
    "--source-preview-height":previewPosition.height+"px",
    "--source-preview-bottom":(innerHeight-Number(previewPosition.top)-Number(previewPosition.height))+"px",
  } as CSSProperties:undefined;
  const targetUrls=archived?[]:refs.flatMap(r=>r.kind==="web"?[r.url]:assetById.get(r.id)?.url?[assetById.get(r.id)!.url!]:[]);
  const webSources=message.answerNotes?.webSources;
  const previewWeb=useWebPreview(archived?undefined:webSources,()=>{
    patch({inspector:null});setHost(previewHost.current);
  },targetUrls,()=>webSources);
  const revision=useCatalogRevision();
  const locations=useMemo(()=>{
    const batch=answerMapBatch(message);
    return batch?answerEvidence(batch):new Map();
  },[message,revision]);
  const groups=useMemo(()=>{
    const sources=refs.map(reference=>({reference,details:citationDetails(reference,message.answerNotes)}));
    return categories.map(category=>({...category,sources:sources.filter(s=>s.details.type===category.type)}));
  },[refs,message.answerNotes,revision]);
  const dialog=useRef<HTMLDialogElement>(null);
  const {state:s,patch,inspectAsset,openVisualization,flyToEvidence,attachScope}=useWorkspace();
  const {byReferenceUrl}=useObservationCatalogue();
  const [tab,setTab]=useState<CitationType>(()=>groups.find(g=>g.sources.length)?.type || "data");
  useEffect(()=>{
    if(!groups.some(g=>g.type===tab && g.sources.length))setTab(groups.find(g=>g.sources.length)?.type || "data");
  },[groups,tab]);
  useEffect(()=>{
    const d=dialog.current!,trigger=document.activeElement;
    const host=previewHost.current;
    d.showModal();
    if((s.evidence || s.inspector) && matchMedia("(prefers-reduced-motion: reduce)").matches)setHost(host);
    return ()=>{
      d.close();
      setHost(current=>current===host?null:current);
      if(trigger instanceof HTMLElement && trigger.isConnected)trigger.focus({preventScroll:true});
    };
  },[]);
  // Preview buttons inside paper evidence also open the workspace reader.
  const initialPreview=useRef({evidence:s.evidence,inspector:s.inspector});
  useEffect(()=>{
    if((s.evidence && s.evidence!==initialPreview.current.evidence) ||
       (s.inspector && s.inspector!==initialPreview.current.inspector))setHost(previewHost.current);
  },[s.evidence,s.inspector,setHost]);
  function inspect(ref:AssetReference) {
    setHost(previewHost.current);
    inspectAsset(ref.id,message.candidates?.filters||emptyFilters(),message.candidates?.selection||null,message.candidates);
  }
  function continueChat() {
    setHost(null);
    close();
  }
  const reveal=frame?Math.min(36,Math.max(16,frame.width*.06)):0;
  const position=frame?{
    left:frame.x+reveal,top:frame.y,width:frame.width-reveal,height:frame.height,
    right:"auto",bottom:"auto",maxHeight:"none",
  }:undefined;
  const initialCitation=useRef(s.citation);
  useEffect(()=>{
    if(s.citation && s.citation!==initialCitation.current)close();
  },[s.citation,close]);
  function mapAction(ref:AssetReference) {
    const action=evidenceAction(locations.get(ref.id));
    return action?<button className="chat-layer-link" onClick={()=>{close();flyToEvidence(message,ref.id);}}>{action}</button>
      :<small className="oe-location-unavailable">暂无可定位范围</small>;
  }
  return createPortal(<dialog className="oe-source-drawer" ref={dialog} aria-label={title}
    style={position}
    onAnimationEnd={e=>{
      if(e.target!==e.currentTarget)return;
      if(s.evidence || s.inspector)setHost(previewHost.current);
    }}
    onCancel={e=>{if(e.target!==e.currentTarget)return;if(previewHost.current?.childElementCount){e.preventDefault();patch({evidence:null,inspector:null});}else {e.preventDefault();continueChat();}}}
    onClick={e=>{previewWeb(e);if(e.target===e.currentTarget){const r=e.currentTarget.getBoundingClientRect();if(e.clientX<r.left || e.clientX>r.right || e.clientY<r.top || e.clientY>r.bottom)continueChat();}}}>
    <div className="source-preview-host" ref={previewHost} style={previewVariables}/>
    <header><h2>{title}</h2><div className="source-page-actions">
      <button className="source-continue" onClick={continueChat}><ArrowLeft size={14}/>继续对话</button>
      <button onClick={continueChat} aria-label="关闭来源与依据"><X size={18}/></button>
    </div></header>
    {question && <p className="source-question" title={question}>对应问题：{question}</p>}
    <nav aria-label="依据类型">{groups.map(group=><button key={group.type} data-reference-type={group.type}
      disabled={!group.sources.length} aria-pressed={tab===group.type} onClick={()=>setTab(group.type)}>
      <CitationIcon type={group.type} size={15}/>{group.name} {group.sources.length}
    </button>)}</nav>
    {groups.find(g=>g.type===tab)?.sources.map(({reference:r,details})=>{
      if(r.kind==="web"){
        const url=safeUrl(r.url),doi=message.answerNotes?.webSources?.find(hit=>hit.url===r.url)?.doi;
        const evidence=savedWebDocument(r,message);
        return url && <section className="oe-web-source" data-reference-type={details.type} key={r.url}>
          <a className="oe-source-card" href={url.href} target="_blank" rel="noreferrer">
            <b><CitationIcon type={details.type}/><span>{r.title} <ArrowUpRight size={13}/></span></b>
            <small>{details.channel} · {url.hostname}{details.material && " · "+(archived?"归档链接类型 ":"")+details.material}</small>{doi && <small>DOI {doi}</small>}
          </a>
          {evidence && <button type="button" className="saved-web-evidence-action" data-source-url={r.url} onClick={()=>{
            setHost(previewHost.current);
            patch({inspector:null,evidence,previewKind:"text"});
          }}>查看已保存依据</button>}
          {Array.from(byReferenceUrl.get(r.url) ?? [],([key,{material,dataUrl,catalogUrl,versionLabel}])=>{
            const attached=s.draftScope?.some(item=>item.kind==="observation" &&
              item.artifactId===material.artifactId && item.version===material.version);
            const disabled=s.pending || s.attachingMapScope || !!s.clarificationReply || attached;
            return <div className="oe-observation-source-actions" key={key}>
              <small>{material.title} · {versionLabel}（{material.version}）</small>
              <button type="button" disabled={disabled} onClick={()=>{
                attachScope(observationAttachment(material));
                continueChat();
              }}>{attached?"已附加此文件版本":"用已验证文件版本提问"}</button>
              <a href={dataUrl} data-external target="_blank" rel="noreferrer">打开发布方文件入口</a>
              <a href={catalogUrl} data-external target="_blank" rel="noreferrer">打开发布目录</a>
            </div>;
          })}
        </section>;
      }
      if (r.evidenceLevel==="observation-file") {
        const evidence=r.observationEvidence;
        return <section className="oe-network-dataset" data-reference-type={details.type} data-observation-evidence={r.id} key={r.id}>
          <div className="oe-source-card">
            <b><CitationIcon type={details.type}/><span>{r.title}</span></b>
            <small>{details.evidence}</small>
            {evidence ? <ObservationFileEvidence evidence={evidence}/> : <small>这份档案未保存详细读取依据。</small>}
          </div>
        </section>;
      }
      const a=assetById.get(r.id),url=safeUrl(a?.url),doi=doiFor(r.id);
      const hasPaperEvidence=details.type==="paper";
      const catalogueRecord=r.evidenceLevel==="catalogue-record";
      const layer=a && (regionalForDataset(a.datasetId)||(a.datasetId==="gfs-wind"?"gfs-wind":undefined));
      return <section className="oe-network-dataset" data-reference-type={details.type} key={r.id}>
        {archived && !catalogueRecord && paperId(r.id) && <SavedPaperEvidence assetId={r.id} entries={message.conversationAssertionEvidence}/>}
        {catalogueRecord && <button type="button" className="oe-source-card" aria-label={"打开本轮目录条目："+r.title} onClick={()=>inspect(r)}>
          <b><CitationIcon type={details.type}/><span>{r.title} <ArrowUpRight size={13}/></span></b>
          <small>{details.evidence}</small>
        </button>}
        {hasPaperEvidence?<PaperEvidenceCard reference={r} deferCurrentEvidence={archived||catalogueRecord}/>:!catalogueRecord&&<button className="oe-source-card" onClick={()=>inspect(r)}>
          <b><CitationIcon type={details.type}/><span>{r.title} <ArrowUpRight size={13}/></span></b>
          <small>{details.channel} · {a?.source || r.source}</small>
          {a?.description && <p>{a.description}</p>}
          {a?.profile?.coverage && <small>{a.profile.coverage}</small>}
          {doi && <small>DOI {doi}</small>}
        </button>}
        {url?<a className="oe-publisher-link" href={url.href} target="_blank" rel="noreferrer">来源入口 · {url.hostname} ↗</a>
          :<small>{catalogueRecord?"目录条目暂无原站地址":"本轮未保存来源链接"}</small>}
        {mapAction(r)}
        {layer && <button className="chat-layer-link" onClick={()=>{close();openVisualization(layer,null);}}>在数据地球打开图层</button>}
        {a && <EntityVisualization asset={a}/>}
      </section>;
    })}
  </dialog>,document.body);
}
