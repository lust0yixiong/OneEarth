import {CitationIcon} from "./CitationIcon";
import {citationDetails} from "../domain/answer-sources";
import {useEffect,useMemo,useState} from "react";
import {assetById} from "../domain/datasets";
import {paperId,paperRecords,type PaperDatasetEvidence} from "../domain/paper-record";
import {doiFor,paperCards,linkedPapers,type AssetReference} from "../domain/answer-sources";

type Paper=PaperDatasetEvidence["papers"][number];
function savedPapers(id:string):Paper[] {
  const tabs=paperRecords.get(id)?.need.tabs || assetById.get(id)?.tabs || [];
  const cards=paperCards(id);
  return (tabs.find(t=>t.label==="论文用法（本页）")?.rows||[]).map(row=>{
    const title=String(row[0]||row[4]||"论文");
    return {
      paperId:String(row[4]),datasetId:String(row[5]),title,abstract:null,
      usage:String(row[1]||""),variables:String(row[2]||""),context:String(row[3]||""),
      quotes:cards.filter(c=>c.type==="原文" && c.title===title)
        .map(c=>({blockId:"",section:c.section||"",quote:c.text,claims:[]})),
    };
  });
}
function isMethod(q:Paper["quotes"][number]) {
  return /method|methodology|configuration|procedure|data processing|observations|experimental|研究方法|方法|实验|数据处理/i.test(q.section)
    || q.claims.some(claim=>/method|workflow|step/.test(claim));
}
function Quote({quote}:{quote:Paper["quotes"][number]}) {
  return <blockquote><small>{[quote.section,quote.blockId].filter(Boolean).join(" · ") || "论文原文"}</small><p>{quote.quote}</p></blockquote>;
}
function EvidenceText({text}:{text:string}) {
  const [full,setFull]=useState(false);
  const long=text.length>420;
  return <><p className={long && !full?"oe-evidence-excerpt":undefined}>{text}</p>
    {long && <button className="oe-expand-evidence" aria-expanded={full} onClick={()=>setFull(!full)}>{full?"收起全文":"展开全文"}</button>}
  </>;
}
function metadataText(raw:string|null|undefined) {
  if(!raw)return "";
  try{
    const parsed=JSON.parse(raw);
    if(Array.isArray(parsed))return [...new Set(parsed.filter(v=>typeof v==="string").map(v=>v.trim()).filter(Boolean))].join("\n");
  }catch{/* Plain metadata text. */}
  return raw;
}
const cache=new Map<string,PaperDatasetEvidence>();
function AssertionPaperEvidence({reference:r}:{reference:AssetReference}) {
  const [expanded,setExpanded]=useState(true);
  const [data,setData]=useState(()=>cache.get(r.id));
  const [status,setStatus]=useState<"loading"|"ready"|"failed">(data?"ready":"loading");
  const [attempt,retry]=useState(0);
  const fallback=useMemo(()=>savedPapers(r.id),[r.id]);
  const a=assetById.get(r.id),doi=doiFor(r.id);
  const dataset=data?.dataset;
  const resolution=[metadataText(dataset?.spatialResolution),metadataText(dataset?.temporalResolution)].filter(Boolean).join("\n");
  const rows=paperRecords.get(r.id)?.need.tabs.find(t=>t.label==="论文用法（本页）")?.rows || [];
  const paperDoi=(paperId:string,datasetId:string)=>{
    const row=rows.find(row=>row[4]===paperId && row[5]===datasetId);
    return typeof row?.[6]==="string" && /^10\.\S+$/.test(row[6])?row[6]:undefined;
  };
  const papers=data?.papers.length?data.papers:fallback;
  useEffect(()=>{
    if(!expanded || data)return;
    const controller=new AbortController();
    setStatus("loading");
    fetch("/api/paper-records/"+encodeURIComponent(r.id)+"/evidence",{
      signal:AbortSignal.any([controller.signal,AbortSignal.timeout(20000)]),
    }).then(async response=>{
      if(!response.ok)throw Error();
      const result:PaperDatasetEvidence=await response.json();
      if(controller.signal.aborted)return;
      cache.set(r.id,result);
      if(cache.size>128)cache.delete(cache.keys().next().value!);
      setData(result);setStatus("ready");
    }).catch(()=>{if(!controller.signal.aborted)setStatus("failed");});
    return ()=>controller.abort();
  },[r.id,expanded,attempt]);
  return <details className="oe-paper" open={expanded} onToggle={e=>setExpanded(e.currentTarget.open)}>
    <summary><CitationIcon type={citationDetails(r).type}/> <span>{dataset?.title || r.title}</span></summary>
    <section className="oe-dataset-overview" aria-label="数据集说明">
      {dataset?.description && <EvidenceText text={dataset.description}/>}
      <dl>
        {dataset?.publisher && <><dt>发布方</dt><dd>{metadataText(dataset.publisher)}</dd></>}
        {dataset?.version && <><dt>版本</dt><dd>{metadataText(dataset.version)}</dd></>}
        {dataset?.resourceType && <><dt>类型</dt><dd>{metadataText(dataset.resourceType)}</dd></>}
        {resolution && <><dt>分辨率记录</dt><dd><details><summary>查看来源记录</summary><EvidenceText text={resolution}/></details></dd></>}
        {a?.profile?.coverage && <><dt>覆盖范围</dt><dd>{a.profile.coverage}</dd></>}
        {doi && <><dt>数据集 DOI</dt><dd><a href={"https://doi.org/"+doi} target="_blank" rel="noreferrer">{doi}</a></dd></>}
      </dl>
      {!dataset?.description && status!=="loading" && <small>数据集简介尚未取得，可通过 DOI 核对发布方说明。</small>}
      <small>数据集元数据与论文用法来自文献资料</small>
    </section>
    {status==="loading" && <p role="status">正在读取论文摘要与原文…</p>}
    {status==="failed" && <p className="oe-evidence-error" role="status">论文摘要与原文暂时无法补取。<button onClick={()=>retry(n=>n+1)}>重试</button></p>}
    {papers.map(p=>{
      const method=p.quotes.filter(isMethod),evidence=p.quotes.filter(q=>!isMethod(q));
      const doi=paperDoi(p.paperId,p.datasetId);
      return <article className="oe-paper-study" key={p.paperId+":"+p.datasetId}>
        <h3><CitationIcon type="paper"/> {p.title}</h3>
        {doi && <a href={"https://doi.org/"+doi} target="_blank" rel="noreferrer">论文 DOI {doi}</a>}
        <section><h4>论文摘要</h4>{p.abstract?<EvidenceText text={p.abstract}/>:<small>本轮资料尚未取得论文摘要。</small>}</section>
        <details className="oe-paper-method-detail"><summary>研究方法与数据用法</summary>
          {p.usage && <p>{p.usage}</p>}
          {p.variables && <p><b>使用变量</b> {p.variables}</p>}
          {p.context && <p><b>研究背景</b> {p.context}</p>}
          {!!p.methods?.length && <ol className="oe-paper-methods">{p.methods.map(step=><li key={step.stepId}>
            <b>{step.name}</b>{step.purpose && <p>{step.purpose}</p>}{step.method && <p>{step.method}</p>}
          </li>)}</ol>}
          {method.map(q=><Quote key={q.blockId+q.section+q.quote} quote={q}/>)}
          {!p.usage && !p.variables && !method.length && !p.methods?.length && <small>本轮资料尚未取得研究方法。</small>}
        </details>
        <details className="oe-paper-evidence-detail"><summary>支撑证据 · {p.quotes.length} 条原文</summary>{evidence.map(q=><Quote key={q.blockId+q.section+q.quote} quote={q}/>)}
          {!evidence.length && <small>{method.length?"关联原文见上方研究方法。":"本轮资料尚未取得关联原文。"}</small>}
        </details>
      </article>;
    })}
  </details>;
}

function StoredTab({tab}:{tab:import("../domain/types").EvidenceTab}) {
  return <section className="oe-saved-paper-tab">
    <h4>{tab.label}</h4>
    {tab.before && <p>{tab.before}</p>}
    {tab.quote && <blockquote><p>{tab.quote}</p></blockquote>}
    {tab.body && <EvidenceText text={tab.body}/>}
    {tab.rows?.length && <div className="answer-table"><table>
      {tab.columns && <thead><tr>{tab.columns.map((label,i)=><th key={i}>{label}</th>)}</tr></thead>}
      <tbody>{tab.rows.map((row,i)=><tr key={i}>{row.map((value,j)=><td key={j}>{String(value??"")}</td>)}</tr>)}</tbody>
    </table></div>}
    {tab.url && /^https?:\/\//.test(tab.url) && <a href={tab.url} target="_blank" rel="noreferrer">查看来源原页 ↗</a>}
  </section>;
}

function CuratedPaperEvidence({reference:r}:{reference:AssetReference}) {
  const a=assetById.get(r.id),doi=doiFor(r.id);
  const sources=linkedPapers(a);
  const local=a?.origins.includes("haina") || a?.datasetId.startsWith("haina:");
  return <details className="oe-paper" open>
    <summary><CitationIcon type={citationDetails(r).type}/> <span>{r.title}</span></summary>
    <section className="oe-dataset-overview" aria-label="数据集说明">
      {a?.description && <EvidenceText text={a.description}/>}
      <dl>
        {a?.type && <><dt>资料类型</dt><dd>{a.type}</dd></>}
        {a?.source && <><dt>来源</dt><dd>{a.source}</dd></>}
        {a?.profile?.coverage && <><dt>覆盖说明</dt><dd>{a.profile.coverage}</dd></>}
        {doi && <><dt>数据集 DOI</dt><dd><a href={"https://doi.org/"+doi} target="_blank" rel="noreferrer">{doi}</a></dd></>}
      </dl>
      {a?.url && /^https?:\/\//.test(a.url) && <a href={a.url} target="_blank" rel="noreferrer">数据与资料入口 ↗</a>}
    </section>
    {(sources.length?sources:[{title:a?.source || r.source}]).map(source=>{
      const tabs=source.tabs || (!local && sources.length<=1?a?.tabs||[]:[]);
      const methods=tabs.filter(t=>/方法|处理流程|匹配条件/.test(t.label));
      const evidence=tabs.filter(t=>!methods.includes(t));
      return <article className="oe-paper-study" key={source.url || source.title}>
        <h3><CitationIcon type="paper"/> {source.title}</h3>
        {source.url && /^https?:\/\//.test(source.url) && <a href={source.url} target="_blank" rel="noreferrer">论文原页 ↗</a>}
        <section><h4>论文摘要</h4>{source.abstract?<EvidenceText text={source.abstract}/>:<small>当前收录的论文记录尚未包含摘要。</small>}</section>
        <details className="oe-paper-method-detail"><summary>研究方法与数据用法</summary>
          {!local && sources.length<=1 && a?.description && <EvidenceText text={a.description}/>}
          {methods.map((tab,i)=><StoredTab key={i} tab={tab}/>)}
          {local && !methods.length && <small>当前关联记录尚未包含研究方法。</small>}
        </details>
        <details className="oe-paper-evidence-detail"><summary>支撑证据 · {evidence.length} 项材料</summary>
          {evidence.map((tab,i)=><StoredTab key={i} tab={tab}/>)}
          {!evidence.length && <small>本轮未保存支撑原文。</small>}
        </details>
      </article>;
    })}
  </details>;
}

export function PaperEvidenceCard({reference}:{reference:AssetReference}) {
  return paperId(reference.id)?<AssertionPaperEvidence reference={reference}/>:<CuratedPaperEvidence reference={reference}/>;
}
