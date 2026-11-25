import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { gridData, dataForTopic, sciencePaths } from "../domain/grid-science-topics";
import { spatialRelation } from "../domain/results";
import { useWorkspace } from "../domain/store";
import type { CandidateSet } from "../domain/types";
import {assetById,loadRemoteAssetIds,type Asset} from "../domain/datasets";
import {products} from "../domain/product-distribution";
import {gridDataScopes,groupGridData,type GridDataScope} from "../domain/grid-data-groups";
import {useGridMembership} from "./use-grid-membership";
import {useCatalogRevision} from "./use-catalog-revision";
import {paperId,paperRecords} from "../domain/paper-record";

type SimRow = [number, number, number, number, number?, number?];
type SimPage = { total: number; sourceCounts: number[]; rows: SimRow[] };
const pageSize = 24;
const referencePageSize = 60;
const families = ["海纳收录", "论文线索", "科学家推荐"];
const sources = ["海纳收录示例", "论文线索示例", "科学家推荐示例"];
const coordinate = (value: number, positive: string, negative: string) =>
  Math.abs(value).toFixed(3) + "°" + (value < 0 ? negative : positive);

export function GridDataPopover({
  batch,
  source,
  onClose,
  organizeByLocation=false,
  coverageBatch,
  coverageRevision,
}: {
  batch: CandidateSet;
  source: number;
  onClose: () => void;
  organizeByLocation?:boolean;
  coverageBatch?:CandidateSet|null;
  coverageRevision?:string;
}) {
  const { inspectAsset, patch } = useWorkspace();
  const [category, setCategory] = useState("全部");
  const [offset, setOffset] = useState(0);
  const [retry, setRetry] = useState(0);
  const [page, setPage] = useState<SimPage | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const selection = batch.selection!;
  const simulation = !!selection.simulated;
  const grouped=organizeByLocation && !simulation;
  const [locationScope,setLocationScope]=useState<GridDataScope>("local");
  const includeReferences=grouped&&!coverageBatch;
  const membership=useGridMembership(grouped,selection,batch.filters,coverageBatch,includeReferences,coverageRevision);
  const [term,setTerm] = useState("");
  const [referenceLimit,setReferenceLimit]=useState(referencePageSize);
  const [referenceRetry,retryReferences]=useState(0);
  const [referenceError,setReferenceError]=useState("");
  const revision=useCatalogRevision();
  const paperReferences=useMemo(()=>membership.referenceIds?.filter(paperId)??[],[membership.referenceIds]);
  const requestedReferences=useMemo(()=>paperReferences.slice(0,referenceLimit),[paperReferences,referenceLimit]);
  const resolvedReferences=requestedReferences.filter(id=>assetById.has(id)).length;
  useEffect(()=>{
    const controller=new AbortController();
    setReferenceError("");
    const missing=requestedReferences.filter(id=>!assetById.has(id));
    if(missing.length)void loadRemoteAssetIds(missing,controller.signal).then(()=>{
      if(!controller.signal.aborted&&missing.some(id=>!assetById.has(id)))
        throw Error("部分格内文献资料未能读取。");
    }).catch(()=>{
      if(!controller.signal.aborted)setReferenceError("部分格内文献资料未能读取。");
    });
    return ()=>controller.abort();
  },[requestedReferences,referenceRetry]);
  const allRows=useMemo(()=>dataForTopic([
    ...gridData(batch.ids,batch.filters.source==="paper"),...gridData(requestedReferences,true),
  ],"全部"),[batch,revision,requestedReferences]);
  const groups=useMemo(()=>membership.members?groupGridData(allRows,membership.members,batch.filters):null,[allRows,membership.members,batch.filters]);
  const scoped=grouped?(locationScope==="all"?allRows:groups?.[locationScope]||[]):allRows;
  const referencePending=!referenceError && resolvedReferences<requestedReferences.length;
  const waiting=grouped && locationScope!=="all" && (membership.members===null || referencePending);
  const paths = useMemo(()=>scoped.flatMap(sciencePaths),[scoped]);
  const terms = [...new Set(paths.filter(([topic]) => topic === category).map(([,name]) => name))];
  const filtered = dataForTopic(scoped,category,term);
  const rowScopes=useMemo(()=>new Map(groups?gridDataScopes.filter(s=>s.id!=="all").flatMap(s=>groups[s.id].map(a=>[a.id,s.id] as const)):[]),[groups]);
  const scopeInfo=gridDataScopes.find(s=>s.id===locationScope)!;
  const changeScope=(next:GridDataScope)=>{
    const nextRows=next==="all"?allRows:groups?.[next]||[],nextPaths=nextRows.flatMap(sciencePaths);
    if(category!=="全部" && !nextPaths.some(([topic])=>topic===category)){setCategory("全部");setTerm("");}
    else if(term && !nextPaths.some(([topic,name])=>topic===category&&name===term))setTerm("");
    setLocationScope(next);setOffset(0);
  };
  const rowBadge=(asset:Asset)=>{
    const group=rowScopes.get(asset.id);
    return <span className={"grid-row-scope "+(group||"pending")}>{group==="local"?"格内可定位":group==="global"?"全球覆盖":group==="coverage"?"范围及其他说明":"定位关系待核"}</span>;
  };
  useEffect(() => {
    if (!simulation) return;
    const ctrl = new AbortController();
    const params = new URLSearchParams({
      id: selection.id,
      system: selection.grid.system,
      n: String(selection.grid.n),
      lon: String(selection.point[0]),
      lat: String(selection.point[1]),
      source: String(source),
      family: String(families.indexOf(category)),
      offset: String(offset),
    });
    setLoading(true);
    setError(false);
    void fetch("/api/simulation-grid?" + params, { signal: ctrl.signal })
      .then(async (r) => {
        if (!r.ok) throw Error();
        const data: SimPage = await r.json();
        if (!ctrl.signal.aborted) setPage(data);
      })
      .catch(() => {
        if (!ctrl.signal.aborted) setError(true);
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
  }, [simulation, selection, category, source, offset, retry]);
  const tabs = simulation
    ? ["全部", ...families.filter((_, i) => page?.sourceCounts[i])]
    : ["全部", ...new Set(paths.map(([topic])=>topic).filter(topic=>topic !== "未标注主题")), ...(paths.some(([topic])=>topic === "未标注主题") ? ["未标注主题"] : [])];
  const count = (label: string) =>
    simulation
      ? label === "全部"
        ? page?.total
        : page?.sourceCounts[families.indexOf(label)]
      : dataForTopic(scoped,label).length;
  const length = simulation ? count(category) ?? 0 : filtered.length;
  const choose = (name: string) => {
    if (name === category && offset === 0) return;
    if (simulation) setLoading(true);
    setCategory(name);
    setTerm("");
    setOffset(0);
  };
  const changePage = (next: number) => {
    if (simulation) setLoading(true);
    setOffset(next);
  };
  const openRecord = ([id, src, lon, lat, w, h]: SimRow) => {
    const area = w !== undefined && h !== undefined;
    patch({
      evidence: {
        id: "sim-" + id,
        title: "模拟记录 #" + id,
        source: sources[src],
        scope: selection.grid.label + " · " + selection.id,
        sourceBatch: batch,
        tabs: [
          {
            kind: "table",
            label: "空间记录",
            columns: [
              "记录编号",
              "类别",
              "经度",
              "纬度",
              ...(area ? ["西界", "南界", "东界", "北界"] : []),
            ],
            rows: [
              [
                id,
                area ? "覆盖范围" : "定位点",
                lon,
                lat,
                ...(area ? [lon - w, lat - h, lon + w, lat + h] : []),
              ],
            ],
          },
        ],
      },
      previewKind: "table",
    });
  };
  return (
    <section
      className={"grid-data-popover" + (simulation ? " simulated-list" : "")+(grouped?" grouped-list":"")}
      id="grid-data-popover"
      aria-label="格内数据列表"
    >
      <header className="popover-heading">
        <span>{grouped?"所选网格关联资料":"格内数据"+(simulation ? " · 模拟记录按来源" : " · 科学主题")}</span>
        <button onClick={onClose} aria-label="关闭格内数据">
          <X size={14} />
        </button>
      </header>
      {grouped && <>
        <div className="grid-data-scope-tabs" role="group" aria-label="资料空间关联范围">
          {gridDataScopes.map(scope=><button key={scope.id} aria-pressed={scope.id===locationScope}
            disabled={scope.id!=="all" && (!groups || referencePending)} onClick={()=>changeScope(scope.id)}>
            {scope.label} <span>{scope.id==="all"?products(allRows).size:groups&&!referencePending?products(groups[scope.id]).size:"…"} 种</span>
          </button>)}
        </div>
        <div className="grid-data-scope-summary" aria-live="polite">
          {membership.error ? <span>{membership.error} <button onClick={membership.retry}>重试</button></span> : waiting ? <span>正在读取格内定位关系…</span> : <>
            <strong>{products(scoped).size} 种数据集 · {scoped.length} 条资料</strong><span>{scopeInfo.description}</span>
            <small>种数按数据集去重，资料保留来源与版本。</small>
            {includeReferences&&locationScope!=="local"&&<small>此处列出已载入的覆盖和范围说明。</small>}
          </>}
          {paperReferences.length>0&&<small>已读取 {resolvedReferences.toLocaleString()} / {paperReferences.length.toLocaleString()} 条格内文献来源。
            {referenceError&&<> {referenceError}<button onClick={()=>retryReferences(n=>n+1)}>重试</button></>}
            {!referencePending&&!referenceError&&referenceLimit<paperReferences.length&&
              <button onClick={()=>setReferenceLimit(n=>n+referencePageSize)}>读取更多格内来源</button>}
          </small>}
        </div>
      </>}
      <div className="grid-data-tabs" role="tablist" aria-label={simulation ? "模拟记录来源" : "一级科学主题"}>
        {tabs.map((name, i) => (
          <button
            key={name}
            role="tab"
            id={"grid-tab-" + i}
            aria-selected={name === category}
            aria-controls="grid-data-list"
            tabIndex={name === category ? 0 : -1}
            onKeyDown={(e) => {
              const direction =
                e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
              if (direction) {
                e.preventDefault();
                const next = (i + direction + tabs.length) % tabs.length;
                choose(tabs[next]);
                document.getElementById("grid-tab-" + next)?.focus();
              }
            }}
            onClick={() => choose(name)}
          >
            {!simulation && name==="全部"?"全部主题":name} <span>{waiting?"…":count(name)}{!simulation&&" 条"}</span>
          </button>
        ))}
      </div>
      {!simulation && terms.length > 1 && <label className="grid-term-filter">
        二级主题 <select value={term} onChange={e=>{setTerm(e.target.value);setOffset(0);}}>
          <option value="">全部二级主题</option>{terms.map(t=><option key={t} value={t}>{t}（{dataForTopic(scoped,category,t).length} 条）</option>)}
        </select>
      </label>}
      <div
        key={locationScope + category + term + offset}
        className="grid-data-rows"
        id="grid-data-list"
        role="tabpanel"
        aria-labelledby={"grid-tab-" + tabs.indexOf(category)}
        tabIndex={0}
      >
        {simulation ? (
          loading ? (
            <p role="status">正在读取格内记录…</p>
          ) : error ? (
            <p>
              格内记录暂时无法读取。
              <button onClick={() => setRetry((n) => n + 1)}>重试</button>
            </p>
          ) : (
            page?.rows.map((row) => (
              <button
                className="grid-data-row"
                key={row[0]}
                onClick={() => openRecord(row)}
              >
                <span>
                  <strong>
                    模拟{row.length > 4 ? "范围" : "点位"} #{row[0]}
                  </strong>
                  <small>
                    {sources[row[1]]} · {coordinate(row[2], "E", "W")}{" "}
                    {coordinate(row[3], "N", "S")}
                  </small>
                </span>
                <ChevronRight size={13} />
              </button>
            ))
          )
        ) : waiting ? (
          <p role={membership.error?"alert":"status"}>{membership.error?"可重试定位核对，或先查看全部关联资料。":"正在读取参与本格着色的数据集名单…"}</p>
        ) : (
          filtered.slice(offset, offset + pageSize).map((asset) => (
            <button
              className="grid-data-row"
              key={asset.id}
              onClick={() => {
                const sourceBatch=batch.ids.includes(asset.id)?batch:{...batch,ids:[...new Set([...batch.ids,...requestedReferences.filter(id=>assetById.has(id))])]};
                inspectAsset(asset.id, batch.filters, selection, sourceBatch);
                onClose();
              }}
            >
              <span>
                <strong>{asset.title}</strong>
                {grouped && rowBadge(asset)}
                <small>
                  {asset.id.startsWith("haina:") && sciencePaths(asset)[0][1] && "海纳主题 · "}{[...new Set(sciencePaths(asset).map(([topic, term]) => term || topic))].join(" / ")} · {paperRecords.get(asset.id)?.assertionCatalogKind==="metadata-only"?"数据集元数据":asset.origins.includes("paper")?"论文研究数据":asset.type} ·{" "}
                  {spatialRelation(
                    asset,
                    batch.filters,
                    selection,
                    batch.layer,
                  )}
                </small>
              </span>
              <ChevronRight size={13} />
            </button>
          ))
        )}
        {!waiting && !loading && !error && !referenceError && (!simulation || page) && !length && (
          <p>{grouped&&locationScope==="local"&&category==="全部"?"本格没有可定位数据集，可切换到全球覆盖或范围说明查看关联资料。":"当前网格和筛选条件下没有匹配的数据。"}</p>
        )}
      </div>
      {length > pageSize && (
        <footer className="grid-list-pager">
          <button
            aria-label="上一页数据"
            disabled={!offset || loading}
            onClick={() => changePage(offset - pageSize)}
          >
            <ChevronLeft size={14} />
          </button>
          <span>
            {offset + 1}–{Math.min(offset + pageSize, length)} / {length}
          </span>
          <button
            aria-label="下一页数据"
            disabled={offset + pageSize >= length || loading}
            onClick={() => changePage(offset + pageSize)}
          >
            <ChevronRight size={14} />
          </button>
        </footer>
      )}
    </section>
  );
}
