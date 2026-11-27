import {
  BoundingRectangle, Cartesian2, Cartesian3, Color, Ellipsoid, Material, PerspectiveFrustum, SceneTransforms, ViewportQuad,
  type Scene as CesiumScene,
} from "cesium";
import {geoArea, geoDistance, geoOrthographic} from "d3-geo";
import type {Position} from "geojson";
import {catalogRevision} from "../domain/datasets";
import {heatColor, heatIntensity, smoothHeatField} from "../domain/distribution-heat";
import {catalogCellColor, catalogEvidenceGrid} from "../domain/results";
import {cellShape} from "../domain/spatial";
import type {Camera, Coordinate, GridSpec} from "../domain/types";
import {createAsyncCoverageViewport} from "./async-viewport";
import {createCoverageClient} from "./coverage-client";
import type {Scene} from "./renderer";
import type {ViewportCell} from "./viewport-pool";

const maxVisibleCells = 8192;
const heatPalette = Array.from({length: 256}, (_, i) => heatColor(i / 255));

type ProjectedCell = { id: string; outline: Path2D; area: number; onScreen: boolean };
type ViewportLayout = {
  key: string;
  catalogue: ProjectedCell[];
  mesh: ProjectedCell[];
  scale: number;
  limb?: Path2D;
  pending: boolean;
  limited: boolean;
};
type PaintedDistribution = {mode: "grid" | "heatmap"; grid: string; count: number; mesh: number};
const worldShapes = new WeakMap<ViewportCell["geometry"], {ring: Cartesian3[]; area: number}>();

function windowProjection(scene: CesiumScene, ellipsoid: Ellipsoid, current: Camera, width: number, height: number) {
  const {camera} = scene;
  const radius = ellipsoid.minimumRadius;
  const altitude = Math.max(1, camera.positionCartographic.height);
  const horizon = Math.acos(radius / (radius + altitude));
  let cap = 0;
  for (const x of [0, width]) for (const y of [0, height]) {
    const corner = camera.pickEllipsoid(new Cartesian2(x, y), ellipsoid);
    if (!corner) { cap = horizon; continue; }
    const ground = ellipsoid.cartesianToCartographic(corner);
    if (ground) cap = Math.max(cap, geoDistance(current.center, [ground.longitude * 180 / Math.PI, ground.latitude * 180 / Math.PI]));
  }
  const fov = camera.frustum instanceof PerspectiveFrustum ? camera.frustum.fovy : undefined;
  const focal = fov ? height / (2 * Math.tan(fov / 2)) : Math.min(width, height);
  const turned = Math.abs(Math.sin(camera.heading)) > .002 || Math.abs(Math.sin(camera.roll)) > .002;
  const searchWidth = turned ? Math.max(width, height) : width;
  const searchHeight = turned ? searchWidth : height;
  // This orthographic cap deliberately overselects. Actual projection below
  // uses the Cesium camera; only geometry intersecting the canvas gets queried.
  const projection = geoOrthographic().rotate([-current.center[0], -current.center[1]])
    .translate([searchWidth / 2, searchHeight / 2])
    .scale(Math.max(1, .98 * focal * radius / (altitude + radius * (1 - Math.cos(cap)))));
  return {projection, searchWidth, searchHeight};
}

function projectCell(scene: CesiumScene, ellipsoid: Ellipsoid, sensor: Cartesian3, cell: ViewportCell, width: number, height: number): ProjectedCell | undefined {
  let shape = worldShapes.get(cell.geometry);
  if (!shape) {
    const ring = cell.geometry.coordinates[0].map((point: Position) => ellipsoid.transformPositionToScaledSpace(
      Cartesian3.fromDegrees(point[0], point[1], 0, ellipsoid), new Cartesian3()));
    shape = {ring, area: geoArea(cell.geometry)};
    worldShapes.set(cell.geometry, shape);
  }
  const front = (position: Cartesian3) => Cartesian3.dot(position, sensor) >= 1;
  const {ring, area} = shape;
  const clipped: Cartesian3[] = [];
  const horizonPoint = (inside: Cartesian3, outside: Cartesian3) => {
    for (let step = 0; step < 9; step++) {
      const midpoint = Cartesian3.normalize(Cartesian3.midpoint(inside, outside, new Cartesian3()), new Cartesian3());
      if (front(midpoint)) inside = midpoint;
      else outside = midpoint;
    }
    return inside;
  };
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const aFront = front(a), bFront = front(b);
    if (aFront) clipped.push(a);
    if (aFront !== bFront) clipped.push(aFront ? horizonPoint(a, b) : horizonPoint(b, a));
  }
  if (clipped.length < 3) return;
  const points: Cartesian2[] = [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const point of clipped) {
    const world = ellipsoid.transformPositionFromScaledSpace(point, new Cartesian3());
    const screen = SceneTransforms.worldToWindowCoordinates(scene, world);
    if (!screen) return;
    points.push(screen);
    minX = Math.min(minX, screen.x);
    minY = Math.min(minY, screen.y);
    maxX = Math.max(maxX, screen.x);
    maxY = Math.max(maxY, screen.y);
  }
  // Keep a narrow screen margin so the smoothing kernel remains continuous
  // across canvas edges when a neighboring coloured cell is just outside.
  if (maxX < -12 || maxY < -12 || minX > width + 12 || minY > height + 12) return;
  const outline = new Path2D();
  outline.moveTo(points[0].x, points[0].y);
  for (const point of points.slice(1)) outline.lineTo(point.x, point.y);
  outline.closePath();
  return {id: cell.id, outline, area, onScreen: maxX >= 0 && maxY >= 0 && minX <= width && minY <= height};
}

/** A scaled ellipsoid is the unit sphere; its visible limb satisfies p·sensor=1. */
function projectLimb(scene: CesiumScene, ellipsoid: Ellipsoid, sensor: Cartesian3) {
  const length = Cartesian3.magnitude(sensor);
  if (length <= 1) return;
  const direction = Cartesian3.divideByScalar(sensor, length, new Cartesian3());
  const from = Cartesian3.mostOrthogonalAxis(direction, new Cartesian3());
  const u = Cartesian3.normalize(Cartesian3.cross(direction, from, new Cartesian3()), new Cartesian3());
  const v = Cartesian3.cross(direction, u, new Cartesian3());
  const center = Cartesian3.divideByScalar(direction, length, new Cartesian3());
  const radius = Math.sqrt(1 - 1 / length ** 2);
  const limb = new Path2D();
  const world = new Cartesian3(), horizontal = new Cartesian3(), vertical = new Cartesian3();
  for (let i = 0; i < 256; i++) {
    const angle = i * 2 * Math.PI / 256;
    Cartesian3.multiplyByScalar(u, radius * Math.cos(angle), horizontal);
    Cartesian3.multiplyByScalar(v, radius * Math.sin(angle), vertical);
    Cartesian3.add(horizontal, vertical, world);
    Cartesian3.add(center, world, world);
    ellipsoid.transformPositionFromScaledSpace(world, world);
    const point = SceneTransforms.worldToWindowCoordinates(scene, world);
    if (!point) return;
    if (i) limb.lineTo(point.x, point.y);
    else limb.moveTo(point.x, point.y);
  }
  limb.closePath();
  return limb;
}

function prepareCanvas(buffer: HTMLCanvasElement, w: number, h: number, ratio: number) {
  if (buffer.width !== w || buffer.height !== h) {
    buffer.width = w;
    buffer.height = h;
  }
  const ctx = buffer.getContext("2d", {willReadFrequently: true})!;
  ctx.resetTransform();
  ctx.clearRect(0, 0, w, h);
  ctx.scale(ratio, ratio);
  return ctx;
}

export function createCesiumDistribution(scene: CesiumScene, canvas: HTMLCanvasElement, changed: () => void) {
  const ellipsoid = scene.globe.ellipsoid;
  const coverage = createCoverageClient(changed);
  let layout: ViewportLayout | undefined, layoutRevision = 0, renderKey = "", bufferIndex = 0;
  const topology = createAsyncCoverageViewport(() => {
    layout = undefined;
    changed();
  });
  const overlays = [document.createElement("canvas"), document.createElement("canvas")];
  const intensity = document.createElement("canvas");
  // The raster is an input texture, composited by a Cesium command on the
  // same canvas as the ellipsoid and imagery.
  const material = Material.fromType(Material.ImageType, {image: overlays[0], color: Color.TRANSPARENT});
  const quad = scene.primitives.add(new ViewportQuad(new BoundingRectangle(), material));
  quad.show = false;
  let painted: PaintedDistribution | undefined, framesBeforePainted = 0;
  let cellsVisible = 0;
  let strength = new Float32Array(), heatScratch = {middle: new Float32Array(), output: new Float32Array()};
  const stamp = () => {
    if (quad.show && framesBeforePainted > 0) {
      framesBeforePainted--;
      if (framesBeforePainted > 0) {
        // Cesium queues canvas textures during the material's first update
        // and draws them on the next frame. Avoid flashing its white default.
        material.uniforms.color = Color.WHITE;
        scene.requestRender();
      }
    }
    if (!quad.show || !painted || framesBeforePainted > 0) {
      delete canvas.dataset.globeDistribution;
      delete canvas.dataset.globeDistributionCount;
      delete canvas.dataset.globeDistributionMesh;
      delete canvas.dataset.globeDistributionGrid;
      return;
    }
    canvas.dataset.globeDistribution = painted.mode;
    canvas.dataset.globeDistributionCount = String(painted.count);
    canvas.dataset.globeDistributionMesh = String(painted.mesh);
    canvas.dataset.globeDistributionGrid = painted.grid;
  };
  const sizeQuad = () => {
    quad.rectangle.width = canvas.width;
    quad.rectangle.height = canvas.height;
  };
  const stopStamp = scene.postRender.addEventListener(stamp);
  const stopResize = scene.preRender.addEventListener(sizeQuad);

  function paint(width: number, height: number, mode: PaintedDistribution["mode"], counts: Map<string, number>,
    catalogue: ProjectedCell[], mesh: ProjectedCell[], lowAlpha: boolean, scenes: boolean, zoom: number,
    projectionScale: number, limb: Path2D | undefined, interacting: boolean) {
    const ratio = Math.min(1, (interacting ? 360 : 640) / Math.max(width, height));
    const w = Math.ceil(width * ratio), h = Math.ceil(height * ratio);
    bufferIndex = 1 - bufferIndex;
    const result = overlays[bufferIndex];
    const ctx = prepareCanvas(result, w, h, ratio);
    if (mode === "grid") {
      ctx.globalAlpha = lowAlpha ? .62 : 1;
      for (const cell of catalogue) {
        const color = catalogCellColor(counts.get(cell.id) ?? 0, scenes);
        if (!color) continue;
        ctx.fillStyle = color;
        ctx.fill(cell.outline);
        ctx.lineWidth = .65;
        ctx.strokeStyle = scenes && mesh.length ? "#256781" : color;
        ctx.stroke(cell.outline);
      }
      ctx.globalAlpha = 1;
    } else if (counts.size) {
      const raster = prepareCanvas(intensity, w, h, ratio);
      for (const cell of catalogue) {
        const shade = Math.round(255 * heatIntensity(counts.get(cell.id) ?? 0));
        if (!shade) continue;
        raster.fillStyle = raster.strokeStyle = `rgb(${shade},${shade},${shade})`;
        raster.fill(cell.outline);
        raster.lineWidth = .5;
        raster.stroke(cell.outline);
      }
      const rgba = raster.getImageData(0, 0, w, h).data;
      if (strength.length !== w * h) {
        strength = new Float32Array(w * h);
        heatScratch = {middle: new Float32Array(w * h), output: new Float32Array(w * h)};
      }
      for (let i = 0; i < strength.length; i++) strength[i] = rgba[4 * i] * rgba[4 * i + 3] / 65025;
      const sample = catalogue.find(cell => counts.has(cell.id));
      const sigma = sample ? Math.max(.8, Math.min(3, projectionScale * Math.sqrt(sample.area) * .35 * ratio)) : 1;
      const smoothed = smoothHeatField(strength, w, h, sigma, heatScratch);
      const image = ctx.createImageData(w, h);
      for (let i = 0; i < smoothed.length; i++) {
        const value = smoothed[i];
        if (value < .025) continue;
        const color = heatPalette[Math.min(255, Math.round(value * 255))];
        const offset = i * 4;
        image.data[offset] = color[0];
        image.data[offset + 1] = color[1];
        image.data[offset + 2] = color[2];
        image.data[offset + 3] = Math.round((lowAlpha ? 235 * .62 : 235) * Math.min(1, value / .2));
      }
      ctx.putImageData(image, 0, 0);
    }
    if (mesh.length) {
      ctx.strokeStyle = zoom < 2 ? "rgba(59,98,88,.11)" : "rgba(54,99,97,.20)";
      ctx.lineWidth = zoom < 2 ? .48 : .6;
      // One composite stroke prevents shared edges from accumulating opacity.
      const lines = new Path2D();
      for (const cell of mesh) lines.addPath(cell.outline);
      ctx.stroke(lines);
    }
    if (limb) {
      ctx.save();
      ctx.globalCompositeOperation = "destination-in";
      ctx.fillStyle = "#fff";
      ctx.fill(limb);
      ctx.restore();
    }
    material.uniforms.image = result;
    material.uniforms.color = Color.TRANSPARENT;
    framesBeforePainted = 2;
    quad.show = true;
  }

  function disable() {
    quad.show = false;
    painted = undefined;
    layout = undefined;
    renderKey = "";
    cellsVisible = 0;
    delete canvas.dataset.coveragePending;
    delete canvas.dataset.coverageSource;
    stamp();
  }

  return {
    update(state: Scene, displayGrid: GridSpec, current: Camera, interacting: boolean) {
      const width = canvas.clientWidth, height = canvas.clientHeight;
      const ordinaryCatalogue = !state.caseId && state.overview !== "simulation" && !state.dataView &&
        !state.publicLayer && !state.fieldLayer && !state.visualization && !state.datasetLayers?.length;
      const nativeMesh=!!state.dataView&&state.mesh;
      if ((!ordinaryCatalogue&&!nativeMesh) || !width || !height) {
        disable();
        return {visibleCells: 0, loading: ""};
      }
      const evidenceGrid = nativeMesh ? displayGrid : catalogEvidenceGrid(displayGrid,state.mapResult);
      const frozen = nativeMesh ? undefined : state.mapResult?.selection;
      const scenes = state.mapResult?.metric === "scenes";
      const mode = !nativeMesh && !frozen && !scenes && state.catalogStyle === "heatmap" ? "heatmap" : "grid";
      const {heading, pitch, roll} = scene.camera;
      const key = JSON.stringify([width, height, current.center, current.zoom, heading, pitch, roll, displayGrid.key,
        evidenceGrid.key, frozen?.id, state.mesh, nativeMesh]);
      if (layout?.key !== key) {
        const {projection, searchWidth, searchHeight} = windowProjection(scene, ellipsoid, current, width, height);
        const sensor = ellipsoid.transformPositionToScaledSpace(scene.camera.positionWC, new Cartesian3());
        let pending = false, limited = false;
        function project(cells: ViewportCell[]) {
          const visible: ProjectedCell[] = [];
          for (const cell of cells) {
            const projected = projectCell(scene, ellipsoid, sensor, cell, width, height);
            if (!projected) continue;
            if (visible.length >= maxVisibleCells) { limited = true; break; }
            visible.push(projected);
          }
          return visible;
        }
        function viewport(grid: GridSpec) {
          const cells = topology.read(grid, projection, current.center, searchWidth, searchHeight, current.zoom);
          pending ||= topology.pending;
          return cells;
        }
        const catalogue = nativeMesh ? [] : project(frozen ? [cellShape(frozen.id, frozen.grid)] : viewport(evidenceGrid));
        const mesh = !state.mesh ? [] : !nativeMesh && !frozen && evidenceGrid.key === displayGrid.key
          ? catalogue : project(viewport(displayGrid));
        layout = {key, catalogue, mesh, scale: projection.scale(), limb: projectLimb(scene, ellipsoid, sensor), pending, limited};
        layoutRevision++;
      }
      const {catalogue, mesh, scale, limb, pending, limited} = layout;
      const ids = catalogue.map(cell => cell.id);
      const publicationKey = catalogRevision() + "/" + (state.paperFeed?.revision ?? "");
      const result = nativeMesh ? undefined : coverage.read(evidenceGrid, ids, state.filters, state.mapResult, publicationKey, interacting);
      if(nativeMesh){
        delete canvas.dataset.coveragePending;
        delete canvas.dataset.coverageSource;
      }else{
        canvas.dataset.coveragePending=String(result?.pending||pending||limited);
        canvas.dataset.coverageSource="server-index";
      }
      const counts = new Map([...(result?.cells??[])].filter(([id,count])=>count>0&&result?.ready.has(id)));
      const fingerprint = JSON.stringify([layoutRevision, mode, result?.revision, !!state.basemap, interacting, [...counts]]);
      if (fingerprint !== renderKey) {
        renderKey = fingerprint;
        cellsVisible = catalogue.filter(cell => cell.onScreen && counts.has(cell.id)).length;
        if (counts.size || mesh.length) {
          paint(width, height, mode, counts, catalogue, mesh, !!state.basemap, scenes, current.zoom, scale, limb, interacting);
          painted = {mode, grid: evidenceGrid.key, count: cellsVisible, mesh: mesh.filter(cell => cell.onScreen).length};
        } else {
          quad.show = false;
          painted = undefined;
        }
      }
      const loading = result?.pending || pending || limited
        ? result?.error || (limited ? "可见网格超出绘制上限，请放大查看。" : pending ? "正在细化可见网格…" : "正在读取网格分布…")
        : "";
      return {visibleCells: cellsVisible, loading};
    },
    invalidate() {
      coverage.invalidate();
    },
    dispose() {
      stopStamp();
      stopResize();
      coverage.dispose();
      topology.dispose();
      scene.primitives.remove(quad);
      material.destroy();
    },
  };
}
