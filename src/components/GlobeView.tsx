import { createPortal } from "react-dom";
import {ResearchRegionLayer} from "./ResearchRegionLayer";
import {gridScope,timeScope} from "../domain/question-scope";
import {RainfallControls} from "./RainfallControls";
import {useCatalogRevision} from "./use-catalog-revision";
import {answerEvidence} from "../domain/answer-map";
import {useFieldData} from "./use-field-data";
import {globeCases,layerFrameCount} from "../domain/regional-cases";
import {sampleField,palettes} from "../globe/regional-layer";
import { GridDataPopover } from "./GridDataPopover";
import {GridHoverOverview} from "./GridHoverOverview";
import {indexGridAccess} from "../domain/grid-hover-summary";
import type {GridHover} from "../globe/grid-hover";
import {productKey,checkedScenes,observationUnit,products,backgroundCoverageProduct,globalProduct} from "../domain/product-distribution";
import {GlobeTimeline} from "./GlobeTimeline";
import {ForestTimeline} from "./ForestTimeline";
import {observationBatchCamera,observationById,observationStamp} from "../domain/push-observations";
import {
  selectedDistribution,
  makeCandidates,
  includesArea,
  spatialGroups,
  sceneScale,
  makeMappedCandidates,
  outsideMappedSelection,
} from "../domain/results";
import {
  assets,
  distinctAssets,
  assetById,
  assetIdentity,
  identitiesForRecords,
  catalogRevision,
} from "../domain/datasets";
import { BatchSpatialSummary } from "./BatchSpatialSummary";
import { WindControls, WindLegend } from "./WindControls";
import { BASEMAPS, basemapBbox, basemapStyle, loadBasemap, type BasemapId } from "../globe/basemaps";
import type { GeoImageFrame } from "../globe/geo-image-layer";
import {
  getWindData,
  loadWindData,
  windFrame,
  windVector,
} from "../domain/wind";
import { DatasetActions } from "./DatasetActions";
import {
  frontsFor,
  dataSelection,
  variableInfo,
  selectedStation,
  ctdSamples,
} from "../domain/visualization";
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import {
  Globe,
  MapPin,
  LocateFixed,
  Plus,
  Minus,
  ChevronDown,
  X,
  ArrowUpRight,
  List,
  Layers,
  Info,
} from "lucide-react";
import { createRenderer, type FrameInfo, type Scene } from "../globe/renderer";
import { useWorkspace } from "../domain/store";
import { caseById } from "../domain/catalog";
import {
  emptyFilters,
  getModel,
  fitCamera,
  localEntries,
} from "../domain/spatial";
import { useGeoOrientation } from "./use-geo-orientation";
import type { CandidateSet, MapLayer } from "../domain/types";
import { useWindTheme } from "../domain/wind-theme";
import {DistributionModePicker} from "./DistributionModePicker";
import {DistributionLegend} from "./DistributionLegend";
import {useDistributionMode} from "./use-distribution-mode";
import {distributionModes,resolveDistributionMode,type DistributionContext} from "../domain/distribution-modes";
import {countBand} from "../domain/distribution-heat";

export function GlobeView({ rightInset = 0, toolsHost }: { rightInset?: number; toolsHost?: HTMLElement | null }) {
  const {
    state: s,
    patch,
    setFilters,
    attachScope,
    openVisualization,inspectAsset,inspectCandidates,flyToGrid,focusAnswerEvidence,flyToEvidence,flyToResearchRegion,
    leaveDetail,
  } = useWorkspace();
  const orientation=useGeoOrientation(s.camera.center,s.camera.zoom);
  const locationBar=useRef<HTMLDivElement>(null);
  const [locationBottom,setLocationBottom]=useState(100);
  useEffect(()=>{
    const element=locationBar.current;if(!element)return;
    const measure=()=>setLocationBottom(element.offsetTop+element.offsetHeight+12);
    const observer=new ResizeObserver(measure);observer.observe(element);measure();
    return ()=>observer.disconnect();
  },[]);
  const geoOrientation=orientation.locate;
  const revision=useCatalogRevision();
  const activeAnswer=s.messages.find(m=>m.id===s.mapResult?.answerId);
  const answerReferences=useMemo(()=>activeAnswer?.answerNotes?.references
    ? activeAnswer.answerNotes.references.flatMap((r,i)=>r.kind==="asset"?[{assetId:r.id,number:i+1}]:[])
    : (activeAnswer?.answerNotes?.sources || []).map((r,i)=>({assetId:r.id,number:i+1})),[activeAnswer]);
  const focusedBatch=useMemo(()=>s.mapResult?{...s.mapResult,filters:s.filters,layer:s.layer}:null,[s.mapResult,s.filters,s.layer]);
  const mappedEvidence=useMemo(()=>focusedBatch?answerEvidence(focusedBatch):new Map(),[focusedBatch,revision]);
  const focusedEvidence=useMemo(()=>focusedBatch && s.mapFocus && s.mapFocus.answerId===focusedBatch.answerId
    ? mappedEvidence.get(s.mapFocus.assetId):undefined,[focusedBatch,s.mapFocus,mappedEvidence]);
  const windCanvas = useRef<HTMLCanvasElement>(null);
  const placePin = useRef<HTMLDivElement>(null);
  const [windLoad, setWindLoad] = useState({
    ready: !!getWindData(),
    error: "",
  });
  const [windRetry, setWindRetry] = useState(0);
  const [windTheme, changeWindTheme] = useWindTheme();
  const canvas = useRef<HTMLCanvasElement>(null),
    controls = useRef<HTMLDivElement>(null),
    renderer = useRef<ReturnType<typeof createRenderer> | null>(null);
  const layer=s.fieldLayer;
  const [preferredStyle,setDistributionStyle]=useDistributionMode();
  const distributionContext:DistributionContext=s.mapResult?.selection?"fixed-cell":s.mapResult?.metric==="scenes"?"scenes":"catalog";
  const distributionStyle=resolveDistributionMode(preferredStyle,distributionContext);
  const smoothedMode=distributionModes[distributionStyle].smoothed && !layer && !s.caseId && !s.dataView && !s.visualization && s.overview==="catalog";
  const fieldData=useFieldData(layer);
  const [animate,setAnimate]=useState(false);
  useEffect(()=>setAnimate(false),[layer?.id,layer?.year]);
  useEffect(()=>{
    if(!animate || !layer || layerFrameCount(layer.id)<=1 || !fieldData.field || fieldData.field.rain?.loading || fieldData.field.rain?.error)return;
    const timer=setTimeout(()=>patch({fieldLayer:{...layer,frame:fieldData.field?.rain?fieldData.field.rain.nextMonth(layer.frame):(layer.frame+1)%layerFrameCount(layer.id)}}),layer.id==="rain"?650:layer.id==="forest"?900:240);
    return ()=>clearTimeout(timer);
  },[animate,layer,fieldData.field,fieldData.revision,patch]);
  useEffect(()=>{
    const rain=fieldData.field?.rain;
    if(layer && rain && !rain.available(layer.frame))patch({fieldLayer:{...layer,frame:rain.nextMonth(layer.frame)}});
  },[layer,fieldData.field,patch]);
  const forestLayer=layer?.id==="forest" ? layer : null;
  const forest=forestLayer ? fieldData.field?.forest : undefined;
  const forestMode=!!(forestLayer && forest);
  const c40Layer=layer?.id==="c40" ? layer : null;
  const c40=c40Layer ? fieldData.field?.raster : undefined;
  const c40Frame=c40Layer ? c40?.images[c40Layer.frame] : undefined;
  const c40Mode=!!(c40Layer && c40Frame);
  const fieldImage=forest?.images[forestLayer?.frame ?? 0] ?? c40Frame?.image ?? null;
  const probe=layer && fieldData.field && (fieldData.field.rain || fieldData.field.data) && s.selection ? sampleField(layer.id,layer.frame,fieldData.field,s.selection.point,s.camera.zoom):null;
  const [basemapId,setBasemapId]=useState<BasemapId|null>(()=>{
    try{const stored=localStorage.getItem("oneearth.basemap.v1");return BASEMAPS.some(style=>style.id===stored)?stored as BasemapId:null;}catch{return null;}
  });
  const [basemapFrame,setBasemapFrame]=useState<GeoImageFrame|null>(null);
  const [basemapOpen,setBasemapOpen]=useState(false);
  const [basemapError,setBasemapError]=useState("");
  const [basemapLoading,setBasemapLoading]=useState(false);
  const [viewportRevision,setViewportRevision]=useState(0);
  useEffect(()=>{
    const onResize=()=>setViewportRevision(value=>value+1);
    window.addEventListener("resize",onResize);
    return ()=>window.removeEventListener("resize",onResize);
  },[]);
  useEffect(()=>{
    try{basemapId?localStorage.setItem("oneearth.basemap.v1",basemapId):localStorage.removeItem("oneearth.basemap.v1");}catch{/* Private mode */}
  },[basemapId]);
  useEffect(()=>{
    if(!basemapId){setBasemapFrame(null);setBasemapError("");setBasemapLoading(false);renderer.current?.render();return;}
    const element=canvas.current;
    if(!element)return;
    const controller=new AbortController();
    setBasemapLoading(true);
    const timer=window.setTimeout(()=>{
      const bounds=basemapBbox(s.camera.center,s.camera.zoom,element.clientWidth,element.clientHeight);
      loadBasemap(basemapId,bounds,controller.signal).then(frame=>{
        if(controller.signal.aborted)return;
        setBasemapFrame(frame);setBasemapError("");setBasemapLoading(false);renderer.current?.render();
      }).catch(()=>{
        if(controller.signal.aborted)return;
        setBasemapError("底图暂时无法载入，已保留当前视图。");setBasemapLoading(false);
      });
    },380);
    return ()=>{window.clearTimeout(timer);controller.abort();};
  },[basemapId,s.camera.center[0],s.camera.center[1],s.camera.zoom,s.chatOpen,viewportRevision]);
  useEffect(()=>{renderer.current?.render();},[basemapFrame]);
  const latest = useRef({ ...s, catalogStyle:distributionStyle,rightInset, windTheme,answerReferences,fieldTexture:fieldData.texture,fieldImage,fieldRain:fieldData.field?.rain, basemap:basemapFrame, basemapId:basemapId??undefined });
  latest.current = { ...s, catalogStyle:distributionStyle,rightInset, windTheme,answerReferences,fieldTexture:fieldData.texture,fieldImage,fieldRain:fieldData.field?.rain, basemap:basemapFrame, basemapId:basemapId??undefined };
  const c = caseById(s.caseId);
  const [frame, setFrame] = useState<FrameInfo>({
    gridLabel: "H3 R2",
    level: 2,
    visibleCells: 0,
    loading: "",
    anchor: null,
  });
  const [gridList, setGridList] = useState<CandidateSet | null>(null);
  const [hover,setHover]=useState<GridHover|null>(null);
  const listButton = useRef<HTMLButtonElement>(null);
  const closeGridList = () => {
    setGridList(null);
    listButton.current?.focus({ preventScroll: true });
  };
  useEffect(() => {
    setGridList(null);
  }, [s.sessionId, s.selection, s.filters, s.layer, s.mapResult, s.visualization, s.dataView, s.overview, s.caseId, s.source]);
  useEffect(() => {
    if (!gridList || s.evidence) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeGridList();
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [gridList, s.evidence]);
  const [policy, setPolicy] = useState(false);
  useEffect(() => {
    if (!canvas.current || !controls.current) return;
    try {
      const engine = createRenderer(
        canvas.current,
        controls.current,
        () => latest.current as Scene,
        (camera) => patch({ camera }),
        (selection) => {
          const { dataView, filters } = latest.current;
          const samples = dataView
            ? dataSelection(dataView, filters, selection)
            : [];
          patch(
            dataView?.kind === "ctd" && samples.length === 1
              ? {
                  selection,
                  dataView: { ...dataView, stationId: samples[0].name },
                }
              : { selection },
          );
        },
        setFrame,
        windCanvas.current || undefined,
        (error) => patch({ error: error?.message || null }),
        setHover,
      );
      renderer.current = engine;
      return () => {
        engine.dispose();
        renderer.current = null;
      };
    } catch (e) {
      patch({
        error: e instanceof Error ? e.message : "数据地球暂时无法绘制。",
      });
    }
  }, [patch]);
  useEffect(()=>{if(s.flight)renderer.current?.flyTo(s.flight.camera);else renderer.current?.stopFlight();},[s.flight?.id]);
  // A place flight only moves the camera; keep a labeled, pulsing pin on the target
  // so the destination is visible without changing the research region layer.
  useEffect(()=>{
    const marker=placePin.current;
    if(!marker||!s.flight||s.flight.kind!=="place")return;
    const center=s.flight.camera.center;
    const place=()=>{
      const element=canvas.current,point=renderer.current?.projectVisible(center);
      if(!point||!element){marker.style.display="none";return;}
      const visible=point[0]>=0&&point[0]<=element.clientWidth&&point[1]>=0&&point[1]<=element.clientHeight;
      marker.style.display=visible?"block":"none";
      if(visible){marker.style.left=point[0]+"px";marker.style.top=point[1]+"px";}
    };
    place();
    const timer=window.setInterval(place,200),element=canvas.current;
    element?.addEventListener("pointermove",place);
    element?.addEventListener("wheel",place,{passive:true});
    window.addEventListener("resize",place);
    return ()=>{
      window.clearInterval(timer);
      element?.removeEventListener("pointermove",place);
      element?.removeEventListener("wheel",place);
      window.removeEventListener("resize",place);
    };
  },[s.flight?.id,s.camera.center[0],s.camera.center[1],s.camera.zoom]);
  useEffect(() => {
    if (!s.visualization) return;
    let cancelled = false;
    setWindLoad({ ready: !!getWindData(), error: "" });
    void loadWindData()
      .then(() => {
        if (!cancelled) {
          setWindLoad({ ready: true, error: "" });
          renderer.current?.render();
        }
      })
      .catch((error) => {
        if (!cancelled)
          setWindLoad({
            ready: false,
            error:
              error instanceof Error ? error.message : "风场暂时无法载入。",
          });
      });
    return () => {
      cancelled = true;
    };
  }, [s.visualization?.id, windRetry]);
  useEffect(
    () => {renderer.current?.clearHover();renderer.current?.render();},
    [
      s.camera,
      s.caseId,
      s.filters,
      s.layer,
      s.selection,
      s.gridSystem,
      s.mesh,
      s.source,
      s.overview,
      s.mapResult,
      s.mapFocus,s.researchRegion,answerReferences,revision,
      s.pushFeed,
      s.paperFeed,
      s.dataView,
      s.visualization,layer,fieldData.texture,fieldImage,fieldData.revision,fieldData.field,
      distributionStyle,
      rightInset,
      windTheme,
    ],
  );
  const model = c ? getModel(c.id) : null;
  const catalogMode = !layer && !c && s.overview === "catalog";
  const pushMode=catalogMode && s.filters.source==="constellation";
  const coarsePush=(s.mapResult?.selection?.grid ? (s.mapResult.selection.grid.system==="h3" ? s.mapResult.selection.grid.n<=3 : s.mapResult.selection.grid.n<=6) : frame.level<=3);
  const mappedIds = useMemo(()=>s.mapResult ? identitiesForRecords(s.mapResult.ids) : null,[s.mapResult,revision]);
  const snapshot = () => {
    const scope = {
      caseId: s.mapResult?.caseId || s.caseId,
      title: s.selection
        ? "所选网格的候选数据"
        : s.mapResult?.title || c?.title || "全球数据目录",
      filters: s.filters,
      selection: s.selection,
      layer: s.layer,
      camera: s.camera,
      gridSystem: s.gridSystem,
    };
    return s.mapResult
      ? makeMappedCandidates(s.mapResult, scope)
      : makeCandidates(scope);
  };
  const timedIds=useMemo(()=>{
    if(!s.filters.period) return null;
    const scope={caseId:s.mapResult?.caseId||s.caseId,title:"时段",filters:s.filters,selection:s.mapResult?.selection||null,layer:s.layer,camera:s.camera,gridSystem:s.gridSystem};
    return identitiesForRecords((s.mapResult?makeMappedCandidates(s.mapResult,scope):makeCandidates(scope)).ids);
  },[s.filters,s.mapResult,s.layer,s.caseId,s.pushFeed]);
  const catalogItems = useMemo(()=>distinctAssets(
    (s.mapResult?s.mapResult.ids.flatMap(id=>assetById.get(id)||[]):assets).filter(
      (a) =>
        a.kind !== "requirement" &&
        (!s.mapResult?.caseId || s.mapResult.caseId === a.caseId) &&
        (!mappedIds || mappedIds.has(assetIdentity(a))) &&
        (!s.filters.source || a.origins.includes(s.filters.source)) &&
        (!s.filters.type || a.categories.includes(s.filters.type)),
    ),
  ),[s.mapResult,s.filters,mappedIds,revision]);
  const hoverIndex=useMemo(()=>indexGridAccess(catalogItems),[catalogItems]);
  const axisRecords=useMemo(()=>catalogItems.flatMap(a=>observationById(a.id)||[]),[catalogItems]);
  const years=useMemo(()=>{const now=new Date().getUTCFullYear();const starts=assets.flatMap(a=>a.profile?.years?[a.profile.years[0]]:[]);return [Math.min(1900,...starts,s.filters.period?.[0]??now),Math.max(now,s.filters.period?.[1]??now)] as [number,number];},[s.filters.period]);
  const visibleItems=useMemo(()=>timedIds?catalogItems.filter(a=>timedIds.has(assetIdentity(a))):catalogItems,[timedIds,catalogItems]);
  const pushedRecords = useMemo(()=>visibleItems.flatMap(a=>observationById(a.id)||[]),[visibleItems]);
  const selectedScope = useMemo(()=>
    (catalogMode || c) && !s.dataView && !s.visualization && s.selection
      ? snapshot()
      : null,[catalogMode,c,s.dataView,s.visualization,s.selection,s.filters,s.layer,s.mapResult,s.gridSystem,revision]);
  const selectedBatch=useMemo(()=>selectedScope?{...selectedScope,camera:s.camera}:null,[selectedScope,s.camera]);
  const sceneMode=s.mapResult?.metric==="scenes";
  const countedCatalog=catalogMode && !sceneMode && !s.dataView && !s.visualization;
  const selectedCount=s.selection && frame.coloredSelection===s.selection.grid.key+"/"+s.selection.id?frame.coloredProducts:undefined;
  const countLegend=(pushMode || s.mapResult?.ids.some(id=>!!observationById(id)))?"格内已核观测记录数":"格内已核观测景数";
  const showOverview=!!s.mapResult || pushMode || !!s.filters.type || !catalogMode;
  const selectedAssets = useMemo(()=>selectedScope?.ids.map(id=>assetById.get(id)!) || [],[selectedScope]);
  const selectedScenes=useMemo(()=>selectedScope ? checkedScenes(selectedScope) : [],[selectedScope]);
  const outsideFrozen =
    !!s.mapResult && outsideMappedSelection(s.mapResult, s.selection);
  const cellGroups = useMemo(()=>spatialGroups(selectedAssets, {
    lookups: s.mapResult?.lookups,
    caseId: s.caseId || s.mapResult?.caseId,
    filters: s.filters,
    layer: s.layer,
    selection: selectedScope?.selection,
  }),[selectedAssets,s.mapResult?.lookups,s.caseId,s.mapResult?.caseId,s.filters,s.layer,selectedScope?.selection]);
  const localHits = cellGroups.local;
  const distribution=useMemo(()=>selectedScope?selectedDistribution(selectedScope):null,[selectedScope]);
  const globalHits=distribution?.globals||[];
  const bandHits = useMemo(()=>selectedAssets.filter(backgroundCoverageProduct),[selectedAssets]);
  const areaHits = cellGroups.coverage.filter(a=>!globalProduct(a,s.filters) && !backgroundCoverageProduct(a));
  const inArea =
    c &&
    s.selection &&
    includesArea(c.id, s.filters, s.layer, s.selection.point);
  const local = c ? localEntries(c.id, s.filters, s.layer, s.selection) : [];
  const shownFronts =
    s.dataView?.kind === "front"
      ? new Set(frontsFor(s.dataView, s.filters).map((f) => f.key))
      : null;
  const entries = shownFronts
    ? local.filter((entry) => entry.key && shownFronts.has(entry.key))
    : local;
  const dataSamples = s.dataView
    ? dataSelection(s.dataView, s.filters, s.selection)
    : [];
  const dataInfo =
    s.dataView?.kind === "ctd" ? variableInfo(s.dataView.variable) : null;
  const windProbe =
    s.visualization && s.selection && getWindData()
      ? windVector(
          getWindData()!,
          windFrame(s.visualization),
          ...s.selection.point,
        )
      : null;
  const inspectDatasetLayer = (id: string, title: string, conditions: string[]) => {
    const batch = s.mapResult?.ids.length === 1 && s.mapResult.ids[0] === id
      ? s.mapResult
      : { title, originKind: "catalog" as const, ids: [id], caseId: null,
          filters: s.filters, selection: s.selection, layer: s.layer, camera: s.camera,
          gridSystem: s.gridSystem, catalogConditions: conditions };
    inspectAsset(id, batch.filters, batch.selection, batch);
  };
  const inspectForest = () => inspectDatasetLayer("haina:1846764", "大兴安岭", ["实体数据", "检索词「大兴安岭」"]);
  const inspectC40 = () => inspectDatasetLayer("haina:1846639", "C40", ["实体数据", "检索词「C40」"]);
  const switchC40City = (index: number) => {
    if (!c40Layer || !c40) return;
    const city = c40.manifest.cities[index];
    if (!city) return;
    patch({fieldLayer: {...c40Layer, frame: index},
      flight: {id: "c40-" + city.id + "-" + Date.now(), camera: {center: city.center, zoom: city.zoom, reason: "C40 · " + city.name}}});
  };
  const openGridList = () => {
    const batch = { ...(selectedBatch || snapshot()) };
    if (s.visualization) batch.ids = windProbe ? ["wind-0"] : [];
    if (s.dataView?.kind === "ctd") batch.ids = dataSamples.length ? ["Q19-4"] : [];
    if (s.dataView?.kind === "front") batch.ids = entries.length ? ["Q20-1"] : [];
    setGridList(batch);
  };
  const footer = <div className={toolsHost && (catalogMode||forestMode||c40Mode) ? "catalog-distribution" : undefined}>
      <div className="map-footer">
        {forestLayer && forest ? <ForestTimeline manifest={forest.manifest} frame={forestLayer.frame} playing={animate}
          choose={frame=>{setAnimate(false);patch({fieldLayer:{...forestLayer,frame}});}}
          shift={delta=>{setAnimate(false);patch({fieldLayer:{...forestLayer,frame:Math.max(0,Math.min(forest.manifest.frames.length-1,forestLayer.frame+delta))}});}}
          toggle={()=>setAnimate(!animate)}/> :
          (catalogMode||c) && !s.visualization && !s.dataView && <GlobeTimeline onAskTime={()=>attachScope(...timeScope(s.filters))} key={pushMode?"scene":c?.id||"catalog"} filters={s.filters} years={years} mode={pushMode?"scene":c?"year":"month"} records={axisRecords} onChange={changes=>setFilters(changes)}/>}
        {layer?.id==="rain" && fieldData.field?.rain ? <RainfallControls grid={fieldData.field.rain} month={layer.frame} playing={animate} chooseYear={(year,frame)=>{setAnimate(false);patch({fieldLayer:{...layer,year,frame}});}} point={s.selection?.point}
          toggle={()=>setAnimate(!animate)} choose={frame=>{setAnimate(false);patch({fieldLayer:{...layer,frame}});}}/> : layer && layer.id!=="forest" && layer.id!=="c40" && <div className="field-controls">
          <strong>{globeCases[layer.id].title}</strong>
          {fieldData.field ? <>
            <div className="field-time"><button aria-label={animate?"暂停图层":"播放图层"} onClick={()=>setAnimate(!animate)}>{animate?"暂停":"播放"}</button>
              <output>{layer.id==="rain"?"2024-"+String(layer.frame+1).padStart(2,"0"):fieldData.field.data?.dates[layer.frame]}</output>
              <input aria-label="图层时间轴" type="range" min={0} max={layerFrameCount(layer.id)-1} value={layer.frame} onChange={e=>{setAnimate(false);patch({fieldLayer:{...layer,frame:+e.target.value}})}}/>
            </div>
            <div className="field-scale">0 <i style={{background:"linear-gradient(to right,"+palettes[layer.id].map(rgb=>"rgb("+rgb+")").join(",")+")"}}/> {globeCases[layer.id].max.toLocaleString()}+ {globeCases[layer.id].unit}</div>
            {s.selection && <output aria-label="图层取值">{s.selection.point.map(v=>v.toFixed(2)+"°").join(", ")} · {probe? [probe.name,probe.value.toLocaleString(),globeCases[layer.id].unit].filter(Boolean).join(" "):"此处无数据"}</output>}
            <a href={"?view=cases&atlas="+layer.id+"&detail=1"}>区域细节 ↗</a>
          </> : fieldData.error?<button onClick={fieldData.retry}>载入失败 · 重试</button>:<small>正在载入数据…</small>}
        </div>}
        <div className="map-controls-row">
        {forestLayer && forest ? <div className="map-legend forest-legend-bar">
          <span className="forest-legend-title">大兴安岭森林 · 嵌入 PCA</span>
          <span><i className="forest-channel" style={{background:"#d64572"}}/>R · PC1 {(forest.manifest.embedding.variance[0]*100).toFixed(1)}%</span>
          <span><i className="forest-channel" style={{background:"#4f9e6d"}}/>G · PC2 {(forest.manifest.embedding.variance[1]*100).toFixed(1)}%</span>
          <span><i className="forest-channel" style={{background:"#4f7fc4"}}/>B · PC3 {(forest.manifest.embedding.variance[2]*100).toFixed(1)}%</span>
          <button className="forest-info-toggle" onClick={inspectForest}><Info size={13}/>数据速览</button>
        </div> : c40Mode && c40 && c40Frame ? <div className="map-legend forest-legend-bar c40-legend-bar">
          <label className="c40-space c40-city-switch" title={"数据快照 " + c40.manifest.snapshot}>
            <MapPin size={13}/>
            <select aria-label="C40 城市" value={c40Layer?.frame ?? 0} onChange={e=>switchC40City(Number(e.target.value))}>
              {c40.manifest.cities.map((city,index)=><option key={city.id} value={index}>{city.name}</option>)}
            </select>
            <ChevronDown size={12} className="c40-caret" aria-hidden="true"/>
          </label>
          <span className="c40-space-meta c40-snapshot">{c40.manifest.snapshot}</span>
          <span className="c40-space-meta c40-count">{c40Frame.city.samples.toLocaleString()} 个多边形中心</span>
          <span className="c40-separator" aria-hidden="true"/>
          <span><i className="forest-channel" style={{background:"#d64572"}}/>R · PC1</span>
          <span><i className="forest-channel" style={{background:"#4f9e6d"}}/>G · PC2</span>
          <span><i className="forest-channel" style={{background:"#4f7fc4"}}/>B · PC3</span>
          <button className="forest-info-toggle" onClick={inspectC40}><Info size={13}/>数据速览</button>
        </div> : !layer && <div className={"map-legend"+(smoothedMode?" heatmap-legend":"")}>
          {!catalogMode && <span className="legend-color" />}
          <span>
            {s.visualization
              ? "风场可视化 · NOAA GFS"
              : s.dataView?.kind === "ctd"
                ? dataInfo!.label + " · 采样网格均值（" + dataInfo!.unit + "）"
                : s.dataView?.kind === "front"
                  ? "实际前缘线 · 首期棕色 / 末期绿色"
                  : c
                    ? model?.area
                      ? "金色为范围 · 绿色深浅按格内定位依据条数"
                      : "绿色深浅按格内定位依据条数"
                    : sceneMode ? countLegend : catalogMode
                      ? distributionModes[distributionStyle].legendTitle
                      : "模拟记录密度（条/km²）"}
          </span>
          {catalogMode && !sceneMode ? (
            <DistributionLegend mode={distributionStyle}/>
          ) : catalogMode ? (
            <span className="distribution-ramp" role="img" aria-label="观测数量由少到多" title="点选网格查看精确观测数量。">
              <span>少</span><i style={{background:`linear-gradient(to right, ${sceneScale.map(bin=>bin.sceneColor).join(",")})`}}/><span>多</span>
            </span>
          ) : (
            !catalogMode && !c && <span className="density-ramp" />
          )}
          {catalogMode && !sceneMode && s.mapResult?.clusterOverlay && <span className="cluster-legend">局地聚集</span>}
          {catalogMode && s.filters.source==="paper" && s.mapResult && !s.mapResult.selection && <span className="paper-legend">论文研究数据的空间依据</span>}
          {(!pushMode || coarsePush) && <small>
            {frame.visibleCells.toLocaleString()}{" "}
            {s.visualization
              ? "个原网格值 / 幅"
              : s.dataView?.kind === "front"
                ? "条前缘"
                : c
                  ? "命中格"
                  : "可见格"}
          </small>}
        </div>}
        <div className="grid-toolbar">
          {!layer && !s.visualization && !s.dataView && !c ? <label className="distribution-source-picker">
            <Layers size={14}/><span>数据分布</span>
            <select aria-label="全景数据来源" value={s.filters.source} onChange={e=>{
              const source=e.target.value;
              const records=source==="constellation"?assets.flatMap(a=>observationById(a.id)||[]):[];
              patch({overview:"catalog",mapResult:null,mapFocus:null,origin:null,selection:null,source:-1,
                evidence:null,inspector:null,filters:{...emptyFilters(),source},layer:"all",
                ...(records.length?{camera:observationBatchCamera(records)}:{})});
            }}>
              <option value="">全部来源</option>
              {s.filters.source==="expert" && <option value="expert" hidden>科学家推荐</option>}
              <option value="public">开放触达</option><option value="haina">海纳专区</option>
              <option value="constellation">三体星座</option><option value="paper">论文研究数据</option>
            </select>
          </label> : <button className="distribution-source-picker" onClick={()=>openVisualization("catalog",null)}><Layers size={14}/>返回数据分布</button>}
          {catalogMode && <DistributionModePicker value={distributionStyle} context={distributionContext} onChange={setDistributionStyle}/>}
          <select
            aria-label="网格体系"
            value={s.gridSystem}
            onChange={(e) =>
              patch({
                gridSystem: e.target.value as "h3" | "s2",
                selection: null,
              })
            }
          >
            <option value="h3">H3 网格</option>
            <option value="s2">S2 网格</option>
          </select>
          <span className="toolbar-divider" />
          <strong>{frame.productCell && "浏览网格 "}{frame.gridLabel}</strong>
          <button
            className="grid-policy-button"
            aria-label="查看网格选级规则"
            aria-expanded={policy}
            onClick={() => setPolicy(!policy)}
          >
            <Info size={14} />
          </button>
          <span className="toolbar-divider" />
          <label>
            <input
              type="checkbox"
              checked={s.mesh}
              onChange={(e) => patch({ mesh: e.target.checked })}
            />
            网格线
          </label>
        </div>
        </div>
        <div className="map-hint">
          {frame.loading || "拖动旋转 · 滚轮缩放 · 点击网格探索"}
        </div>

      </div>
      {policy && (
        <div className="grid-policy-popover">
          <strong>为什么显示这一级？</strong>
          <p>{s.camera.reason}</p>
          <p>
            H3 R2–R7 / S2 L5、L6、L8、L9、L11、L12
            按近似面积对应六档视野。缩放更新显示层级，选中网格保留原范围。
          </p>
        </div>
      )}
  </div>;
  return (
    <section
      className={"earth-view" + (s.visualization ? " wind-mode" : "")+((catalogMode||forestMode||c40Mode)?" catalog-distribution":"")}
      data-wind-theme={s.visualization ? windTheme : undefined}
      aria-label="数据地球"
    >
      <div className="earth-canvas-wrap">
        <canvas
          ref={canvas}
          role="img"
          aria-label="可旋转、缩放与点选网格的数据地球"
        />
        <canvas
          ref={windCanvas}
          className="wind-particles-canvas"
          aria-hidden="true"
        />
        {s.flight?.kind==="place" && (
          <div ref={placePin} className="place-pin" role="img" aria-label={"定位标记："+(s.flight.label||"目标位置")}>
            <span className="place-pin-pulse" aria-hidden="true" />
            <span className="place-pin-dot" aria-hidden="true" />
            {s.flight.label && <span className="place-pin-label">{s.flight.label}</span>}
          </div>
        )}
      </div>

      {hover && canvas.current && <GridHoverOverview hover={hover} filters={s.filters} batch={s.mapResult}
        index={hoverIndex} locate={geoOrientation} width={canvas.current.clientWidth-rightInset} height={canvas.current.clientHeight}
        pushConfigured={s.pushFeed?.offline?undefined:s.pushFeed?.configured}/>}

      {activeAnswer && frame.answerPins?.map((pin,i)=><button key={pin.assetId+":"+i}
        className={"answer-map-pin"+(pin.kind==="range"?" range":"")+(s.mapFocus?.assetId===pin.assetId?" focused":"")}
        style={{left:pin.x,top:pin.y}} aria-label={(pin.kind==="range"?"目录范围依据 ":"球上依据 ")+pin.number+"："+(assetById.get(pin.assetId)?.title || "资料")}
        onPointerEnter={()=>focusAnswerEvidence(activeAnswer,pin.assetId)} onPointerLeave={()=>focusAnswerEvidence(activeAnswer,null)}
        onFocus={()=>focusAnswerEvidence(activeAnswer,pin.assetId)} onBlur={()=>focusAnswerEvidence(activeAnswer,null)}
        onClick={()=>{
          focusAnswerEvidence(activeAnswer,pin.assetId,true);patch({chatOpen:true});
          document.querySelector(`[data-message-id="${CSS.escape(activeAnswer.id)}"] .answer-citation[data-asset-id="${CSS.escape(pin.assetId)}"]`)?.scrollIntoView({block:"nearest"});
        }}>{pin.kind==="range"?"范围 ":""}{pin.number}</button>)}
      {frame.productCell?.anchor && (
        <span className="product-cell-label" style={{ left: frame.productCell.anchor.x, top: frame.productCell.anchor.y }}>
          {frame.productCell.level} · {frame.productCell.count} 种产品参与着色
        </span>
      )}
      {s.visualization && (
        <>
          <WindControls
            theme={windTheme}
            onThemeChange={changeWindTheme}
            ready={windLoad.ready}
            error={windLoad.error}
            retry={() => setWindRetry((value) => value + 1)}
          />
          <WindLegend theme={windTheme} />
        </>
      )}
      <div ref={locationBar} className="earth-location" aria-label="当前视野位置" style={{maxWidth:`calc(100% - ${rightInset}px - 52px)`}}>
        <div className="geographic-context">
          <MapPin size={13} />
          <span className="location-path" title={orientation.label}>视野中心 · {orientation.label}</span>
          <small>
            {Math.abs(s.camera.center[0]).toFixed(2)}°
            {s.camera.center[0] < 0 ? "W" : "E"}　
            {Math.abs(s.camera.center[1]).toFixed(2)}°
            {s.camera.center[1] < 0 ? "S" : "N"}
          </small>
          {orientation.country && orientation.requestedLevel>0 && <details className="location-provenance" key={s.camera.center.join(",")+"/"+orientation.label}
            onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node))e.currentTarget.open=false;}}>
            <summary aria-label="行政区位置依据"><Info size={12}/>{orientation.areas.length?"区划参考":orientation.pending?"定位中":orientation.error?"区划暂不可用":"区划未细分"}</summary>
            <div className="location-provenance-panel">
              <strong>{orientation.label}</strong>
              {orientation.areas.map(area=><p key={area.level+area.id}>{area.name}<small>{area.year} 年区划</small><small>{area.source} · {area.license}</small></p>)}
              {!!orientation.areas.length && <p>区划名称依据各层数据所载年份，可能与现行区划不同。视野放大后，显示到已提供且能核对的位置层级。</p>}
              {(orientation.error || orientation.partial) && <p>部分细分边界暂未载入，当前保留已核对的层级。</p>}
              {orientation.pending && <p>正在后台载入细分边界…</p>}
              {!orientation.pending && !orientation.error && !orientation.areas.length && <p>该点没有可核对的更细边界，保留图集位置。</p>}
              <a href="https://www.geoboundaries.org/" target="_blank" rel="noreferrer">行政边界来源：geoBoundaries</a>
            </div>
          </details>}
        </div>
        {s.researchRegion && <ResearchRegionLayer layer={s.researchRegion}
          toggle={()=>patch({researchRegion:{...s.researchRegion!,visible:!s.researchRegion!.visible}})}
          locate={()=>flyToResearchRegion(s.researchRegion!.region,s.researchRegion!.messageId)}/>}
      </div>
      {s.visualization || layer ? null : c ? (
        <div className="earth-task-card">
          <div className="task-label">
            <span>
              {c.id} · {c.verified ? "已核来源" : "来源目录"}
            </span>
            <button
              aria-label="退出当前研究"
              onClick={() =>
                patch({
                  caseId: null,
                  filters: emptyFilters(),
                  selection: null,
                  layer: "all",
                  camera: {
                    center: [105, 25],
                    zoom: 1,
                    reason: "全球数据分布总览",
                  },
                })
              }
            >
              <X size={14} />
            </button>
          </div>
          <h2>{c.title}</h2>
          <p>
            {s.dataView?.kind === "ctd"
              ? dataInfo!.label +
                " · " +
                selectedStation(s.dataView).date.slice(0, 10) +
                " · 目标深度 " +
                s.dataView.depth +
                " m"
              : s.dataView?.kind === "front"
                ? s.dataView.glacier +
                  " · " +
                  (s.dataView.epoch === "compare" ? "首末前缘对照" : "单期前缘")
                : !c.verified
                  ? c.region + " · 尚无已核局地记录"
                  : model?.caption}
          </p>
          {c.id === "wind" && <DatasetActions caseId="wind" index={0} />}
          {s.origin && !s.dataView && (
            <button className="candidate-link" onClick={leaveDetail}>
              返回候选列表
            </button>
          )}
          {!s.dataView && (
            <button
              className="candidate-link"
              onClick={() => inspectCandidates(snapshot())}
            >
              查看研究所需资料
            </button>
          )}
          {(c.verified || s.dataView) && (
            <div className="task-options">
              {s.dataView ? (
                <button onClick={leaveDetail}>
                  {s.origin ? "返回进入前的结果" : "返回证据分布"}
                </button>
              ) : (
                <select
                  aria-label="球面输出"
                  value={s.layer}
                  onChange={(e) =>
                    patch({
                      layer: e.target.value as MapLayer,
                      selection: null,
                    })
                  }
                >
                  <option value="all">证据分布</option>
                  <option value="verified">实读数据</option>
                  <option value="joint">共同可用</option>
                  {c.id === "Q02" && (
                    <option value="paired">DEM 与边界同地</option>
                  )}
                </select>
              )}
              <button
                onClick={() =>
                  patch({
                    camera: fitCamera(c.id, s.filters, s.layer) || s.camera,
                    selection: null,
                  })
                }
              >
                <LocateFixed size={13} />
                定位全貌
              </button>
            </div>
          )}
          {model?.places && (
            <div className="place-links">
              {model.places.map(([label, term]) => (
                <button
                  key={term}
                  aria-pressed={s.filters.place === term}
                  onClick={() =>
                    setFilters(
                      { place: s.filters.place === term ? "" : term },
                      true,
                    )
                  }
                >
                  {label}
                  <ArrowUpRight size={11} />
                </button>
              ))}
            </div>
          )}
          {s.layer === "joint" && (
            <div className="map-gap">当前材料尚未通过全部联合使用条件。</div>
          )}
          {s.filters.period && (
            <button
              className="filter-chip"
              onClick={() => setFilters({ period: null })}
            >
              {s.filters.period.join("–")} 年 <X size={11} />
            </button>
          )}
          {s.filters.depth && (
            <button
              className="filter-chip"
              onClick={() => setFilters({ depth: null })}
            >
              {s.filters.depth.join("–")} m <X size={11} />
            </button>
          )}
          {s.filters.maxDem !== null && (
            <button
              className="filter-chip"
              onClick={() => setFilters({ maxDem: null })}
            >
              DEM ≤ {s.filters.maxDem} m<X size={11} />
            </button>
          )}
        </div>
      ) : showOverview && (
        <div className={"earth-overview"+(pushMode?" push-overview":"")} style={s.researchRegion && catalogMode?{top:locationBottom,bottom:"auto"}:undefined}>
          <span className="overview-rule" />
      {s.mapResult?.answerId && <div className="globe-answer-context">
        <div className="globe-answer-summary" role="status"><MapPin size={13}/><span>{s.mapFocus && focusedEvidence
          ? (assetById.get(s.mapFocus.assetId)?.title || "所选资料")+(focusedEvidence.kind==="local"?" · 数据位置已高亮":focusedEvidence.kind==="global"?" · 全球覆盖已高亮":focusedEvidence.coverageGeometries?.length?" · 目录范围已高亮":" · 数据位置待核")
          : "正在显示："+s.mapResult.title}</span>
          <button onClick={()=>patch({mapResult:null,mapFocus:null})} aria-label="解除本轮结果范围"><X size={13}/></button>
        </div>
        {activeAnswer && <div className="globe-answer-reference-list" role="group" aria-label="本轮地图依据">
          {answerReferences.map(ref=>{const evidence=mappedEvidence.get(ref.assetId);if(!evidence)return null;
            return <button key={ref.number} className={(s.mapFocus?.assetId===ref.assetId?"focused ":"")+(evidence.kind==="unlocated"?"unlocated":"")}
              title={(assetById.get(ref.assetId)?.title || "资料")+(evidence.kind==="range"?" · 目录范围，非精确数据位置":"")}
              onPointerEnter={()=>focusAnswerEvidence(activeAnswer,ref.assetId)} onPointerLeave={()=>focusAnswerEvidence(activeAnswer,null)}
              onClick={()=>flyToEvidence(activeAnswer,ref.assetId)}>{evidence.kind==="global"?"全球":evidence.kind==="range"?"范围":evidence.kind==="unlocated"?"待定位":"位置"}〔{ref.number}〕</button>;
          })}
        </div>}
      </div>}

          {catalogMode ? (
            <>
              {s.mapResult && !s.mapResult.answerId && <p className="batch-title" title={s.mapResult.title}>{s.mapResult.title} · {s.filters.source==="paper" ? visibleItems.length+" 份论文研究数据" : products(visibleItems).size+" 种产品"}</p>}
              {pushMode ? <>
                <p className="push-count">{products(visibleItems).size} 种产品 · {pushedRecords.length} 条观测 · {new Set(pushedRecords.map(r=>r.satellite)).size} 颗卫星</p>
                <small>{pushedRecords.length?(pushedRecords.every(r=>r.test)?"联调数据 · ":"")+
                  (s.mapResult?"当前结果":"接收目录 · 每日刷新") : s.mapResult ? "本轮没有符合条件的星座观测" : s.pushFeed?.offline?"接收服务暂不可用":s.pushFeed?"等待星座推送 · 每日刷新":"正在读取观测"}</small>
                {pushedRecords.length>0 && <div className="push-extent">
                  <button onClick={()=>patch({camera:{...observationBatchCamera(pushedRecords),zoom:1},selection:null})}>全球分布</button>
                  <button onClick={()=>patch({camera:observationBatchCamera(pushedRecords),selection:null})}>定位观测</button>
                </div>}
              </> : null}

              {s.mapResult?.selection && (
                <div className="frozen-grid-note">
                  <span>原选网格 · {s.mapResult.selection.grid.label}{frame.productCell && ` · ${frame.productCell.count} 种产品参与着色`}</span>
                  <button
                    onClick={() =>
                      patch({
                        mapResult: {
                          ...s.mapResult!,
                          selection: null,
                          originKind: s.mapResult!.caseId
                            ? "research"
                            : "catalog",
                          title: "原批资料 · 重新选格",
                        },
                        selection: null,
                      })
                    }
                  >
                    解除原选格
                  </button>
                </div>
              )}
              {s.mapResult && s.origin && (
                <button className="candidate-link" onClick={leaveDetail}>
                  返回候选列表
                </button>
              )}
              {s.filters.type && <button className="candidate-link" aria-label={"清除形态筛选："+s.filters.type} onClick={()=>setFilters({type:""})}>
                {s.filters.type} <X size={11}/>
              </button>}
            </>
          ) : (
            <>
              <p>探索多源地学数据的空间分布</p>
              <strong>
                10,000,000<span>条空间记录</span>
              </strong>
              <small>模拟分布 · 从科学问题进入已核数据与线索</small>
              <div className="source-switch">
                <select
                  aria-label="全景数据来源"
                  value={s.source}
                  onChange={(e) => patch({ source: +e.target.value })}
                >
                  <option value={-1}>全部来源</option>
                  <option value={0}>海纳收录示例</option>
                  <option value={1}>论文线索示例</option>
                  <option value={2}>科学家推荐示例</option>
                </select>
              </div>
            </>
          )}
        </div>
      )}
      <div className="earth-side-controls" ref={controls}>
        <button data-basemap aria-label="切换底图" title="切换底图" aria-expanded={basemapOpen} aria-haspopup="dialog" onClick={()=>setBasemapOpen(open=>!open)}>
          <Layers size={18} />
        </button>
        <span />
        <button data-reset aria-label="恢复全球视图" title="恢复全球视图">
          <LocateFixed size={18} />
        </button>
        <span />
        <button data-plus aria-label="放大地球">
          <Plus size={19} />
        </button>
        <button data-minus aria-label="缩小地球">
          <Minus size={19} />
        </button>
      </div>
      {basemapOpen && (
        <>
          <div className="basemap-backdrop" onClick={()=>setBasemapOpen(false)} />
          <div className="basemap-menu" role="dialog" aria-label="选择底图">
            <header><strong>底图</strong><button aria-label="关闭底图菜单" onClick={()=>setBasemapOpen(false)}><X size={13} /></button></header>
            <div className="basemap-list">
              <button aria-pressed={!basemapId} className={!basemapId?"active":""} onClick={()=>{setBasemapId(null);setBasemapOpen(false);}}>
                <i className="basemap-swatch vector" aria-hidden="true" />
                <span><strong>矢量底图</strong><small>项目默认样式，最轻</small></span>
              </button>
              {BASEMAPS.map(style=>(
                <button key={style.id} aria-pressed={basemapId===style.id} className={basemapId===style.id?"active":""}
                  onClick={()=>{setBasemapId(style.id);setBasemapOpen(false);}}>
                  <i className={"basemap-swatch "+style.id} aria-hidden="true" />
                  <span><strong>{style.name}</strong><small>{style.hint}</small></span>
                </button>
              ))}
            </div>
            {s.visualization && <p className="basemap-note">风场可视化使用专用背景，返回普通地球后显示底图。</p>}
            {basemapError && <p role="status">{basemapError}</p>}
            <small className="basemap-credit">底图 © Esri ArcGIS Online{basemapStyle(basemapId)?" · "+basemapStyle(basemapId)!.attribution:""}</small>
          </div>
        </>
      )}
      {basemapId && basemapLoading && <div className="basemap-status">正在载入底图…</div>}
      {basemapId && !basemapLoading && basemapError && <div className="basemap-status error">{basemapError}</div>}
      {basemapId && basemapFrame && (
        <div className="basemap-attribution" title={basemapStyle(basemapId)?.attribution}>
          {basemapStyle(basemapId)?.name} · 底图 © Esri
        </div>
      )}
      {!layer && s.selection && frame.anchor && (
        <div
          className="grid-popover-stack"
          style={{
            "--anchor-x": `${frame.anchor.x + 15}px`,
            "--anchor-y": `${Math.max(frame.anchor.y - 65, 12)}px`,
            "--map-inset": `${rightInset}px`,
          } as CSSProperties}
        >
          <div className="map-popover">
          <div className="popover-heading">
            <span>
              {s.selection.grid.label} ·{" "}
              {s.visualization ? "位置风速" : "选中网格"}
            </span>
            <button
              aria-label="清除选格"
              onClick={() => patch({ selection: null })}
            >
              <X size={14} />
            </button>
          </div>
          <button className="fly-to-grid" onClick={()=>flyToGrid(s.selection!)}><LocateFixed size={13}/>定位此网格</button>
          <small className="picked-location">
            {geoOrientation(s.selection.point).split("（")[0]} ·{" "}
            {s.selection.point
              .map(
                (v, i) =>
                  Math.abs(v).toFixed(2) +
                  "°" +
                  (i ? (v < 0 ? "S" : "N") : v < 0 ? "W" : "E"),
              )
              .join(" ")}
          </small>
          <strong>
            {(catalogMode || c) && !s.dataView && !s.visualization
              ? outsideFrozen
                ? "点击位置在原选格之外"
                : countedCatalog ? selectedCount===undefined ? "正在读取格内可定位数据集…" : "格内可定位数据集 "+selectedCount+" 种"
                : catalogMode && s.filters.source==="paper" ? selectedAssets.length+" 份论文研究数据" : "关联 "+(distribution?.total||0)+" 种产品"+(selectedScenes.length?" · 已核 "+selectedScenes.length+" "+observationUnit(selectedScenes):"")
              : s.visualization
                ? windProbe
                  ? windProbe.speed.toFixed(2) + " m/s"
                  : "风场正在载入"
                : c
                  ? s.dataView?.kind === "ctd"
                    ? dataSamples.length
                      ? (
                          dataSamples.reduce((n, s) => n + s.value, 0) /
                          dataSamples.length
                        ).toFixed(4) +
                        " " +
                        dataInfo!.unit
                      : "此格无有效采样值"
                    : inArea && !entries.length
                      ? model?.areaTitle
                      : entries.length + " 条定位依据"
                  : s.selection.counts?.length
                    ? (s.source < 0 ? s.selection.counts.reduce((a, b) => a + b, 0) : s.selection.counts[s.source] ?? 0)
                        .toLocaleString() + " 条模拟记录"
                    : "正在读取来源统计…"}
          </strong>
          {countedCatalog && !outsideFrozen && selectedCount!==undefined && <div className="cell-color-basis">
            {smoothedMode ? "本格精确数量；热度按邻域计数平滑生成" : selectedCount===0 ? "本格不着色 · 覆盖资料另列" : "网格着色依据 · "+countBand(selectedCount)!.label+" 档"}
          </div>}
          <p>
            {countedCatalog && !outsideFrozen && <span className="cell-hit-row cell-related-total">
              关联产品共 {distribution?.total||0} 种（含覆盖与范围说明）
            </span>}
            {(catalogMode || c) && !s.dataView && !s.visualization ? (
              outsideFrozen ? (
                "此批次限定于已保存的原格。可解除原选格，查看这些资料在其他位置的依据。"
              ) : pushMode ? (
                selectedAssets.length ? selectedAssets.slice(0,3).map(a=>{
                  const r=observationById(a.id)!;
                  return <span key={a.id} className="cell-hit-row">{r.satellite} · {observationStamp(r)}</span>;
                }) : "当前观测足迹未与此格相交。"
              ) : (
                <>
                  {s.mapResult?.selection && (
                    <span className="cell-hit-row">
                      按原格 {s.mapResult.selection.grid.label} 统计
                    </span>
                  )}
                  {localHits.length > 0 && (
                    <span className="cell-hit-row">
                      {localHits
                        .slice(0, 2)
                        .map((a) => a.title)
                        .join("、")}
                      {localHits.length > 2 ? " 等" : ""}
                    </span>
                  )}
                  <span className="cell-hit-row">
                    全球覆盖 {products(globalHits).size} 种{catalogMode && "（不参与着色）"}
                    {globalHits.length > 0 && " · "+globalHits.slice(0,2).map(a=>a.title).join("、")}
                  </span>
                  {!!frame.clusterKeys?.length && <span className="cell-hit-row">局地聚集 · {frame.clusterKeys.length} 种产品：{[...new Set(selectedAssets.filter(a=>frame.clusterKeys!.includes(productKey(a) || "")).map(a=>a.title))].join("、")}</span>}
                  {!!bandHits.length && <span className="cell-hit-row">元数据覆盖说明 {products(bandHits).size} 种（不参与着色）</span>}
                  {catalogMode && !!globalHits.length && !!bandHits.length && <span className="cell-hit-row cell-count-note">覆盖类别可重叠，关联总数按产品去重</span>}
                  {areaHits.length > 0 && (
                    <span className="cell-hit-row">
                      相关范围或研究区域 {areaHits.length} 项 ·{" "}
                      {areaHits.slice(0, 2).map((a) => a.title).join("、")}{areaHits.length > 2 && " 等"}
                    </span>
                  )}
                  {entries.length > 0 && (
                    <span className="cell-hit-row">
                      格内 {entries.length} 条定位依据
                    </span>
                  )}
                </>
              )
            ) : s.visualization ? (
              windProbe ? (
                `${s.selection.point.map((v) => v.toFixed(3)).join(", ")}° · u ${windProbe.u.toFixed(2)} · v ${windProbe.v.toFixed(2)} m/s，风向来向 ${windProbe.from.toFixed(0)}°。数值来自原 1° 风场的双线性插值。`
              ) : (
                "载入完成后可读取此位置的风矢量。"
              )
            ) : c ? (
              s.dataView?.kind === "ctd" ? (
                dataSamples.length ? (
                  dataSamples.length +
                  " 个站次 · 最近实测层 " +
                  (dataSamples.length === 1
                    ? dataSamples[0].depth +
                      " m · " +
                      dataSamples[0].name.split("_").pop()
                    : Math.min(...dataSamples.map((s) => s.depth)) +
                      "–" +
                      Math.max(...dataSamples.map((s) => s.depth)) +
                      " m · 格内均值")
                ) : (
                  "当前采样日与目标深度下没有命中观测。"
                )
              ) : entries.length ? (
                entries
                  .slice(0, 2)
                  .map((e) => e.label)
                  .join("、")
              ) : inArea ? (
                "点击位置在所示范围内，可查看范围依据。"
              ) : (
                "当前条件下暂无已核数据命中。"
              )
            ) : (
              "来源计数来自同一批模拟记录，网格相交分别统计。"
            )}
          </p>
          <div className="popover-actions">
            <button
              ref={listButton}
              aria-expanded={!!gridList && !s.evidence}
              aria-controls={gridList ? "grid-data-popover" : undefined}
              onClick={gridList ? closeGridList : openGridList}
              disabled={
                s.visualization
                  ? !windProbe
                  : s.dataView?.kind === "ctd"
                    ? !dataSamples.length
                    : false
              }
            >
              <List size={12} />
              查看数据
            </button>
            <button
              onClick={() => {
                attachScope(gridScope(s.selection!,geoOrientation(s.selection!.point).split("（")[0]),...timeScope(s.filters));
              }}
            >
              用此范围提问
              <ArrowUpRight size={12} />
            </button>
          </div>
          </div>
          {gridList && (
            <div className="grid-evidence-anchor" hidden={!!s.evidence}>
              <GridDataPopover batch={gridList} source={s.source} onClose={closeGridList} organizeByLocation={countedCatalog} coverageBatch={s.mapResult} />
            </div>
          )}
        </div>
      )}
      {s.dataView?.kind === "ctd" && (
        <div className="data-map-scale">
          <span>仅着色有样本的网格 · 最近实测层 ±5 m</span>
          <div className="scalar-color-ramp" />
          <div>
            <small>{dataInfo!.min.toFixed(2)}</small>
            <small>
              {dataInfo!.max.toFixed(2)} {dataInfo!.unit}
            </small>
          </div>
          {!ctdSamples(s.dataView, s.filters).length && (
            <p>本采样日没有符合该深度与变量的有效值。</p>
          )}
        </div>
      )}
      {toolsHost ? createPortal(footer, toolsHost) : footer}
    </section>
  );
}
