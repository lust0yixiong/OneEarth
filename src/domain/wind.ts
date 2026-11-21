import manifest from "../data/evidence/wind-manifest.json";
import type { Coordinate, EvidenceDocument, VisualizationState } from "./types";
export const windManifest = manifest;
export type WindFrame = (typeof manifest.frames)[number];
export type WindData = { fields: Map<string, Int16Array> };
let cached: WindData | null = null;
let pending: Promise<WindData> | null = null;
export const getWindData = () => cached;
export function decodeWind(buffer: ArrayBuffer): WindData {
  if (buffer.byteLength !== manifest.binaryBytes)
    throw Error("风场数据长度不符，请重新载入。");
  const fields = new Map<string, Int16Array>();
  const bytes = new DataView(buffer);
  for (const frame of manifest.frames) {
    const values = new Int16Array(frame.valueCount);
    for (let i = 0; i < values.length; i++)
      values[i] = bytes.getInt16(frame.byteOffset + i * 2, true);
    fields.set(frame.id, values);
  }
  return { fields };
}
export const installWindData = (data: WindData) => {
  cached = data;
};
export function loadWindData(): Promise<WindData> {
  if (cached) return Promise.resolve(cached);
  if (!pending)
    pending = fetch(manifest.binaryUrl)
      .then(async (response) => {
        if (!response.ok) throw Error("风场文件暂时无法载入，请重试。");
        const buffer = await response.arrayBuffer();
        if (globalThis.crypto?.subtle) {
          const digest = await crypto.subtle.digest("SHA-256", buffer);
          const hash = [...new Uint8Array(digest)]
            .map((v) => v.toString(16).padStart(2, "0"))
            .join("");
          if (hash !== manifest.sha256)
            throw Error("风场文件校验失败，请重新载入。");
        }
        cached = decodeWind(buffer);
        return cached;
      })
      .finally(() => {
        pending = null;
      });
  return pending;
}
export const defaultWindState = (): VisualizationState => ({
  id: "gfs-wind",
  level: "250hPa",
  forecastHour: 0,
  playing: true,
  color: true,
});
export const windFrame = (view: VisualizationState) =>
  manifest.frames.find(
    (f) => f.level === view.level && f.forecastHour === view.forecastHour,
  )!;
export const windTimeLabel = (frame: WindFrame) =>
  frame.validTime.replace("T", " ").replace(":00:00Z", ":00 UTC");
export function windVector(
  data: WindData,
  frame: WindFrame,
  lon: number,
  lat: number,
) {
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lat) > 90)
    return null;
  const values = data.fields.get(frame.id);
  if (!values) return null;
  const x = ((lon % 360) + 360) % 360,
    y = Math.max(0, Math.min(180, 90 - lat));
  const x0 = Math.floor(x),
    x1 = (x0 + 1) % 360,
    y0 = Math.floor(y),
    y1 = Math.min(180, y0 + 1);
  const tx = x - x0,
    ty = y - y0;
  const cells = [y0 * 360 + x0, y0 * 360 + x1, y1 * 360 + x0, y1 * 360 + x1];
  const weights = [(1 - tx) * (1 - ty), tx * (1 - ty), (1 - tx) * ty, tx * ty];
  let u = 0,
    v = 0;
  for (let i = 0; i < 4; i++) {
    const a = values[cells[i] * 2],
      b = values[cells[i] * 2 + 1];
    if (a === 32767 || b === 32767) return null;
    u += a * manifest.scale * weights[i];
    v += b * manifest.scale * weights[i];
  }
  return {
    u,
    v,
    speed: Math.hypot(u, v),
    from: ((Math.atan2(-u, -v) * 180) / Math.PI + 360) % 360,
  };
}
export function windDocument(
  view: VisualizationState,
  point?: Coordinate,
): EvidenceDocument {
  const frame = windFrame(view),
    data = getWindData();
  const raw = data?.fields.get(frame.id);
  const row = (x: number, y: number) => {
    const index = (y * manifest.width + x) * 2;
    const u = raw![index] * manifest.scale,
      v = raw![index + 1] * manifest.scale;
    return [
      x > 180 ? x - 360 : x,
      90 - y,
      +u.toFixed(2),
      +v.toFixed(2),
      +Math.hypot(u, v).toFixed(2),
    ];
  };
  let rows: number[][] = [];
  if (raw) {
    if (point) {
      const x = Math.floor((point[0] + 360) % 360),
        y = Math.min(179, Math.floor(90 - point[1]));
      rows = [
        row(x, y),
        row((x + 1) % 360, y),
        row(x, y + 1),
        row((x + 1) % 360, y + 1),
      ];
    } else
      for (let y = 0; y < manifest.height; y++)
        for (let x = 0; x < manifest.width; x++) rows.push(row(x, y));
  } else rows = frame.samples;
  const sampled = point && data ? windVector(data, frame, ...point) : null;
  return {
    version: manifest.referenceTime + " · " + frame.id,
    id: "gfs-" + frame.id + (point ? "-" + point.join(",") : ""),
    title:
      "NCEP GFS · " + (point ? "所选位置的原网格依据" : "全球风矢量原网格"),
    scope: `${view.level === "10m" ? "近地面 10 m" : "250 hPa"} · ${windTimeLabel(frame)} · F${String(frame.forecastHour).padStart(3, "0")}`,
    source: manifest.source,
    url: manifest.sourceUrl,
    attachments: manifest.originals
      .filter((o) =>
        o.file.includes(`f${String(frame.forecastHour).padStart(3, "0")}`),
      )
      .map((o) => ({ label: "原始 GRIB2", url: o.file })),
    tabs: [
      {
        kind: "table",
        label: point ? "相邻四个原网格值" : "全球原网格 · 1°",
        columns: ["经度 °", "纬度 °", "u 东向 m/s", "v 北向 m/s", "风速 m/s"],
        rows,
      },
      {
        kind: "web",
        label: "来源与口径",
        body: `来源：${manifest.source}。起报时间 ${manifest.referenceTime}。这是已保存的数据快照。预报时效 F000 / F006 / F012，分别保留 10 m 和 250 hPa 的 u/v 分量。\n每幅场 360 × 181 个原始 1° 网格点；浏览器存储的风分量保留至 0.01 m/s。球面颜色和流线按同一 u/v 场做双线性插值，粒子运动用于说明瞬时风向，不代表观测到的气团轨迹。\n${sampled ? `所选位置插值：u ${sampled.u.toFixed(3)}、v ${sampled.v.toFixed(3)}、风速 ${sampled.speed.toFixed(3)} m/s。\n` : ""}NOAA 发布入口：${manifest.sourceUrl}\n本地原始 GRIB2 文件：${manifest.originals.find((o) => o.file.includes(`f${String(frame.forecastHour).padStart(3, "0")}`))?.file}`,
      },
      {
        kind: "code",
        label: "数据参数",
        language: "json",
        body: JSON.stringify(
          {
            dataset: manifest.id,
            source: manifest.source,
            referenceTime: manifest.referenceTime,
            frame,
            grid: {
              width: 360,
              height: 181,
              lonStart: 0,
              latStart: 90,
              dx: 1,
              dy: 1,
            },
            encoding: manifest.encoding,
            scale: manifest.scale,
            binarySha256: manifest.sha256,
            originals: manifest.originals,
          },
          null,
          2,
        ),
      },
    ],
  };
}
