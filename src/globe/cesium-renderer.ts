import {
  Cartesian2, Cartesian3, Cartographic, CesiumWidget, Color, ColorGeometryInstanceAttribute,
  Credit, CreditDisplay, EllipsoidalOccluder, GeometryInstance, GroundPolylineGeometry,
  GroundPolylinePrimitive, Math as CesiumMath, PolygonHierarchy, PolylineColorAppearance,
  ScreenSpaceEventHandler, ScreenSpaceEventType,
} from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import {geoCentroid} from "d3-geo";
import type {Geometry, Position} from "geojson";
import {mesh} from "topojson-client";
import type {GeometryCollection, Topology} from "topojson-specification";
import atlas from "world-atlas/land-110m.json";
import {resolution} from "../data/evidence/globe-navigation.mjs";
import {answerEvidence} from "../domain/answer-map";
import {catalogRevision} from "../domain/datasets";
import {catalogEvidenceGrid} from "../domain/results";
import {cellAt, cellShape, gridSpec} from "../domain/spatial";
import type {Camera, Coordinate, Selection} from "../domain/types";
import type {FlightMapReceipt} from "../domain/flight-catalogue";
import {getWindData,windManifest} from "../domain/wind";
import type {CatalogueFrameObservation} from "../domain/catalogue-presentation";
import {createCoverageClient} from "./coverage-client";
import {createCesiumDatasetLayers} from "./cesium-dataset-layers";
import {createCesiumDistribution} from "./cesium-distribution";
import {createCesiumWind,visibleCesiumWind} from "./cesium-wind";
import {createCesiumObservationOverlay} from "./cesium-observation-overlay";
import type {FrameInfo, Scene, createRenderer} from "./renderer";

type ProofRenderer = ReturnType<typeof createRenderer>;
const globalDistance = 8100000;
const edgeColor = Color.fromCssColorString("#2c715a");
const focusColor = Color.fromCssColorString("#b2681a");
const coastColor = Color.fromCssColorString("#a9bdb6");
// Ignore subpixel pose changes, including rounding in Cesium's camera basis.
const positionEpsilon = 0.01; // metres
const orientationEpsilon = 1e-8; // unit-vector distance
const cameraSettleMs = 500; // matches Cesium’s default move-end delay
type CameraPose = {position:Cartesian3;direction:Cartesian3;up:Cartesian3};
const sameCamera = (a: Camera, b: Camera) =>
  Math.abs(a.center[1] - b.center[1]) < 0.00001 &&
  Math.abs(((a.center[0] - b.center[0] + 540) % 360) - 180) < 0.00001 &&
  Math.abs(a.zoom - b.zoom) < 0.001;

function cartesian(point: Position) {
  return Cartesian3.fromDegrees(point[0], point[1]);
}

function createCoastlines() {
  const topology = atlas as unknown as Topology<{land: GeometryCollection}>;
  const {coordinates} = mesh(topology, topology.objects.land);
  return new GroundPolylinePrimitive({
    allowPicking: false,
    appearance: new PolylineColorAppearance(),
    geometryInstances: coordinates.map(points => new GeometryInstance({
      geometry: new GroundPolylineGeometry({positions: points.map(cartesian), width: 1.15}),
      attributes: {color: ColorGeometryInstanceAttribute.fromColor(coastColor)},
    })),
  });
}

export function createCesiumRenderer(
  host: HTMLDivElement,
  getScene: () => Scene,
  onCamera: (camera: Camera) => void,
  onSelect: (selection: Selection) => void,
  onFrame: (frame: FrameInfo) => void,
  onError: (error: Error | null) => void,
  onManualNavigation: () => void,
  onCatalogueFrame?: (observation: CatalogueFrameObservation) => void,
): ProofRenderer & {
  canvas: HTMLCanvasElement;
  flyTo(c: Camera, settled?: (receipt: FlightMapReceipt) => void): void;
  retryViirs(): void;
  observationOverlay(layers:HTMLCanvasElement[]):ReturnType<typeof createCesiumObservationOverlay>;
} {
  (globalThis as typeof globalThis & {CESIUM_BASE_URL: string}).CESIUM_BASE_URL = "/cesium/";
  // Suppress the widget's default badge. Imagery providers still supply their own credits.
  CreditDisplay.cesiumCredit = new Credit("");
  const widget = new CesiumWidget(host, {
    baseLayer: false, skyBox: false, skyAtmosphere: false, scene3DOnly: true,
    requestRenderMode: true, maximumRenderTimeChange: Infinity, showRenderLoopErrors: false,
  });
  const scene = widget.scene;
  const globe = scene.globe;
  globe.baseColor = Color.fromCssColorString("#f8faf9");
  globe.enableLighting = false;
  globe.showGroundAtmosphere = false;
  scene.backgroundColor = Color.fromCssColorString("#eef3f1");
  scene.groundPrimitives.add(createCoastlines());
  if (scene.sun) scene.sun.show = false;
  if (scene.moon) scene.moon.show = false;
  scene.screenSpaceCameraController.enableTilt = false;
  scene.screenSpaceCameraController.enableLook = false;
  const camera = scene.camera;
  const canvas = widget.canvas;
  canvas.dataset.globeEngine = "cesium";
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", "可旋转、缩放与点选网格的数据地球");
  const handler = new ScreenSpaceEventHandler(canvas);
  let disposed = false, moving = false, flying = false, requestedFrame = 0, presented = "";
  let presentedFilters: Scene["filters"] | undefined, presentedBatch: Scene["mapResult"];
  let lastCatalogueFrame: string | undefined;
  let observationRevision=0;
  const motionPose = readPose();
  const renderedPose = readPose();
  let lastMotionAt = 0;
  let renderedWidth=0,renderedHeight=0;
  const observationMode=getScene().observationGlobe===true;
  const occluder=new EllipsoidalOccluder(globe.ellipsoid,camera.positionWC);
  const screenPoint=new Cartesian2(),aboveSurface=new Cartesian3();
  let storedCamera = getScene().camera, target = storedCamera;
  let drawing: {selection: Scene["selection"]; batch: Scene["mapResult"]; focus: Scene["mapFocus"];
    region: Scene["researchRegion"]; revision: number} | undefined;
  const catalogue = observationMode ? undefined : {
    coverage: createCoverageClient(schedule),
    distribution: createCesiumDistribution(scene, canvas, schedule),
    layers: createCesiumDatasetLayers(widget, schedule, projectVisible),
  };
  let wind: ReturnType<typeof createCesiumWind> | undefined;

  function readPose(): CameraPose {
    return {position:Cartesian3.clone(camera.positionWC),
      direction:Cartesian3.clone(camera.directionWC),up:Cartesian3.clone(camera.upWC)};
  }
  function savePose(pose: CameraPose) {
    Cartesian3.clone(camera.positionWC,pose.position);
    Cartesian3.clone(camera.directionWC,pose.direction);
    Cartesian3.clone(camera.upWC,pose.up);
  }
  function poseChanged(pose: CameraPose) {
    return Cartesian3.distanceSquared(camera.positionWC,pose.position)>positionEpsilon**2 ||
      Cartesian3.distanceSquared(camera.directionWC,pose.direction)>orientationEpsilon**2 ||
      Cartesian3.distanceSquared(camera.upWC,pose.up)>orientationEpsilon**2;
  }

  function ground(pixel: Cartesian2) {
    return camera.pickEllipsoid(pixel, globe.ellipsoid);
  }
  function coordinate(position: Cartesian3): Coordinate {
    const value = Cartographic.fromCartesian(position);
    return [CesiumMath.toDegrees(value.longitude), CesiumMath.toDegrees(value.latitude)];
  }
  function currentCamera(): Camera {
    if (!canvas.clientWidth || !canvas.clientHeight) return target;
    const p = ground(new Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2));
    const height = p ? Cartesian3.distance(camera.positionWC, p) : camera.positionCartographic.height;
    return {
      center: p ? coordinate(p) : target.center,
      zoom: Math.max(1, Math.min(2200, globalDistance / Math.max(1, height))),
      reason: target.reason,
    };
  }
  function projectVisible(point: Coordinate): [number, number] | null {
    const world = cartesian(point);
    if(!Cartesian3.equals(occluder.cameraPosition,camera.positionWC))occluder.cameraPosition=camera.positionWC;
    if (!occluder.isPointVisible(Cartesian3.multiplyByScalar(world, 1.00001, aboveSurface))) return null;
    const p = scene.cartesianToCanvasCoordinates(world,screenPoint);
    return p && p.x >= 0 && p.x <= canvas.clientWidth && p.y >= 0 && p.y <= canvas.clientHeight ? [p.x, p.y] : null;
  }

  function destination(c: Camera) {
    return Cartesian3.fromDegrees(c.center[0], c.center[1], globalDistance / c.zoom);
  }
  const northUp = {heading: 0, pitch: -Math.PI / 2, roll: 0};
  function place(c: Camera) {
    target = c;
    camera.setView({destination: destination(c), orientation: northUp});
  }
  function commit() {
    const actual = currentCamera();
    if (!sameCamera(actual, target)) target = actual;
    if (!sameCamera(actual, getScene().camera)) {
      storedCamera = actual;
      onCamera(actual);
    }
    schedule();
  }
  let pendingGroundObservation:{settle:(receipt:FlightMapReceipt)=>void;pose:CameraPose}|undefined;
  function stopFlight() {
    if(flying)camera.cancelFlight();
    const pending=pendingGroundObservation;
    pendingGroundObservation=undefined;
    pending?.settle({state:"cancelled",observedAt:Date.now()});
  }
  function observeFlightGround() {
    const pending=pendingGroundObservation;
    if(!pending || flying || !canvas.isConnected || document.visibilityState!=="visible")return;
    const {settle,pose}=pending;
    pendingGroundObservation=undefined;
    if(poseChanged(pose)){
      settle({state:"ground-unavailable",observedAt:Date.now()});
      return;
    }
    // A real postRender after arrival supplies the ground, never the request or preflight selection.
    const x=canvas.clientWidth/2,y=canvas.clientHeight/2;
    const picked=x>=40&&y>=40 ? [[x,y],[x-16,y],[x+16,y],[x,y-16],[x,y+16]]
      .map(([sx,sy])=>ground(new Cartesian2(sx,sy))) : [];
    if(picked.length!==5 || !picked.every(Boolean)){
      settle({state:"ground-unavailable",observedAt:Date.now()});
      return;
    }
    const point=coordinate(picked[0]!);
    const level=resolution(currentCamera().zoom);
    settle({state:"arrived",observedAt:Date.now(),ground:{id:cellAt(point,gridSpec("h3",level)),level,point}});
  }
  function flyTo(c: Camera,settled?:(receipt:FlightMapReceipt)=>void) {
    stopFlight();
    target = c;
    flying = true;
    canvas.dataset.flying = "true";
    camera.flyTo({destination: destination(c), orientation: northUp,
      duration: matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : .7,
      complete() {
        flying = false;
        canvas.dataset.flying = "false";
        commit();
        if(settled){
          const pose={position:new Cartesian3(),direction:new Cartesian3(),up:new Cartesian3()};
          savePose(pose);
          pendingGroundObservation={settle:settled,pose};
          schedule();
        }
      },
      cancel() {
        flying = false;
        canvas.dataset.flying = "false";
        schedule();
        settled?.({state:"cancelled",observedAt:Date.now()});
      },
    });
    schedule();
  }

  function addGeometry(geometry: Geometry, color: Color, fill: boolean) {
    function line(points: Position[]) {
      if (points.length < 2) return;
      widget.entities.add({polyline: {positions: points.map(cartesian), material: color, width: 2.5, clampToGround: true}});
    }
    function polygon(rings: Position[][]) {
      if (!rings[0]?.length) return;
      if (fill) widget.entities.add({polygon: {hierarchy: new PolygonHierarchy(rings[0].map(cartesian),
        rings.slice(1).map(ring => new PolygonHierarchy(ring.map(cartesian))),
      ), material: color.withAlpha(.22)}});
      rings.forEach(line);
    }
    switch (geometry.type) {
      case "Point":
        widget.entities.add({position: cartesian(geometry.coordinates), point: {
          color, pixelSize: 8, outlineColor: Color.WHITE, outlineWidth: 1,
        }});
        break;
      case "MultiPoint":
        for (const point of geometry.coordinates) addGeometry({type:"Point", coordinates:point}, color, fill);
        break;
      case "LineString": line(geometry.coordinates); break;
      case "MultiLineString": geometry.coordinates.forEach(line); break;
      case "Polygon": polygon(geometry.coordinates); break;
      case "MultiPolygon": geometry.coordinates.forEach(polygon); break;
      case "GeometryCollection": geometry.geometries.forEach(g => addGeometry(g, color, fill)); break;
    }
  }
  function updateGeometry(state: Scene) {
    const revision = catalogRevision();
    if (drawing && drawing.selection === state.selection && drawing.batch === state.mapResult &&
        drawing.focus === state.mapFocus && drawing.region === state.researchRegion && drawing.revision === revision) return;
    drawing = {selection: state.selection, batch: state.mapResult, focus: state.mapFocus, region: state.researchRegion, revision};
    widget.entities.suspendEvents();
    try {
      widget.entities.removeAll();
      if (state.selection) addGeometry(cellShape(state.selection.id, state.selection.grid).geometry, edgeColor, true);
      const region = state.researchRegion?.visible ? state.researchRegion.region : null;
      if (region?.status === "located" && region.geometry) addGeometry(region.geometry, Color.TEAL, false);
      if (!state.mapResult?.answerId) return;
      for (const [id, evidence] of answerEvidence(state.mapResult)) {
        const color = state.mapFocus?.assetId === id ? focusColor : Color.DARKVIOLET.withAlpha(.75);
        for (const geometry of [...evidence.geometries, ...(evidence.coverageGeometries ?? [])].slice(0, 12)) {
          addGeometry(geometry, color, false);
        }
      }
    } finally {
      widget.entities.resumeEvents();
    }
  }

  function answerPins(
    state: Scene,
    receipt?: {datasetIds: Set<string>; allowGridAnchor: boolean},
  ): NonNullable<FrameInfo["answerPins"]> {
    const batch = state.mapResult;
    if (!batch?.answerId) return [];
    const evidence = answerEvidence(batch);
    const pins: NonNullable<FrameInfo["answerPins"]> = [];
    for (const ref of state.answerReferences ?? []) {
      const details = evidence.get(ref.assetId);
      if (!details || details.kind === "unlocated") continue;
      const geometry = details.geometries[0] ?? details.coverageGeometries?.[0];
      const point = geometry ? geoCentroid(geometry) as Coordinate : batch.selection?.point;
      const projected = point?.every(Number.isFinite) ? projectVisible(point) : null;
      const xy = projected ?? (batch.selection ? projectVisible(batch.selection.point) : null);
      if (!xy) continue;
      let [x, y] = xy;
      while (pins.some(pin => Math.hypot(pin.x - x, pin.y - y) < 27)) y -= 28;
      if (y < 14) continue;
      pins.push({...ref, x, y, kind: details.kind === "local" ? "local" : "range"});
      if (receipt && ((geometry && projected) || receipt.allowGridAnchor)) receipt.datasetIds.add(ref.assetId);
    }
    return pins;
  }

  function observeCatalogueFrame() {
    if (!onCatalogueFrame) return;
    const state = getScene();
    const batch = state.mapResult;
    const result = batch?.resultBatch;
    // A postRender can arrive after the workbench changes answers but before
    // draw installs geometry for that answer. Never attribute the old frame to it.
    if (!result || !batch.answerId || result.taskId !== batch.answerId || drawing?.batch !== batch
        || drawing.revision !== catalogRevision() || result.status === "failed") {
      lastCatalogueFrame = undefined;
      return;
    }
    const displayed = new Set<string>();
    const authoritativeGrid = batch.selection?.grid.system === "h3" && result.kind === "catalogue" &&
      result.channels.some(channel => channel.source === "authoritative-grid-catalogue" &&
        (channel.status === "done" || channel.status === "partial"));
    // A visible H3 anchor can present directory membership without presenting
    // the dataset's footprint or an observation at the anchor coordinates.
    answerPins(state, {datasetIds: displayed, allowGridAnchor: authoritativeGrid});
    const datasetIds = result.itemIds.filter(id => displayed.has(id));
    if (!datasetIds.length) {
      lastCatalogueFrame = undefined;
      return;
    }
    const key = JSON.stringify([result.taskId, result.batchId, datasetIds]);
    if (lastCatalogueFrame === key) return;
    lastCatalogueFrame = key;
    onCatalogueFrame({runId: result.taskId, batchId: result.batchId, renderer: "cesium", datasetIds, observedAt: Date.now()});
  }

  function draw() {
    requestedFrame = 0;
    if (disposed) return;
    const state = getScene();
    canvas.dataset.focusWidth = String(canvas.clientWidth);
    if (state.camera !== storedCamera) {
      storedCamera = state.camera;
      if (!flying && !sameCamera(currentCamera(), storedCamera)) place(storedCamera);
    }
    if(!catalogue){scene.requestRender();return;}
    const {coverage,distribution,layers}=catalogue;
    updateGeometry(state);
    const liveCamera = currentCamera();
    const level = resolution(liveCamera.zoom);
    const grid = gridSpec(state.gridSystem, level);
    const selection = state.selection;
    const evidenceGrid = catalogEvidenceGrid(grid, state.mapResult);
    const distributionFrame = distribution.update(state, grid, liveCamera, moving || flying);
    const activeWind = visibleCesiumWind(state);
    layers.update(state,grid,liveCamera.zoom);
    if (activeWind && !wind) {
      wind = createCesiumWind(scene, canvas, {
        ground(pixel) {
          const picked = ground(pixel);
          return picked ? coordinate(picked) : undefined;
        },
        visible: projectVisible,
      });
    }
    wind?.update(activeWind, state.windTheme, liveCamera, moving || flying);
    const {drawnIds, ...layerFrame} = layers.frame(state);
    if (drawnIds.length) canvas.dataset.globeLayers = drawnIds.join(" ");
    else delete canvas.dataset.globeLayers;
    const countedGrid = selection?.grid ?? evidenceGrid;
    const cells = selection ? [selection.id] : [];
    const index = coverage.read(countedGrid, cells, state.filters, state.mapResult,
      catalogRevision() + "/" + (state.paperFeed?.revision ?? ""), moving || flying);
    const anchor = selection ? projectVisible(selection.point) : null;
    const result: FrameInfo = {
      ...layerFrame,
      gridLabel: grid.label, level,
      visibleCells: activeWind && state.visualization && getWindData()
        ? windManifest.width*windManifest.height : distributionFrame.visibleCells || (selection ? 1 : 0),
      anchor: anchor ? {x:anchor[0],y:anchor[1]} : null,
      loading: index.pending ? (index.error || "正在读取所选网格计数…") : distributionFrame.loading,
      answerPins: answerPins(state),
      ...(selection ? {
        coloredSelection: selection.grid.key + "/" + selection.id,
        coloredProducts: index.ready.has(selection.id) ? index.cells.get(selection.id) ?? 0 : undefined,
        coverageSelection: index.revision ? {selection, filters: state.filters, batch: state.mapResult, revision: index.revision} : undefined,
      } : {}),
    };
    const stamp = JSON.stringify([level, result.coloredSelection, result.coloredProducts, result.loading,
      index.revision, result.anchor, result.answerPins, result.visibleCells,
      result.paintedRasters, result.viirs, result.publicMarkers, drawnIds]);
    if (stamp !== presented || presentedFilters !== state.filters || presentedBatch !== state.mapResult) {
      presented = stamp;
      presentedFilters = state.filters;
      presentedBatch = state.mapResult;
      onFrame(result);
    }
    scene.requestRender();
  }
  function schedule() {
    if (!disposed && !requestedFrame) requestedFrame = requestAnimationFrame(draw);
  }

  place(target);
  // Scene updates still run between renders in request-render mode. Use them
  // to settle at a quiet pose without keeping rendered frames alive.
  const removeUpdate = scene.postUpdate.addEventListener(() => {
    if (poseChanged(motionPose)) {
      savePose(motionPose);
      lastMotionAt = performance.now();
      moving = true;
      schedule();
    } else if (moving && performance.now()-lastMotionAt >= cameraSettleMs) {
      moving = false;
      if (!flying) commit();
    }
  });
  const removePost = scene.postRender.addEventListener(() => {
    if (observationMode && (poseChanged(renderedPose) ||
        renderedWidth!==canvas.clientWidth || renderedHeight!==canvas.clientHeight)) {
      savePose(renderedPose);
      renderedWidth=canvas.clientWidth;
      renderedHeight=canvas.clientHeight;
      observationRevision++;
    }
    if (globe.tilesLoaded) {
      canvas.dataset.painted = "true";
      observeFlightGround();
      if (!moving && !flying && canvas.isConnected && canvas.clientWidth && canvas.clientHeight &&
          document.visibilityState === "visible") observeCatalogueFrame();
    }
    catalogue?.layers.postRender(getScene());
  });
  const resize = new ResizeObserver(schedule);
  resize.observe(host);
  const manual = () => {onManualNavigation(); stopFlight();};
  canvas.addEventListener("pointerdown", manual);
  canvas.addEventListener("wheel", manual, {passive:true});
  handler.setInputAction(({position}: {position: Cartesian2}) => {
    const picked = ground(position);
    if (!picked) return;
    const point = coordinate(picked);
    const state = getScene();
    if(!catalogue){state.onObservationPick?.(position.x,position.y);return;}
    const grid = gridSpec(state.gridSystem, resolution(currentCamera().zoom));
    const layerPick = catalogue.layers.pick(state, point, position);
    if (layerPick && state.onDatasetPick?.(layerPick,grid) && layerPick.kind!=="wind") {
      schedule();
      return;
    }
    onSelect({id: cellAt(point, grid), grid, point});
    schedule();
  }, ScreenSpaceEventType.LEFT_CLICK);
  schedule();

  return {
    canvas, render: schedule, currentCamera, projectVisible, flyTo, stopFlight,
    clearHover() {},
    invalidateCoverage() {
      catalogue?.coverage.invalidate();
      catalogue?.distribution.invalidate();
    },
    retryViirs() {catalogue?.layers.retryViirs();},
    get observationRevision() {return observationRevision;},
    observationOverlay(overlayLayers) {return createCesiumObservationOverlay(scene,canvas,overlayLayers);},
    zoom(sign) {
      manual();
      const c = currentCamera();
      place({...c, zoom: Math.max(1, Math.min(2200, c.zoom * (sign > 0 ? 1.5 : 1 / 1.5)))});
      commit();
    },
    reset() {
      manual();
      place({center: [105, 25], zoom: 1, reason: "全球总览"});
      commit();
    },
    dispose() {
      stopFlight();
      disposed = true;
      cancelAnimationFrame(requestedFrame);
      resize.disconnect();
      removePost();
      removeUpdate();
      canvas.removeEventListener("pointerdown", manual);
      canvas.removeEventListener("wheel", manual);
      handler.destroy();
      catalogue?.coverage.dispose();
      catalogue?.distribution.dispose();
      catalogue?.layers.dispose();
      wind?.dispose();
      widget.destroy();
    },
  };
}
