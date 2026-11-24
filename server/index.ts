import { releaseVersion } from "./version";
import {earthquakeDay,seismicStations} from "./earthquakes";
import {weatherStations} from "./weather-stations";
import {worldLightning} from "./world-lightning";
import {lightning} from "./lightning";

import {administrativeOrientation} from "./admin-orientation";
import { createModelService } from "./model-service";
import { mkdirSync } from "node:fs";
import { accessGuard, workbenchLan } from "./access";
import { staticAssets } from "./static-assets";
import { listModels } from "./model-list";
import { randomUUID } from "node:crypto";
import { createModelExecutor } from "./executor";
import { validChatModel } from "../src/domain/chat-model";
import {chatHomeSettings} from "./chat-home";
import {sourcePreview} from "./source-preview";
import { simulationGrid } from "./simulation-grid";
import { parseSources } from "./constellations";
import { spatialProxy } from "./spatial-proxy";
import { hainaPublicLayerRoute } from "./haina-public-layer-routes";
import { createRuntimeApi } from "./runtime-api-service";
import { serveHttp } from "./http-lifecycle";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import { decodeWind, installWindData } from "../src/domain/wind";
import { cases } from "../src/domain/catalog";
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
const host = process.env.ONEEARTH_HOST || "127.0.0.1";
const lanInterface=process.env.ONEEARTH_LAN_INTERFACE;
if(lanInterface&&host!=="127.0.0.1")throw Error("局域网入口要求 ONEEARTH_HOST=127.0.0.1。");
const lan=workbenchLan(lanInterface);
const port = Number(process.env.PORT || 5274);
const runtimePort = Number(process.env.ONEEARTH_RUNTIME_PORT || port+3);
const merged = process.env.ONEEARTH_ROLE !== "web";
const vite = process.env.NODE_ENV === "production" ? undefined : await import("vite").then(({createServer}) =>
  createServer({root,server:{middlewareMode:true},appType:"spa"}));
const runtime = await (merged ? createRuntimeApi(stateDir) : Promise.resolve(undefined)).catch(async error => {
  await vite?.close();
  throw error;
});
const modelSettings = createModelService();
const runModelTest = createModelExecutor(modelSettings.configureService);
app.use(accessGuard(process.env.ONEEARTH_ALLOWED_HOSTS,lan));
app.use("/internal", (_req,res)=>res.status(404).json({error:"未找到对应接口。"}));
app.use("/api/simulation-grid", simulationGrid(path.join(dataDir,"grid-data")));
app.disable("x-powered-by");
app.use("/api/orientation",administrativeOrientation(process.env.ONEEARTH_ADMIN_BOUNDARY_DIR || path.join(root,".local","admin-boundaries"),
  {baseUrl:process.env.ONEEARTH_ADMIN_BOUNDARIES_URL}));
const configuredPushSources = Object.keys(parseSources(process.env.ONEEARTH_PUSH_SOURCES)).length;
if (runtime) {
  app.use(runtime.business);
} else {
  // Explicit gateway-only diagnostics preserve the previous split role.
  const runtimeUrl = process.env.ONEEARTH_RUNTIME_URL || "http://127.0.0.1:"+runtimePort;
  app.post("/api/paper-records/search",spatialProxy(runtimeUrl,{timeout:40000}));
  app.use(["/api/chat/messages","/api/tasks","/api/results","/api/paper-records","/api/data-access","/api/coverage","/api/spatial",
    "/api/research-record","/api/catalog","/api/haina/catalog","/api/observation-materials"], spatialProxy(runtimeUrl));
  app.use("/api/constellations",spatialProxy(runtimeUrl,{timeout:40000,authorization:true}));
}
const geo = spatialProxy(process.env.ONEEARTH_SPATIAL_URL || "http://127.0.0.1:5276");
app.use(["/precip-data","/visualizations/haina/1846764","/visualizations/haina/1846639"],geo);
app.get(hainaPublicLayerRoute, geo);
app.get("/api/lightning/world",worldLightning(path.join(root,".local","lightning")));
app.get("/api/lightning", lightning);
app.get("/api/earthquakes/day",earthquakeDay);
app.get("/api/earthquakes/stations",seismicStations);
app.get("/api/weather/stations",weatherStations);

app.use(express.json({ limit: "192kb" }));
mkdirSync(stateDir, {recursive:true});
app.use("/api/settings/chat-home",chatHomeSettings(path.join(stateDir,"chat-home.json")));
app.use("/api/source-preview",sourcePreview(path.join(stateDir,"source-preview")));
app.get("/api/health", (_req, res) =>
  res.json({
    status: "ok",
    mode: "oneearth-next",
    version: releaseVersion,
    sources: { constellationPush: configuredPushSources, earthSearch: "collection-snapshot-and-live-item-search" },
    cases: cases.length,
    verifiedCases: cases.filter((c) => c.verified).length,
    spatialDataReady: existsSync(path.join(dataDir, "s2-data/manifest.json")),
  }),
);
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
    modelSettings.setServiceKey(config,key.trim());res.json({ok:true});return;
  }
  if(req.params.action!=="list"){res.status(400).json({error:"无效的服务设置。"});return;}
  try {res.set("Cache-Control","no-store").json({models:await modelSettings.serviceModels(config)});}
  catch(err){res.status(502).json({error:err instanceof Error?err.message:"无法读取模型清单。"});}
});
app.get("/api/models/deepseek/tools", (_req,res) => res.set("Cache-Control","no-store").json({
  configured:!!modelSettings.deepSeekKey(),
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
    const reply=await runModelTest(config,"Reply with exactly this text: "+token,controller.signal);
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
if (!vite) {
  app.use("/assets", staticAssets(path.join(distDir, "assets")));
  app.use(express.static(distDir));
  app.get("/{*path}", (_req, res) =>
    res.sendFile(path.join(distDir, "index.html")),
  );
} else {
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
if(lanInterface&&!lan)console.warn("OneEarth LAN: 指定网络接口当前没有唯一可用的私有 IPv4 地址。");
await serveHttp([
  ...(runtime?[{app:runtime.compatibility,host:"127.0.0.1",port:runtimePort,label:"OneEarth runtime compatibility"}]:[]),
  {app,host,port,label:"OneEarth workbench"},
  ...(lan?[{app,host:lan.address,port,label:"OneEarth LAN",optional:true}]:[]),
], {
  async stopAccepting() { await Promise.all([runtime?.stopAccepting(),vite?.close()]); },
  async close() { await runtime?.close(); },
});
