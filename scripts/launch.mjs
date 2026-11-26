import { spawn } from "node:child_process";
import { mkdirSync, existsSync, readFileSync, realpathSync } from "node:fs";
import { parseEnv } from "node:util";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readCredentials, readPrototypeAccess, selectAccess } from "./credentials.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = path.resolve(root, "../oneearth-app");
const local = existsSync(path.join(root, ".env")) ? parseEnv(readFileSync(path.join(root, ".env"), "utf8")) : {};
const env = {...local,...process.env};
if (env.ONEEARTH_CREDENTIALS_FILE && env.ONEEARTH_USE_EXISTING_ACCESS === "1")
  throw Error("请在独立凭据文件和开发复用模式中选择一项。");
if(env.ONEEARTH_CREDENTIALS_FILE){
  for(const [key,value] of Object.entries(readCredentials(env.ONEEARTH_CREDENTIALS_FILE)))
    env[key] ??= value;
}else if(env.ONEEARTH_USE_EXISTING_ACCESS==="1"){
  const original=readPrototypeAccess(root);
  for(const [key,value] of Object.entries(selectAccess(original)))env[key] ??= value;
  if(typeof original.PATH==="string"&&!env.PATH)env.PATH=original.PATH;
}
env.HAINA_ACCESS_KEY_ID ||= env.HAINA_DATAHUB_AK;
env.HAINA_SECRET_ACCESS_KEY ||= env.HAINA_DATAHUB_SK;
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
if (new Set([env.PORT,env.ONEEARTH_DISCOVERY_PORT,env.ONEEARTH_SPATIAL_PORT]).size !== 3) throw Error("OneEarth 服务端口重复。");
env.ONEEARTH_DISCOVERY_TOOL_CALLBACK_URL = "http://127.0.0.1:" + env.PORT;
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
  worker:["server/runtime-worker.ts"],
  workbench:["server/index.ts"],
  spatial:["server/spatial-service.ts"],
  seed:["scripts/seed-spatial.ts"],
  baseline:[".local/baseline/server/index.ts"],
  haina:["scripts/probe-haina.py"],
};
const serviceDatabase = {discovery:"DISCOVERY",worker:"RUNTIME",workbench:"RUNTIME",spatial:"SPATIAL",seed:"SPATIAL"};
const roles = process.argv.slice(2);
if (!roles.length) roles.push("discovery","spatial","worker","workbench");
if (!roles.every(role => Object.hasOwn(services,role))) throw Error("未知 OneEarth 服务。");
if (new Set(roles).size !== roles.length) throw Error("OneEarth 服务角色重复。");
function launchSpec(role) {
  const executable=role==="haina" ? path.join(root,".local/haina-venv/bin/python") : process.execPath;
  const args=role==="haina" ? services[role] : ["--import","tsx",...services[role]];
  const childEnv={...env,ONEEARTH_ROLE:role};
  if (role!=="discovery") delete childEnv.ONEEARTH_DISCOVERY_CHAT_MODEL;
  if (role!=="discovery" && role!=="worker") delete childEnv.ONEEARTH_DISCOVERY_RECOVERY_TOKEN;
  if (Object.hasOwn(serviceDatabase,role)){
    for(const database of ["RUNTIME","DISCOVERY","SPATIAL"]){
      if(database!==serviceDatabase[role]) delete childEnv["ONEEARTH_"+database+"_DATABASE_URL"];
    }
  }
  if (role==="workbench") {
    for (const name of ["ONEEARTH_OBJECT_ENDPOINT","ONEEARTH_OBJECT_BUCKET","ONEEARTH_OBJECT_PREFIX",
      "ONEEARTH_OBJECT_PATH_STYLE","AWS_ACCESS_KEY_ID","AWS_SECRET_ACCESS_KEY","AWS_SESSION_TOKEN"]) delete childEnv[name];
  }
  return {executable,args,childEnv};
}

// launchd tracks each service PID directly. The multi-role development command
// still forwards signals to its children.
if (process.platform === "darwin" && roles.length === 1 &&
    ["workbench","worker","discovery","spatial"].includes(roles[0])) {
  const {executable,args,childEnv} = launchSpec(roles[0]);
  process.chdir(root);
  process.execve(executable,[executable,...args],childEnv);
}

const children = [];
let stopping = false;
function stop(signal = "SIGTERM") {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill(signal);
}
for (const role of roles) {
  const {executable,args,childEnv} = launchSpec(role);
  const child = spawn(executable,args,{
    stdio:"inherit",cwd:root,env:childEnv,
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
