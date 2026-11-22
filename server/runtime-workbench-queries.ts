import express from "express";
import path from "node:path";
import { assets, observationAssets, registerHaina, registerObservations, replacePublishedPapers } from "../src/domain/datasets";
import { cases, resources } from "../src/domain/catalog";
import { validHainaRecord, type HainaRecord } from "../src/domain/haina-record";
import { paperId, validPaperRecord, type PaperRecord } from "../src/domain/paper-record";
import { constellationService, parseSources } from "./constellations";
import { dataAccessIndex, dataAccessRouter } from "./data-access";
import type { HainaCatalogPage, PaperQuery, PaperQueryOutput } from "./discovery-materials-contract";
import { researchPdf } from "./research-pdf";
import { spatialProxy } from "./spatial-proxy";

type ReadPaperPage = (input: Extract<PaperQuery, { operation: "list" }>, signal: AbortSignal) => Promise<PaperQueryOutput["list"]>;
type ReadHainaPage = (cursor: number, limit: number, signal: AbortSignal) => Promise<HainaCatalogPage>;

/** Keep a derived search index. Discovery remains the publisher of the paper catalogue. */
export function paperCatalogueProjection(read: ReadPaperPage, publish: (records: PaperRecord[]) => void, now = Date.now) {
  let checkedAt = 0;
  let revision: string | undefined;
  let refreshing: Promise<void> | undefined;
  async function refresh() {
    const signal = AbortSignal.timeout(12_000);
    const head = await read({ operation: "list", view: "catalog", cursor: "", limit: 1 }, signal);
    const current = head.catalog.revision;
    if (!current) throw Error("论文目录的发布版本不可核对。");
    if (current === revision) {
      checkedAt = now();
      return;
    }
    const records: PaperRecord[] = [];
    const keys = new Set<string>();
    const cursors = new Set<string>([""]);
    let cursor = "";
    while (true) {
      const page = await read({ operation: "list", view: "catalog", cursor, limit: 500 }, signal);
      if (page.catalog.revision !== current || page.total !== head.total) {
        throw Error("论文目录在分页期间更新，请重新读取。");
      }
      for (const row of page.records) {
        if (!validPaperRecord(row) || keys.has(row.dsKey)) throw Error("论文目录分页包含无效或重复记录。");
        keys.add(row.dsKey);
        records.push(row);
      }
      if (page.nextCursor === null) break;
      if (!page.records.length || cursors.has(page.nextCursor) || records.length >= head.total) {
        throw Error("论文目录分页未推进。");
      }
      cursor = page.nextCursor;
      cursors.add(cursor);
    }
    if (records.length !== head.total) throw Error("论文目录未完整读取。");
    publish(records);
    revision = current;
    checkedAt = now();
  }
  return async () => {
    if (revision && now() - checkedAt < 2_000) return;
    refreshing ??= refresh().finally(() => { refreshing = undefined; });
    return refreshing;
  };
}

export function hainaCatalogueProjection(read: ReadHainaPage, publish: (records: HainaRecord[], synced: string, endpoint: string) => void = registerHaina, now = Date.now) {
  let checkedAt = 0;
  let revision: string | undefined;
  let refreshing: Promise<void> | undefined;
  async function refresh() {
    const signal = AbortSignal.timeout(12_000);
    const head = await read(0, 1, signal);
    const current = JSON.stringify([head.synced, head.endpoint, head.areaId]);
    if (current === revision) {
      checkedAt = now();
      return;
    }
    const records: HainaRecord[] = [];
    const ids = new Set<number>();
    let cursor = 0;
    while (true) {
      const page = await read(cursor, 250, signal);
      if (page.synced !== head.synced || page.total !== head.total || page.endpoint !== head.endpoint || page.areaId !== head.areaId) {
        throw Error("海纳目录在分页期间更新，请重新读取。");
      }
      for (const row of page.records) {
        if (!validHainaRecord(row) || row.id <= cursor || ids.has(row.id)) throw Error("海纳目录分页包含无效或重复记录。");
        ids.add(row.id);
        records.push(row);
      }
      if (page.nextCursor === null) break;
      if (!page.records.length || page.nextCursor <= cursor || records.length >= head.total) throw Error("海纳目录分页未推进。");
      cursor = page.nextCursor;
    }
    if (records.length !== head.total) throw Error("海纳目录未完整读取。");
    publish(records, head.synced, head.endpoint);
    revision = current;
    checkedAt = now();
  }
  return async () => {
    if (!revision || now() - checkedAt >= 2_000) {
      refreshing ??= refresh().finally(() => { refreshing = undefined; });
      await refreshing;
    }
    return revision ?? "";
  };
}

export function runtimeWorkbenchQueries(state: string, readPapers: ReadPaperPage, readHaina: ReadHainaPage) {
  const router = express.Router();
  const spatial = spatialProxy(process.env.ONEEARTH_SPATIAL_URL || "http://127.0.0.1:5276");
  router.use(["/api/coverage", "/api/spatial"], spatial);

  const sources = parseSources(process.env.ONEEARTH_PUSH_SOURCES);
  const observations = constellationService(process.env.ONEEARTH_OBSERVATION_DB || path.join(state, "observations.sqlite"), sources);
  router.use("/api/constellations", observations.router);
  const index = dataAccessIndex(path.join(state, "data-access.sqlite"));
  let paperVersion = 0;
  const pullPapers = paperCatalogueProjection(readPapers, records => {
    replacePublishedPapers(records);
    paperVersion++;
  });
  const pullHaina = hainaCatalogueProjection(readHaina);
  router.get("/api/catalog", async (_req, res) => {
    try {
      await Promise.all([pullPapers(), pullHaina()]);
      registerObservations(observations.latest().records, true);
      const published = new Set(assets.filter(asset => paperId(asset.id)).map(asset => asset.id));
      res.json({ cases, resources: [...resources.filter(resource => !paperId(resource.id) || published.has(resource.id)), ...observationAssets()] });
    } catch {
      res.status(503).json({ error: "数据索引暂时无法读取，请重试。" });
    }
  });
  router.get("/api/haina/catalog", async (req, res) => {
    const cursor = Number(req.query.cursor || 0);
    const limit = Number(req.query.limit || 250);
    if (!Number.isSafeInteger(cursor) || cursor < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 250) {
      res.status(400).json({error:"海纳目录分页参数无效。"});
      return;
    }
    const controller = new AbortController();
    const close = () => {if (!res.writableEnded) controller.abort();};
    res.once("close", close);
    try { res.set("Cache-Control", "no-store").json(await readHaina(cursor, limit, controller.signal)); }
    catch (error) {
      if (!controller.signal.aborted) res.status(502).json({error:error instanceof Error ? error.message : "海纳目录读取失败。"});
    } finally { res.off("close", close); }
  });
  router.use("/api/research-record", researchPdf());
  let indexedPaperVersion = -1;
  let observationVersion = "";
  let hainaRevision = "";
  router.use("/api/data-access", express.json({ limit: "8mb" }), dataAccessRouter(index, async () => {
    const [, currentHaina] = await Promise.all([pullPapers(), pullHaina()]);
    const currentObservations = observations.version();
    if (paperVersion === indexedPaperVersion && currentObservations === observationVersion && currentHaina === hainaRevision) return;
    index.replace(assets, observations.catalogRecords());
    indexedPaperVersion = paperVersion;
    observationVersion = currentObservations;
    hainaRevision = currentHaina;
  }, observations.status));
  const errors: express.ErrorRequestHandler = (error, _req, res, next) => {
    if (res.headersSent) { next(error); return; }
    if (error?.type === "entity.too.large") res.status(413).json({ error: "推送内容超过大小限制。" });
    else if (error instanceof SyntaxError) res.status(400).json({ error: "请求内容无效，请重新提交。" });
    else res.status(500).json({ error: "服务暂时无法完成请求。" });
  };
  router.use(errors);
  return router;
}
