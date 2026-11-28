import {useEffect,useRef,useState} from "react";
import {cancelWorkspaceDiscovery,DiscoveryNotAccepted,loadWorkspaceDiscovery,newWorkspaceDiscoveryHandle,
  readWorkspaceDiscoveryAdmission,removeWorkspaceDiscovery,saveWorkspaceDiscovery,savedWorkspaceDiscoveries,
  submitWorkspaceDiscovery,type WorkspaceDiscoveryHandle} from "../domain/workspace-discovery-client";
import {workspaceDiscoveryIntent,workspaceDiscoveryQuery,type WorkspaceDiscoveryReference,type WorkspaceDiscoveryView} from "../domain/workspace-discovery";

const statusText:Record<WorkspaceDiscoveryView["status"],string>={
  queued:"等待查找",running:"正在查找", "waiting-input":"等待补充条件",complete:"查找完成",failed:"查找失败",cancelled:"查找已取消",
};
const isActive=(view:WorkspaceDiscoveryView)=>view.status==="queued" || view.status==="running" || view.status==="waiting-input";

type Props={
  conversationId:string;
  draft:string;
  expectedRevision?:number;
  refreshRevision:()=>Promise<number>;
  onReference:(reference:WorkspaceDiscoveryReference,query:string)=>void;
};

export function WorkspaceDiscoveryPanel({conversationId,draft,expectedRevision,refreshRevision,onReference}:Props){
  const [handles,setHandles]=useState(()=>savedWorkspaceDiscoveries(conversationId));
  const [selected,setSelected]=useState<string>();
  const [view,setView]=useState<WorkspaceDiscoveryView>();
  const [expanded,setExpanded]=useState(true);
  const [submitNotice,setSubmitNotice]=useState("");
  const [readNotice,setReadNotice]=useState("");
  const [submitting,setSubmitting]=useState(false);
  const [cancelling,setCancelling]=useState<string>();
  const [readVersion,requestRead]=useState(0);
  const submittingRef=useRef(false);
  const handle=handles.find(item=>item.actionId===selected) ?? handles[0];
  const current=view?.actionId===handle?.actionId ? view : undefined;
  const query=workspaceDiscoveryIntent(draft) ?? workspaceDiscoveryQuery(draft);

  useEffect(()=>{
    setReadNotice("");
    if(!handle)return;
    const controller=new AbortController();
    let timer:ReturnType<typeof setTimeout>|undefined;
    let operationId=handle.operationId;
    let missing=0;
    let failures=0;
    async function poll(){
      if(!handle || controller.signal.aborted)return;
      try {
        const id=operationId ?? await readWorkspaceDiscoveryAdmission(conversationId,handle,controller.signal);
        if(controller.signal.aborted)return;
        if(!id){
          if(++missing<12)timer=setTimeout(poll,1200);
          else setReadNotice("暂时无法确认是否已受理。可以再次读取原操作。");
          return;
        }
        if(!operationId){
          operationId=id;
          // Retaining the original action ID and key is enough to reopen even if this update cannot be saved.
          try {saveWorkspaceDiscovery(conversationId,{...handle,operationId:id});} catch {}
        }
        const next=await loadWorkspaceDiscovery(conversationId,{...handle,operationId:id},controller.signal);
        if(controller.signal.aborted)return;
        failures=0;
        setReadNotice("");
        setView(previous=>previous?.operationId===next.operationId && !isActive(previous) ? previous : next);
        if(isActive(next))timer=setTimeout(poll,1200);
      } catch {
        if(controller.signal.aborted)return;
        if(++failures<3)timer=setTimeout(poll,1200);
        else setReadNotice("暂时无法读取原查找操作。");
      }
    }
    void poll();
    return ()=>{controller.abort();if(timer!==undefined)clearTimeout(timer);};
  },[conversationId,handle,readVersion]);

  async function start(){
    if(!query || submittingRef.current)return;
    submittingRef.current=true;
    setSubmitting(true);
    setSubmitNotice("");
    try {
      const revision=expectedRevision ?? await refreshRevision().catch(()=>{throw Error("暂时无法核对会话研究状态，请重试。");});
      const pending=newWorkspaceDiscoveryHandle();
      try {saveWorkspaceDiscovery(conversationId,pending);} catch {throw Error("浏览器无法保存查找编号，操作未提交。");}
      let accepted:WorkspaceDiscoveryHandle=pending;
      try {
        const operationId=await submitWorkspaceDiscovery(conversationId,pending,revision,query);
        accepted={...pending,operationId};
        try {saveWorkspaceDiscovery(conversationId,accepted);} catch {}
      } catch(error){
        if(error instanceof DiscoveryNotAccepted){
          try {removeWorkspaceDiscovery(conversationId,pending.actionId);} catch {}
          if(error.revisionConflict)void refreshRevision().catch(()=>undefined);
          throw error;
        }
      }
      setHandles(items=>[accepted,...items.filter(item=>item.actionId!==accepted.actionId)].slice(0,8));
      setSelected(accepted.actionId);
      setExpanded(true);
    } catch(error){
      setSubmitNotice(error instanceof Error ? error.message : "暂时无法提交查找。");
    } finally {
      submittingRef.current=false;
      setSubmitting(false);
    }
  }

  async function cancel(){
    if(!handle || !current || !isActive(current) || cancelling===handle.actionId)return;
    setCancelling(handle.actionId);
    setSubmitNotice("");
    try {await cancelWorkspaceDiscovery(conversationId,{...handle,operationId:current.operationId});}
    catch {setSubmitNotice("取消结果待确认，正在读取原操作。");}
    finally {setCancelling(undefined);requestRead(version=>version+1);}
  }

  const index=handles.findIndex(item=>item.actionId===handle?.actionId);
  const result=current?.result;
  return <section className="workspace-discovery" aria-label="查找资料">
    <div className="workspace-discovery-controls">
      <button type="button" className="activity-link" disabled={!query || submitting} onClick={()=>void start()}
        title="使用输入框的内容查找资料">{submitting?"正在提交查找…":"查找资料"}</button>
      {handle && <button type="button" className="activity-link" aria-expanded={expanded} onClick={()=>setExpanded(value=>!value)}>
        {expanded?"收起查找记录":"查看查找记录"}
      </button>}
    </div>
    {submitNotice && <p role="alert">{submitNotice}</p>}
    {draft.trim() && !query && <p>查找内容最多 800 字。</p>}
    {handle && expanded && <div className="workspace-discovery-record" data-operation-id={current?.operationId}>
      {handles.length>1 && <nav aria-label="近期查找记录" className="workspace-discovery-controls">
        <button type="button" className="activity-link" disabled={index>=handles.length-1} onClick={()=>setSelected(handles[index+1]?.actionId)}>较早</button>
        <button type="button" className="activity-link" disabled={index===0} onClick={()=>setSelected(handles[index-1]?.actionId)}>较新</button>
      </nav>}
      {current?.query && <p className="workspace-discovery-query">{current.query}</p>}
      <div className="workspace-discovery-controls">
        <p role="status">{current ? current.status==="complete" && result && !result.complete ? "查找部分完成" : statusText[current.status] :
          readNotice || "正在读取原查找操作…"}</p>
        {current && isActive(current) && <button type="button" className="activity-link" disabled={cancelling===handle.actionId}
          onClick={()=>void cancel()}>{cancelling===handle.actionId?"正在取消…":"取消查找"}</button>}
        {readNotice && <button type="button" className="activity-link" onClick={()=>requestRead(version=>version+1)}>重新读取</button>}
      </div>
      {current && readNotice && <p role="alert">{readNotice}</p>}
      {result && <>
        {result.limitation && <p>{result.limitation}</p>}
        {result.items.length===0 && <p>没有返回资料条目。</p>}
        {result.items.length>0 && <ul>
          {result.items.map(item=><li key={item.kind+":"+item.id}>
            {item.url ? <a href={item.url} target="_blank" rel="noopener noreferrer">{item.title}</a> : <strong>{item.title}</strong>}
            <small>{item.kind==="paper"?"论文":"数据集"} · {item.source}</small>
            {item.excerpt && <p>{item.excerpt}</p>}
          </li>)}
        </ul>}
        {current.status==="complete" && result.items.length>0 && <button type="button" className="activity-link" onClick={()=>{
          onReference({operationId:current.operationId,batchId:result.batchId,accessKey:handle.accessKey},result.query);
          setExpanded(false);
        }}>引用到 Chat</button>}
      </>}
    </div>}
  </section>;
}
