import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, existsSync, readFileSync, realpathSync } from "node:fs";
import { parseEnv } from "node:util";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = path.resolve(root, "../oneearth-app");
const local = existsSync(path.join(root, ".env")) ? parseEnv(readFileSync(path.join(root, ".env"), "utf8")) : {};
const env = {...local,...process.env};
const allowed = /^(?:PATH|DEEPSEEK_API_KEY|ONEEARTH_DEEPSEEK_(?:SEARCH|FETCH)|ONEEARTH_EARTHNANO_URL|ONEEARTH_ASSERTION_PG_(?:HOST|PORT|DATABASE|USER|PASSWORD|SSL)|HAINA_(?:ACCESS_KEY_ID|SECRET_ACCESS_KEY|DATAHUB_AK|DATAHUB_SK)|ONEEARTH_HAINA_AREA_ID)$/;
if (env.ONEEARTH_USE_EXISTING_ACCESS === "1") {
  const original = {};
  for (const name of [".env", ".env.haina"]) {
    const file = path.join(source, name);
    if (existsSync(file)) Object.assign(original, parseEnv(readFileSync(file, "utf8")));
  }
  const plist = path.join(homedir(), "Library/LaunchAgents/org.oneearth.prototype.plist");
  if (process.platform === "darwin" && existsSync(plist)) {
    const program = "import json, plistlib, sys; print(json.dumps(plistlib.load(open(sys.argv[1], 'rb')).get('EnvironmentVariables', {})))";
    Object.assign(original, JSON.parse(execFileSync("python3", ["-c", program, plist], {stdio:["ignore","pipe","ignore"]}).toString()));
  }
  for (const [key, value] of Object.entries(original)) if (allowed.test(key) && !env[key]) env[key] = value;
  // The SDK and signed catalogue use different variable names for the same issued pair.
  env.HAINA_ACCESS_KEY_ID ||= env.HAINA_DATAHUB_AK;
  env.HAINA_SECRET_ACCESS_KEY ||= env.HAINA_DATAHUB_SK;
}
for (const key of Object.keys(env)) if (env[key] === undefined) delete env[key];

const oldData = path.join(homedir(), "Applications/OneEarth");
function scopedPath(value) {
  const candidate = path.resolve(root,value);
  let parent = candidate;
  while (!existsSync(parent)) parent = path.dirname(parent);
  const real = path.resolve(realpathSync(parent),path.relative(parent,candidate));
  if ([source, oldData].some(protectedPath => real === protectedPath || real.startsWith(protectedPath + path.sep))) {
    throw Error("OneEarth 新服务的文件路径指向原型。");
  }
  return real;
}
function port(value, fallback) {
  const n = Number(value ?? fallback);
  if (!Number.isInteger(n) || n < 1024 || n > 65535 || n === 5174) throw Error("OneEarth 新服务端口无效或与原型冲突。");
  return String(n);
}
env.NODE_ENV ||= "production";
env.PORT = port(env.ONEEARTH_PORT, 5274);
env.ONEEARTH_DISCOVERY_PORT = port(env.ONEEARTH_DISCOVERY_PORT, 5275);
env.ONEEARTH_SPATIAL_PORT = port(env.ONEEARTH_SPATIAL_PORT, 5276);
env.ONEEARTH_RUNTIME_PORT = port(env.ONEEARTH_RUNTIME_PORT,Number(env.PORT)+3);
if (new Set([env.PORT,env.ONEEARTH_DISCOVERY_PORT,env.ONEEARTH_SPATIAL_PORT,env.ONEEARTH_RUNTIME_PORT]).size !== 4) throw Error("OneEarth 服务端口重复。");
env.ONEEARTH_RUNTIME_URL = "http://127.0.0.1:" + env.ONEEARTH_RUNTIME_PORT;
env.ONEEARTH_DISCOVERY_URL = "http://127.0.0.1:" + env.ONEEARTH_DISCOVERY_PORT;
env.ONEEARTH_SPATIAL_URL = "http://127.0.0.1:" + env.ONEEARTH_SPATIAL_PORT;
env.ONEEARTH_STATE_DIR = scopedPath(env.ONEEARTH_STATE_DIR || ".local/state");
env.ONEEARTH_DATA_DIR = scopedPath(env.ONEEARTH_DATA_DIR || ".local/globe-data");
env.ONEEARTH_DIST_DIR = scopedPath(env.ONEEARTH_DIST_DIR || "dist");
for (const name of ["ONEEARTH_RESULT_DB","ONEEARTH_COVERAGE_DB","ONEEARTH_OBSERVATION_DB",
  "ONEEARTH_ADMIN_BOUNDARY_DIR","ONEEARTH_OBJECT_DIR","ONEEARTH_POSTGIS_DIR"]) {
  if (env[name]) env[name] = scopedPath(env[name]);
}
env.TMPDIR = path.join(env.ONEEARTH_STATE_DIR,"tmp");
mkdirSync(env.TMPDIR,{recursive:true,mode:0o700});

const services = {
  discovery:["server/discovery-service.ts"],
  worker:["server/index.ts"],
  runtime:["server/runtime-api.ts"],
  web:["server/index.ts"],
  spatial:["server/spatial-service.ts"],
  seed:["scripts/seed-spatial.ts"],
  baseline:[".local/baseline/server/index.ts"],
  haina:["scripts/probe-haina.py"],
};
const roles = process.argv.slice(2);
if (!roles.length) roles.push("discovery","spatial","worker","runtime","web");
if (!roles.every(role => Object.hasOwn(services,role))) throw Error("未知 OneEarth 服务。");
const children = [];
let stopping = false;
function stop(signal = "SIGTERM") {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill(signal);
}
for (const role of roles) {
  const executable=role==="haina" ? path.join(root,".local/haina-venv/bin/python") : process.execPath;
  const args=role==="haina" ? services[role] : ["--import","tsx",...services[role]];
  const child = spawn(executable,args,{
    stdio:"inherit",cwd:root,env:{...env,ONEEARTH_ROLE:role},
  });
  children.push(child);
  child.once("exit",(code,signal)=>{
    if (stopping) return;
    if (roles.length === 1 && ["seed","haina"].includes(role)) {process.exitCode = code ?? 1; return;}
    console.error("OneEarth " + role + " exited (" + (code ?? signal) + ")");
    process.exitCode = code || 1;
    stop();
  });
}
process.on("SIGINT",()=>stop("SIGINT"));
process.on("SIGTERM",()=>stop());
