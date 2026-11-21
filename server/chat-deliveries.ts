import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { Response } from "express";

// A random delivery ID belongs to one submitted payload. Reconnecting clients
// receive the latest progress or the original terminal event over the same API.
export function chatDeliveries(filename: string) {
  const db = new DatabaseSync(filename);
  db.exec("CREATE TABLE IF NOT EXISTS deliveries (id TEXT PRIMARY KEY, digest TEXT NOT NULL, terminal TEXT, updated INTEGER NOT NULL)");
  db.prepare("UPDATE deliveries SET terminal = ? WHERE terminal IS NULL")
    .run(JSON.stringify({error:"服务重启中断了本轮回答，可按原条件重试。"}));
  const active = new Map<string, {last: string; listeners: Set<Response>; snapshot?:()=>unknown}>();
  function attach(id: string, payload: unknown, res: Response, snapshot?:()=>unknown) {
    if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)) {
      res.status(400).json({error:"无效的请求编号。"});
      return;
    }
    const digest = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    const old = db.prepare("SELECT digest, terminal FROM deliveries WHERE id = ?").get(id);
    if (old && old.digest !== digest) {
      res.status(409).json({error:"该请求编号已用于另一轮提问。"});
      return;
    }
    res.type("application/x-ndjson").set("Cache-Control","no-store").flushHeaders();
    if (typeof old?.terminal === "string") {
      res.end(old.terminal + "\n");
      return;
    }
    const previous = active.get(id);
    const run = previous || {last:"", listeners:new Set<Response>(), snapshot};
    run.listeners.add(res);
    res.once("close", () => run.listeners.delete(res));
    if (previous) {
      if (run.snapshot) res.write(JSON.stringify(run.snapshot())+"\n");
      else if (run.last) res.write(run.last);
      return;
    }
    db.prepare("DELETE FROM deliveries WHERE terminal IS NOT NULL AND updated < ?").run(Date.now()-7*86400000);
    db.prepare("INSERT INTO deliveries VALUES (?, ?, NULL, ?)").run(id,digest,Date.now());
    active.set(id,run);
    return (value: unknown, finished = false) => {
      const line = JSON.stringify(value) + "\n";
      if (finished) {
        db.prepare("UPDATE deliveries SET terminal = ?, updated = ? WHERE id = ?").run(line.trimEnd(), Date.now(), id);
        active.delete(id);
        for (const listener of run.listeners) listener.end(line);
      } else {
        run.last = line;
        for (const listener of run.listeners) listener.write(line);
      }
    };
  }
  return {attach};
}
