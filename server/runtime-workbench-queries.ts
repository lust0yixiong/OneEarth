import express from "express";
import type {AccessCatalogues, CatalogueProjectionStatus} from "../src/domain/data-access";
import path from "node:path";
import { assets, observationAssets, registerHaina, registerObservations, replacePublishedPapers } from "../src/domain/datasets";
import { cases, resources } from "../src/domain/catalog";
import { validHainaRecord, type HainaRecord } from "../src/domain/haina-record";
import { paperId, validPaperRecord, type PaperRecord } from "../src/domain/paper-record";
import type { constellationService } from "./constellations";
import { dataAccessIndex, dataAccessRouter } from "./data-access";
import type { HainaCatalogPage, PaperQuery, PaperQueryOutput } from "./discovery-materials-contract";
import { researchPdf } from "./research-pdf";
import { spatialProxy } from "./spatial-proxy";

type ReadPaperPage = (input: Extract<PaperQuery, { operation: "list" }>, signal: AbortSignal) => Promise<PaperQueryOutput["list"]>;
type ReadHainaPage = (cursor: number, limit: number, signal: AbortSignal) => Promise<HainaCatalogPage>;

/** Keep a derived search index. Discovery remains the publisher of the paper catalogue. */
export function paperCatalogueProjection(read: ReadPaperPage, publish: (records: PaperRecord[]) => void, now = Date.now, timing = {pageMs:12_000,totalMs:120_000}) {
  let checkedAt = 0;
  let revision: string | undefined;
  let refreshing: Promise<void> | undefined;
  let total:number|undefined,failed=false;
  const shutdown=new AbortController();
  async function refresh() {
    const deadline=AbortSignal.any([shutdown.signal,AbortSignal.timeout(timing.totalMs)]);
    const pageRead=(input:Extract<PaperQuery,{operation:"list"}>)=>read(input,AbortSignal.any([deadline,AbortSignal.timeout(timing.pageMs)]));
    const head = await pageRead({ operation: "list", view: "catalog", cursor: "", limit: 1 });
    const current = head.catalog.revision;
    if (!current || !Number.isSafeInteger(head.total) || head.total<0) throw Error("论文目录的发布版本不可核对。");
    if (current === revision) {
      if(head.total!==total)throw Error("相同目录版本的总数不一致。");
      checkedAt = now();
      return;
    }
    const records: PaperRecord[] = [];
    const keys = new Set<string>();
    const cursors = new Set<string>([""]);
    let cursor = "";
    while (true) {
      const page = await pageRead({ operation: "list", view: "catalog", cursor, limit: 500 });
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
    total=head.total;
    checkedAt = now();
  }
  const pull=async () => {
    if (revision && now() - checkedAt < 2_000) return;
    refreshing ??= refresh().then(()=>{failed=false;},error=>{failed=true;throw error;}).finally(() => { refreshing = undefined; });
    return refreshing;
  };
  return Object.assign(pull,{close:()=>shutdown.abort(),status:():CatalogueProjectionStatus=>({state:failed?(revision?"stale":"unavailable"):refreshing?"refreshing":revision?"ready":"unavailable",revision,total,checkedAt:checkedAt?new Date(checkedAt).toISOString():undefined,
    ...(failed?{warning:"论文目录刷新失败；仅保留已完整取得的目录版本，未确认当前发布。"}:{})})});
}

export function hainaCatalogueProjection(read: ReadHainaPage, publish: (records: HainaRecord[], synced: string, endpoint: string) => void = registerHaina, now = Date.now) {
  let checkedAt = 0;
  let revision: string | undefined;
  let refreshing: Promise<void> | undefined;
  let total:number|undefined,failed=false;
  const shutdown=new AbortController();
  async function refresh() {
    const signal = AbortSignal.any([shutdown.signal,AbortSignal.timeout(12_000)]);
    const head = await read(0, 1, signal);
    const current = JSON.stringify([head.synced, head.endpoint, head.areaId]);
    if (current === revision) {
      if(head.total!==total)throw Error("相同目录版本的总数不一致。");
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
    total=head.total;
    checkedAt = now();
  }
  const pull=async () => {
    if (!revision || now() - checkedAt >= 2_000) {
      refreshing ??= refresh().then(()=>{failed=false;},error=>{failed=true;throw error;}).finally(() => { refreshing = undefined; });
      await refreshing;
    }
    return revision ?? "";
  };
  return Object.assign(pull,{close:()=>shutdown.abort(),status:():CatalogueProjectionStatus=>({state:failed?(revision?"stale":"unavailable"):refreshing?"refreshing":revision?"ready":"unavailable",revision,total,checkedAt:checkedAt?new Date(checkedAt).toISOString():undefined,
    ...(failed?{warning:"海纳目录刷新失败；仅保留已完整取得的目录版本，未确认当前发布。"}:{})})});
}

export function runtimeWorkbenchQueries(state: string, readPapers: ReadPaperPage, readHaina: ReadHainaPage,
  observations: ReturnType<typeof constellationService>) {
  const router = express.Router();
  const spatial = spatialProxy(process.env.ONEEARTH_SPATIAL_URL || "http://127.0.0.1:5276");
  router.use(["/api/coverage", "/api/spatial"], spatial);

  router.use("/api/constellations", observations.router);
  const index = dataAccessIndex(path.join(state, "data-access.sqlite"));
  let paperVersion=0,indexedPaperVersion=-1,observationVersion="",hainaRevision="";
  const pullPapers=paperCatalogueProjection(readPapers,records=>{replacePublishedPapers(records);paperVersion++;});
  const pullHaina=hainaCatalogueProjection(readHaina);
  let job:Promise<void>|undefined,lastAttempt=0,stopped=false,indexFailed=false;
  function status():AccessCatalogues{
    const indexed=index.snapshot();
    function source(name:"paper"|"haina",live:CatalogueProjectionStatus):CatalogueProjectionStatus{
      const served=indexed?.[name],hasPublished=!!served?.revision;
      const ready=hasPublished&&live.revision===served.revision;
      const failed=indexFailed||live.state==="stale"||live.state==="unavailable"&&!job;
      return {revision:served?.revision,total:served?.total,checkedAt:served?.checkedAt,state:failed?(hasPublished?"stale":"unavailable"):job||!ready?(hasPublished?"refreshing":"unavailable"):"ready",
        ...(ready&&live.checkedAt?{checkedAt:live.checkedAt}:{}),
        ...((failed||!hasPublished)?{warning:hasPublished?"目录更新暂不可用，继续显示上次完整版本。":"此来源目录尚未完整就绪；当前列表不代表完整发布。"}:{})};
    }
    return {paper:source("paper",pullPapers.status()),haina:source("haina",pullHaina.status())};
  }
  async function update(){
    await Promise.allSettled([pullPapers(),pullHaina()]);
    if(stopped)return;
    const currentObservations=observations.version(),currentHaina=pullHaina.status().revision||"";
    if(paperVersion===indexedPaperVersion&&currentObservations===observationVersion&&currentHaina===hainaRevision)return;
    const live={paper:pullPapers.status(),haina:pullHaina.status()},prior=index.snapshot();
    function committed(value:CatalogueProjectionStatus):CatalogueProjectionStatus{return {state:value.revision?"ready":"unavailable",revision:value.revision,total:value.total,checkedAt:value.checkedAt};}
    const stamp:AccessCatalogues={paper:committed(live.paper.revision?live.paper:prior?.paper||live.paper),haina:committed(live.haina.revision?live.haina:prior?.haina||live.haina)};
    const preserve=[...(!live.paper.revision?["paper"]:[]),...(!live.haina.revision?["haina"]:[])];
    // Never persist transient errors as successful publication identities.
    await index.replaceAsync([...assets],[...observations.catalogRecords()],stamp,preserve);
    indexedPaperVersion=paperVersion;observationVersion=currentObservations;hainaRevision=currentHaina;indexFailed=false;
  }
  function refresh(){
    if(stopped||job||Date.now()-lastAttempt<2_000)return;
    lastAttempt=Date.now();
    job=update().catch(()=>{indexFailed=true;}).finally(()=>{job=undefined;});
  }
  // Small bundled/public entries remain usable while a first publisher scan runs.
  // A persisted complete generation is never overwritten by this bootstrap.
  if(!index.initialized())index.replace(assets,observations.catalogRecords());
  refresh();
  const timer=setInterval(refresh,30_000);timer.unref();
  router.get("/api/catalog", (_req,res)=>{
    refresh();registerObservations(observations.latest().records,true);
    const published=new Set(assets.filter(asset=>paperId(asset.id)).map(asset=>asset.id));
    res.set("Cache-Control","no-store").json({cases,resources:[...resources.filter(resource=>!paperId(resource.id)||published.has(resource.id)),...observationAssets()],catalogues:{paper:pullPapers.status(),haina:pullHaina.status()}});
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
  router.use("/api/data-access",express.json({limit:"8mb"}),dataAccessRouter(index,refresh,observations.status,status));
  const errors: express.ErrorRequestHandler = (error, _req, res, next) => {
    if (res.headersSent) { next(error); return; }
    if (error?.type === "entity.too.large") res.status(413).json({ error: "推送内容超过大小限制。" });
    else if (error instanceof SyntaxError) res.status(400).json({ error: "请求内容无效，请重新提交。" });
    else res.status(500).json({ error: "服务暂时无法完成请求。" });
  };
  router.use(errors);
  return {router,close:()=>{stopped=true;clearInterval(timer);pullPapers.close();pullHaina.close();index.close();}};
}
