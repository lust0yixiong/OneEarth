import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

assert.equal(process.platform, "darwin", "本验收使用 macOS 进程级网络限制。");
const profile = '(version 1) (allow default) (deny network-outbound (remote tcp "*:5174"))';
const sandbox = "/usr/bin/sandbox-exec";
const curl = "/usr/bin/curl";
const prototype = "http://127.0.0.1:5174/api/health";
const output = path.resolve(process.env.ONEEARTH_EVIDENCE_DIR || "evidence/prototype-isolation");
const webPort = Number(process.env.ONEEARTH_ISOLATION_PORT || 5374);
assert.ok(Number.isInteger(webPort) && webPort >= 1024 && webPort <= 65532 &&
  ![5174,5274,5275,5276,5277].some(port => port >= webPort && port <= webPort + 3));
const entry = "http://127.0.0.1:" + webPort;

function checkPrototype() {
  const args = ["--noproxy", "*", "-fsS", "--max-time", "4", prototype];
  const outside = spawnSync(curl,args,{encoding:"utf8"});
  assert.equal(outside.status,0,"原型应从受限进程之外保持在线。");
  assert.equal(JSON.parse(outside.stdout).status,"ok");
  const inside = spawnSync(sandbox,["-p",profile,curl,...args],{encoding:"utf8"});
  assert.equal(inside.status,7,"受限进程连接在线的 5174 应失败。");
  assert.match(inside.stderr,/Failed to connect.*port 5174/);
  return {outside:"ok",insideCurlExit:inside.status};
}

await mkdir(".local",{recursive:true});
await mkdir(output,{recursive:true});
const state = path.resolve(await mkdtemp(".local/prototype-isolation-"));
const env = {...process.env,
  ONEEARTH_USE_EXISTING_ACCESS: "1",
  ONEEARTH_PORT: String(webPort),
  ONEEARTH_DISCOVERY_PORT: String(webPort+1),
  ONEEARTH_SPATIAL_PORT: String(webPort+2),
  ONEEARTH_RUNTIME_PORT: String(webPort+3),
  ONEEARTH_STATE_DIR: state,
  ONEEARTH_ADMIN_BOUNDARY_DIR: path.join(state,"admin-boundaries"),
  ONEEARTH_HOST: "127.0.0.1",
  ONEEARTH_URL: entry,
};
for(const key of ["ONEEARTH_RESULT_DB","ONEEARTH_COVERAGE_DB","ONEEARTH_OBSERVATION_DB",
  "ONEEARTH_OBJECT_DIR","ONEEARTH_POSTGIS_DIR","ONEEARTH_SPATIAL_DATABASE_URL","ONEEARTH_OBJECT_BUCKET",
  "ONEEARTH_TEST_FAIL_CHANNEL","ONEEARTH_BASELINE"]) delete env[key];
// Explicitly select local storage and the real channels even if the launcher's .env provides overrides.
Object.assign(env,{ONEEARTH_SPATIAL_DATABASE_URL:"",ONEEARTH_OBJECT_BUCKET:"",ONEEARTH_TEST_FAIL_CHANNEL:"",
  ONEEARTH_RESULT_DB:path.join(state,"results.sqlite"),ONEEARTH_OBSERVATION_DB:path.join(state,"observations.sqlite"),
  ONEEARTH_COVERAGE_DB:path.join(state,"coverage.sqlite"),ONEEARTH_OBJECT_DIR:path.join(state,"objects"),
  ONEEARTH_POSTGIS_DIR:path.join(state,"postgis")});

function start(script, args = [], overrides = {}) {
  const child=spawn(sandbox,["-p",profile,process.execPath,script,...args],{
    env:{...env,...overrides},stdio:"inherit",
  });
  const result=new Promise((resolve,reject)=>{
    child.once("error",reject);
    child.once("exit",(code,signal)=>resolve({code,signal}));
  });
  return {child,result};
}
async function run(script,args = [],overrides) {
  const {result}=start(script,args,overrides);
  const exit=await result;
  assert.equal(exit.code,0,script+" 未通过（"+(exit.signal || exit.code)+"）。");
}
async function servicesReady() {
  for (let i=0;i<100;i++) {
    const checks = await Promise.all([0,1,2,3].map(async offset=>{
      try {
        const response=await fetch("http://127.0.0.1:"+(webPort+offset)+"/api/health",{signal:AbortSignal.timeout(2000)});
        return response.ok && (await response.json()).status==="ok";
      } catch { return false; }
    }));
    if(checks.every(Boolean))return;
    await delay(200);
  }
  throw Error("隔离实例未就绪。");
}
const report={entry,version:"0.1.0",networkPolicy:"macOS Seatbelt denies outbound TCP 5174 in browser and service process trees",
  before:checkPrototype(),startedAt:new Date().toISOString()};
await run("scripts/launch.mjs",["seed"]);
const services=start("scripts/launch.mjs");
try {
  await Promise.race([servicesReady(),services.result.then(()=>{throw Error("隔离服务提前退出。");})]);
  await run("scripts/accept-spatial.mjs",[],{ONEEARTH_EVIDENCE_DIR:path.join(output,"map")});
  await run("scripts/accept-first-turn.mjs",[],{ONEEARTH_EVIDENCE_DIR:path.join(output,"chat")});
  const map=JSON.parse(await readFile(path.join(output,"map","verification.json"),"utf8"));
  const chat=JSON.parse(await readFile(path.join(output,"chat","task-evidence.json"),"utf8"));
  Object.assign(report,{after:checkPrototype(),finishedAt:new Date().toISOString(),
    tiles:map.tileCount,tileService:map.tileService,refresh:chat.refresh,
    turns:chat.turns.map(turn=>({id:turn.id,executor:turn.executor,status:turn.status,
      assertionReferences:turn.paperIds.length,discoveryCalls:turn.channelCalls.filter(call=>call.name==="独立数据发现服务").length}))});
  await writeFile(path.join(output,"verification.json"),JSON.stringify(report,null,2)+"\n");
} finally {
  services.child.kill("SIGTERM");
  await services.result;
}
