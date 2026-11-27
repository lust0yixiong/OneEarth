import {literatureDisplay} from "../domain/literature-label";
import {useCatalogRevision} from "./use-catalog-revision";
import {answerEvidence,answerMapBatch} from "../domain/answer-map";
import {productKey} from "../domain/product-distribution";
import {useGridMembership} from "./use-grid-membership";
import {AnswerMapContext} from "./AnswerMapContext";
import {EntityVisualization} from "./EntityVisualization";
import {gridSpec} from "../domain/spatial";
const unselected={id:"",grid:gridSpec("h3",2),point:[0,0] as [number,number]};
import { regionalForDataset } from "../domain/regional-cases";
import { useCallback, useMemo, useState } from "react";
import {RunDetails} from "./RunDetails";
import {SourceDrawer} from "./SourceDrawer";
import {AnswerFooter} from "./AnswerFooter";
import {sourcesFor,citationDetails} from "../domain/answer-sources";
import {savedWebDocument} from "../domain/web-preview";
import {loadRemoteAssetIds} from "../domain/datasets";
import type {ReactNode} from "react";
import { AnswerContent } from "./AnswerContent";
import { ArrowUpRight, BookOpen, Check, ChevronDown } from "lucide-react";
import { assetById } from "../domain/datasets";
import { sourceLabels } from "../domain/catalog";
import { emptyFilters } from "../domain/spatial";
import { useWorkspace } from "../domain/store";
import type { AnswerReference, Message } from "../domain/types";

function RetainedResearch({message,open}:{message:Message;open:(ref:AnswerReference)=>void}){
  const delivery=message.answerDelivery;
  if(!delivery)return null;
  const topics=message.researchProgress?.actions.filter(action=>action.area==="literature" && action.topic)??[];
  const assets=new Map(delivery.materials.flatMap(ref=>ref.kind==="asset"?[[ref.id,ref] as const]:[]));
  const grouped=new Set<string>();
  const rows=topics.map(action=>{
    const refs=(action.evidence??[]).flatMap(source=>{
      const ref=assets.get(source.assetId);
      if(!ref)return [];
      grouped.add(ref.id);
      return [ref];
    });
    const status=action.status==="not_started" || action.status==="queued" ? "文献渠道本轮未查"
      : action.status==="timeout" ? "文献检索超时"
      : action.status==="done" && action.count===0 ? "未找到论文依据"
      : (action.count??0)>0 ? "已核实 "+action.count+" 篇论文用法"
      : "文献核查未完成";
    return {id:action.id,topic:action.topic,status,refs};
  });
  const remaining=delivery.materials.filter(ref=>ref.kind==="web" || !grouped.has(ref.id));
  if(!rows.length && !remaining.length)return null;
  const links=(refs:AnswerReference[])=>refs.length>0 && <ul className="oe-retained-links">
    {refs.map(ref=><li key={ref.kind==="asset"?ref.id:ref.url}>
      <button type="button" onClick={()=>open(ref)}>{ref.title} <ArrowUpRight size={12} aria-hidden="true"/></button>
    </li>)}
  </ul>;
  return <section className="oe-retained-research" aria-label="本轮已保留资料">
    <h3>{delivery.materials.length ? "本轮已保留的依据" : "本轮文献核查范围"}</h3>
    {delivery.materials.length>0 && <p>以下为本轮已取得的论文用法或原文片段，适用性仍待核查。</p>}
    {!!rows.length && <ul className="oe-retained-topics">
      {rows.map(row=><li key={row.id}>
        <div className="oe-retained-topic"><strong>{row.topic}</strong><span>{row.status}</span></div>
        {links(row.refs)}
      </li>)}
    </ul>}
    {!!remaining.length && <div>
      {!!rows.length && <h4>其他已保留依据</h4>}
      {links(remaining)}
    </div>}
  </section>;
}

export function AnswerBody({message,question,animate,archived,children,clarificationAction,onQuote,onReady,initiallyOpenProcess,showLiveMembership=true}:{message:Message;question:string;animate:boolean;archived:boolean;children?:ReactNode;clarificationAction?:ReactNode;onQuote?:(reference:AnswerReference,number:number)=>void;onReady?:(id:string)=>void;initiallyOpenProcess?:boolean;showLiveMembership?:boolean}){
  const m=useMemo(()=>literatureDisplay(message),[message]);
  const {state:s,inspectAsset,openVisualization,patch,focusAnswerEvidence}=useWorkspace();
  const revision=useCatalogRevision();
  const [ready,setReady]=useState(true);
  const finish=useCallback(()=>{setReady(true);onReady?.(m.id);},[m.id,onReady]);
  const notes=m.answerNotes;
  const [drawer,setDrawer]=useState<{refs:AnswerReference[];title:string}|null>(null);
  const batch=m.candidates;
  const [expanded,setExpanded]=useState(false);
  const [limit,setLimit]=useState(20);
  const mapBatch=useMemo(()=>answerMapBatch(m),[m]);
  const locations=useMemo(()=>mapBatch?answerEvidence(mapBatch):new Map(),[mapBatch,revision]);
  const active=s.mapResult?.answerId===m.id;
  const selection=s.selection || unselected;
  const membership=useGridMembership(showLiveMembership && active && !!s.selection && s.mapResult?.metric!=="scenes",selection,s.filters,s.mapResult);
  const inCell=new Set(batch?.ids.filter(id=>{
    const a=assetById.get(id),key=a && productKey(a);return showLiveMembership && !!key && membership.members?.has(key);
  }));
  const hover=(id:string|null)=>focusAnswerEvidence(m,id);
  const inspect=async(id:string)=>{
    const observation=notes?.references?.find(ref=>ref.kind==="asset"&&ref.id===id&&ref.evidenceLevel==="observation-file");
    if(observation){setDrawer({refs:[observation],title:"本轮观测文件依据"});return;}
    if(!assetById.has(id))await loadRemoteAssetIds([id]).catch(()=>undefined);
    if(!assetById.has(id)){patch({error:"当前未能载入这条资料，请重试。"});return;}
    if(active)focusAnswerEvidence(m,id,true);
    if(matchMedia("(max-width: 600px)").matches)patch({chatOpen:false});
    inspectAsset(id,batch?.filters || emptyFilters(),batch?.selection || null,batch);
  };
  const {inline:inlineRefs,refs:references}=useMemo(()=>sourcesFor(m),[m,revision]);
  const referenceDetails=useMemo(()=>inlineRefs.map(ref=>citationDetails(ref,notes)),[inlineRefs,notes,revision]);
  const savedActions=useMemo(()=>{
    const actions=new Map<string,()=>void>();
    for (const ref of inlineRefs) {
      if (ref.kind!=="web") continue;
      const evidence=savedWebDocument(ref,message);
      if (evidence) actions.set(ref.url,()=>patch({evidence,previewKind:"text",inspector:null}));
    }
    return actions;
  },[inlineRefs,message,patch]);
  const shown=new Set([
    ...(notes?.sources.map(a=>a.id) || []),
    ...(m.research?.rows.flatMap(row=>row.ids) || []),
    ...(m.catalogMatch && !notes ? batch?.ids || [] : []),
    ...(!notes ? m.dataSupport?.candidates.map(a=>a.assetId) || [] : []),
  ]);
  const remaining=batch?.ids.filter(id=>!shown.has(id)) || [];
  if(m.clarification)return <div role="region" aria-label="补充关键信息">
    <RunDetails initiallyOpen={initiallyOpenProcess} trace={m.runTrace} researchProgress={m.researchProgress} openFinding={inspect}/>
    <AnswerContent text={m.text} references={[]} inspect={inspect} animate={animate} onComplete={finish}/>
    {clarificationAction}
  </div>;
  return <>
    <RunDetails initiallyOpen={initiallyOpenProcess} trace={m.runTrace} researchProgress={m.researchProgress} runs={notes?.searches} stage={notes?.paperTrace || notes?.basis} failed={m.failed} openFinding={inspect}/>
    <AnswerContent text={m.text} quote={onQuote} selectedReferences={s.draftScope?.flatMap(i=>i.kind==="reference"?[i.reference]:[]) || []} references={inlineRefs} details={referenceDetails} inspect={inspect} hover={hover} inCell={active?inCell:undefined} focused={active?s.mapFocus?.assetId:undefined}
      limitation={m.answerDelivery?undefined:notes?.limitation} onComplete={finish} animate={animate && !m.failed} open={refs=>setDrawer({refs,title:"本段来源与依据"})}
      savedActions={savedActions}/>
    <RetainedResearch message={m} open={ref=>{
      if(ref.kind==="asset"){void inspect(ref.id);return;}
      const evidence=savedWebDocument(ref,m);
      if(evidence)patch({evidence,previewKind:"text",inspector:null});
      else setDrawer({refs:[ref],title:"本轮保留的依据"});
    }}/>
    {m.answerDelivery && notes?.limitation && <details className="oe-retained-limitations">
      <summary>适用范围与限制</summary>
      <p>{notes.limitation}</p>
    </details>}
    {ready && <><AnswerMapContext message={m} locations={locations} cellCount={inCell.size} loading={!membership.members} error={membership.error} showCellRelation={showLiveMembership}/>
    {notes?.followUp && <p className="answer-question">{notes.followUp}</p>}
    {batch && remaining.length>0 && <details className="chat-role" onToggle={e=>setExpanded(e.currentTarget.open)}>
      <summary>{references.length ? "其他候选资料" : "本轮候选资料"}（{remaining.length}）<ChevronDown size={12}/></summary>
      {expanded && <div className="chat-role-body">{remaining.slice(0,limit).map(id=>{
        const asset=assetById.get(id);
        const layer=asset && (regionalForDataset(asset.datasetId) || (asset.datasetId==="gfs-wind"?"gfs-wind":null));
        return asset ? <div className="chat-role-item" key={id}><button onClick={()=>inspect(id)}>{asset.title} <ArrowUpRight size={12}/></button>
          {layer && <button className="chat-layer-link" onClick={()=>openVisualization(layer,null)}>在数据地球打开图层 <ArrowUpRight size={12}/></button>}<EntityVisualization asset={asset}/></div> : null;
      })}{limit<remaining.length && <button onClick={()=>setLimit(n=>n+20)}>显示更多资料</button>}</div>}
    </details>}
    {children}
    {m.activity && <button className="activity-link" onClick={()=>patch({evidence:m.activity!,previewKind:"trace"})}>查看完整执行记录 <ArrowUpRight size={12}/></button>}
    {!m.failed && <AnswerFooter message={m} question={question} refs={references} open={()=>setDrawer({refs:references,title:"本条回答的来源与依据"})}/>}
    </>}
    {drawer && <SourceDrawer {...drawer} message={message} archived={archived} question={question} close={()=>setDrawer(null)}/>}
  </>;
}
