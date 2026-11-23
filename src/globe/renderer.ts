import {createRainPainter} from "./rain-layer";
import type {RainTiles} from "./rain-tiles";
import {rainCell,rainGrid,rainFactors} from "../domain/rainfall";
import { rememberClientError } from "../domain/client-error";
import {answerEvidence} from "../domain/answer-map";
import {createCameraMotion} from "./camera-motion";
import {createHoverIntent,type GridHover} from "./grid-hover";
import {createFieldPainter} from "./regional-layer";
import {createGeoImagePainter,type GeoImageFrame} from "./geo-image-layer";
import {createDistributionPainters} from "./distribution-painters";
import {resolveDistributionMode,type DistributionMode} from "../domain/distribution-modes";
import { clusterOverlay, paperOverlay } from "./distribution-overlays";
import {createAsyncCoverageViewport} from './async-viewport';
import {createCoverageClient} from "./coverage-client";
import {backgroundCoverageProduct,regionRecords} from "../domain/product-distribution";
import {drawObservationLabels,drawCellCounts} from "./observation-labels";
import {coarseObservationGrid} from "../domain/observation-grid";
import { observationAssets, catalogRevision } from "../domain/datasets";
import { observationById, observationGeometry } from "../domain/push-observations";
import { visibleObservation } from "../domain/results";
import { earthSearchId, inventoryId } from "../domain/earth-search";
import { catalogEvidenceGrid, includesArea, outsideMappedSelection } from "../domain/results";
import { createWindParticles, drawWindSurface, type WindTheme } from "./wind-layer";
import { getWindData, windFrame, windManifest } from "../domain/wind";
import { drawGrid } from "../data/evidence/research-grid.mjs";
import { drawDataLayer } from "./data-layer";
import {
  geoOrthographic,
  geoGraticule10,
  geoPath,
  geoDistance,
  geoArea,
  geoCentroid,
} from "d3-geo";
import { feature } from "topojson-client";
import atlas from "world-atlas/land-110m.json";
import { cellArea } from "h3-js";
import { createGridStore } from "../data/evidence/grid-store.mjs";
import { createS2Store, s2IdAt } from "../data/evidence/s2-store.mjs";
import { drawResearchMap } from "../data/evidence/research-spatial.mjs";
import { navigation, resolution } from "../data/evidence/globe-navigation.mjs";
import type backgroundData from "../data/evidence/background-overview.json";
import {
  gridSpec,
  cellAt,
  cellShape,
  indexFor,
  spatialEntries,
  getModel,
} from "../domain/spatial";
import type {
  DataView,
  VisualizationState,
  Camera,
  Filters,
  GridSystem,
  MapLayer,
  Selection,
  Coordinate,
} from "../domain/types";
export interface Scene {
  flight?:{kind?:"research-region"|"place"|"grid"|"layer-control"}|null;
  researchRegion?:import("../domain/research-region").ResearchRegionLayer|null;
  observationGlobe?:boolean;
  onObservationPick?:(x:number,y:number)=>void;
  answerReferences?: {assetId:string;number:number}[];
  pending?:boolean;
  mapFocus?: {answerId:string;assetId:string;locked:boolean}|null;
  catalogStyle?: DistributionMode;
  paperFeed?:{loading:boolean}|null;
  fieldLayer?: {id:string;frame:number}|null;
  fieldTexture?:Uint8ClampedArray|null;
  fieldImage?:GeoImageFrame|null;
  basemap?:GeoImageFrame|null;
  basemapId?:string;
  fieldRain?:RainTiles|null;
  windTheme: WindTheme;
  mapResult?: import("../domain/types").CandidateSet | null;
  overview?: "catalog" | "simulation";
  visualization?: VisualizationState | null;
  rightInset?: number;
  caseId: string | null;
  camera: Camera;
  gridSystem: GridSystem;
  filters: Filters;
  layer: MapLayer;
  selection: Selection | null;
  mesh: boolean;
  source: number;
  dataView: DataView | null;
}
export interface FrameInfo {
  answerPins?: {assetId:string;number:number;x:number;y:number;kind:"local"|"range"}[];
  clusterKeys?: string[];
  coloredProducts?: number;
  coloredSelection?: string;
  coverageSelection?: {selection: Selection; filters: Filters; batch: Scene["mapResult"]; revision: string};
  productCell?: { level: string; count: number; anchor: { x: number; y: number } | null };
  gridLabel: string;
  level: number;
  visibleCells: number;
  loading: string;
  anchor: { x: number; y: number } | null;
}
export function createRenderer(
  canvas: HTMLCanvasElement,
  controls: HTMLElement,
  getScene: () => Scene,
  onCamera: (c: Camera) => void,
  onSelect: (s: Selection) => void,
  onFrame: (f: FrameInfo) => void,
  windCanvas?: HTMLCanvasElement,
  onError?: (error: Error | null) => void,
  onHover?: (hover:GridHover|null) => void,
  onManualNavigation?: () => void,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw Error("浏览器未提供 Canvas 绘图环境");
  let drawingFailed = false;
  let hoverIntent:ReturnType<typeof createHoverIntent<GridHover>>|undefined;
  let hovered:GridHover|null=null;
  let disposed = false,
    frame = 0,
    projection = geoOrthographic();
  const drawField=createFieldPainter();
  const drawGeoImage=createGeoImagePainter();
  let rainPainter:ReturnType<typeof createRainPainter>|undefined;
  const distributionPainters=createDistributionPainters();
  const particles = windCanvas ? createWindParticles(windCanvas) : null;
  const land = feature(atlas as any, (atlas as any).objects.land);
  const graticule = geoGraticule10();
  const basemapPaths=new WeakMap<object,{key:string;path:Path2D}>();
  const h3Store = createGridStore(schedule);
  let s2Store: ReturnType<typeof createS2Store> | undefined;
  const getS2Store = () => s2Store ??= createS2Store(schedule);
  let background: typeof backgroundData | undefined;
  let backgroundRows: {id: string; row: number[]}[] = [];
  let backgroundPending: Promise<void> | undefined;
  let drawPolitical: typeof import("../data/evidence/geo-orientation.mjs").drawPolitical | undefined;
  let firstFrame = true;
  import("../data/evidence/geo-orientation.mjs").then(atlas => {
    if (!disposed) { drawPolitical = atlas.drawPolitical; schedule(); }
  }).catch(error => rememberClientError(error, "globe-orientation"));
  function loadBackground() {
    backgroundPending ??= import("../data/evidence/background-overview.json").then(module => {
      if (!disposed) {
        background = module.default;
        const grid = gridSpec("h3", 2);
        backgroundRows = background.world.map(row => ({id: cellAt([row[0],row[1]],grid), row}));
        schedule();
      }
    }).catch(error => {
      rememberClientError(error, "globe-simulation");
      if (!disposed) onError?.(new Error("模拟网格暂时无法载入，请重试。"));
    }).finally(() => { backgroundPending = undefined; });
    return backgroundPending;
  }
  const areaCache = new Map<string, number>();
  const coverageClient = createCoverageClient(schedule);
  const selectedCoverageClient = createCoverageClient(schedule);
  let regionView:{revision:number;filters:Filters;batch:Scene["mapResult"];regions:ReturnType<typeof regionRecords>}|undefined;
  let focusView:{batch:Scene["mapResult"];filters:Filters;layer:MapLayer;revision:number;evidence:ReturnType<typeof answerEvidence>}|undefined;
  const motion=createCameraMotion({read:()=>getScene().camera,commit:onCamera,
    changed:()=>{markInteraction();schedule();},
    canFly:()=>{
      const {pending,flight}=getScene();
      // A pending answer must not interrupt an explicit navigation already underway.
      return !disposed && (!pending || flight?.kind==="grid" || flight?.kind==="research-region" ||
        flight?.kind==="place" || flight?.kind==="layer-control");
    },
    flightChanged:flying=>{canvas.dataset.flying=String(flying);if(flying)hoverIntent?.cancel();}});
  const stopFlight=motion.stopFlight,flyTo=motion.flyTo;
  let interacting = false,pendingNavigation=false;
  let interactionTimer: ReturnType<typeof setTimeout> | undefined;
  const markInteraction = () => {
    hoverIntent?.cancel();
    interacting = true;
    clearTimeout(interactionTimer);
    interactionTimer = setTimeout(() => { interacting = false; motion.settle();schedule(); }, 160);
  };
  const coverageViewport=createAsyncCoverageViewport(schedule);
  let overlays: { key: string; cluster?: ReturnType<typeof clusterOverlay>; paper?: ReturnType<typeof paperOverlay> } | undefined;
  let observationRevision=0;
  let width = 0,
    height = 0;
  const radius = () =>
    Math.max(
      1,
      Math.min(
        canvas.clientWidth - (getScene().rightInset || 0),
        canvas.clientHeight,
      ) * 0.455,
    );
  function paint(
    geometry: any,
    fill: string | null,
    stroke: string | null,
    alpha = 1,
    lineWidth = 0.6,
  ) {
    ctx!.globalAlpha = alpha;
    let path:Path2D|undefined;
    if(typeof Path2D!=="undefined" && (geometry===land || geometry===graticule)) {
      const key=JSON.stringify([projection.rotate(),projection.translate(),projection.scale(),projection.clipExtent()]);
      let cached=basemapPaths.get(geometry);
      if(cached?.key!==key){
        const next=new Path2D();
        geoPath(projection,{beginPath:()=>{},moveTo:next.moveTo.bind(next),lineTo:next.lineTo.bind(next),arc:next.arc.bind(next),closePath:next.closePath.bind(next)})(geometry);
        cached={key,path:next};basemapPaths.set(geometry,cached);
      }
      path=cached.path;
    } else {ctx!.beginPath();geoPath(projection, ctx!)(geometry);}
    if (fill) {
      ctx!.fillStyle = fill;
      if(path)ctx!.fill(path);else ctx!.fill();
    }
    if (stroke) {
      ctx!.strokeStyle = stroke;
      ctx!.lineWidth = lineWidth;
      if(path)ctx!.stroke(path);else ctx!.stroke();
    }
    ctx!.globalAlpha = 1;
  }
  function schedule() {
    if (disposed || frame) return;
    frame = requestAnimationFrame(() => {
      try {
        draw();
        if (drawingFailed) { drawingFailed = false; onError?.(null); }
      }
      catch (error) {
        frame = 0;
        drawingFailed = true;
        canvas.width = canvas.width;
        rememberClientError(error, "globe");
        onError?.(new Error("地球绘制中断，请点击恢复全球视图重试。"));
      }
    });
  }
  function draw() {
    frame = 0;
    if (disposed) return;
    const scene = {...getScene(),camera:motion.camera()};
    if(!scene.pending)pendingNavigation=false;
    const catalog = !scene.dataView && !scene.caseId && !scene.fieldLayer && !scene.visualization && scene.overview !== "simulation";
    // The catalogue's grid is its common foundation, including while the
    // distribution is loading or the user is rotating a smoothed view.
    const showMesh = scene.mesh;
    canvas.dataset.gridVisible=String(showMesh);
    canvas.dataset.basemap=scene.basemap?(scene.basemapId||"on"):"";
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    if (!width || !height) return;
    const baseOnly = firstFrame && !scene.caseId && !scene.dataView && !scene.fieldLayer && !scene.visualization;
    firstFrame = false;
    // Pointer coordinates and evidence stay in CSS pixels. Avoid four times the
    // raster work on Retina displays during motion; restore sharpness at rest.
    const dpr = Math.min(devicePixelRatio, interacting?1:2);
    const w = Math.round(width * dpr),
      h = Math.round(height * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx!.clearRect(0, 0, width, height);
    const { center, zoom } = scene.camera;
    const band = resolution(zoom);
    const g = gridSpec(scene.gridSystem, band);
    projection
      .rotate(center.map((n) => -n) as [number, number])
      .translate([(width - (scene.rightInset || 0)) / 2, height / 2])
      .scale(radius() * zoom)
      .clipExtent([
        [0, 0],
        [width, height],
      ]);
    if(scene.observationGlobe){
      paint({type:"Sphere"},"#f5f7f7","#c6d2cf",1,0.8);
      paint(land,"#fcfcf9","#b9c6c1",1,0.7);
      ctx!.save();ctx!.globalAlpha=0.52;
      drawPolitical?.(ctx,projection,interacting?1:zoom);ctx!.restore();
      observationRevision++;
      canvas.dataset.painted="true";
      return;
    }
    let clusterKeys: string[] | undefined;
    let coloredProducts: number | undefined;
    let coverageSelection: FrameInfo["coverageSelection"];
    let coloredSelection: string | undefined;
    let productCell: FrameInfo["productCell"];
    let loading = "",
      visibleCells = 0;
    if(scene.fieldLayer?.id==="forest"||scene.fieldLayer?.id==="c40"){
      paint({type:"Sphere"},"#dcebf2","#9bb6c3");
      paint(land,"#f5f8f4","#b4c6bf");
      if(scene.basemap)drawGeoImage(ctx!,projection,scene.basemap,width,height,interacting);
      if(scene.fieldImage)drawGeoImage(ctx!,projection,scene.fieldImage,width,height,interacting);
      if(zoom<15)paint(graticule,null,"#bad0d7",0.55);
      drawPolitical?.(ctx!,projection,interacting?1:zoom);
      if(showMesh)drawGrid(ctx!,projection,center,g,width,height,zoom);
      if(scene.selection)paint(cellShape(scene.selection.id,scene.selection.grid).geometry,null,"#975411",1,1.5);
    } else if(scene.fieldLayer){
      paint({type:"Sphere"},"#c9e1e7","#90b1b7");
      if(scene.basemap)drawGeoImage(ctx!,projection,scene.basemap,width,height,interacting);
      if(scene.fieldRain){
        rainPainter??=createRainPainter(schedule);
        const level=rainPainter.draw(ctx!,projection,scene.fieldRain,scene.fieldLayer.frame,width,height,width-(scene.rightInset||0),interacting);
        canvas.dataset.rainStep=String(rainFactors[level]*rainGrid.step);
        canvas.dataset.rainLoading=String(scene.fieldRain.loading);
        ctx!.save();ctx!.globalAlpha=.4;
        drawPolitical?.(ctx!,projection,interacting?1:zoom);ctx!.restore();
      }
      else if(scene.fieldTexture)drawField(ctx!,projection,scene.fieldTexture,width,height,interacting);
      else if(!scene.basemap)paint(land,"#e8e9dc","#93a99e");
      if(showMesh)drawGrid(ctx!,projection,center,g,width,height,zoom);
      if(scene.selection && scene.fieldLayer.id==="rain"){
        const {west,north}=rainCell(scene.selection.point);
        const {step}=rainGrid;
        paint({type:"Polygon",coordinates:[[[west,north],[west+step,north],[west+step,north-step],[west,north-step],[west,north]]]},null,"#864c18",1,1.8);
      }else if(scene.selection)paint(cellShape(scene.selection.id,scene.selection.grid).geometry,null,"#975411",1,1.5);
    } else if (scene.visualization) {
      const data = getWindData();
      const light = scene.windTheme === "light";
      paint({ type: "Sphere" }, light ? "#dcebf2" : "#092637", light ? "#92b0bd" : "#749fad");
      ctx!.save();
      ctx!.beginPath();
      ctx!.arc(...projection.translate(), projection.scale(), 0, Math.PI * 2);
      ctx!.clip();
      if (data && scene.visualization.color)
        drawWindSurface(
          ctx!,
          projection,
          data,
          windFrame(scene.visualization),
          width,
          height,
          scene.windTheme,
        );
      paint(land, light ? (scene.visualization.color && data ? null : "#f1f5ef") : "#a4b8a709", light ? "#315f749c" : "#b9d3cb88");
      paint(graticule, null, light ? "#38718633" : "#b5d7d22b");
      if (showMesh)
        drawGrid(ctx!, projection, center, g, width, height, zoom);
      if (scene.selection)
        paint(
          cellShape(scene.selection.id, scene.selection.grid).geometry,
          light ? "#fff2be44" : "#f6db5b18",
          light ? "#a24d13" : "#fff2a1",
          1,
          1.4,
        );
      ctx!.restore();
      visibleCells = data ? windManifest.width * windManifest.height : 0;
      loading = data ? "" : "正在载入真实 GFS 风场…";
    } else {
      ctx!.save();
      ctx!.shadowColor = "#37698735";
      ctx!.shadowBlur = interacting?0:30;
      paint({ type: "Sphere" }, "#dcebf2", "#9bb6c3");
      ctx!.restore();
      paint(land, "#f5f8f4", "#b4c6bf");
      // The raster basemap covers the visible cap; vector coastlines and graticule
      // stay on top so orientation does not depend on imagery being available.
      if(scene.basemap)drawGeoImage(ctx!,projection,scene.basemap,width,height,interacting);
      if (zoom < 15) paint(graticule, null, "#bad0d7", 0.7);
      if (!catalog) drawPolitical?.(ctx, projection, interacting ? 1 : zoom);
      ctx!.save();
      ctx!.beginPath();
      ctx!.arc(...projection.translate(), projection.scale(), 0, Math.PI * 2);
      ctx!.clip();
      if (baseOnly) {
        // Let the browser paint the globe before computing catalogue footprints.
        if(showMesh)drawGrid(ctx!,projection,center,g,width,height,zoom);
        schedule();
      } else if (scene.dataView) {
        visibleCells = drawDataLayer(
          ctx!,
          projection,
          center,
          scene.dataView,
          scene.filters,
          g,
          showMesh,
          width,
          height,
          zoom,
          scene.selection,
        );
      } else if (scene.caseId) {
        const model = getModel(scene.caseId);
        const entries = spatialEntries(
          scene.caseId,
          scene.filters,
          scene.layer,
        );
        const index = indexFor(scene.caseId, scene.filters, scene.layer, g);
        visibleCells = index.size;
        drawResearchMap({
          ctx,
          projection,
          camera: center,
          g,
          w: width,
          h: height,
          z: zoom,
          mesh: showMesh,
          layer: scene.layer,
          model: includesArea(scene.caseId, scene.filters, scene.layer)
            ? model
            : { ...model, area: undefined },
          entries,
          index,
          selected: scene.selection
            ? { id: scene.selection.id, grid: scene.selection.grid }
            : null,
        });
      } else if (scene.overview !== "simulation") {
        // A saved grid is the unit of its evidence. The independent display
        // mesh can change scale or system without expanding that footprint.
        const evidenceGrid = catalogEvidenceGrid(g, scene.mapResult);
        const pushMode=scene.mapResult?.metric==="scenes";
        const coarse=coarseObservationGrid(evidenceGrid);
        const frozen=scene.mapResult?.selection;
        const visible=frozen ? [cellShape(frozen.id,frozen.grid)] : coverageViewport.read(evidenceGrid,projection,center,width-(scene.rightInset||0),height,zoom);
        const viewportPending=!frozen && coverageViewport.pending;
        canvas.dataset.viewportPending=String(viewportPending);
        const ids=visible.map(cell=>cell.id);
        if(!frozen && scene.selection?.grid.key===evidenceGrid.key && !ids.includes(scene.selection.id))ids.unshift(scene.selection.id);
        const coverage=coverageClient.read(evidenceGrid,ids,scene.filters,scene.mapResult,scene.paperFeed?.loading?0:catalogRevision(),interacting);
        const cells=coverage.cells;
        canvas.dataset.coveragePending=String(coverage.pending||viewportPending);
        canvas.dataset.coverageSource="server-index";
        if(coverage.pending||viewportPending)loading=coverage.error || (viewportPending?"正在细化可见网格…":"正在读取网格分布…");
        let regions:ReturnType<typeof regionRecords>=[];
        if(scene.mapResult?.clusterOverlay || (!coarse && (scene.mapResult || scene.filters.source==="constellation"))) {
          if(!regionView || regionView.revision!==catalogRevision() || regionView.filters!==scene.filters || regionView.batch!==scene.mapResult)
            regionView={revision:catalogRevision(),filters:scene.filters,batch:scene.mapResult,regions:regionRecords(scene.filters,scene.mapResult)};
          regions=regionView.regions;
        }
        if (scene.selection && (!frozen || (frozen.id===scene.selection.id && frozen.grid.key===scene.selection.grid.key))) {
          // A retained selection keeps its original grid when navigation zooms
          // to another level. Its headline still reads the indexed exact count.
          const selected=scene.selection.grid.key===evidenceGrid.key ? coverage : !frozen ?
            selectedCoverageClient.read(scene.selection.grid,[scene.selection.id],scene.filters,scene.mapResult,scene.paperFeed?.loading?0:catalogRevision(),interacting) : undefined;
          if (selected?.revision) coverageSelection={
            selection:scene.selection,filters:scene.filters,batch:scene.mapResult,revision:selected.revision,
          };
          if(!pushMode) {
            coloredSelection=scene.selection.grid.key+"/"+scene.selection.id;
            coloredProducts=selected?.ready.has(scene.selection.id)?selected.cells.get(scene.selection.id)??0:undefined;
          }
          if(selected?.pending && !loading)loading=selected.error || "正在读取所选网格计数…";
        }
        for (const areaCase of scene.mapResult?.selection ? [] : ["Q07"]) {
          if (scene.mapResult?.caseId && scene.mapResult.caseId !== areaCase)
            continue;
          const model = getModel(areaCase);
          if (
            !includesArea(areaCase, scene.filters, scene.layer) ||
            !model.area
          )
            continue;
          const relation = areaCase === earthSearchId ? inventoryId : areaCase + "-" + model.areaNeed;
          if (scene.mapResult && !scene.mapResult.ids.includes(relation))
            continue;
          ctx!.setLineDash([4, 3]);
          paint(model.area, areaCase === earthSearchId ? "#24876b30" : null, areaCase === earthSearchId ? "#17664e" : areaCase === "wind" ? "#5b91a7" : "#a48449");
          ctx!.setLineDash([]);
        }
        const frozenSelection = scene.mapResult?.selection;
        const displayMode=resolveDistributionMode(scene.catalogStyle || "heatmap",frozenSelection?"fixed-cell":pushMode?"scenes":"catalog");
        canvas.dataset.distributionStyle=displayMode;
        const paintedCounts=new Map<string,number>();
        const cellLabels:{x:number;y:number;count:number}[]=[];
        for (const [id, count] of cells) {
          const shape = cellShape(id, evidenceGrid);
          if (scene.mapResult?.selection) {
            const [[left, top], [right, bottom]] = geoPath(projection).bounds(shape.geometry);
            if (left > width || right < 0 || top > height || bottom < 0) continue;
          } else {
            if (geoDistance(center, shape.center) > Math.PI / 2) continue;
            const [x, y] = projection(shape.center)!;
            if (x < 0 || x > width || y < 0 || y > height) continue;
          }
          visibleCells++;
          paintedCounts.set(id,count);
          if(pushMode && coarse && geoDistance(center,shape.center)<Math.PI/2){
            const [x,y]=projection(shape.center)!;
            cellLabels.push({x,y,count});
          }
        }
        // Over imagery the catalogue tint stays lighter, otherwise the basemap is barely visible.
        ctx!.save();
        if(scene.basemap)ctx!.globalAlpha=.62;
        distributionPainters[displayMode]({ctx:ctx!,projection,grid:evidenceGrid,counts:paintedCounts,width,height,dragging:interacting,scenes:pushMode,mesh:showMesh});
        ctx!.restore();
        if (showMesh) {
          ctx!.save();
          if (frozenSelection && frozenSelection.grid.key !== g.key) ctx!.globalAlpha = 0.35;
          drawGrid(ctx, projection, center, g, width, height, zoom,evidenceGrid.key===g.key && !frozenSelection?visible:undefined,interacting);
          ctx!.restore();
        }
        paint(land, null, "#516d7466");
        drawPolitical?.(ctx, projection, interacting ? 1 : zoom);
        const showClusters = scene.mapResult?.clusterOverlay === true;
        const paperBatch = !frozenSelection && scene.filters.source === "paper" ? scene.mapResult : null;
        if (!pushMode && (showClusters || paperBatch)) {
          const key = JSON.stringify([evidenceGrid.key, scene.filters, scene.mapResult, regions.map(r=>[r.asset.id,r.scene]), observationAssets().map(a=>a.id)]);
          if (overlays?.key !== key) overlays = {
            key, cluster: showClusters ? clusterOverlay(evidenceGrid,scene.filters,scene.mapResult,regions) : undefined,
            paper: paperBatch ? paperOverlay(evidenceGrid,scene.filters,paperBatch) : undefined,
          };
          if (overlays.cluster) {
            paint(overlays.cluster.geometry,null,"#fff8df",1,3.7);
            paint(overlays.cluster.geometry,null,"#965119",1,2);
            const labels = [];
            for (const [id, products] of overlays.cluster.clusters) {
              const point = cellShape(id,evidenceGrid).center;
              if (geoDistance(center,point) >= Math.PI / 2) continue;
              const [x,y] = projection(point)!;
              labels.push({x,y,count:products.size});
            }
            drawCellCounts(ctx!,labels,width-(scene.rightInset || 0),height,true);
            if (scene.selection) clusterKeys = [...(overlays.cluster.clusters.get(scene.selection.id) || [])];
          }
          if (overlays.paper) {
            ctx!.setLineDash([4,3]);
            for (const shape of [...overlays.paper.areas,overlays.paper.geometry]) paint(shape,null,"#754b94",1,2);
            ctx!.setLineDash([]);
          }
        }
        if(cellLabels.length) drawCellCounts(ctx!,cellLabels,width-(scene.rightInset || 0),height);
        if (!scene.mapResult?.selection && !coarse) {
          const visible=observationAssets(scene.mapResult?.ids).flatMap(a=>{
            const r=observationById(a.id)!;
            return visibleObservation(r,scene.filters,scene.layer) ? [r] : [];
          });
          for(const r of regions) if(!observationById(r.asset.id) && !backgroundCoverageProduct(r.asset))paint(r.area,null,"#347762",1,0.8);
          for(const r of visible) {
            if(r.geometry.type!=="Point") paint(observationGeometry(r),"#2395bb3b","#196686",1,1.8);
          }
          drawObservationLabels(ctx!,projection,visible,center,width-(scene.rightInset || 0),height);
        }
        if (frozenSelection && !pushMode) {
          const geometry = cellShape(frozenSelection.id, frozenSelection.grid).geometry;
          paint(geometry, null, "#ffffffcc", 1, 4);
          paint(geometry, null, "#245448", 1, 2);
          const extent = projection.clipExtent();
          const focusWidth = Math.max(1, width - (scene.rightInset || 0));
          projection.clipExtent([[0, 0], [focusWidth, height]]);
          const [x, y] = geoPath(projection).centroid(geometry);
          projection.clipExtent(extent);
          if(coverage.ready.has(frozenSelection.id)) productCell = { level: evidenceGrid.label, count: cells.get(frozenSelection.id) ?? 0,
            anchor: Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null };
        } else if (frozenSelection) {
          const inside = scene.selection && !outsideMappedSelection(scene.mapResult!, scene.selection);
          paint(cellShape(frozenSelection.id, frozenSelection.grid).geometry, inside ? "#cd922a40" : null, "#805f36", 1.6);
        } else if (scene.selection) {
          paint(
            cellShape(scene.selection.id, scene.selection.grid).geometry,
            "#cd922a40",
            "#a87324",
          );
        }
      } else {
        const marks: {
          id: string;
          center: Coordinate;
          count: number;
          density: number;
        }[] = [];
        const edge =
          g.system === "h3"
            ? [182.5, 69, 26, 9.9, 3.7, 1.4][band - 2]
            : Math.sqrt(510065621 / (6 * 4 ** g.n));
        const cap =
          Math.asin(
            Math.min(1, Math.hypot(width, height) / (2 * projection.scale())),
          ) +
          (2 * edge) / 6371;
        const add = (
          id: string,
          lon: number,
          lat: number,
          count: number,
          area?: number,
        ) => {
          const point: [number, number] = [lon, lat];
          if (geoDistance(center, point) > Math.PI / 2) return;
          const [x, y] = projection(point)!;
          const padding = ((projection.scale() * edge) / 6371) * 2;
          if (
            x < -padding ||
            x > width + padding ||
            y < -padding ||
            y > height + padding
          )
            return;
          const cacheKey = g.key + id;
          if (!areaCache.has(cacheKey))
            areaCache.set(
              cacheKey,
              g.system === "h3"
                ? cellArea(id, "km2")
                : geoArea(cellShape(id, g).geometry) * 6371.0088 ** 2,
            );
          if (areaCache.size > 40000) areaCache.clear();
          marks.push({
            id,
            center: point,
            count,
            density: count / (area || areaCache.get(cacheKey) || 1),
          });
        };
        if (g.system === "h3" && band === 2) {
          if (!background) { loadBackground(); loading = "正在载入模拟网格"; }
          for (const {id, row} of backgroundRows) {
            const counts = (background!.meta as Record<string, number[]>)[id];
            add(
              id,
              row[0],
              row[1],
              scene.source < 0 ? row[2] : counts[scene.source],
            );
          }
        } else {
          const store = g.system === "s2" ? getS2Store() : h3Store;
          loading = store.visit(
            g.n,
            center,
            cap,
            (lon: number, lat: number, u: Uint32Array, i: number) => {
              const id =
                g.system === "s2"
                  ? s2IdAt(u, i)
                  : u[i].toString(16) + u[i + 1].toString(16).padStart(8, "0");
              add(
                id,
                lon,
                lat,
                scene.source < 0
                  ? u[i + 4] + u[i + 5] + u[i + 6]
                  : u[i + 4 + scene.source],
              );
            },
          );
        }
        visibleCells = marks.length;
        const path = geoPath(projection, ctx!);
        for (const m of marks) {
          if (!m.count) continue;
          const intensity = Math.min(1, Math.log2(1 + 1000 * m.density) / 11);
          ctx!.beginPath();
          path(cellShape(m.id, g).geometry);
          ctx!.fillStyle = `rgba(35,133,83,${0.045 + 0.85 * intensity * intensity})`;
          ctx!.fill();
          if (showMesh) {
            ctx!.lineWidth = 0.45;
            ctx!.strokeStyle = "rgba(28,79,55,.13)";
            ctx!.stroke();
          }
        }
        if (scene.selection)
          paint(
            cellShape(scene.selection.id, scene.selection.grid).geometry,
            "#d0933b22",
            "#a26b2d",
          );
      }
      ctx!.restore();
    }
    particles?.update(
      scene.visualization
        ? {
            view: scene.visualization,
            theme: scene.windTheme,
            projection,
            camera: center,
            width,
            height,
          }
        : null,
    );
    const focus=scene.mapFocus,batch=scene.mapResult;
    const answerPins:NonNullable<FrameInfo["answerPins"]>=[];
    canvas.dataset.answerId=batch?.answerId || "";
    canvas.dataset.focusedAsset="";
    canvas.dataset.focusedKind="";
    canvas.dataset.answerGlobal="0";
    if(catalog && batch?.answerId) {
      if(focusView?.batch!==batch || focusView.filters!==scene.filters || focusView.layer!==scene.layer || focusView.revision!==catalogRevision())
        focusView={batch,filters:scene.filters,layer:scene.layer,revision:catalogRevision(),evidence:answerEvidence({...batch,filters:scene.filters,layer:scene.layer})};
      const refs=(scene.answerReferences || []).slice(0,20);
      const globals=refs.filter(ref=>focusView!.evidence.get(ref.assetId)?.kind==="global");
      canvas.dataset.answerGlobal=String(globals.length);
      if(globals.length)paint({type:"Sphere"},null,"#71629f",1,2);
      const ranges=new Set(refs.flatMap(ref=>focusView!.evidence.get(ref.assetId)?.coverageGeometries || []));
      ctx!.setLineDash([6,4]);
      for(const geometry of ranges)paint(geometry,null,"#7461a0",1,1.4);
      ctx!.setLineDash([]);
      // Coverage outlines are distinct from local samples and never change counts.
      for(const ref of (scene.answerReferences || []).slice(0,20)) {
        const evidence=focusView.evidence.get(ref.assetId);
        if(!evidence || !["local","range"].includes(evidence.kind))continue;
        for(const geometry of (evidence.kind==="local"?evidence.geometries:evidence.coverageGeometries || []).slice(0,3)) {
          const point=geoCentroid(geometry) as Coordinate;
          if(evidence.kind==="local" && (!point.every(Number.isFinite) || geoDistance(center,point)>=Math.PI/2))continue;
          const p=evidence.kind==="range"?geoPath(projection).centroid(geometry):projection(point);
          if(!p || p[0]<14 || p[0]>width-(scene.rightInset || 0)-14 || p[1]<14 || p[1]>height-14)continue;
          if(answerPins.some(pin=>pin.assetId===ref.assetId && Math.hypot(pin.x-p[0],pin.y-p[1])<30))continue;
          let y=p[1];
          while(answerPins.some(pin=>Math.hypot(pin.x-p[0],pin.y-y)<24))y-=24;
          answerPins.push({...ref,x:p[0],y,kind:evidence.kind as "local"|"range"});
        }
      }
      const evidence=focus?.answerId===batch.answerId?focusView.evidence.get(focus.assetId):undefined;
      if(evidence?.kind==="local") {
        for(const geometry of evidence.geometries) {
          if(geometry.type==="Point") {
            const point=geometry.coordinates as Coordinate;
            if(geoDistance(center,point)>=Math.PI/2)continue;
            const p=projection(point);if(!p)continue;
            ctx!.beginPath();ctx!.arc(p[0],p[1],7,0,2*Math.PI);
            ctx!.fillStyle="#fff1cf";ctx!.fill();ctx!.strokeStyle="#ad570e";ctx!.lineWidth=2;ctx!.stroke();
          } else paint(geometry,"rgba(255,188,73,.18)","#ad570e",1,2);
        }
        canvas.dataset.focusedAsset=focus!.assetId;
        canvas.dataset.focusedKind="local";
      } else if(evidence?.kind==="global" || evidence?.coverageGeometries?.length) {
        ctx!.setLineDash(evidence.kind==="range"?[7,4]:[]);
        for(const geometry of evidence.kind==="global"?[{type:"Sphere"}]:evidence.coverageGeometries!)paint(geometry,null,"#b56817",1,3);
        ctx!.setLineDash([]);
        canvas.dataset.focusedAsset=focus!.assetId;
        canvas.dataset.focusedKind=evidence.kind;
      }
    }
    // Independent question-region overlay: never enters coverage counts, cells,
    // candidate filters, or the purple/orange source-evidence highlights.
    const region=scene.researchRegion?.visible?scene.researchRegion.region:null;
    canvas.dataset.researchRegion=region?.status==="located"?region.label:"";
    canvas.dataset.researchRegionPrecision=region?.status==="located"?region.precision:"";
    if(region?.status==="located"){
      ctx!.save();
      ctx!.lineJoin="round";ctx!.lineCap="round";
      const shape=region.geometry || {type:"Sphere"};
      // White casing keeps a narrow teal boundary visible on any distribution.
      paint(shape,null,"rgba(255,255,255,.95)",1,5);
      ctx!.setLineDash(region.precision==="approximate"?[7,5]:[]);
      paint(shape,null,"#007d91",1,2.5);
      ctx!.restore();
    }
    if(hovered)paint(cellShape(hovered.selection.id,hovered.selection.grid).geometry,"#eef8f222","#38785b",1,1.4);
    let anchor = null;
    if (
      scene.selection &&
      geoDistance(center, scene.selection.point) < Math.PI / 2
    ) {
      const p = projection(scene.selection.point)!;
      if (p[0] >= 0 && p[0] <= width && p[1] >= 0 && p[1] <= height)
        anchor = { x: p[0], y: p[1] };
    }
    onFrame({ answerPins,clusterKeys, coloredProducts, coloredSelection, coverageSelection, productCell, gridLabel: g.label, level: band, visibleCells, loading, anchor });
    canvas.dataset.painted = "true";
    canvas.dataset.focusWidth = String(width - (scene.rightInset || 0));
  }
  let selectVersion = 0;
  async function pick(x: number, y: number) {
    if(getScene().observationGlobe){ getScene().onObservationPick?.(x,y); return; }
    const [originX, originY] = projection.translate();
    if (Math.hypot(x - originX, y - originY) > projection.scale()) return;
    const scene = {...getScene(),camera:motion.camera()};
    motion.settle();
    const point = projection.invert!([x, y]) as Coordinate;
    const g = gridSpec(scene.gridSystem, resolution(scene.camera.zoom));
    const id = cellAt(point, g);
    const version = ++selectVersion;
    const selection: Selection = { id, grid: g, point };
    if (scene.caseId || scene.overview !== "simulation") {
      onSelect(selection);
      return;
    }
    onSelect({ ...selection, simulated: true });
    try {
      if (g.system === "h3" && g.n === 2 && !background) await loadBackground();
      const meta =
        g.system === "h3" && g.n === 2
          ? (background?.meta as Record<string, number[]> | undefined)?.[id]
          : await (g.system === "s2" ? getS2Store() : h3Store).meta(id);
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
      if (
        disposed ||
        version !== selectVersion ||
        getScene().caseId ||
        getScene().gridSystem !== g.system ||
        getScene().selection?.id !== id
      )
        return;
      onSelect({
        ...selection,
        simulated: true,
        counts: meta?.slice(0, 3) || [0, 0, 0],
        sampleIds: meta?.slice(3) || [],
      });
    } catch {
      if (
        version === selectVersion &&
        !disposed &&
        getScene().gridSystem === g.system &&
        getScene().selection?.id === id
      )
        onSelect({ ...selection, simulated: true, counts: [] });
    }
  }
  const nav = navigation({
    canvas,
    root: controls,
    getCamera: () => motion.camera().center,
    getScale: () => motion.camera().zoom,
    baseRadius: radius,
    getOrigin: () => projection.translate(),
    pick,
    setCamera: (zoom: number, center: Coordinate) => {
      onManualNavigation?.();
      motion.move({
        center,
        zoom,
        reason: "当前视野按缩放显示网格。已选网格沿用原始范围。",
      });
      if(getScene().pending && !pendingNavigation){pendingNavigation=true;motion.settle();}
    },
    stopFlight,
  });
  const hoverEnabled=()=>{
    const s=getScene();
    return !!onHover && !s.observationGlobe && !s.caseId && !s.dataView && !s.fieldLayer && !s.visualization &&
      s.overview!=="simulation" && s.mapResult?.metric!=="scenes" && !interacting && canvas.dataset.flying!=="true";
  };
  function onGlobe(x:number,y:number) {
    const [ox,oy]=projection.translate();
    return width>0 && height>0 && x>=0 && y>=0 && x<=width-(getScene().rightInset||0) && y<=height && Math.hypot(x-ox,y-oy)<projection.scale();
  }
  if(onHover)hoverIntent=createHoverIntent<GridHover>({
    resolve:(x,y)=>{
      if(disposed || !hoverEnabled() || !onGlobe(x,y))return null;
      const point=projection.invert!([x,y]) as Coordinate;
      if(!point?.every(Number.isFinite))return null;
      const s=getScene(),grid=catalogEvidenceGrid(gridSpec(s.gridSystem,resolution(motion.camera().zoom)),s.mapResult);
      const id=cellAt(point,grid);
      if(s.mapResult?.selection && id!==s.mapResult.selection.id)return null;
      return {selection:{id,grid,point:cellShape(id,grid).center as Coordinate},x,y};
    },
    show:value=>{hovered=value;onHover(value);schedule();},
    hide:()=>{hovered=null;onHover(null);schedule();},
  });
  const cancelHover=()=>{hoverIntent?.cancel();delete canvas.dataset.gridHoverable;};
  const pointerMove=(event:PointerEvent)=>{
    if(!hoverIntent)return;
    const rect=canvas.getBoundingClientRect(),x=event.clientX-rect.left,y=event.clientY-rect.top;
    if(event.buttons || event.pointerType==="touch" || !hoverEnabled() || !onGlobe(x,y)){cancelHover();return;}
    canvas.dataset.gridHoverable="true";hoverIntent.move(x,y);
  };
  const visibility=()=>{if(document.hidden)cancelHover();};
  if(onHover){
    canvas.addEventListener("pointermove",pointerMove);
    for(const event of ["pointerdown","pointerleave","pointercancel","wheel"] as const)canvas.addEventListener(event,cancelHover,{passive:true});
    window.addEventListener("blur",cancelHover);document.addEventListener("visibilitychange",visibility);
  }
  const contextLost = () => onError?.(new Error("绘图环境正在恢复，请稍候。"));
  const contextRestored = () => { onError?.(null); schedule(); };
  canvas.addEventListener("contextlost", contextLost);
  canvas.addEventListener("contextrestored", contextRestored);
  const observer = new ResizeObserver(()=>{cancelHover();schedule();});
  observer.observe(canvas);
  schedule();
  return {
    render: schedule,
    invalidateCoverage() {
      coverageClient.invalidate();
      selectedCoverageClient.invalidate();
    },
    clearHover:cancelHover,
    get observationRevision(){return observationRevision;},
    currentCamera: () => motion.camera(),
    projectVisible(point:Coordinate){
      if(!width || geoDistance(motion.camera().center,point)>=Math.PI/2)return null;
      return projection(point);
    },
    flyTo,stopFlight,
    zoom: (sign: number) => nav.step(sign),
    reset: () => {onManualNavigation?.();stopFlight();motion.move({ center: [105, 25], zoom: 1, reason: "全球总览" });motion.settle();},
    dispose() {
      disposed = true;
      cancelHover();
      if(onHover){
        canvas.removeEventListener("pointermove",pointerMove);
        for(const event of ["pointerdown","pointerleave","pointercancel","wheel"] as const)canvas.removeEventListener(event,cancelHover);
        window.removeEventListener("blur",cancelHover);document.removeEventListener("visibilitychange",visibility);
      }
      stopFlight();
      cancelAnimationFrame(frame);
      clearTimeout(interactionTimer);
      coverageClient.dispose();
      distributionPainters.dispose();
      coverageViewport.dispose();
      selectedCoverageClient.dispose();
      observer.disconnect();
      canvas.removeEventListener("contextlost", contextLost);
      canvas.removeEventListener("contextrestored", contextRestored);
      selectVersion++;
      nav.dispose?.();
      particles?.dispose();
      rainPainter?.dispose();
    },
  };
}
