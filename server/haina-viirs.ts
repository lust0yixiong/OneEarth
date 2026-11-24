import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";
import { promisify } from "node:util";
import type { RequestHandler } from "express";
import { hainaViirsRoute } from "./haina-public-layer-routes";

const run = promisify(execFile);
const digest = (data: Buffer) => createHash("sha256").update(data).digest("hex");
const fileName = "SVDNB_npp_20250801_20250831_Global_cog.tif";
const fileSize = 4_753_924_147;
const maxZoom = 8;
const cacheLimit = 32 * 1024 * 1024;
const jobsLimit = 64;
const concurrency = 4;
const numeric = /^-?(?:\d{1,3}(?:\.\d{0,17})?|\.\d{1,17})(?:e-\d{1,3})?$/i;

class Busy extends Error {}

type Job = { args: string[]; waiters: number; promise: Promise<Buffer>; resolve: (bytes: Buffer) => void; reject: (error: unknown) => void };

function rasterResults(python: string, source: string) {
  const pending = new Map<string, Job>();
  const queued: Job[] = [];
  const cached = new Map<string, Buffer>();
  let active = 0;
  let cachedBytes = 0;

  function remember(key: string, bytes: Buffer) {
    cached.set(key, bytes);
    cachedBytes += bytes.length;
    while (cachedBytes > cacheLimit || cached.size > 2048) {
      const first = cached.keys().next().value!;
      cachedBytes -= cached.get(first)!.length;
      cached.delete(first);
    }
  }

  function drain() {
    while (active < concurrency) {
      const job = queued.shift();
      if (!job) return;
      if (!job.waiters) {
        job.reject(new Error("VIIRS view changed"));
        continue;
      }
      active++;
      const script = resolve("scripts/haina-viirs-raster.py");
      void run(python, [script, source, ...job.args], {
        maxBuffer: 400_000, timeout: 12000, encoding: "buffer",
        env: { PATH: process.env.PATH, PYTHONPATH: process.env.ONEEARTH_VIIRS_PYTHONPATH, PYTHONDONTWRITEBYTECODE: "1" },
      }).then(({stdout}) => job.resolve(stdout), job.reject).finally(() => {
        active--;
        drain();
      });
    }
  }

  return async (args: string[], signal: AbortSignal): Promise<Buffer> => {
    signal.throwIfAborted();
    const key = args.join(",");
    const hit = cached.get(key);
    if (hit) {
      cached.delete(key);
      cached.set(key, hit);
      return hit;
    }
    let job = pending.get(key);
    if (!job) {
      if (pending.size >= jobsLimit) throw new Busy("VIIRS rendering queue full");
      let resolve!: Job["resolve"];
      let reject!: Job["reject"];
      const promise = new Promise<Buffer>((accept, fail) => { resolve=accept;reject=fail; });
      job = { args, waiters: 0, promise, resolve, reject };
      pending.set(key, job);
      void job.promise.then(bytes => remember(key, bytes), () => {}).finally(() => pending.delete(key));
      queued.push(job);
    }
    job.waiters++;
    const drop = () => { job.waiters--; };
    signal.addEventListener("abort", drop, {once:true});
    drain();
    try { return await job.promise; }
    finally {
      signal.removeEventListener("abort", drop);
      if (!signal.aborted) drop();
    }
  };
}

export function hainaViirs(): RequestHandler {
  const {ONEEARTH_VIIRS_MANIFEST: manifestPath, ONEEARTH_VIIRS_SOURCE: source, ONEEARTH_VIIRS_PYTHON: python} = process.env;
  if (!manifestPath || !source || !python) return (_req,res) => { res.status(404).json({error:"VIIRS 全球图层尚未发布。"}); };
  const manifest = readFileSync(manifestPath);
  const {datasetId, revision, tileSize, maxZoom: publishedMax} = JSON.parse(manifest.toString());
  if (datasetId!==1835833 || !/^[a-f0-9]{64}$/.test(revision) || tileSize!==256 || publishedMax!==maxZoom ||
      basename(source)!==fileName || statSync(source).size!==fileSize)
    throw new Error("VIIRS source and serving manifest mismatch");
  const results = rasterResults(python,source);
  const manifestETag = '"' + digest(manifest) + '"';

  return async (req,res) => {
    const route = hainaViirsRoute.exec(req.path)?.groups;
    if (!route) { res.sendStatus(404);return; }
    if (route.manifest) {
      res.set({ETag:manifestETag,"Cache-Control":"no-cache"});
      if (req.get("if-none-match")===manifestETag) { res.status(304).end();return; }
      res.type("application/json").end(manifest);
      return;
    }
    if ((route.tileRevision || route.sampleRevision)!==revision) {
      res.status(404).json({error:"VIIRS 发布修订不存在。"});return;
    }
    const controller = new AbortController();
    res.once("close", () => controller.abort());
    let args:string[];
    if (route.tileRevision) {
      const [z,x,y] = [route.z,route.x,route.y].map(Number);
      if (z>maxZoom || x>=2**(z+1) || y>=2**z || Object.keys(req.query).length) {
        res.status(400).json({error:"瓦片编号超出地理网格。"});return;
      }
      args = ["tile",String(z),String(x),String(y)];
    } else {
      const {lon,lat} = req.query;
      if (typeof lon!=="string" || typeof lat!=="string" || !numeric.test(lon) || !numeric.test(lat) ||
          Math.abs(Number(lon))>180 || Math.abs(Number(lat))>90 || Object.keys(req.query).length!==2) {
        res.status(400).json({error:"取值需要有效 WGS84 经度与纬度。"});return;
      }
      const longitude = Number(lon);
      args = ["sample","--",String(longitude===180 ? -180 : longitude),String(Number(lat))];
    }
    try {
      const body = await results(args,controller.signal);
      if (controller.signal.aborted) return;
      const etag = '"' + digest(body) + '"';
      res.set({ETag:etag,"Cache-Control":route.tileRevision?"public, max-age=31536000, immutable":"public, max-age=300"});
      if (req.get("if-none-match")===etag) { res.status(304).end();return; }
      res.type(route.tileRevision?"image/png":"application/json").end(body);
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error instanceof Busy) res.set("Retry-After","1");
      res.status(503).json({error:error instanceof Busy?"VIIRS 绘图繁忙，请重试。":"VIIRS 栅格暂不可读。"});
    }
  };
}
