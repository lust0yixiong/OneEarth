import { useEffect, useMemo, useState } from "react";
import { isForestDate, type HainaForestManifest } from "../domain/regional-cases";
import type { ForestImage } from "../globe/regional-layer";

const base = "/visualizations/haina/1846764";
function checkedManifest(data: HainaForestManifest) {
  if (data.datasetId !== "haina:1846764" || !Array.isArray(data.frames) || !data.frames.length ||
    data.grid?.width !== 370 || data.grid?.height !== 303 || data.grid.bounds?.length !== 4 ||
    !data.grid.bounds.every(Number.isFinite) || data.embedding?.variance?.length !== 3 ||
    !data.embedding.variance.every(Number.isFinite) ||
    !data.frames.every((frame, i) => isForestDate(frame.date) && (i === 0 || data.frames[i - 1].date < frame.date) &&
      (frame.image === base + "/" + frame.date.replaceAll("-", "") + ".webp" ||
       frame.image === base + "/daily-v1/" + frame.date + ".webp")))
    throw Error("森林日期目录格式不正确");
  return data;
}

export function useForestLayer(layer: { frame: number; date?: string } | null, playing: boolean) {
  const active = layer !== null;
  const [manifest, setManifest] = useState<HainaForestManifest | null>(null);
  const [catalogError, setCatalogError] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<{ route: string; image: ForestImage } | null>(null);
  const [catalogAttempt, retryCatalog] = useState(0);
  const [imageAttempt, retryImage] = useState(0);
  useEffect(() => {
    if (!active) { setManifest(null); return; }
    const request = new AbortController();
    setCatalogError(false);
    void fetch(base + "/manifest.json", { signal: request.signal, cache: "no-cache" })
      .then(async response => {
        if (!response.ok) throw Error("森林日期目录读取失败");
        const data = checkedManifest(await response.json());
        if (!request.signal.aborted) setManifest(data);
      }).catch(() => { if (!request.signal.aborted) setCatalogError(true); });
    return () => request.abort();
  }, [active, catalogAttempt]);
  const date = layer && manifest ?
    (layer.date ?? manifest.defaultDate ?? manifest.frames[layer.frame]?.date ?? manifest.frames[0].date) : "";
  const index = useMemo(() => manifest?.frames.findIndex(frame => frame.date === date) ?? -1, [manifest, date]);
  const frame = manifest?.frames[index] ?? null;
  useEffect(() => {
    setLoaded(null);
    setImageError(null);
    if (!frame || !manifest) return;
    const request = new AbortController();
    void fetch(frame.image, { signal: request.signal })
      .then(async response => {
        if (!response.ok) throw Error("当日图层读取失败");
        const bitmap = await createImageBitmap(await response.blob());
        try {
          if (request.signal.aborted) return;
          if (bitmap.width !== manifest.grid.width || bitmap.height !== manifest.grid.height)
            throw Error("森林图层尺寸不正确");
          const canvas = document.createElement("canvas");
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          const context = canvas.getContext("2d")!;
          context.drawImage(bitmap, 0, 0);
          const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
          setLoaded({ route: frame.image, image: { pixels: data, width: canvas.width, height: canvas.height, bounds: manifest.grid.bounds } });
        } finally {
          bitmap.close();
        }
      }).catch(() => { if (!request.signal.aborted) setImageError(frame.image); });
    return () => request.abort();
  }, [frame, manifest, imageAttempt]);
  const image = loaded && frame?.image === loaded.route ? loaded.image : null;
  const next = playing && image && index >= 0 ? manifest?.frames[index + 1] : undefined;
  useEffect(() => {
    if (!next) return;
    const request = new AbortController();
    // Populate the browser HTTP cache for one frame ahead; never fetch the rest of the timeline.
    void fetch(next.image, { signal: request.signal }).then(response => {
      if (response.ok) return response.blob();
    }).catch(() => {});
    return () => request.abort();
  }, [next]);
  return { manifest, date, frame, index, image, catalogError, imageError: frame !== null && frame.image === imageError,
    retryCatalog: () => retryCatalog(attempt => attempt + 1), retryImage: () => retryImage(attempt => attempt + 1) };
}
