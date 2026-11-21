import { releaseVersion } from "./version";
import {dataAccessIndex,dataAccessRouter} from "./data-access";
import {hainaService} from "./haina-search";
import {earthquakeDay,seismicStations} from "./earthquakes";
import {weatherStations} from "./weather-stations";
import {worldLightning} from "./world-lightning";
import {lightning} from "./lightning";

import {researchPdf} from "./research-pdf";
import {administrativeOrientation} from "./admin-orientation";
import { deepSeekKey, serviceModels, setServiceKey } from "./model-service";
import { paperCache } from "./earthnano";
import { mkdirSync } from "node:fs";
import { accessGuard } from "./access";
import { staticAssets } from "./static-assets";
import { listModels } from "./model-list";
import { randomUUID } from "node:crypto";
import { runExecutor } from "./executor";
import { validChatModel } from "../src/domain/chat-model";
import {chatHomeSettings} from "./chat-home";
import {sourcePreview} from "./source-preview";
import { simulationGrid } from "./simulation-grid";
import { constellationService, parseSources } from "./constellations";
import { assets, assetById, registerObservations, registerPapers, observationAssets, subscribeCatalog } from "../src/domain/datasets";
import { spatialProxy } from "./spatial-proxy";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import { decodeWind, installWindData } from "../src/domain/wind";
import { cases, resources } from "../src/domain/catalog";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (existsSync(path.join(root, ".env")))
  process.loadEnvFile(path.join(root, ".env"));
const distDir=process.env.ONEEARTH_DIST_DIR || path.join(root,"dist");
const stateDir=process.env.ONEEARTH_STATE_DIR||path.join(root,".local");
const dataDir =
  process.env.ONEEARTH_DATA_DIR ||
  path.resolve(root, "../产品设计/prototype/oneearth-data-globe/dist");
const windFile = path.join(root, "public/visualizations/gfs/wind.bin");
if (existsSync(windFile)) {
  const bytes = readFileSync(windFile);
  installWindData(
    decodeWind(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    ),
  );
}
const app = express();
app.use(accessGuard(process.env.ONEEARTH_ALLOWED_HOSTS));
app.use("/api/simulation-grid", simulationGrid(path.join(dataDir,"grid-data")));
app.disable("x-powered-by");
app.use("/api/orientation",administrativeOrientation(process.env.ONEEARTH_ADMIN_BOUNDARY_DIR || path.join(root,".local","admin-boundaries"),
  {baseUrl:process.env.ONEEARTH_ADMIN_BOUNDARIES_URL}));
const pushSources = parseSources(process.env.ONEEARTH_PUSH_SOURCES);
const push = constellationService(process.env.ONEEARTH_OBSERVATION_DB || path.join(stateDir, "observations.sqlite"), pushSources);
app.use("/api/constellations",push.router);
app.use(["/api/tasks","/api/results"],spatialProxy(process.env.ONEEARTH_RUNTIME_URL || "http://127.0.0.1:5277"));
const geo = spatialProxy(process.env.ONEEARTH_SPATIAL_URL || "http://127.0.0.1:5276");
app.use(["/api/coverage","/api/spatial","/precip-data","/visualizations/haina/1846764","/visualizations/haina/1846639"],geo);
app.use("/api/data-access",express.json({limit:"8mb"}));
app.get("/api/lightning/world",worldLightning(path.join(root,".local","lightning")));
app.get("/api/lightning", lightning);
app.get("/api/earthquakes/day",earthquakeDay);
app.get("/api/earthquakes/stations",seismicStations);
app.get("/api/weather/stations",weatherStations);

app.use("/api/research-record",researchPdf());
// Leave room for the bounded source identity, web and assertion evidence memories.
app.use("/api/paper-records",spatialProxy(process.env.ONEEARTH_DISCOVERY_URL || "http://127.0.0.1:5275"));
app.use(express.json({ limit: "192kb" }));
mkdirSync(stateDir, {recursive:true});
app.use("/api/settings/chat-home",chatHomeSettings(path.join(stateDir,"chat-home.json")));
app.use("/api/source-preview",sourcePreview(path.join(stateDir,"source-preview")));
const cachedPapers = paperCache(path.join(stateDir,"paper-evidence.sqlite"));
const haina=hainaService(path.join(stateDir,"haina-catalog.json"),{publicDir:path.join(root,"public")});
haina.start();
app.get("/api/haina/catalog",async(req,res)=>{
  const cursor=Number(req.query.cursor||0),limit=Number(req.query.limit||250);
  if(!Number.isSafeInteger(cursor)||cursor<0||!Number.isSafeInteger(limit)||limit<1||limit>250){res.status(400).json({error:"海纳目录分页参数无效。"});return;}
  try{res.set("Cache-Control","no-store").json(await haina.page(cursor,limit));}
  catch(error){res.status(502).json({error:error instanceof Error?error.message:"海纳目录读取失败。"});}
});
registerPapers(cachedPapers.list());
registerObservations(push.latest().records,true);
const accessIndex=dataAccessIndex(path.join(stateDir,"data-access.sqlite"));
let accessDirty=true;
let accessObservationVersion="";
subscribeCatalog(()=>{accessDirty=true;});
app.use("/api/data-access",dataAccessRouter(accessIndex,()=>{
  const version=push.version();
  if(accessDirty||version!==accessObservationVersion){accessIndex.replace(assets,push.catalogRecords());accessDirty=false;accessObservationVersion=version;}
},push.status));
app.get("/api/health", (_req, res) =>
  res.json({
    status: "ok",
    mode: "oneearth-next",
    version: releaseVersion,
    sources: { constellationPush: Object.keys(pushSources).length, earthSearch: "collection-snapshot-and-live-item-search" },
    cases: cases.length,
    verifiedCases: cases.filter((c) => c.verified).length,
    spatialDataReady: existsSync(path.join(dataDir, "s2-data/manifest.json")),
  }),
);
app.get("/api/catalog", (_req, res) => {
  registerObservations(push.latest().records,true);
  res.json({cases,resources:[...resources,...observationAssets()]});
});
app.use(["/api/chat","/api/models"],(req,res,next)=>{
  if (req.method==="POST" && !req.is("application/json")) {
    res.status(403).json({error:"请通过 OneEarth 页面提交模型请求。"}); return;
  }
  next();
});
app.post("/api/models/service/:action",async(req,res)=>{
  const {config,key}=req.body || {};
  if (!validChatModel(config) || !config.provider || config.provider==="native") {res.status(400).json({error:"请核对模型服务地址。"});return;}
  if(req.params.action==="key" && typeof key==="string" && key.trim() && key.length<8192 && !/[\r\n]/.test(key)){
    setServiceKey(config,key.trim());res.json({ok:true});return;
  }
  if(req.params.action!=="list"){res.status(400).json({error:"无效的服务设置。"});return;}
  try {res.set("Cache-Control","no-store").json({models:await serviceModels(config)});}
  catch(err){res.status(502).json({error:err instanceof Error?err.message:"无法读取模型清单。"});}
});
app.get("/api/models/deepseek/tools", (_req,res) => res.set("Cache-Control","no-store").json({
  configured:!!deepSeekKey(),
  defaults:{search:process.env.ONEEARTH_DEEPSEEK_SEARCH==="true",fetch:process.env.ONEEARTH_DEEPSEEK_FETCH==="true"},
}));
app.get("/api/models/:executor",async(req,res)=>{
  const executor=req.params.executor;
  if(executor!=="codex" && executor!=="claude"){res.status(400).json({error:"未知执行器。"});return;}
  try {res.set("Cache-Control","no-store").json({models:await listModels(executor)});}
  catch(err){res.status(502).json({error:err instanceof Error?err.message:"无法读取模型列表。"});}
});
app.post("/api/models/test",async(req,res)=>{
  const config=req.body;
  if(!validChatModel(config)){res.status(400).json({error:"模型配置无效。"});return;}
  const controller=new AbortController();
  res.once("close",()=>{if(!res.writableEnded)controller.abort();});
  try {
    const token="OneEarth-"+randomUUID().slice(0,8);
    const start=Date.now();
    const reply=await runExecutor(config,"Reply with exactly this text: "+token,controller.signal);
    if(!reply.includes(token))throw Error("执行器已响应，但回复未通过连接校验。");
    res.json({elapsedMs:Date.now()-start});
  } catch(err){if(!controller.signal.aborted)res.status(502).json({error:err instanceof Error?err.message:"连接失败。"});}
});
app.use("/grid-data", express.static(path.join(dataDir, "grid-data")));
app.use("/s2-data", express.static(path.join(dataDir, "s2-data")));
app.use(["/grid-data", "/s2-data"], (_req, res) =>
  res.status(404).json({ error: "网格数据文件未找到，请检查数据目录。" }),
);
app.use("/api", (_req, res) =>
  res.status(404).json({ error: "未找到对应接口。" }),
);
if (process.env.NODE_ENV === "production") {
  app.use("/assets", staticAssets(path.join(distDir, "assets")));
  app.use(express.static(distDir));
  app.get("/{*path}", (_req, res) =>
    res.sendFile(path.join(distDir, "index.html")),
  );
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    root,
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
}
app.use(
  (
    error: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    const large = (error as {type?:string})?.type === "entity.too.large";
  res.status(large ? 413 : error instanceof SyntaxError ? 400 : 500).json({
      error:
        large ? "推送内容超过大小限制。" : error instanceof SyntaxError
          ? "请求内容无效，请重新提交。"
          : "服务暂时无法完成请求。",
    });
  },
);
const port = Number(process.env.PORT || 5274);
const host = process.env.ONEEARTH_HOST || "127.0.0.1";
const server = app.listen(port, host, () =>
  console.log("OneEarth app http://" + (host.includes(":") ? `[${host}]` : host) + ":" + port),
);
server.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
