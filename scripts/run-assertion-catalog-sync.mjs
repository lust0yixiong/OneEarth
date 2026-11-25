import { spawn } from "node:child_process";
import { closeSync, constants, fstatSync, openSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { readCredentials } from "./credentials.mjs";

const [deploymentFile] = process.argv.slice(2);
if (process.argv.length !== 3 || !path.isAbsolute(deploymentFile)) {
  throw Error("用法：node scripts/run-assertion-catalog-sync.mjs <部署配置绝对路径>");
}

const fd = openSync(deploymentFile, constants.O_RDONLY | constants.O_NOFOLLOW);
let deployment;
try {
  const stat = fstatSync(fd);
  if (!stat.isFile() || stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0 || stat.size > 64 * 1024) {
    throw Error("同步配置须由当前用户独占读取。");
  }
  deployment = parseEnv(readFileSync(fd, "utf8"));
} finally {
  closeSync(fd);
}

const { ONEEARTH_CREDENTIALS_FILE, ONEEARTH_DISCOVERY_DATABASE_URL, ONEEARTH_STATE_DIR } = deployment;
if (!ONEEARTH_CREDENTIALS_FILE || !ONEEARTH_DISCOVERY_DATABASE_URL || !ONEEARTH_STATE_DIR ||
    !path.isAbsolute(ONEEARTH_STATE_DIR)) {
  throw Error("部署配置须提供断言凭据引用、发现数据库和绝对状态目录。");
}
const assertion = Object.fromEntries(Object.entries(readCredentials(ONEEARTH_CREDENTIALS_FILE))
  .filter(([name]) => name.startsWith("ONEEARTH_ASSERTION_PG_")));
if (!assertion.ONEEARTH_ASSERTION_PG_HOST) throw Error("尚未配置论文研究数据只读连接。");

const script = fileURLToPath(new URL("./sync-assertion-postgres.ts", import.meta.url));
console.log(JSON.stringify({ event: "assertion-catalog-sync-started", at: new Date().toISOString() }));
const sync = spawn(process.execPath, ["--import", "tsx", script], {
  cwd: path.dirname(path.dirname(script)),
  env: { ...assertion, ONEEARTH_DISCOVERY_DATABASE_URL, ONEEARTH_STATE_DIR },
  stdio: "inherit",
});
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.once(signal, () => sync.kill(signal));
}
sync.once("error", error => {
  console.error("同步进程未启动。", error.code);
  process.exitCode = 1;
});
sync.once("exit", (code, signal) => {
  process.exitCode = code ?? 1;
  console.log(JSON.stringify({ event: "assertion-catalog-sync-finished",
    at: new Date().toISOString(), exitCode: process.exitCode, signal }));
});
