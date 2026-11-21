import { Check, LoaderCircle, CircleAlert, CircleMinus } from "lucide-react";
import type { SearchRun } from "../domain/types";

export function SearchSteps({runs}:{runs:SearchRun[]}) {
  return <ol className="search-steps" aria-label="联网检索步骤">{runs.map(r=>
    <li key={r.engine+r.query} data-status={r.status}><details><summary>
      {r.status==="running"?<LoaderCircle size={13} className="spin"/>:r.status==="failed"?<CircleAlert size={13}/>:r.hits.length?<Check size={13}/>:<CircleMinus size={13}/>}
      <span className="search-query"><b>{r.engine==="DataCite"?"DataCite 数据集":r.engine==="PDF 原文"?"PDF 原文":r.engine==="原站读取"?"原站正文读取":r.engine+" 网页"}</b> · {r.query}</span>
      <small>{r.status==="running"?(r.engine==="原站读取"?"读取中":"检索中"):r.status==="failed"?(r.engine==="原站读取"?"读取失败":"检索失败"):r.hits.length?r.hits.length+" 条结果":"无匹配结果"}</small>
    </summary>
    {r.total!==undefined && <p className="search-meta">索引匹配 {r.total.toLocaleString()} 条，本次返回 {r.hits.length} 条；仍需核对研究条件。</p>}
    {r.hits.map(h=><div className="search-hit" key={h.url}>
      <a href={h.url} target="_blank" rel="noreferrer">{h.title}</a>
      {r.engine==="PDF 原文" && h.pageExcerpt?<p style={{whiteSpace:"pre-line"}}>{h.pageExcerpt}</p>:h.snippet && <p>{h.snippet}</p>}
      {(h.doi || h.version) && <small>{h.doi && "DOI: "+h.doi}{h.version && " · 版本 "+h.version}</small>}
    </div>)}
    {r.requestUrl && <a className="search-request" href={r.requestUrl} target="_blank" rel="noreferrer">查看检索响应{r.elapsedMs!==undefined?" · "+(r.elapsedMs/1000).toFixed(1)+" 秒":""}</a>}
    </details>
    {r.status==="failed" && <p className="search-error">{r.error || "请求失败，未取得结果。"}</p>}
    {r.warning && <p className="search-meta">{r.warning}</p>}
    {r.status==="done" && !r.hits.length && <p className="search-empty">{r.warning?"没有可用的相关网页。":"该查询未命中，不代表资料不存在。"}</p>}
    {r.status==="done" && !!r.hits.length && <div className="search-preview">
      <a href={r.hits[0].url} target="_blank" rel="noreferrer">{r.hits[0].title}</a>
      {r.hits.length>1 && <small>展开查看其余 {r.hits.length-1} 条</small>}
    </div>}
    </li>)}</ol>;
}
