import { geoDistance, type GeoProjection } from "d3-geo";
import {
  getWindData,
  windFrame,
  windVector,
  type WindData,
  type WindFrame,
} from "../domain/wind";
import type { Coordinate, VisualizationState } from "../domain/types";
export type WindTheme = "light" | "dark";
const darkStops = [
  [0, 13, 44, 76],
  [0.18, 24, 91, 143],
  [0.4, 38, 151, 179],
  [0.62, 104, 202, 193],
  [0.8, 225, 218, 128],
  [1, 255, 247, 207],
];
const lightStops = [
  [0, 219, 237, 242],
  [0.18, 165, 215, 223],
  [0.4, 90, 177, 190],
  [0.62, 54, 135, 160],
  [0.8, 51, 100, 141],
  [1, 42, 64, 111],
];
const ramps = { light: lightStops, dark: darkStops };
export function windLegendGradient(theme: WindTheme) {
  const stops = ramps[theme].map(([offset, r, g, b]) => `rgb(${r},${g},${b}) ${Math.round(offset * 100)}%`);
  return `linear-gradient(90deg, ${stops.join(", ")})`;
}
export function windRgb(speed: number, max: number, theme: WindTheme): [number, number, number] {
  const stops = ramps[theme];
  const t = Math.max(0, Math.min(1, speed / max));
  const upper = stops.findIndex((s) => s[0] >= t),
    a = stops[Math.max(0, upper - 1)],
    b = stops[Math.max(0, upper)];
  const f = (t - a[0]) / (b[0] - a[0] || 1);
  return [1, 2, 3].map((i) => Math.round(a[i] + (b[i] - a[i]) * f)) as [
    number,
    number,
    number,
  ];
}
export function drawWindSurface(
  ctx: CanvasRenderingContext2D,
  projection: GeoProjection,
  data: WindData,
  frame: WindFrame,
  width: number,
  height: number,
  theme: WindTheme,
) {
  const step = 4,
    w = Math.ceil(width / step),
    h = Math.ceil(height / step);
  const raster = document.createElement("canvas");
  raster.width = w;
  raster.height = h;
  const context = raster.getContext("2d")!;
  const pixels = context.createImageData(w, h),
    [cx, cy] = projection.translate(),
    radius = projection.scale();
  const max = frame.level === "10m" ? 35 : 110;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const px = (x + 0.5) * step,
        py = (y + 0.5) * step;
      if (Math.hypot(px - cx, py - cy) > radius) continue;
      const point = projection.invert!([px, py]);
      if (!point) continue;
      const v = windVector(data, frame, ...point);
      if (!v) continue;
      const rgb = windRgb(v.speed, max, theme),
        offset = (y * w + x) * 4;
      pixels.data[offset] = rgb[0];
      pixels.data[offset + 1] = rgb[1];
      pixels.data[offset + 2] = rgb[2];
      pixels.data[offset + 3] = 255;
    }
  context.putImageData(pixels, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(raster, 0, 0, width, height);
}

type Particle = { lon: number; lat: number; age: number; life: number };
type Config = {
  view: VisualizationState;
  theme: WindTheme;
  projection: GeoProjection;
  camera: Coordinate;
  width: number;
  height: number;
};
export function createWindParticles(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d")!;
  let config: Config | null = null,
    particles: Particle[] = [],
    raf = 0,
    signature = "",
    last = 0,
    tick = 0,
    disposed = false;
  const spawn = (): Particle => {
    const c = config!,
      [cx, cy] = c.projection.translate(),
      r = c.projection.scale();
    for (let i = 0; i < 80; i++) {
      const x = Math.random() * c.width,
        y = Math.random() * c.height;
      if (Math.hypot(x - cx, y - cy) > r * 0.99) continue;
      const point = c.projection.invert!([x, y]);
      if (point && geoDistance(c.camera, point) < Math.PI / 2)
        return {
          lon: point[0],
          lat: point[1],
          age: 0,
          life: 55 + Math.random() * 65,
        };
    }
    return { lon: c.camera[0], lat: c.camera[1], age: 0, life: 60 };
  };
  function draw(now: number, advance = true) {
    raf = 0;
    const c = config,
      data = getWindData();
    if (disposed || !c || !data) return;
    const frame = windFrame(c.view),
      dt = last ? Math.min(0.04, (now - last) / 1000) : 1 / 60;
    last = now;
    const dpr = Math.min(devicePixelRatio, 2);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (advance) {
      ctx.globalCompositeOperation = "destination-in";
      ctx.fillStyle = "rgba(0,0,0,0.94)";
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.globalCompositeOperation = "source-over";
    }
    ctx.lineWidth = c.width < 600 ? 1 : 1.15;
    ctx.lineCap = "round";
    const max = frame.level === "10m" ? 35 : 110;
    for (let i = 0; i < particles.length; i++) {
      let p = particles[i];
      const v = windVector(data, frame, p.lon, p.lat);
      if (
        !v ||
        p.age++ > p.life ||
        Math.abs(p.lat) > 89.8 ||
        geoDistance(c.camera, [p.lon, p.lat]) > Math.PI / 2
      ) {
        particles[i] = spawn();
        continue;
      }
      const old = c.projection([p.lon, p.lat])!;
      // Display speed is accelerated; direction and relative speed come from u/v.
      const baseRadius =
        Math.min(c.projection.translate()[0] * 2, c.height) * 0.455;
      const seconds =
        (dt * 14000) / Math.max(1, c.projection.scale() / baseRadius);
      const lon =
        p.lon +
        (v.u * seconds) /
          (111320 * Math.max(0.0035, Math.cos((p.lat * Math.PI) / 180)));
      const lat = p.lat + (v.v * seconds) / 111320;
      if (
        Math.abs(lat) > 89.8 ||
        geoDistance(c.camera, [lon, lat]) > Math.PI / 2
      ) {
        particles[i] = spawn();
        continue;
      }
      const next = c.projection([lon, lat])!;
      if (Math.hypot(next[0] - old[0], next[1] - old[1]) > 35) {
        particles[i] = spawn();
        continue;
      }
      if (c.theme === "light") {
        ctx.strokeStyle = c.view.color && v.speed > max * 0.58
          ? "rgba(238,252,255,0.95)"
          : "rgba(16,69,88,0.81)";
      } else {
        const rgb = windRgb(Math.min(max, v.speed * 0.7 + max * 0.4), max, c.theme);
        ctx.strokeStyle = `rgba(${rgb.join(",")},0.84)`;
      }
      ctx.beginPath();
      ctx.moveTo(...old);
      ctx.lineTo(...next);
      ctx.stroke();
      if (advance) {
        p.lon = ((lon + 540) % 360) - 180;
        p.lat = lat;
      }
    }
    canvas.dataset.tick = String(++tick);
    if (c.view.playing && !document.hidden) raf = requestAnimationFrame(draw);
  }
  const visible = () => {
    if (!document.hidden && config?.view.playing && !raf) {
      last = 0;
      raf = requestAnimationFrame(draw);
    }
  };
  document.addEventListener("visibilitychange", visible);
  return {
    update(next: Config | null) {
      cancelAnimationFrame(raf);
      raf = 0;
      const restyle = next?.theme !== config?.theme || next?.view.color !== config?.view.color;
      config = next;
      if (!next || !getWindData()) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        particles = [];
        signature = "";
        canvas.dataset.particles = "0";
        return;
      }
      const dpr = Math.min(devicePixelRatio, 2),
        width = Math.round(next.width * dpr),
        height = Math.round(next.height * dpr);
      const key = JSON.stringify([
        next.width,
        next.height,
        next.camera,
        next.projection.scale(),
        next.projection.translate(),
        next.view.level,
        next.view.forecastHour,
      ]);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      if (key !== signature) {
        signature = key;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        particles = Array.from({ length: next.width < 650 ? 1300 : 3000 }, () =>
          spawn(),
        );
        for (const p of particles) p.age = Math.random() * 50;
        last = 0;
      } else if (restyle) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        last = 0;
      }
      canvas.dataset.particles = String(particles.length);
      canvas.dataset.frame = windFrame(next.view).id;
      canvas.dataset.paused = String(!next.view.playing);
      if (next.view.playing) raf = requestAnimationFrame(draw);
      else if (!canvas.dataset.tick || last === 0)
        draw(performance.now(), false);
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", visible);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    },
  };
}
