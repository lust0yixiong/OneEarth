import {Fragment,useState} from "react";
import {Bookmark,ExternalLink,Globe,HardDrive,ChevronDown,FileText,ArrowUpRight,Layers} from "lucide-react";
import type {AccessRow} from "../domain/data-access";
import {observationContent} from "../domain/data-access";
import {assetById,assetIdentity,type Asset} from "../domain/datasets";
import {paperId,paperRecords} from "../domain/paper-record";
import {PaperEvidenceCard} from "./PaperEvidenceCard";
import {linkedPapers} from "../domain/answer-sources";
import {datasetLayers,regionalForDataset} from "../domain/regional-cases";
import {rainCoverageLabel,useRainCatalog} from "./use-rain-catalog";

const isRainLayer=(asset:AccessRow["asset"])=>asset.id===datasetLayers.rain && asset.datasetId===datasetLayers.rain;

export const accessStamp=(value:string)=>new Intl.DateTimeFormat("zh-CN",{timeZone:"Asia/Shanghai",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false}).format(new Date(value));
export interface AccessActions {
  inspect:(id:string)=>void;map:(ids:string[])=>void;compare:(id:string)=>void;favorite:(identity:string)=>void;visualize:(id:string)=>void;
  compared:string[];saved:string[];
}
const defaultCover="/brand/OneEarth-A02-line-refine-v15-black-512.png";
function Cover({row,open}:{row:AccessRow;open:()=>void}){
  const [failed,setFailed]=useState(false),[loaded,setLoaded]=useState(false);
  const url=!failed&&row.asset.card?.thumbnailUrl;
  return <button className="catalog-cover" data-default={!url} onClick={open} aria-label={"查看资料："+row.asset.title}>
    {url&&!loaded&&<img className="catalog-cover-pending" src={defaultCover} alt=""/>}
    <img src={url||defaultCover} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer"
      style={url&&!loaded?{opacity:0}:undefined} onLoad={()=>setLoaded(true)} onError={()=>setFailed(true)}/>
  </button>;
}
function Favorite({row,actions}:{row:AccessRow;actions:AccessActions}){
  const key=assetIdentity({...row.asset,tabs:[]}),saved=actions.saved.includes(key);
  return <button aria-label={saved?"取消收藏":"收藏资料"} aria-pressed={saved} onClick={()=>actions.favorite(key)}><Bookmark size={16} fill={saved?"currentColor":"none"}/></button>;
}
function Actions({row,actions,preview=false}:{row:AccessRow;actions:AccessActions;preview?:boolean}){
  const a=row.asset;
  return <div className="access-row-actions">
    {preview&&<button className="data-view-button" aria-label={"数据速览："+a.title} onClick={()=>actions.inspect(a.id)}>数据速览</button>}
    <button aria-pressed={actions.compared.includes(a.id)} onClick={()=>actions.compare(a.id)}>{actions.compared.includes(a.id)?"已选对照":"加入对照"}</button>
    {row.mappable&&<button onClick={()=>actions.map([a.id])}><Globe size={13}/>在球上查看</button>}
    <Favorite row={row} actions={actions}/>
  </div>;
}
export function EntityCards({rows,actions}:{rows:AccessRow[];actions:AccessActions}){
  return <div className="resource-waterfall access-entity-cards">{rows.map(row=>{
    const a=row.asset,tags=a.card?.tags.length?a.card.tags:a.categories;
    return <article className="catalog-card catalog-record" key={row.key}>
      <Cover key={a.card?.thumbnailUrl||a.id} row={row} open={()=>actions.inspect(a.id)}/>
      <h2>{a.title}</h2>
      <div className="access-holding"><HardDrive size={13}/>{a.holding?.channelName||"实体接入"}<span>{a.holding?.access==="restricted"?"按权限获取":a.holding?.access==="public"?"公共开放":a.holding?.access==="workspace"?"工作区可获取":"获取权限待核"}</span></div>
      <ul className="catalog-tags" aria-label="资料标签">{tags.slice(0,4).map(tag=><li key={tag}>{tag}</li>)}</ul>
      {a.profile?.coverage&&<p className="access-card-coverage">{a.profile.coverage}</p>}
      {(row.papers>0||row.evidenceKinds.length>0)&&<small className="access-card-evidence">{row.papers>0?`关联 ${row.papers} 篇论文`:row.evidenceKinds.join(" · ")}</small>}
      {row.ids.length>1&&<details className="catalog-related"><summary>查看该数据集的 {row.ids.length} 条持有记录</summary>{row.ids.map(id=><button key={id} onClick={()=>actions.inspect(id)}>{assetById.get(id)?.title||id}</button>)}</details>}
      <div className="catalog-card-actions">
        <button className="data-view-button" aria-label={"数据速览："+a.title} onClick={()=>actions.inspect(a.id)}>数据速览 <ArrowUpRight size={13}/></button>
        <button aria-pressed={actions.compared.includes(a.id)} onClick={()=>actions.compare(a.id)}>{actions.compared.includes(a.id)?"已选对照":"加入对照"}</button>
        {row.mappable&&<button onClick={()=>actions.map([a.id])}><Globe size={13}/>定位分布</button>}
        {regionalForDataset(a.datasetId)&&<button className="visualize-button" onClick={()=>actions.visualize(a.id)}><Layers size={13}/>在球上可视化</button>}
      </div>
      <footer className="catalog-card-footer">
        {a.card?.size&&<span aria-label={"数据大小 "+a.card.size}><HardDrive size={14}/>{a.card.size}</span>}
        {a.url&&<a href={a.url} target="_blank" rel="noreferrer" aria-label="打开发布来源"><ExternalLink size={14}/></a>}
        <div className="catalog-favorite"><Favorite row={row} actions={actions}/></div>
      </footer>
    </article>;
  })}</div>;
}
function ClueDetail({row,actions,status,rainCoverage}:{row:AccessRow;actions:AccessActions;status:string;rainCoverage?:string}){
  const a=row.asset;
  const description=rainCoverage ? assetById.get(datasetLayers.rain)?.description ?? "可用年月以 OneEarth 发布目录为准。" : a.description;
  const records=row.relatedIds.filter(paperId);
  const papers=records.filter(id=>paperRecords.get(id)?.assertionCatalogKind!=="metadata-only");
  const metadataOnly=records.length>0 && !papers.length;
  const attached=linkedPapers(assetById.get(a.id));
  return <section className="access-clue-detail" aria-label={a.title+"的依据"}>
    {status?<p role="status">{status}</p>:<>
      {!papers.length&&<section className="access-dataset-overview"><h3>数据集概览</h3><p>{description}</p>
        {metadataOnly&&<small>已收录数据集元数据，暂无关联论文用法。</small>}<dl>
        <dt>来源</dt><dd>{a.source}</dd>
        {rainCoverage ? <><dt>OneEarth 降水图层</dt><dd>{rainCoverage}</dd></> :
          a.profile?.coverage&&<><dt>空间与时间</dt><dd>{a.profile.coverage}{a.profile.years&&" · "+a.profile.years.join("—")}</dd></>}
        {a.profile?.access&&<><dt>获取方式</dt><dd>{a.profile.access}</dd></>}
      </dl></section>}
      {papers.map(id=><PaperEvidenceCard key={id} reference={{kind:"asset",id,title:assetById.get(id)?.title||a.title,source:assetById.get(id)?.source||a.source}}/>)}
      {!papers.length&&attached.length>0&&<section><h3>关联论文</h3>{attached.map(p=><p key={p.url||p.title}>{p.url?<a href={p.url} target="_blank" rel="noreferrer">{p.title} ↗</a>:p.title}</p>)}</section>}
      <div className="access-evidence-actions">
        <button onClick={()=>actions.inspect(a.id)}>打开完整资料 <ArrowUpRight size={13}/></button>
        {row.entityId&&<button onClick={()=>actions.inspect(row.entityId!)}><HardDrive size={13}/>查看已接入实体</button>}
        {a.url&&<a href={a.url} target="_blank" rel="noreferrer">发布来源 ↗</a>}
      </div>
    </>}
  </section>;
}
export function ClueIndex({rows,actions,expanded,status,expand}:{rows:AccessRow[];actions:AccessActions;expanded:string|null;status:string;expand:(row:AccessRow)=>void}){
  const publication=useRainCatalog(rows.some(row=>isRainLayer(row.asset)));
  return <div className="access-index" aria-label="数据线索索引">
    <div className="access-index-heading" aria-hidden="true"><span>数据集 / 变量与范围</span><span>来源依据</span><span>操作</span></div>
    {rows.map(row=>{const a=row.asset,open=expanded===row.key;
      const rainCoverage=isRainLayer(a)?rainCoverageLabel(publication):undefined;
      return <Fragment key={row.key}><article className="access-index-row catalog-record" data-expanded={open}>
        <div className="access-index-name"><button className="access-index-title" onClick={()=>expand(row)} aria-expanded={open}><h2>{a.title}</h2></button>
          <div className="access-index-meta">{[a.type,a.version,rainCoverage ?? a.profile?.years?.join("—")].filter(Boolean).join(" · ")}</div>
          <p>{a.profile?.coverage||a.source}</p>
        </div>
        <div className="access-index-sources"><span>{row.evidenceKinds.join(" · ")||"数据来源记录"}</span>
          {row.papers>0&&<small>{row.papers.toLocaleString()} 篇关联论文</small>}
          {row.entityId&&<button onClick={()=>actions.inspect(row.entityId!)}>已有实体 ↗</button>}
        </div>
        <div className="access-index-tools"><button className="access-expand" aria-label={(open?"收起依据：":"查看依据：")+a.title} aria-expanded={open} onClick={()=>expand(row)}><FileText size={14}/>{open?"收起依据":"查看依据"}<ChevronDown size={13}/></button><Actions row={row} actions={actions} preview/></div>
      </article>{open&&<ClueDetail row={row} actions={actions} status={status} rainCoverage={rainCoverage}/>}</Fragment>;
    })}
  </div>;
}
export function TimelyRows({rows,actions}:{rows:AccessRow[];actions:AccessActions}){
  return <div className="access-timely-list" aria-label="星座接收记录">
    <div className="access-timely-heading" aria-hidden="true"><span>接收时间（北京时间）</span><span>观测与产品</span><span>接收内容</span></div>
    {rows.map(row=>{const r=row.observation;if(!r)return null;
      return <article className="access-timely-row catalog-record" key={r.key}>
        <time dateTime={r.receivedAt}>{accessStamp(r.receivedAt)}</time>
        <div className="access-timely-product"><h2><button onClick={()=>actions.inspect(row.asset.id)}>{r.title}</button></h2>
          <p>{r.satellite} · {r.sourceName} · {r.collection}</p><small>观测 <time dateTime={r.observedAt}>{accessStamp(r.observedAt)}</time> · 修订 {r.revision}</small>
          <Actions row={row} actions={actions}/>
        </div>
        <div className="access-timely-status"><span>{observationContent(r)}</span>{r.file&&<small>{row.asset.card?.size||r.file.bytes+" B"}</small>}
          <button onClick={()=>actions.inspect(row.asset.id)}>查看记录 <ArrowUpRight size={13}/></button>
        </div>
      </article>;
    })}
  </div>;
}
