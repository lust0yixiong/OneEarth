#!/usr/bin/env node
/**
 * Build the Shanghai / Beijing / Guangzhou C40 embedding layers.
 *
 * Input (downloaded with scripts/download-haina-c40.py):
 *   .local/haina/1846639/<city>/shards/geom2ind_polygon_<city>_.../{indices,meta,gids}.npy
 *   .local/haina/1846639/<city>/dataset_metadata/<city>/source_contract.json
 * Output:
 *   public/visualizations/haina/1846639/<city>.webp
 *   public/visualizations/haina/1846639/manifest.json
 *   src/data/evidence/haina-c40.json
 *
 * indices.npy is a (16384, 4, 32, 16) uint8 tensor: 1024 int16 embedding
 * values per polygon. Each row is L2-normalised, then the first three
 * principal components of a deterministic sample across the three cities
 * become R/G/B. A point is placed at the polygon centre from meta.npy (AEQD
 * metres, inverse-projected to WGS84); the point is not the full polygon.
 */
import {mkdirSync,readFileSync,readdirSync,statSync,writeFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const datasetId = "1846639";
const datasetRoot = path.join(root, ".local", "haina", datasetId);
const outputDir = path.join(root, "public", "visualizations", "haina", datasetId);
const W = 1600, D = 1024;
const registry = JSON.parse(readFileSync(path.join(datasetRoot, "root", "C40_all.dataset.json"), "utf8"));
const layerName = (cityId, code) => registry.gid_encoding.source_registry
  .find((entry) => entry.entity_id === cityId && entry.source_code === code)?.layer || String(code);
const CITY_CONFIG = [
  {id: "shanghai-chn", folder: "shanghai", name: "上海", zoom: 110},
  {id: "beijing-chn", folder: "beijing", name: "北京", zoom: 130},
  {id: "guangzhou-chn", folder: "guangzhou", name: "广州", zoom: 70},
];

function npy(file) {
  const buffer = readFileSync(file);
  const major = buffer[6];
  const headerLength = major === 1 ? buffer.readUInt16LE(8) : buffer.readUInt32LE(8);
  const prefix = major === 1 ? 10 : 12;
  const header = buffer.toString("latin1", prefix, prefix + headerLength);
  const shape = /shape': \(([^)]*)\)/.exec(header)[1].split(",").map((value) => Number(value.trim())).filter(Boolean);
  return {shape, buffer, offset: prefix + headerLength};
}
function readShard(dir) {
  const indices = npy(path.join(dir, "indices.npy"));
  const meta = npy(path.join(dir, "meta.npy"));
  const gids = npy(path.join(dir, "gids.npy"));
  const count = gids.shape[0];
  return {
    count,
    gids: new BigInt64Array(gids.buffer.buffer, gids.buffer.byteOffset + gids.offset, count),
    meta: new Float32Array(meta.buffer.buffer, meta.buffer.byteOffset + meta.offset, count * 6),
    embeddings: new Int16Array(indices.buffer.buffer, indices.buffer.byteOffset + indices.offset, count * D),
  };
}
function countRows(dir) {
  const file = path.join(dir, "gids.npy");
  const buffer = readFileSync(file);
  const major = buffer[6];
  const headerLength = major === 1 ? buffer.readUInt16LE(8) : buffer.readUInt32LE(8);
  const prefix = major === 1 ? 10 : 12;
  const header = buffer.toString("latin1", prefix, prefix + headerLength);
  return Number(/shape': \((\d+)/.exec(header)[1]);
}

const cities = CITY_CONFIG.map((config) => {
  const contractPath = path.join(datasetRoot, config.folder, "dataset_metadata", config.id, "source_contract.json");
  const contract = JSON.parse(readFileSync(contractPath, "utf8"));
  const shardRoot = path.join(datasetRoot, config.folder, "shards");
  const dirs = readdirSync(shardRoot)
    .filter((name) => name.startsWith("geom2ind_"))
    .sort()
    .map((name) => path.join(shardRoot, name));
  const bounds = contract.boundary_bounds_wgs84;
  const [west, south, east, north] = bounds;
  const height = Math.max(700, Math.min(1600, Math.round(W * (north - south) / (east - west))));
  return {
    ...config,
    bounds,
    width: W,
    height,
    center: [contract.projection.center_lon, contract.projection.center_lat],
    projection: {type: "Azimuthal Equidistant", lat0: contract.projection.center_lat, lon0: contract.projection.center_lon, radius: 6371000},
    dirs,
    total: dirs.reduce((sum, dir) => sum + countRows(dir), 0),
  };
});
if (cities.some((city) => !city.dirs.length)) throw Error("C40 分片缺失，请先运行 scripts/download-haina-c40.py");
const total = cities.reduce((sum, city) => sum + city.total, 0);

// Deterministic sample across all cities for one shared PCA basis.
const step = Math.max(1, Math.floor(total / 12000));
const sample = [];
let row = 0;
for (const city of cities) {
  for (const dir of city.dirs) {
    const shard = readShard(dir);
    for (let i = 0; i < shard.count; i++, row++) {
      if (row % step) continue;
      const offset = i * D;
      let norm = 0;
      for (let j = 0; j < D; j++) norm += shard.embeddings[offset + j] ** 2;
      norm = Math.sqrt(norm) || 1;
      const vector = new Float32Array(D);
      for (let j = 0; j < D; j++) vector[j] = shard.embeddings[offset + j] / norm;
      sample.push(vector);
    }
  }
}
const S = sample.length;
const mean = new Float32Array(D);
for (const vector of sample) for (let j = 0; j < D; j++) mean[j] += vector[j];
for (let j = 0; j < D; j++) mean[j] /= S;
for (const vector of sample) for (let j = 0; j < D; j++) vector[j] -= mean[j];
function orthonormalColumns(matrix, rows) {
  for (let k = 0; k < 3; k++) {
    for (let p = 0; p < k; p++) {
      let dot = 0;
      for (let i = 0; i < rows; i++) dot += matrix[i * 3 + k] * matrix[i * 3 + p];
      for (let i = 0; i < rows; i++) matrix[i * 3 + k] -= dot * matrix[i * 3 + p];
    }
    let norm = 0;
    for (let i = 0; i < rows; i++) norm += matrix[i * 3 + k] ** 2;
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < rows; i++) matrix[i * 3 + k] /= norm;
  }
}
let loadings = new Float32Array(D * 3);
for (let j = 0; j < D; j++)
  for (let k = 0; k < 3; k++) loadings[j * 3 + k] = Math.sin((j + 1) * (k + 2) * 1.7) + Math.cos(j * 0.11 + k);
orthonormalColumns(loadings, D);
for (let iteration = 0; iteration < 18; iteration++) {
  const scores = new Float32Array(S * 3);
  for (let i = 0; i < S; i++) {
    const vector = sample[i], base = i * 3;
    for (let j = 0; j < D; j++) {
      const value = vector[j];
      scores[base] += value * loadings[j * 3];
      scores[base + 1] += value * loadings[j * 3 + 1];
      scores[base + 2] += value * loadings[j * 3 + 2];
    }
  }
  orthonormalColumns(scores, S);
  const next = new Float32Array(D * 3);
  for (let i = 0; i < S; i++) {
    const vector = sample[i], base = i * 3, u0 = scores[base], u1 = scores[base + 1], u2 = scores[base + 2];
    for (let j = 0; j < D; j++) {
      const value = vector[j];
      next[j * 3] += value * u0;
      next[j * 3 + 1] += value * u1;
      next[j * 3 + 2] += value * u2;
    }
  }
  orthonormalColumns(next, D);
  loadings = next;
}
const sampleScores = [];
const componentVariance = [0, 0, 0];
for (let i = 0; i < S; i++) {
  const vector = sample[i], score = [0, 0, 0];
  for (let j = 0; j < D; j++) {
    const value = vector[j];
    score[0] += value * loadings[j * 3];
    score[1] += value * loadings[j * 3 + 1];
    score[2] += value * loadings[j * 3 + 2];
  }
  sampleScores.push(score);
  for (let k = 0; k < 3; k++) componentVariance[k] += score[k] ** 2;
}
for (let k = 0; k < 3; k++) componentVariance[k] /= S;
let meanSquared = 0;
for (const value of mean) meanSquared += value * value;
const totalVariance = Math.max(1e-9, 1 - meanSquared);
const variance = componentVariance.map((value) => Number((value / totalVariance).toFixed(4)));
const low = [], high = [];
for (let k = 0; k < 3; k++) {
  const sorted = sampleScores.map((score) => score[k]).sort((a, b) => a - b);
  low.push(sorted[Math.floor(S * 0.02)]);
  high.push(sorted[Math.floor(S * 0.98)]);
}

mkdirSync(outputDir, {recursive: true});
const cityManifests = [];
for (const city of cities) {
  const {width, height, bounds, center, projection} = city;
  const [west, south, east, north] = bounds;
  const pixels = Buffer.alloc(width * height * 4);
  const layerCounts = {};
  let painted = 0;
  const inverse = (x, y) => {
    const rho = Math.hypot(x, y);
    if (rho < 1e-9) return [center[0], center[1]];
    const c = rho / projection.radius, sinC = Math.sin(c), cosC = Math.cos(c);
    const lat0 = center[1] * Math.PI / 180, lon0 = center[0] * Math.PI / 180;
    const latitude = Math.asin(cosC * Math.sin(lat0) + y * sinC * Math.cos(lat0) / rho);
    const longitude = lon0 + Math.atan2(x * sinC, rho * Math.cos(lat0) * cosC - y * Math.sin(lat0) * sinC);
    return [longitude * 180 / Math.PI, latitude * 180 / Math.PI];
  };
  for (const dir of city.dirs) {
    const shard = readShard(dir);
    for (let i = 0; i < shard.count; i++) {
      const gid = shard.gids[i];
      if (gid <= 0n) continue;
      const layerCode = Number(gid >> 23n);
      const layer = layerName(city.id, layerCode);
      layerCounts[layer] = (layerCounts[layer] || 0) + 1;
      const offset = i * D;
      let norm = 0;
      for (let j = 0; j < D; j++) norm += shard.embeddings[offset + j] ** 2;
      norm = Math.sqrt(norm) || 1;
      const score = [0, 0, 0];
      for (let j = 0; j < D; j++) {
        const value = shard.embeddings[offset + j] / norm - mean[j];
        score[0] += value * loadings[j * 3];
        score[1] += value * loadings[j * 3 + 1];
        score[2] += value * loadings[j * 3 + 2];
      }
      const color = [0, 0, 0];
      for (let k = 0; k < 3; k++) {
        const unit = Math.max(0, Math.min(1, (score[k] - low[k]) / (high[k] - low[k])));
        color[k] = Math.round(Math.pow(unit, 0.82) * 255);
      }
      const [longitude, latitude] = inverse(shard.meta[i * 6], shard.meta[i * 6 + 1]);
      if (longitude < west || longitude > east || latitude < south || latitude > north) continue;
      const px = Math.round((longitude - west) / (east - west) * (width - 1));
      const py = Math.round((north - latitude) / (north - south) * (height - 1));
      const radius = 5;
      const x0 = Math.max(0, px - radius), x1 = Math.min(width - 1, px + radius);
      const y0 = Math.max(0, py - radius), y1 = Math.min(height - 1, py + radius);
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const pixel = (y * width + x) * 4;
          pixels[pixel] = color[0];
          pixels[pixel + 1] = color[1];
          pixels[pixel + 2] = color[2];
          pixels[pixel + 3] = 240;
        }
      painted++;
    }
  }
  const imageFile = path.join(outputDir, `${city.folder}.webp`);
  await sharp(pixels, {raw: {width, height, channels: 4}})
    .webp({quality: 90, alphaQuality: 100, effort: 6})
    .toFile(imageFile);
  cityManifests.push({
    id: city.id, name: city.name, bounds, center, projection, zoom: city.zoom,
    image: `/visualizations/haina/${datasetId}/${city.folder}.webp`,
    width, height, samples: painted, shards: city.dirs.length, layers: layerCounts,
  });
  console.log(`${city.name}：${painted.toLocaleString()} 个多边形中心，${city.dirs.length} 个分片`);
}
const manifest = {
  version: 1,
  datasetId: `haina:${datasetId}`,
  name: "C40 landuse 嵌入数据集",
  snapshot: "2026-10-13",
  defaultCity: "shanghai-chn",
  embedding: {
    dimensions: D,
    method: "PCA",
    components: ["R", "G", "B"],
    variance,
    stretch: [0.02, 0.98],
    note: `三个城市共 ${total.toLocaleString()} 个多边形中心；每个点是一个多边形的投影中心，1024 维向量逐行 L2 归一化后取前三个主成分映射 R/G/B。点不表示完整多边形轮廓，颜色表示嵌入相对位置，不是土地利用类别。`,
  },
  cities: cityManifests,
  source: {
    datasetId,
    url: `https://cn.zero2x.org/data-hub/portal/dataset?id=${datasetId}`,
    license: "ODbL-1.0",
    licenseUrl: "https://opendatacommons.org/licenses/odbl/1-0/",
    provider: "地学数据组 · 之江实验室",
    source: "之江实验室-胡斌",
    files: cities.flatMap((city) => city.dirs.map((dir) =>
      `${city.folder}/shards/${path.basename(dir)}/{indices,meta,gids}.npy`)),
  },
};
const manifestText = JSON.stringify(manifest, null, 2) + "\n";
writeFileSync(path.join(outputDir, "manifest.json"), manifestText);
writeFileSync(path.join(root, "src", "data", "evidence", "haina-c40.json"), manifestText);
console.log(`写出 manifest（${cities.length} 个城市），PC 方差 ${variance.map((value) => (value * 100).toFixed(1) + "%").join(" / ")}`);
