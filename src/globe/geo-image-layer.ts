import type {GeoProjection} from "d3-geo";

export type NumberBounds = [west: number, south: number, east: number, north: number];

/** A georeferenced RGBA image in EPSG:4326, row 0 at the north edge. */
export interface GeoImageFrame {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
  bounds: NumberBounds;
  opacity?: number;
}

/**
 * Paint a rectangular lon/lat image over the globe. The source keeps its
 * native resolution instead of being stretched into an equirectangular
 * texture, so a 0.03° dataset stays legible when the camera zooms in.
 */
export function createGeoImagePainter() {
  const buffer = document.createElement("canvas");
  let geometryKey = "";
  let uv = new Float32Array(0);
  let image: ImageData | undefined;
  return (
    ctx: CanvasRenderingContext2D,
    projection: GeoProjection,
    frame: GeoImageFrame,
    width: number,
    height: number,
    moving: boolean,
  ) => {
    if (!frame.pixels.length || frame.width < 1 || frame.height < 1) return;
    const [west, south, east, north] = frame.bounds;
    const corners: [number, number][] = [
      [west, north],
      [east, north],
      [east, south],
      [west, south],
      [(west + east) / 2, north],
      [(west + east) / 2, south],
      [west, (north + south) / 2],
      [east, (north + south) / 2],
    ];
    let left = Infinity,
      top = Infinity,
      right = -Infinity,
      bottom = -Infinity;
    for (const corner of corners) {
      const point = projection(corner);
      if (!point || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) continue;
      left = Math.min(left, point[0]);
      right = Math.max(right, point[0]);
      top = Math.min(top, point[1]);
      bottom = Math.max(bottom, point[1]);
    }
    if (!Number.isFinite(left)) return;
    left = Math.max(0, Math.floor(left) - 2);
    top = Math.max(0, Math.floor(top) - 2);
    right = Math.min(width, Math.ceil(right) + 2);
    bottom = Math.min(height, Math.ceil(bottom) + 2);
    const dw = right - left,
      dh = bottom - top;
    if (dw <= 0 || dh <= 0) return;
    const scale = moving
      ? Math.min(1, 640 / Math.max(dw, dh))
      : Math.min(devicePixelRatio, 2, 1600 / Math.max(dw, dh));
    const w = Math.max(1, Math.ceil(dw * scale)),
      h = Math.max(1, Math.ceil(dh * scale));
    const key = [width, height, w, h, left, top, dw, dh, ...projection.rotate(), ...frame.bounds, frame.width, frame.height].join("/");
    if (key !== geometryKey) {
      geometryKey = key;
      uv = new Float32Array(w * h * 2);
      const [cx, cy] = projection.translate();
      const radius = projection.scale();
      const spanX = east - west;
      const spanY = north - south;
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const px = left + (x + 0.5) * (dw / w);
          const py = top + (y + 0.5) * (dh / h);
          const a = (px - cx) / radius,
            b = (py - cy) / radius;
          const offset = (y * w + x) * 2;
          if (a * a + b * b >= 1) {
            uv[offset] = NaN;
            continue;
          }
          const inverted = projection.invert!([px, py]);
          if (!inverted) {
            uv[offset] = NaN;
            continue;
          }
          const lon = inverted[0],
            lat = inverted[1];
          if (lon < west || lon > east || lat < south || lat > north) {
            uv[offset] = NaN;
            continue;
          }
          uv[offset] = ((lon - west) / spanX) * (frame.width - 1);
          uv[offset + 1] = ((north - lat) / spanY) * (frame.height - 1);
        }
      buffer.width = w;
      buffer.height = h;
      image = undefined;
    }
    const target = buffer.getContext("2d")!;
    if (!image || image.width !== w || image.height !== h) image = target.createImageData(w, h);
    const output = image.data;
    const {pixels, width: sourceWidth, height: sourceHeight} = frame;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const source = (y * w + x) * 2;
        const outputOffset = (y * w + x) * 4;
        if (Number.isNaN(uv[source])) {
          output[outputOffset + 3] = 0;
          continue;
        }
        const fx = Math.max(0, Math.min(sourceWidth - 1, uv[source]));
        const fy = Math.max(0, Math.min(sourceHeight - 1, uv[source + 1]));
        const x0 = Math.floor(fx),
          y0 = Math.floor(fy),
          x1 = Math.min(sourceWidth - 1, x0 + 1),
          y1 = Math.min(sourceHeight - 1, y0 + 1);
        const tx = fx - x0,
          ty = fy - y0;
        const a = (1 - tx) * (1 - ty),
          b = tx * (1 - ty),
          c = (1 - tx) * ty,
          d = tx * ty;
        const p00 = (y0 * sourceWidth + x0) * 4,
          p10 = (y0 * sourceWidth + x1) * 4,
          p01 = (y1 * sourceWidth + x0) * 4,
          p11 = (y1 * sourceWidth + x1) * 4;
        const alpha = pixels[p00 + 3] * a + pixels[p10 + 3] * b + pixels[p01 + 3] * c + pixels[p11 + 3] * d;
        if (alpha < 2) {
          output[outputOffset + 3] = 0;
          continue;
        }
        output[outputOffset] = pixels[p00] * a + pixels[p10] * b + pixels[p01] * c + pixels[p11] * d;
        output[outputOffset + 1] = pixels[p00 + 1] * a + pixels[p10 + 1] * b + pixels[p01 + 1] * c + pixels[p11 + 1] * d;
        output[outputOffset + 2] = pixels[p00 + 2] * a + pixels[p10 + 2] * b + pixels[p01 + 2] * c + pixels[p11 + 2] * d;
        output[outputOffset + 3] = alpha;
      }
    target.putImageData(image, 0, 0);
    const previousAlpha = ctx.globalAlpha;
    const previousSmoothing = ctx.imageSmoothingEnabled;
    ctx.globalAlpha = Math.max(0, Math.min(1, frame.opacity ?? 0.94));
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(buffer, left, top, dw, dh);
    ctx.globalAlpha = previousAlpha;
    ctx.imageSmoothingEnabled = previousSmoothing;
  };
}
