#!/usr/bin/env node
/**
 * Turn the downloaded Haina 1846764 daily parquet slices into a web layer.
 *
 * Input (downloaded with the haina-datahub SDK, see the README section):
 *   .local/haina/1846764/<YYYYMMDD>/date=<YYYYMMDD>/data.parquet
 * Output:
 *   public/visualizations/haina/1846764/<YYYYMMDD>.webp
 *   public/visualizations/haina/1846764/manifest.json
 *
 * The 64-dimensional vectors are summarised by the first three principal
 * components. Each channel is stretched with the global 2nd–98th percentile
 * so colors stay comparable between dates. This is a visualization of the
 * embedding, not a physical variable; the manifest records the method.
 */
import {createHash} from "node:crypto";
import {mkdirSync, readFileSync, writeFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {asyncBufferFromFile, parquetReadObjects} from "hyparquet";
import {compressors} from "hyparquet-compressors";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const datasetId = "1846764";
const dates = ["20230115", "20230215", "20230315", "20230415", "20230515", "20230615", "20230715", "20230815", "20230915", "20231015", "20231115", "20231215"];
const inputDir = path.join(root, ".local", "haina", datasetId);
const outputDir = path.join(root, "public", "visualizations", "haina", datasetId);
const grid = {
  width: 370,
  height: 303,
  resolution: 0.03,
  bounds: [117.95, 44.96, 129.05, 54.05],
};
const dims = 64;

const slices = [];
for (const date of dates) {
  const file = path.join(inputDir, date, `date=${date}`, "data.parquet");
  const buffer = await asyncBufferFromFile(file);
  const rows = await parquetReadObjects({file: buffer, compressors});
  if (!rows.length) throw Error(`${date} 没有数据行`);
  const records = rows.map((row) => {
    if (!Array.isArray(row.vector) || row.vector.length !== dims)
      throw Error(`${date} 的向量维度不是 ${dims}`);
    const feature = JSON.parse(row.feature);
    const pixelId = Number(feature.pixel_id);
    if (!Number.isInteger(pixelId) || pixelId < 0 || pixelId >= grid.width * grid.height)
      throw Error(`${date} 的 pixel_id 超出网格：${feature.pixel_id}`);
    return {pixelId, vector: row.vector};
  });
  slices.push({
    date,
    file,
    sha256: createHash("sha256").update(readFileSync(file)).digest("hex"),
    records,
  });
  console.log(`${date}: ${records.length.toLocaleString()} 个像元`);
}

// One basis for every date, so a color change means the embedding changed.
const mean = new Float64Array(dims);
let count = 0;
for (const slice of slices)
  for (const {vector} of slice.records) {
    for (let i = 0; i < dims; i++) mean[i] += vector[i];
    count++;
  }
for (let i = 0; i < dims; i++) mean[i] /= count;
const covariance = new Float64Array(dims * dims);
for (const slice of slices)
  for (const {vector} of slice.records)
    for (let i = 0; i < dims; i++) {
      const a = vector[i] - mean[i];
      for (let j = i; j < dims; j++) covariance[i * dims + j] += a * (vector[j] - mean[j]);
    }
for (let i = 0; i < dims; i++)
  for (let j = i; j < dims; j++) {
    covariance[i * dims + j] /= count;
    covariance[j * dims + i] = covariance[i * dims + j];
  }
let trace = 0;
for (let i = 0; i < dims; i++) trace += covariance[i * dims + i];

function norm(vector) {
  let sum = 0;
  for (const value of vector) sum += value * value;
  return Math.sqrt(sum);
}
const components = [];
const eigenvalues = [];
const residual = Float64Array.from(covariance);
for (let component = 0; component < 3; component++) {
  let vector = Float64Array.from({length: dims}, (_, i) =>
    Math.sin((i + 1) * (component + 1) * 1.7) + Math.cos(i * 0.37) + ((i * 13 + component * 7) % 11) / 11,
  );
  let eigenvalue = 0;
  for (let iteration = 0; iteration < 500; iteration++) {
    const next = new Float64Array(dims);
    for (let i = 0; i < dims; i++) {
      let sum = 0;
      for (let j = 0; j < dims; j++) sum += residual[i * dims + j] * vector[j];
      next[i] = sum;
    }
    const length = norm(next);
    if (!length) break;
    let dot = 0;
    for (let i = 0; i < dims; i++) dot += next[i] * vector[i];
    for (let i = 0; i < dims; i++) next[i] /= length;
    if (dot < 0) for (let i = 0; i < dims; i++) next[i] = -next[i];
    eigenvalue = length;
    let change = 0;
    for (let i = 0; i < dims; i++) change = Math.max(change, Math.abs(next[i] - vector[i]));
    vector = next;
    if (change < 1e-12) break;
  }
  let pivot = 0;
  for (let i = 1; i < dims; i++) if (Math.abs(vector[i]) > Math.abs(vector[pivot])) pivot = i;
  if (vector[pivot] < 0) for (let i = 0; i < dims; i++) vector[i] = -vector[i];
  components.push(vector);
  eigenvalues.push(eigenvalue);
  for (let i = 0; i < dims; i++)
    for (let j = 0; j < dims; j++) residual[i * dims + j] -= eigenvalue * vector[i] * vector[j];
}

const scores = slices.map((slice) =>
  slice.records.map(({vector}) =>
    components.map((component) => {
      let value = 0;
      for (let i = 0; i < dims; i++) value += (vector[i] - mean[i]) * component[i];
      return value;
    }),
  ),
);
const flattened = scores.flat();
const low = [];
const high = [];
for (let channel = 0; channel < 3; channel++) {
  const sorted = flattened.map((score) => score[channel]).sort((a, b) => a - b);
  low.push(sorted[Math.floor(sorted.length * 0.02)]);
  high.push(sorted[Math.floor(sorted.length * 0.98)]);
}

mkdirSync(outputDir, {recursive: true});
const frames = [];
for (const [index, slice] of slices.entries()) {
  const pixels = Buffer.alloc(grid.width * grid.height * 4);
  for (const [rowIndex, {pixelId}] of slice.records.entries()) {
    const score = scores[index][rowIndex];
    const offset = pixelId * 4;
    for (let channel = 0; channel < 3; channel++) {
      const unit = Math.max(0, Math.min(1, (score[channel] - low[channel]) / (high[channel] - low[channel])));
      pixels[offset + channel] = Math.round(Math.pow(unit, 0.85) * 255);
    }
    pixels[offset + 3] = 255;
  }
  const file = path.join(outputDir, `${slice.date}.webp`);
  await sharp(pixels, {raw: {width: grid.width, height: grid.height, channels: 4}})
    .webp({quality: 88, alphaQuality: 100, effort: 6})
    .toFile(file);
  frames.push({
    date: `${slice.date.slice(0, 4)}-${slice.date.slice(4, 6)}-${slice.date.slice(6)}`,
    partition: `date=${slice.date}`,
    image: `/visualizations/haina/${datasetId}/${slice.date}.webp`,
    validPixels: slice.records.length,
    sourceSha256: slice.sha256,
  });
  console.log(`写出 ${file}`);
}

const variance = eigenvalues.map((value) => Number((value / trace).toFixed(4)));
const manifest = {
  version: 1,
  datasetId: `haina:${datasetId}`,
  name: "OneEarth/大兴安岭森林时空嵌入数据集",
  description: "以 303×370 网格、0.03° 分辨率组织的 64 维森林时空嵌入。",
  grid,
  embedding: {
    dimensions: dims,
    method: "PCA",
    components: ["R", "G", "B"],
    variance,
    stretch: [0.02, 0.98],
    note: `三个通道分别为前三个主成分，按 ${dates.length} 个日期的全局 2%–98% 分位拉伸。颜色表示嵌入向量的相对位置，不是物理量。`,
  },
  frames,
  source: {
    datasetId,
    url: `https://cn.zero2x.org/data-hub/portal/dataset?id=${datasetId}`,
    license: "CC-BY-4.0",
    licenseUrl: "https://choosealicense.com/licenses/cc-by-4.0/",
    provider: "地学数据组 · 之江实验室",
    files: frames.map((frame) => `date=${frame.date.replaceAll("-", "")}/data.parquet`),
  },
};
const manifestText = JSON.stringify(manifest, null, 2) + "\n";
writeFileSync(path.join(outputDir, "manifest.json"), manifestText);
writeFileSync(path.join(root, "src", "data", "evidence", "haina-forest.json"), manifestText);
console.log(`写出 manifest.json（public 与 src）：${frames.length} 个日期，PC 方差占比 ${variance.map((v) => (v * 100).toFixed(1) + "%").join(" / ")}`);
