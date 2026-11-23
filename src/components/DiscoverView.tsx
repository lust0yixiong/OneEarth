import {useEffect,useMemo,useRef,useState} from "react";
import {Bookmark,Database,ListFilter,Radio,RefreshCw,Globe} from "lucide-react";
import {BatchContext,ResearchListLibrary,SaveResearchList} from "./ResearchLists";
import {ResearchAssessment} from "./ResearchAssessment";
import {BatchSpatialSummary} from "./BatchSpatialSummary";
import {catalogBatch} from "../domain/batch-context";
import {assetById,assetIdentity,loadRemoteAssetIds,registerObservations,type Asset} from "../domain/datasets";
import {emptyFilters} from "../domain/spatial";
import {comparison} from "../domain/results";
import {useWorkspace} from "../domain/store";
import {accessSections,initialAccessSection,type AccessPage,type AccessQuery,type AccessRow,type AccessSection} from "../domain/data-access";
import {readAccessPage} from "../domain/data-access-client";
import {EntityCards,ClueIndex,TimelyRows,accessStamp,type AccessActions} from "./DataAccessRows";
import {regionalForDataset} from "../domain/regional-cases";
import "../styles/data-access.css";

export function DiscoverView(){
  const {state:s,patch,inspectAsset,mapCandidates,toggleSaved,leaveDetail,openCatalog,openVisualization}=useWorkspace();
  const search=s.search,section=initialAccessSection(search),scope=search.result?.filters||emptyFilters();
  const [data,setData]=useState<AccessPage|null>(null),[incoming,setIncoming]=useState<AccessPage|null>(null);
  const [loading,setLoading]=useState(true),[error,setError]=useState(""),[reload,setReload]=useState(0);
  const [expanded,setExpanded]=useState<string|null>(null),[evidenceStatus,setEvidenceStatus]=useState("");
  const [connected,setConnected]=useState(false),[streamError,setStreamError]=useState("");
  const [busy,setBusy]=useState(false);
  const element=useRef<HTMLElement>(null),currentData=useRef(data),latestSearch=useRef(search),actionVersion=useRef(0);
  const expansionVersion=useRef(0);
  currentData.current=data;latestSearch.current=search;
  const queryKey=JSON.stringify({section,query:search.query,type:search.type,source:search.source,page:search.page||0,limit:30,
    capability:search.capability,ids:search.result?.ids,
    ...(search.savedOnly?(search.savedIds?{savedIds:search.savedIds}:{savedIdentities:s.saved}):{}),
    scope:{period:scope.period,utcWindow:scope.utcWindow}});
  const query=useMemo(()=>JSON.parse(queryKey) as AccessQuery,[queryKey]);
  function set(changes:Partial<typeof search>){patch({search:{...latestSearch.current,...changes,page:0,pageIds:undefined,compare:[]},inspector:null,evidence:null});}
  function accept(page:AccessPage){
    registerObservations(page.rows.flatMap(r=>r.observation?[r.observation]:[]));
    setData(page);setIncoming(null);setError("");setStreamError("");
    const ids=page.rows.map(r=>r.asset.id),old=latestSearch.current;
    if(JSON.stringify(old.pageIds)!==JSON.stringify(ids)||old.page!==page.page)patch({search:{...old,page:page.page,pageIds:ids}});
  }
  useEffect(()=>{
    const controller=new AbortController(),version=++actionVersion.current;
    setLoading(true);setError("");setData(null);setIncoming(null);setExpanded(null);setEvidenceStatus("");
    const timer=setTimeout(()=>void readAccessPage(query,controller.signal).then(page=>{
      if(controller.signal.aborted||actionVersion.current!==version)return;
      if(!latestSearch.current.section&&!page.total){
        const other=(Object.keys(accessSections) as AccessSection[]).find(k=>page.counts[k]>0);
        if(other){patch({search:{...latestSearch.current,section:other,page:0,pageIds:undefined}});return;}
      }
      accept(page);setLoading(false);
    }).catch(e=>{if(!controller.signal.aborted){setError(e instanceof Error?e.message:"数据索引读取失败。");setLoading(false);}}),180);
    return ()=>{clearTimeout(timer);controller.abort();actionVersion.current++;};
  },[queryKey,reload]);
  useEffect(()=>{
    if(section!=="timely")return;
    const controller=new AbortController();let checking=false;
    async function check(){
      if(checking||controller.signal.aborted||!currentData.current||document.visibilityState==="hidden")return;
      checking=true;
      try{
        const page=await readAccessPage({...query,page:0},controller.signal),old=currentData.current;
        if(!controller.signal.aborted&&old&&page.total>old.total){setIncoming(page);setStreamError("");}
      }catch{if(!controller.signal.aborted)setStreamError("暂时无法检查新接收记录，已保留当前列表。");}
      finally{checking=false;}
    }
    const events=new EventSource("/api/constellations/events");
    events.onopen=()=>setConnected(true);events.onerror=()=>setConnected(false);
    events.addEventListener("observation",check);events.addEventListener("ready",check);
    const timer=setInterval(check,30000);
    const visible=()=>{if(document.visibilityState==="visible")void check();};
    document.addEventListener("visibilitychange",visible);
    return ()=>{controller.abort();events.close();clearInterval(timer);document.removeEventListener("visibilitychange",visible);};
  },[section,queryKey]);
  useEffect(()=>()=>{actionVersion.current++;},[]);
  const rows=data?.rows||[],ids=rows.map(r=>r.asset.id);
  const batch=catalogBatch(search,ids,s.camera,s.gridSystem);
  const selectedIds=search.compare;
  const compared=selectedIds.flatMap(id=>assetById.get(id)||[]);
  const assessed={...batch,ids:selectedIds.length?selectedIds:batch.ids};
  async function hydrated(ids:string[],work:()=>void){
    const version=actionVersion.current;
    setBusy(true);
    try{await loadRemoteAssetIds(ids);if(version!==actionVersion.current)return;
      if(ids.some(id=>!assetById.has(id)))throw Error("部分资料详情尚未取得，请重试。");
      work();
    }catch(e){if(version===actionVersion.current)patch({error:e instanceof Error?e.message:"资料读取失败。"});}
    finally{setBusy(false);}
  }
  const actions:AccessActions={
    inspect:id=>void hydrated([id],()=>inspectAsset(id,scope,search.result?.selection||null,batch)),
    map:ids=>void hydrated(ids,()=>mapCandidates(ids)),
    compare:id=>void hydrated([id],()=>{const old=latestSearch.current;patch({search:{...old,compare:old.compare.includes(id)?old.compare.filter(v=>v!==id):[...old.compare,id]}});}),
    favorite:toggleSaved,compared:selectedIds,saved:s.saved,
    visualize:id=>void hydrated([id],()=>{const layer=regionalForDataset(assetById.get(id)?.datasetId||"");if(layer)openVisualization(layer,null);else patch({error:"该数据集暂无可上球图层。"});}),
  };
  async function expand(row:AccessRow){
    const request=++expansionVersion.current;
    if(expanded===row.key){setExpanded(null);return;}
    const version=actionVersion.current;setExpanded(row.key);setEvidenceStatus("正在读取数据集与来源依据…");
    try{await loadRemoteAssetIds(row.relatedIds);
      if(version===actionVersion.current&&request===expansionVersion.current){if(row.relatedIds.some(id=>!assetById.has(id)))throw Error("部分来源详情尚未取得，可重试或打开发布来源。");setEvidenceStatus("");}
    }catch(e){if(version===actionVersion.current&&request===expansionVersion.current)setEvidenceStatus(e instanceof Error?e.message:"来源依据读取失败。");}
  }
  function chooseSection(next:AccessSection){set({section:next,source:"",kind:"all"});}
  const icons={entities:Database,clues:ListFilter,timely:Radio};
  const sourceOptions=data?.sources||[],typeOptions=data?.types||[];
  const statusSources=data?.stream?.sources||[];
  const channelRows=statusSources.length?statusSources.map(c=>({...c,...data?.channels.find(v=>v.id===c.id)})):data?.channels.map(c=>({...c,name:c.name}))||[];
  return <section className="discover-view data-access-view" ref={element}>
    <header className="page-heading"><h1>数据触达</h1><div className="catalog-library-actions">
      <button className="library-entry" aria-pressed={s.listLibraryOpen} onClick={()=>patch({listLibraryOpen:!s.listLibraryOpen,inspector:null,evidence:null})}>研究清单</button>
      <button className="saved-toggle" aria-pressed={search.savedOnly} onClick={()=>set({savedOnly:!search.savedOnly,savedIds:undefined})}><Bookmark size={14}/>{search.savedOnly?"全部资料":"我的收藏"}<span>{s.saved.length}</span></button>
    </div></header>
    {s.listLibraryOpen&&<ResearchListLibrary/>}
    {search.result&&<div className="result-context"><strong>{search.result.title}</strong><BatchContext batch={{...batch,ids:search.result.ids}}/>
      {s.origin?.view==="earth"&&<button onClick={leaveDetail}>返回之前的球面</button>}<button onClick={openCatalog}>浏览全部资料</button></div>}
    <nav className="access-sections" aria-label="数据触达类别" role="tablist">{(Object.entries(accessSections) as [AccessSection,string][]).map(([key,label])=>{
      const Icon=icons[key];return <button key={key} role="tab" id={"access-tab-"+key} aria-controls="access-panel" aria-selected={section===key} onClick={()=>chooseSection(key)}><Icon size={17}/>{label}{data&&<span>{data.counts[key].toLocaleString()}</span>}</button>;
    })}</nav>
    <div className="discovery-filters">
      <select aria-label="筛选数据形态" value={search.type} onChange={e=>set({type:e.target.value})}><option value="">全部数据类型</option>
        {search.type&&!typeOptions.includes(search.type)&&<option value={search.type}>{search.type}</option>}{typeOptions.map(t=><option key={t}>{t}</option>)}</select>
      <select aria-label="筛选数据来源" value={search.source} onChange={e=>set({source:e.target.value})}><option value="">全部接入来源</option>
        {search.source&&!sourceOptions.some(v=>v.id===search.source)&&<option value={search.source}>{search.source}</option>}{sourceOptions.map(o=><option key={o.id} value={o.id}>{o.label}</option>)}</select>
    </div>
    {search.query.trim() && <div className="access-query-filter">
      <span>当前筛选词 <strong>{search.query}</strong></span>
      <button onClick={()=>set({query:""})}>清除筛选词</button>
    </div>}
    <div className="access-tools"><div className="catalog-capabilities" aria-label="按可用资料筛选">{[["","全部本类"],["map","可在球上定位"],["request","需申请资料"]].map(([v,label])=><button key={v} aria-pressed={(search.capability||"")===v} onClick={()=>set({capability:v as typeof search.capability})}>{label}</button>)}</div>
      <button className="access-refresh" disabled={loading} onClick={()=>setReload(n=>n+1)} aria-label="刷新数据触达"><RefreshCw size={14}/>刷新</button></div>
    <div id="access-panel" role="tabpanel" aria-labelledby={"access-tab-"+section} aria-busy={loading}>
      {section==="entities"&&<p className="access-section-note">实验室持有的数据实体；范围和文件内容以实际持有清单为准。</p>}
      {section==="clues"&&<div className="access-section-note"><span>按数据集与版本汇聚来源依据</span><small>网页存证尚未接入</small></div>}
      {section==="timely"&&<>
        <div className="access-stream-status"><span><i data-connected={connected}/>{connected?"接收更新已连接":"接收更新正在连接"}</span><span>已配置 {data?.stream?.configured??s.pushFeed?.configured??0} 个来源</span></div>
        {!!channelRows.length&&<div className="access-channels">{channelRows.map(c=><section key={c.id}><strong>{c.name}</strong><span>{c.count?.toLocaleString()||0} 条接收记录</span><small>{c.latest?"最近接收 "+accessStamp(c.latest):"等待首条观测"}</small></section>)}</div>}
        {incoming&&data&&<div className="access-incoming" role="status"><span>新接收 {incoming.total-data.total} 条记录</span><button onClick={()=>{if(query.page){patch({search:{...latestSearch.current,page:0,pageIds:undefined}});}else accept(incoming);setIncoming(null);element.current?.scrollTo({top:0});}}>查看新增</button></div>}
        {streamError&&<p className="access-error" role="status">{streamError}</p>}
      </>}
      {loading&&<p className="access-loading" role="status">正在检索{accessSections[section]}…</p>}
      {error&&<div className="access-error" role="alert">{error}<button onClick={()=>setReload(n=>n+1)}>重试</button></div>}
      {!loading&&!error&&data&&<>
        <div className="result-caption access-result-caption"><span>{data.total.toLocaleString()} {section==="timely"?"条接收记录":"个数据集"}{data.total>data.limit?` · 本页 ${data.page*data.limit+1}—${Math.min(data.total,(data.page+1)*data.limit)}`:""}</span>
          {!!rows.some(r=>r.mappable)&&<button disabled={busy} onClick={()=>actions.map(ids)}><Globe size={13}/>{data.pages>1?"在球上查看本页":"在球上查看这批数据"}</button>}
          {!!selectedIds.length&&<div><button disabled={busy||selectedIds.length<2} onClick={()=>void hydrated(selectedIds,()=>patch({inspector:{comparedBatch:assessed,comparison:comparison(compared,scope,search.result?.selection)},evidence:null}))}>比较已选（{selectedIds.length}）</button><button onClick={()=>patch({search:{...search,compare:[]}})}>清除选择</button></div>}
        </div>
        {!!ids.length&&<section className="research-decisions"><div className="research-decision-tools"><strong>{selectedIds.length?"已选 "+selectedIds.length+" 项":data.pages>1?"本页资料":"当前资料"}</strong><SaveResearchList batch={assessed} selected={!!selectedIds.length}/></div>
          {compared.length>0&&compared.length===selectedIds.length&&<><ResearchAssessment batch={assessed}/><BatchSpatialSummary batch={assessed}/></>}
        </section>}
        {section==="entities"&&<EntityCards rows={rows} actions={actions}/>}
        {section==="clues"&&<ClueIndex rows={rows} actions={actions} expanded={expanded} status={evidenceStatus} expand={row=>void expand(row)}/>}
        {section==="timely"&&<TimelyRows rows={rows} actions={actions}/>}
        {!rows.length&&<div className="empty-state">{section==="timely"&&!data.stream?.configured&&!data.total?"尚未配置星座接收来源，接入后将在这里显示真实接收记录。":"当前条件下没有匹配的"+accessSections[section]+"。"}
          <button onClick={()=>set({query:"",type:"",source:"",savedOnly:false,capability:""})}>清除筛选</button></div>}
        {data.pages>1&&<nav className="access-pagination" aria-label="数据触达分页"><button disabled={!data.page} onClick={()=>patch({search:{...search,page:data.page-1,pageIds:undefined}})}>上一页</button><span>{data.page+1} / {data.pages}</span><button disabled={data.page+1>=data.pages} onClick={()=>patch({search:{...search,page:data.page+1,pageIds:undefined}})}>下一页</button></nav>}
      </>}
    </div>
  </section>;
}
