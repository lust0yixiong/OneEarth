import {literatureDisplay} from "../src/domain/literature-label";
import { registerPapers, catalogRevision } from "../src/domain/datasets";
import { gzipSync } from "node:zlib";
import { Router } from "express";
import { paperId, paperCatalogSummary, paperMapSummary } from "../src/domain/paper-record";
import { searchPapers, type paperCache } from "./earthnano";
import { configuredAssertionReader } from "./assertion-postgres";

export function paperCatalog(cache: ReturnType<typeof paperCache>, lookup = searchPapers) {
  const router = Router();
  const pages=new Map<string,Buffer>();
  const evidenceCache=new Map<string,{time:number;data:unknown}>();
  router.get("/:id/evidence",async(req,res)=>{
    const record=paperId(req.params.id)?cache.get(req.params.id):undefined;
    if(!record){res.sendStatus(404);return;}
    const reader=configuredAssertionReader();
    if(!reader){res.status(503).json({error:"论文原文连接暂未配置"});return;}
    const cached=evidenceCache.get(record.id);
    if(cached && Date.now()-cached.time<600000){res.json(cached.data);return;}
    const identities=(record.need.tabs.find(t=>t.label==="论文用法（本页）")?.rows||[])
      .flatMap(row=>typeof row[4]==="string" && typeof row[5]==="string"?[{paperId:row[4],datasetId:row[5]}]:[]);
    try{
      const data=await reader.evidence(record.dsKey,identities);
      evidenceCache.set(record.id,{time:Date.now(),data});
      if(evidenceCache.size>128)evidenceCache.delete(evidenceCache.keys().next().value!);
      res.set("Cache-Control","no-store").json(data);
    }catch{res.status(503).json({error:"论文摘要与原文暂时无法读取"});}
  });
  router.get("/:id/questions",async(req,res)=>{
    const record=paperId(req.params.id)?cache.get(req.params.id):undefined;
    const cursor=req.query.cursor||"";
    if(!record || typeof cursor!=="string" || cursor.length>3000){res.sendStatus(400);return;}
    const reader=configuredAssertionReader();
    if(!reader){res.status(503).json({error:"论文研究数据连接暂未配置。"});return;}
    try{res.set("Cache-Control","no-store").json(await reader.questions(record.dsKey,cursor));}
    catch{res.status(503).json({error:"论文研究问题暂时无法读取，请重试。"});}
  });
  router.get("/", (req,res) => {
    res.set("Cache-Control", "no-store");
    if (req.query.ids === undefined) {
      const cursor=req.query.cursor ?? "",limit=Number(req.query.limit ?? 250);
      if (typeof cursor!=="string" || cursor.length>1000 || !Number.isInteger(limit) || limit<1 || limit>500) {res.sendStatus(400);return;}
      const view=req.query.view==="map"?"map":req.query.view==="catalog"?"catalog":"full";
      const page=()=>{const value=cache.page(cursor,limit);return view==="full"?value:{...value,records:value.records.map(view==="map"?paperMapSummary:paperCatalogSummary)};};
      if(req.acceptsEncodings("gzip")) {
        const key=JSON.stringify([catalogRevision(),cache.dataVersion(),cursor,limit,view]);
        let compressed=pages.get(key);
        if(!compressed){compressed=gzipSync(JSON.stringify(literatureDisplay(page())),{level:1});pages.set(key,compressed);if(pages.size>128)pages.delete(pages.keys().next().value!);}
        res.vary("Accept-Encoding").type("application/json").set("Content-Encoding","gzip").send(compressed);
      } else res.json(literatureDisplay(page()));
      return;
    }
    const ids = typeof req.query.ids === "string" ? req.query.ids.split(",") : [];
    if (!ids.length || ids.length>20 || !ids.every(paperId)) { res.sendStatus(400); return; }
    res.json(literatureDisplay(ids.flatMap(id => cache.get(id) || [])));
  });
  router.post("/search", async (req,res) => {
    if (!req.is("application/json")) {res.sendStatus(415);return;}
    const query = req.body?.query;
    if (typeof query!=="string" || !query.trim() || query.trim().length>240) {res.status(400).json({error:"请输入数据集名称或 DOI（不超过 240 字）。"});return;}
    const controller = new AbortController();
    res.once("close", () => {if (!res.writableEnded) controller.abort();});
    try {
      const hit = await lookup({name:query.trim(), facets:[], region:[]},controller.signal,()=>{});
      cache.saveBatch(hit.records);
      registerPapers(hit.records);
      res.set("Cache-Control","no-store").json({records:literatureDisplay(hit.records),cached:false,incomplete:hit.incomplete});
    } catch (error) {
      if (!controller.signal.aborted) res.status(503).json({error:"文献资料查询未完成，请重试。",records:[]});
    }
  });
  return router;
}
