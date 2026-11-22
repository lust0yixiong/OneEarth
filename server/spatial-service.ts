import express from "express";
import path from "node:path";
import { coverageIndex, coverageScope } from "./coverage-index";
import { coverageRouter } from "./coverage-router";
import { coveragePublication, loadSpatialPaperPublication, pollSpatialPaperPublication } from "./coverage-publication";
import { spatialPaperStore } from "./spatial-paper-store";
import { coverageCellBounds } from "./spatial-paper-bounds";
import { paperId } from "../src/domain/paper-record";
import { emptyFilters } from "../src/domain/spatial";
import { regionRecords } from "../src/domain/product-distribution";
import { accessGuard } from "./access";
import { layerObjects, spatialStore, type Bounds } from "./spatial-store";

const index = await spatialStore();
const objects = layerObjects();
const postgis = await index.version();
const app = express();
app.disable("x-powered-by");
app.use(accessGuard());
app.use((_req,res,next)=>{res.set("X-OneEarth-Service","spatial");next();});
const state = process.env.ONEEARTH_STATE_DIR || path.resolve(".local/state");
const papers = await spatialPaperStore();
const publication = coveragePublication();
await loadSpatialPaperPublication(papers, publication);
pollSpatialPaperPublication(papers, publication);
const coverage = coverageIndex(process.env.ONEEARTH_COVERAGE_DB || path.join(state,"spatial-coverage.sqlite"));
void coverage.warm(coverageScope(regionRecords(emptyFilters())).geometries).catch(()=>{
  console.error("OneEarth spatial coverage warm failed");
});
app.use("/api/coverage", express.json({ limit: "2mb" }), coverageRouter(coverage, {
  ...publication,
  paperCandidates(generation, filters, batch, grid, cells) {
    if (filters.source && filters.source !== "paper") return Promise.resolve([]);
    const ids = batch ? batch.ids.filter(paperId) : null;
    if (ids && !ids.length) return Promise.resolve([]);
    return papers.candidates(generation, ids, coverageCellBounds(grid, cells), filters);
  },
}));
app.get("/api/health", (_req,res) => res.json({
  status:"ok",service:"spatial",engine:index.engine,postgis,objects:objects.backend,
  paperProjection: publication.head(),
}));
app.get("/api/spatial/layers", async (_req,res) => res.json(await index.layers()));
function date(value:unknown):value is string {
  return typeof value==="string" && /^\d{4}-\d\d-\d\d$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10)===value;
}
app.get("/api/spatial/layers/:layer/chunks", async (req,res) => {
  const [w,s,e,n,...rest] = String(req.query.bbox || "").split(",").map(Number);
  const {start,end} = req.query;
  const level = Number(req.query.level);
  if (!date(start) || !date(end) || start>end || ![0,1,2].includes(level) || rest.length ||
    ![w,s,e,n].every(Number.isFinite) || w===e || Math.abs(w)>180 || Math.abs(e)>180 || s< -90 || n>90 || s>=n) {
    res.status(400).json({error:"图层查询需要有效的 bbox、时段与尺度。"}); return;
  }
  const bounds:Bounds=[w,s,e,n];
  res.json({chunks:await index.chunks(req.params.layer,start,end,level,bounds)});
});
app.get([/^\/precip-data\//,/^\/visualizations\/haina\/(?:1846764|1846639)\//], async (req,res) => {
  const row = await index.object(req.path);
  if (!row) {res.status(404).json({error:"图层对象不存在。"});return;}
  const etag='"'+row.hash+'"';
  const cached=!req.path.endsWith(".json");
  res.set({ETag:etag,"Cache-Control":cached?"public, max-age=86400":"no-cache"});
  if (req.headers["if-none-match"]===etag) {res.status(304).end();return;}
  const bytes=await objects.read(row.hash);
  if (bytes.length!==row.size) {res.status(502).json({error:"图层对象校验失败。"});return;}
  res.type(row.media).set("Content-Length",String(bytes.length)).end(bytes);
});
app.use((_error:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{
  res.status(503).json({error:"图层索引或对象存储暂不可用。"});
});
const port=Number(process.env.ONEEARTH_SPATIAL_PORT || 5276);
app.listen(port,"127.0.0.1",()=>console.log("OneEarth spatial listening on "+port));
