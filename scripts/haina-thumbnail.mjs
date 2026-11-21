import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, rename, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const origin = "https://haina-datahub.zero2x.org";
const directory = new URL("../public/thumbnails/haina/", import.meta.url);
const cache = new Map();

async function cacheBrowseImage(url) {
  const pathKey = url.origin === origin ? url.pathname : url.origin + url.pathname;
  const id = createHash("sha256").update(pathKey).digest("hex").slice(0, 24);
  const file = new URL(id + ".webp", directory);
  const relative = "/thumbnails/haina/" + id + ".webp";
  const temporary = fileURLToPath(new URL(id + "." + randomUUID() + ".webp", directory));
  try {
    await mkdir(directory, { recursive: true });
    const response = await fetch(url, { signal: AbortSignal.timeout(18000), redirect: "error" });
    if (!response.ok) throw Error("HTTP " + response.status);
    const bytes = Buffer.from(await response.arrayBuffer());
    await sharp(bytes, { limitInputPixels: 64_000_000 }).rotate()
      .resize({ width: 640, height: 640, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 }).toFile(temporary);
    await rename(temporary, file);
    return relative;
  } catch {
    // An upstream failure should not replace an earlier copy of the same cover.
    try { await access(file); return relative; } catch { return undefined; }
  } finally {
    await rm(temporary, { force: true });
  }
}

// Never store an expiring OSS signature in the public snapshot. All records
// referring to the same publisher image share one optimized local file.
export function hainaThumbnail(raw) {
  if (typeof raw !== "string" || !raw.trim()) return;
  let url;
  try { url = new URL(raw, origin); } catch { return; }
  if (url.username || url.password || !["http:", "https:"].includes(url.protocol)) return;
  const signed = [...url.searchParams.keys()].some(k => /signature|credential|token/i.test(k));
  if ((url.origin === origin && url.pathname.startsWith("/ossRoute/")) ||
      (url.origin === "https://storage.googleapis.com" && signed)) {
    const key = url.origin + url.pathname;
    if (!cache.has(key)) cache.set(key, cacheBrowseImage(url));
    return cache.get(key);
  }
  if (!/^https?:\/\//i.test(raw) || signed) return;
  return url.href;
}
