import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";

const directory = await mkdtemp(join(tmpdir(), "oneearth-constellation-demo-"));
const token = randomBytes(32).toString("hex");
const port = process.env.ONEEARTH_DEMO_PORT || "5175";
const base = "http://127.0.0.1:" + port;
const child = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
  stdio: ["ignore", "pipe", "inherit"],
  env: {
    ...process.env,
    PORT: port,
    NODE_ENV: "production",
    ONEEARTH_OBSERVATION_DB: join(directory, "demo.sqlite"),
    ONEEARTH_PUSH_SOURCES: JSON.stringify({
      integration: { name: "联调星座（模拟）", token, test: true },
    }),
  },
});
const done = once(child, "exit");
let stopping = false;
const stop = () => {
  stopping = true;
  child.kill("SIGTERM");
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
try {
  // Only seed the child we started, after its own listen callback.
  const ready = new Promise((resolve) =>
    child.stdout.on("data", (chunk) => {
      if (chunk.toString().includes("OneEarth app " + base)) resolve();
    }),
  );
  await Promise.race([
    ready,
    done.then(() => {
      throw Error("联调服务启动失败");
    }),
  ]);
  const start = Date.now() - 20 * 60000;
  for (let i = 0; i < 2; i++) {
    const value = 1.2 + i * 0.1;
    const file = Buffer.from(
      "variable,value,unit\nchlorophyll," + value.toFixed(1) + ",mg/m3\n",
    );
    const resp = await fetch(
      base + "/api/constellations/integration/observations",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({
          schemaVersion: 1,
          collection: "联调水色产品",
          id: "DEMO-" + (i + 1),
          revision: 1,
          title: i ? "联调观测 · 长江口东侧" : "联调观测 · 长江口西侧",
          satellite: "TEST-0" + (i + 1),
          observedAt: new Date(start + i * 300000).toISOString(),
          publishedAt: new Date(start + i * 300000 + 120000).toISOString(),
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [121.2 + i * 0.6, 30.9],
                [121.9 + i * 0.6, 30.9],
                [121.9 + i * 0.6, 31.6],
                [121.2 + i * 0.6, 31.6],
                [121.2 + i * 0.6, 30.9],
              ],
            ],
          },
          measurements: [{ variable: "模拟叶绿素浓度", value, unit: "mg/m³" }],
          file: {
            name: "demo-water-color.csv",
            base64: file.toString("base64"),
          },
        }),
      },
    );
    if (resp.status !== 201) throw Error("联调推送失败 HTTP " + resp.status);
    if (i === 0) await delay(250);
  }
  console.log("联调预览 " + base + "/?view=earth&source=constellation");
  const [code] = await done;
  if (!stopping && code) process.exitCode = code;
} finally {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGTERM");
    await done;
  }
  await rm(directory, { recursive: true, force: true });
}
