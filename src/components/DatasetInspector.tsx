import {datasetScope} from "../domain/question-scope";
import {paperRecords} from "../domain/paper-record";
import {useCatalogRevision} from "./use-catalog-revision";
import {loadRemoteAssetIds} from "../domain/datasets";
import {useWebPreview} from "./use-web-preview";
import {publicLayerForDataset,type PublicLayerPoint,type PublicLayerSelection} from "../domain/haina-public-layer";
import {usePublicLayerManifest,type HainaPublicLayer} from "./use-haina-public-layer";
import {EntityVisualization} from "./EntityVisualization";
import {regionalForDataset} from "../domain/regional-cases";
import {readC40Catalogue} from "./use-c40-layer";
import {readForestPublication} from "./use-forest-layer";
import {rainCoverageLabel, refreshRainCatalog, useRainCatalog} from "./use-rain-catalog";
import { PaperResearchQuestions } from "./PaperResearchQuestions";
import { hainaScopeReview } from "../domain/haina-space";
import {materialDetails} from "../domain/material-summary";
import {checkedScenes,observationUnit} from "../domain/product-distribution";
import {SourcePreviewSurface} from "./SourcePreviewHost";
import { observationById, observationURL } from "../domain/push-observations";
import { sceneDocument, type SceneLookup } from "../domain/earth-search";
import { DatasetLineage } from "./DatasetLineage";
import { ResearchAssessment } from "./ResearchAssessment";
import { BatchSpatialSummary } from "./BatchSpatialSummary";
import { BatchContext, SaveResearchList } from "./ResearchLists";
import { SeptemberComparison } from "./SeptemberComparison";
import { Fragment, useState, useEffect, useLayoutEffect, useMemo } from "react";
import {
  ChartNoAxesCombined,
  FileSearch,
  ExternalLink,
  Download,
  X,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { useWorkspace } from "../domain/store";
import { assetById, type Asset } from "../domain/datasets";
import { researchTasks } from "../domain/research-task";
import { caseById, catalogGroupById } from "../domain/catalog";
import { assetLabel, spatialRelation } from "../domain/results";
import { assetMaterials } from "../domain/evidence";
import {
  defaultWindState,
  windManifest,
  windTimeLabel,
  windFrame,
} from "../domain/wind";
import { scopedDataView, supportsDataView, selectedStation } from "../domain/visualization";
import { regionLabel } from "../domain/regions";
import type {
  CandidateSet,
  EvidenceTab,
  Filters,
  Selection,
} from "../domain/types";

function exportTable(tab: EvidenceTab, name: string) {
  const csv = [tab.columns || [], ...(tab.rows || [])]
    .map((row) =>
      row
        .map((value) => '"' + String(value ?? "").replaceAll('"', '""') + '"')
        .join(","),
    )
    .join("\r\n");
  const url = URL.createObjectURL(
    new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = name.replace(/[/\\:]/g, "-") + ".csv";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function Overview({
  lookup,
  asset,
  filters,
  selection,
}: {
  lookup?: SceneLookup;
  asset: Asset;
  filters: Filters;
  selection: Selection | null;
}) {
  const {
    state: s,
    patch,
    attachScope,openData,
    openVisualization,
    preview,
  } = useWorkspace();
  const coverageReview = asset.caseId === "haina"
    ? hainaScopeReview(Number(asset.id.slice("haina:".length)),asset.title) : undefined;
  const pushed = observationById(asset.id);
  const wind = asset.datasetId === "gfs-wind";
  const rain = regionalForDataset(asset.datasetId) === "rain";
  const researchUse=catalogGroupById(asset.caseId)?.needs[asset.needIndex]?.name;
  const rainPublication = useRainCatalog(rain);
  const frame = windFrame(s.visualization || defaultWindState());
  const eligible = supportsDataView(asset.caseId, asset.needIndex);
  const active =
    s.view === "earth" && asset.caseId === s.caseId && eligible
      ? s.dataView
      : null;
  const station = active?.kind === "ctd" ? selectedStation(active) : null;
  const doc = useMemo(
    () => assetMaterials(asset, filters, selection, active),
    [asset, filters, selection, active],
  );
  const tabs = doc.tabs.filter((t) => t.kind !== "web");
  const openTab = (tab: EvidenceTab) =>
    patch({
      evidence: {
        ...doc,
        id: doc.id + "/" + doc.tabs.indexOf(tab),
        title: tab.label,
        scope: [asset.title, doc.scope].filter(Boolean).join(" · "),
        tabs: [tab],
      },
      previewKind: tab.kind,
    });
  const batch=s.inspector&&"parent" in s.inspector?s.inspector.parent:undefined;
  const facts=materialDetails(asset,doc.tabs);
  const checked=batch ? checkedScenes({...batch,ids:[asset.id],filters,selection}) : [];
  return (
    <>
      <button className="data-view-button" onClick={()=>attachScope(datasetScope(asset))}>用此数据集提问</button>
      <div className="dataset-meta">
        {[assetLabel(asset), asset.categories.join(" / "), asset.status].join(
          " · ",
        )}
      </div>
      <p>{batch?.sceneKey ? "当前选中影像 · "+batch.sceneKey : asset.description}</p>
      {!checked.length && facts.length>0 && <p>可核对内容 · {facts.join("；")}</p>}
      {checked.length>0 && <div className="material-row">
        <strong>本次范围已核 {checked.length} {observationUnit(checked)}</strong>
        {checked.slice(0,3).map(r=><a key={r.id} href={r.url} target="_blank" rel="noreferrer">{r.id} · {r.date.slice(0,10)}</a>)}
      </div>}
      {lookup && <div className="material-row">
        <span>{sceneDocument(lookup).scope}</span>
        <button onClick={() => patch({evidence: sceneDocument(lookup), previewKind: "table"})}>预览逐景索引</button>
        <a href={lookup.url} target="_blank" rel="noreferrer">复查发布方</a>
      </div>}
      <dl>
        {pushed && <>
          <dt>卫星 / 产品系列</dt><dd>{pushed.satellite} · {pushed.collection}</dd>
          <dt>观测时间</dt><dd>{pushed.observedAt}</dd>
          <dt>发布时间</dt><dd>{pushed.publishedAt || "提供方未声明"}</dd>
          <dt>OneEarth 接收</dt><dd>{pushed.receivedAt}</dd>
        </>}
        <dt>来源</dt>
        <dd>{asset.source}</dd>
        {rain && <>
          <dt>OneEarth 降水图层</dt>
          <dd>{rainCoverageLabel(rainPublication)}
            {rainPublication.status==="unavailable" && <button className="data-view-button" onClick={()=>void refreshRainCatalog()}>重试发布目录</button>}
          </dd>
        </>}
        {asset.profile && (
          <>
            {researchUse && <><dt>研究用途</dt><dd>{researchUse}</dd></>}
            <dt>覆盖与粒度</dt>
            <dd>{asset.profile.coverage}
              {coverageReview?.original && <div><a href={coverageReview.original} target="_blank" rel="noreferrer">查看原始来源 <ExternalLink size={12}/></a></div>}
            </dd>
            <dt>获取方式</dt>
            <dd>{asset.profile.access}</dd>
            <dt>使用条件</dt>
            <dd>{asset.profile.limitation}</dd>
          </>
        )}
        {filters.period && asset.profile?.years && (
          <>
            <dt>时间匹配</dt>
            <dd>
              资料覆盖年限 {asset.profile.years[0]}–
              {asset.profile.years[1] || "持续更新"}。具体日期的可用性须按观测记录核对。
            </dd>
          </>
        )}
        {asset.profile?.catalogYears && (
          <>
            <dt>目录登记时段</dt>
            <dd>{asset.profile.catalogYears[0]}–{asset.profile.catalogYears[1] ?? "持续更新"}。观测覆盖时段待核。</dd>
          </>
        )}
        <dt>当前范围</dt>
        <dd>
          {[
            regionLabel(filters.place),
            selection && selection.grid.label + " · " + selection.id,
            filters.period?.join("–"),
            filters.depth && filters.depth.join("–") + " m",
            station?.name,
          ]
            .filter(Boolean)
            .join(" · ") || "全部区域"}{" "}
          · {lookup ? "已核坐标 " + lookup.point.join(", ") : spatialRelation(asset, filters, selection)}
        </dd>
      </dl>
      <div className="inspector-links">
        <EntityVisualization asset={asset} hidePublicButton={s.view==="earth" && !!s.inspector && "parent" in s.inspector}/>
        {eligible && (
          <button
            className="native-content-button"
            onClick={() =>
              active
                ? patch({ inspector: null })
                : openData(asset.caseId, asset.needIndex, filters, selection)
            }
          >
            {asset.caseId === "Q19" ? "查看温盐剖面" : "对照冰川前缘"}
          </button>
        )}
        {wind && (
          <button
            className="visualize-button"
            onClick={() =>
              s.visualization && s.view === "earth"
                ? patch({ inspector: null })
                : openVisualization("gfs-wind", selection)
            }
          >
            在球上探索风场
          </button>
        )}
        {pushed?.file && <a href={observationURL(pushed.key)+"/file"} download><Download size={13}/>下载原文件 · {pushed.file.name}</a>}
        {pushed?.productUrl && <a href={pushed.productUrl} target="_blank" rel="noreferrer"><ExternalLink size={13}/>打开提供方产品</a>}
        {asset.url && (
          <a href={asset.url} rel="noreferrer" target="_blank">
            <ExternalLink size={13} />
            {pushed ? "查看接收记录" : asset.profile?.role === "request"
              ? "查看申请条件"
              : asset.profile?.role === "method"
                ? "打开方法文档"
                : asset.kind === "clue"
                  ? "访问线索来源"
                  : "访问发布方"}
          </a>
        )}
      </div>
      <DatasetLineage asset={asset} />
      <PaperResearchQuestions key={asset.id} assetId={asset.id}/>
      <h3>材料与获取</h3>
      {wind ? (
        <div className="material-row">
          <span>
            {selection ? "选点相邻 4 个原网格" : "全球 1° 原网格"} · {frame.level} · {windTimeLabel(frame)}
          </span>
          <button onClick={() => void preview("wind", 0, "table", asset.id, filters, selection)}>
            预览原始网格
          </button>
          <a
            href={
              windManifest.originals.find((o) =>
                o.file.endsWith(
                  "f" + String(frame.forecastHour).padStart(3, "0") + ".grib2",
                ),
              )?.file
            }
            download
          >
            <Download size={13} />
            原始 GRIB2
          </a>
        </div>
      ) : (
        tabs.map((t, i) => (
          <div className="material-row" key={i}>
            <span>
              {t.label}
              {t.kind === "table" &&
                " · " + (t.rows?.length || 0).toLocaleString() + " 行"}
            </span>
            <button onClick={() => openTab(t)}>
              <FileSearch size={13} />
              预览
              {
                {
                  table: "表格",
                  pdf: "PDF",
                  text: "摘录",
                  code: "代码",
                  trace: "记录",
                  web: "来源",
                }[t.kind]
              }
            </button>
            {t.kind === "table" && !!t.rows?.length && (
              <button
                onClick={() =>
                  exportTable(
                    t,
                    [asset.title, station?.name, t.label]
                      .filter(Boolean)
                      .join("-"),
                  )
                }
              >
                <Download size={13} />
                导出此表 CSV
              </button>
            )}
          </div>
        ))
      )}
      {asset.tabs
        .filter((t) => t.kind === "web" && t.url && t.url !== asset.url)
        .map((t, i) => (
          <div className="material-row" key={i}>
            <span>{t.label}</span>
            <a href={t.url} target="_blank" rel="noreferrer">
              前往来源 <ExternalLink size={12} />
            </a>
          </div>
        ))}
      {!tabs.length && !wind && (
        <p>本地尚无原始文件，可从上方入口核对访问条件与材料。</p>
      )}
      {asset.tabs
        .filter((t) => t.kind === "web" && t.body)
        .map((t, i) => (
          <details key={i}>
            <summary>{t.label}</summary>
            <p>{t.body}</p>
          </details>
        ))}
    </>
  );
}
function ResearchCollection({ batch }: { batch: CandidateSet }) {
  const { inspectAsset } = useWorkspace();
  const task = researchTasks[batch.caseId || ""];
  const study = caseById(batch.caseId);
  return (
    <>
      <BatchContext batch={batch} />
      <div className="batch-save">
        <SaveResearchList batch={batch} />
      </div>
      <ResearchAssessment batch={batch} />
      <BatchSpatialSummary batch={batch} />
      {task && (
        <p className="study-check">
          <strong>{task.group}</strong>
          {task.check}
        </p>
      )}
      {task && (
        <a
          className="question-paper"
          href={"https://doi.org/" + task.doi}
          target="_blank"
          rel="noreferrer"
        >
          题源论文 <ExternalLink size={12} />
        </a>
      )}
      {batch.caseId === "Q08" &&
        batch.ids.includes("Q08-0") &&
        batch.ids.includes("Q08-1") && (
          <SeptemberComparison period={batch.filters.period} />
        )}
      <div className="batch-list">
        {batch.ids.map((id) => {
          const a = assetById.get(id);
          return (
            a && (
              <button
                key={id}
                onClick={() => inspectAsset(id, batch.filters, batch.selection)}
              >
                <span>
                  {study?.needs[a.needIndex]?.name || a.categories[0]}
                </span>
                <strong>{a.title}</strong>
                <small>{a.status} ↗</small>
              </button>
            )
          );
        })}
      </div>
      {!batch.ids.length && (
        <p>当前条件下没有命中。可以调整范围或回到研究问题查看各项需求。</p>
      )}
    </>
  );
}
function DataGlobeButton({asset,scope,published=false}:{
  asset?:Asset;
  published?:boolean;
  scope?:{filters:Filters;selection:Selection|null};
}) {
  const {state:s,openData,openVisualization,openPublicLayer}=useWorkspace();
  const pilot=publicLayerForDataset(asset?.datasetId) ?? publicLayerForDataset(asset?.id);
  const publication=usePublicLayerManifest(published?undefined:pilot);
  const readyPilot=published||!!publication.manifest;
  const layer=asset ? regionalForDataset(asset.datasetId) : undefined;
  const rain=useRainCatalog(layer==="rain");
  const [verified,setVerified]=useState<"forest"|"c40"|null>(null);
  useEffect(()=>{
    setVerified(null);
    if (layer!=="forest" && layer!=="c40") return;
    const request=new AbortController();
    const signal=AbortSignal.any([request.signal,AbortSignal.timeout(10000)]);
    const read=layer==="forest" ? readForestPublication(signal) : readC40Catalogue(signal);
    void read.then(()=>{
      if (!request.signal.aborted) setVerified(layer);
    }).catch(()=>{});
    return ()=>request.abort();
  },[layer]);
  const readyLayer=layer==="rain" ? rain.status==="ready" && rain.catalog.years.length>0
    : layer==="forest" || layer==="c40" ? verified===layer : layer!==undefined;
  const wind=asset?.datasetId==="gfs-wind";
  const native=asset && scope && supportsDataView(asset.caseId,asset.needIndex)
    && scopedDataView(asset.caseId,asset.needIndex,{...scope.filters,need:asset.needIndex},scope.selection,s.dataView);

  function open() {
    if (pilot && readyPilot) {
      openPublicLayer(pilot);
    } else if (layer && readyLayer) {
      openVisualization(layer,null);
    } else if (wind && scope) {
      openVisualization("gfs-wind",scope.selection);
    } else if (native && asset && scope) {
      openData(asset.caseId,asset.needIndex,scope.filters,scope.selection);
    }
  }
  return <button type="button" className="data-globe-button" disabled={pilot ? !readyPilot : !(readyLayer || wind || native)} onClick={open}>数据上球</button>;
}

function HainaLayerDetails({haina,selection}:{haina:HainaPublicLayer;selection:PublicLayerSelection}) {
  const {manifest}=haina.catalogue;
  if(!manifest)return null;
  const point:PublicLayerPoint|undefined=haina.data?.points?.find(item=>item.id===selection.point);
  return <>
    {point && <section className="haina-point-detail" aria-label="火山原始记录">
      <h3>{point.label}</h3>
      <dl>
        <dt>点位经纬度</dt><dd>{point.coordinate.map(value=>value.toFixed(4)+"°").join(", ")}</dd>
        {Object.entries(point.properties).map(([label,value])=><Fragment key={label}>
          <dt>{label}</dt><dd>{value===null||value==="" ? "缺测" : typeof value==="object" ? JSON.stringify(value) : String(value)}</dd>
        </Fragment>)}
      </dl>
    </section>}
    <dl className="haina-public-layer-details" aria-label="已发布图层详情">
      <dt>已发布范围</dt><dd>{manifest.mode==="viirs"
        ? "随视野显示 · "+manifest.period : haina.view?.kind==="patch"
        ? haina.view.label+" · "+haina.view.month+(haina.view.image?"":"（此月未发布）")
        : haina.view ? haina.view.label+" · "+manifest.period : "此图斑未发布"}</dd>
      {manifest.mode==="coverage" && <><dt>可用月份</dt>
        <dd>{haina.patch?.months.join("、")||"当前图斑无已发布切片"}</dd>
        <dt>颜色说明</dt><dd>{manifest.colors.kind==="shared-pca"?"共用 PCA 色轴":"逐帧独立 PCA，颜色不可直接跨期比较"}</dd></>}
      <dt>图层说明</dt><dd>{manifest.description}</dd>
      <dt>图层来源</dt><dd>{/^https?:\/\//i.test(manifest.source)
        ? <a href={manifest.source} target="_blank" rel="noreferrer">查看发布来源 <ExternalLink size={12}/></a>
        : manifest.source}</dd>
    </dl>
  </>;
}

export function DatasetInspector({haina}:{haina:HainaPublicLayer}) {
  const { state: s, patch, inspectCandidates, registerWorkspacePanel } = useWorkspace();
  const [collapsed, setCollapsed] = useState(false);
  const previewWeb=useWebPreview();
  const item = s.inspector;
  useCatalogRevision();
  const assetId=item && "assetId" in item?item.assetId:undefined;
  const summary=!!assetId && !!paperRecords.get(assetId)?.catalogSummary;
  const [readError,setReadError]=useState("");
  const [readAttempt,retryRead]=useState(0);
  useEffect(()=>{
    if(!assetId || !summary)return;
    let active=true;setReadError("");
    void loadRemoteAssetIds([assetId]).then(()=>{
      if(paperRecords.get(assetId)?.catalogSummary)throw Error("完整资料尚未取得，请重试。");
    }).catch(error=>{if(active)setReadError(error instanceof Error?error.message:"完整资料暂时无法读取。");});
    return ()=>{active=false;};
  },[assetId,summary,readAttempt]);
  useEffect(()=>setCollapsed(false),[item]);
  const compact = collapsed || !!s.evidence;
  useLayoutEffect(()=>item?registerWorkspacePanel("inspector",{inspector:compact?"collapsed":"expanded"}):undefined,
    [item,compact,registerWorkspacePanel]);
  if (!item) return null;
  const asset = "assetId" in item ? assetById.get(item.assetId) : undefined;
  const batch = "batch" in item ? item.batch : null;
  const parent = "parent" in item ? item.parent : undefined;
  const collection = batch || parent;
  const comparison = "comparison" in item ? item.comparison : null;
  const pilot=publicLayerForDataset(asset?.datasetId) ?? publicLayerForDataset(asset?.id);
  const activeHaina=s.view==="earth" && s.publicLayer?.id===pilot ? s.publicLayer : null;
  return (
    <SourcePreviewSurface><section
      aria-label="数据速览" onClick={previewWeb}
      className={
        "data-inspector overview-inspector" + (compact ? " compact" : "")
      }
    >
      <div className="data-inspector-heading">
        <span className="eyebrow">
          <ChartNoAxesCombined size={14} />
          数据速览
        </span>
        <div className="icon-actions">
          {parent && s.view === "earth" && (
            <button onClick={() => inspectCandidates(parent)}>
              同批资料（{parent.ids.length}）
            </button>
          )}
          {collection && s.view === "earth" &&
            <DataGlobeButton asset={summary ? undefined : asset} scope={"assetId" in item ? item : undefined}
              published={!!activeHaina && !!haina.catalogue.manifest}/>}
          <button
            aria-label={compact ? "展开数据速览" : "收起数据速览"}
            onClick={() => {
              patch({ evidence: null });
              setCollapsed(!compact);
            }}
          >
            {compact ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>
          <button
            aria-label="关闭数据速览"
            onClick={() => patch({ inspector: null, evidence: null })}
          >
            <X size={16} />
          </button>
        </div>
      </div>
      <h2>{asset?.title || comparison?.title || batch?.title}</h2>
      <div className="overview-body" hidden={compact}>
        {activeHaina && <HainaLayerDetails haina={haina} selection={activeHaina}/>}
        {parent && <BatchContext batch={parent} />}
        {asset && parent && "assetId" in item &&
          <SaveResearchList single batch={{...parent, ids:[asset.id], filters:item.filters, selection:item.selection,
            gridSystem:item.selection?.grid.system || parent.gridSystem}} />}
        {summary && <p role="status">{readError || "正在读取完整论文资料…"}{readError && <button onClick={()=>retryRead(n=>n+1)}>重试</button>}</p>}
        {asset && !summary && "assetId" in item && (
          <Overview
            asset={asset}
            lookup={parent?.lookups?.find(l => l.assetId === asset.id)}
            filters={item.filters}
            selection={item.selection}
          />
        )}
        {batch && <ResearchCollection batch={batch} />}
        {"comparedBatch" in item && item.comparedBatch && (
          <>
            <BatchContext batch={item.comparedBatch} />
            <SaveResearchList batch={item.comparedBatch} selected />
            <ResearchAssessment batch={item.comparedBatch} />
          </>
        )}
        {comparison && (
          <table>
            <thead>
              <tr>
                {comparison.tabs[0].columns?.map((c) => (
                  <th key={c}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {comparison.tabs[0].rows?.map((row, i) => (
                <tr key={i}>
                  {row.map((v, j) => (
                    <td key={j}>{String(v)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section></SourcePreviewSurface>
  );
}
