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
import {CitationIcon} from "./CitationIcon";
import {citationTypeLabels} from "../domain/citation-types";
import {useSourcePreviewHost,usePreviewPosition} from "./SourcePreviewHost";
import {savedWebDocument} from "../domain/web-preview";

function safeUrl(raw:string|undefined) {
  try{
    const url=new URL(raw||"");
    return /^https?:$/.test(url.protocol) && !url.username && !url.password?url:undefined;
  }catch{return undefined;}
}

const categories:{type:CitationType;name:string}[]=(['data','paper','web'] as const).map(type=>({type,name:citationTypeLabels[type]}));

export function SourceDrawer({refs,title,message,question,close}:{refs:AnswerReference[];title:string;message:Message;question?:string;close:()=>void}) {
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
  const targetUrls=refs.flatMap(r=>r.kind==="web"?[r.url]:assetById.get(r.id)?.url?[assetById.get(r.id)!.url!]:[]);
  const previewWeb=useWebPreview(message.answerNotes?.webSources,()=>{patch({inspector:null});setHost(previewHost.current);},targetUrls);
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
  const {state:s,patch,inspectAsset,openVisualization,flyToEvidence}=useWorkspace();
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
            <small>{details.channel} · {url.hostname}</small>{doi && <small>DOI {doi}</small>}
          </a>
          {evidence && <button type="button" className="saved-web-evidence-action" data-source-url={r.url} onClick={()=>{
            setHost(previewHost.current);
            patch({inspector:null,evidence,previewKind:"text"});
          }}>查看已保存依据</button>}
        </section>;
      }
      const a=assetById.get(r.id),url=safeUrl(a?.url),doi=doiFor(r.id);
      const hasPaperEvidence=details.type==="paper";
      const layer=a && (regionalForDataset(a.datasetId)||(a.datasetId==="gfs-wind"?"gfs-wind":undefined));
      return <section className="oe-network-dataset" data-reference-type={details.type} key={r.id}>
        {hasPaperEvidence?<PaperEvidenceCard reference={r}/>:<button className="oe-source-card" onClick={()=>inspect(r)}>
          <b><CitationIcon type={details.type}/><span>{r.title} <ArrowUpRight size={13}/></span></b>
          <small>{details.channel} · {a?.source || r.source}</small>
          {a?.description && <p>{a.description}</p>}
          {a?.profile?.coverage && <small>{a.profile.coverage}</small>}
          {doi && <small>DOI {doi}</small>}
        </button>}
        {url?<a className="oe-publisher-link" href={url.href} target="_blank" rel="noreferrer">来源入口 · {url.hostname} ↗</a>:<small>本轮未保存来源链接</small>}
        {mapAction(r)}
        {layer && <button className="chat-layer-link" onClick={()=>{close();openVisualization(layer,null);}}>在数据地球打开图层</button>}
        {a && <EntityVisualization asset={a}/>}
      </section>;
    })}
  </dialog>,document.body);
}
