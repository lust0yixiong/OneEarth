import express from "express";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  resultIdPattern,
  snapshotMaxBytes,
  validResultSnapshot,
} from "../src/domain/result-snapshot";

export function resultSnapshots(filename: string) {
  const router = express.Router();
  let database: DatabaseSync | undefined;
  function db() {
    if (database) return database;
    mkdirSync(path.dirname(filename), { recursive: true });
    const opened = new DatabaseSync(filename);
    opened.exec("PRAGMA busy_timeout = 3000");
    opened.exec(
      "CREATE TABLE IF NOT EXISTS result_snapshots (id TEXT PRIMARY KEY, snapshot TEXT NOT NULL)",
    );
    database = opened;
    return opened;
  }
  router.param("id", (_req, res, next, id) => {
    if (!resultIdPattern.test(id)) {
      res.status(400).json({ error: "结果链接编号无效。" });
      return;
    }
    next();
  });
  router.get("/:id", (req, res) => {
    const row = db()
      .prepare("SELECT snapshot FROM result_snapshots WHERE id = ?")
      .get(req.params.id);
    if (!row) {
      res.status(404).json({ error: "此服务没有该结果快照。" });
      return;
    }
    res.type("json").send(row.snapshot);
  });
  router.put("/:id", express.json({ limit: snapshotMaxBytes }), (req, res) => {
    if (!validResultSnapshot(req.body)) {
      res.status(400).json({ error: "结果快照的格式或范围无效。" });
      return;
    }
    const raw = JSON.stringify(req.body);
    const inserted = db()
      .prepare(
        "INSERT OR IGNORE INTO result_snapshots (id, snapshot) VALUES (?, ?)",
      )
      .run(req.params.id, raw);
    if (
      !inserted.changes &&
      db()
        .prepare("SELECT snapshot FROM result_snapshots WHERE id = ?")
        .get(req.params.id)?.snapshot !== raw
    ) {
      res.status(409).json({ error: "该编号已属于另一份结果。" });
      return;
    }
    res.sendStatus(inserted.changes ? 201 : 200);
  });
  return router;
}
