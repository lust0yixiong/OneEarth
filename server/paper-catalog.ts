import {gzipSync} from "node:zlib";
import {Router, type Response} from "express";
import {paperCatalogAccess, PaperCatalogError, type PaperCatalogAccess} from "./paper-catalog-access";

function respondError(res: Response, error: unknown, search = false) {
  if (!(error instanceof PaperCatalogError)) throw error;
  if (!error.message) {res.sendStatus(error.status);return;}
  res.status(error.status).json({error:error.message,...(search && error.status === 503 ? {records:[]} : {})});
}

export function paperCatalog(cache: Parameters<typeof paperCatalogAccess>[0],
  lookup?: NonNullable<Parameters<typeof paperCatalogAccess>[1]>["lookup"]) {
  return paperCatalogRoutes(paperCatalogAccess(cache,{lookup}));
}

export function paperCatalogRoutes(catalog: PaperCatalogAccess) {
  const router = Router();
  const pages = new Map<string,Buffer>();
  router.get("/:id/evidence",async (req,res) => {
    try {
      const {data,cached} = await catalog.evidence(req.params.id);
      if (!cached) res.set("Cache-Control","no-store");
      res.json(data);
    } catch (error) {respondError(res,error);}
  });
  router.get("/:id/questions",async (req,res) => {
    try {res.set("Cache-Control","no-store").json(await catalog.questions(req.params.id,req.query.cursor || ""));}
    catch (error) {respondError(res,error);}
  });
  router.get("/", (req,res) => {
    res.set("Cache-Control","no-store");
    try {
      if (req.query.ids !== undefined) {
        res.json(catalog.batch(typeof req.query.ids === "string" ? req.query.ids.split(",") : []));
        return;
      }
      const page = catalog.page(req.query);
      if (!req.acceptsEncodings("gzip")) {res.json(page.read());return;}
      let compressed = pages.get(page.cacheKey);
      if (!compressed) {
        compressed = gzipSync(JSON.stringify(page.read()),{level:1});
        pages.set(page.cacheKey,compressed);
        if (pages.size > 128) pages.delete(pages.keys().next().value!);
      }
      res.vary("Accept-Encoding").type("application/json").set("Content-Encoding","gzip").send(compressed);
    } catch (error) {respondError(res,error);}
  });
  router.post("/search",async (req,res) => {
    if (!req.is("application/json")) {res.sendStatus(415);return;}
    const controller = new AbortController();
    res.once("close", () => {if (!res.writableEnded) controller.abort();});
    try {
      const data = await catalog.search(req.body?.query,controller.signal);
      res.set("Cache-Control","no-store").json(data);
    } catch (error) {
      if (!controller.signal.aborted) respondError(res,error,true);
    }
  });
  return router;
}
