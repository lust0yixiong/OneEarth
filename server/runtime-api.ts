import path from "node:path";
import { createRuntimeApi } from "./runtime-api-service";
import { serveHttp } from "./http-lifecycle";

const state = process.env.ONEEARTH_STATE_DIR || path.resolve(".local/state");
const port = Number(process.env.ONEEARTH_RUNTIME_PORT || 5277);
const runtime = await createRuntimeApi(state);
await serveHttp([{app:runtime.compatibility,host:"127.0.0.1",port,label:"OneEarth runtime API"}], runtime);
