import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import type { Router } from "express";

export const taskIdPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
type Status = "queued" | "running" | "complete" | "failed" | "cancelled";
type Payload = Record<string, unknown>;
type Task = {id: string; body: string; fingerprint: string; status: Status; created: number; updated: number};
type EventRow = {seq: number; at: number; payload: string};

export class TaskConflict extends Error {}

export function openTaskStore(file: string) {
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA busy_timeout = 5000;
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY, body TEXT NOT NULL, fingerprint TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('queued','running','complete','failed','cancelled')),
      created INTEGER NOT NULL, updated INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS task_queue ON tasks(status, created);
    CREATE TABLE IF NOT EXISTS task_events (
      seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL REFERENCES tasks(id),
      at INTEGER NOT NULL, payload TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS task_replay ON task_events(id, seq);
  `);
  const find = db.prepare("SELECT * FROM tasks WHERE id = ?");
  const get = (id: string) => find.get(id) as Task | undefined;
  const event = db.prepare("INSERT INTO task_events(id, at, payload) VALUES (?, ?, ?)");
  const write = (id: string, payload: Payload, at = Date.now()) => event.run(id, at, JSON.stringify(payload));
  function transaction<T>(work: () => T): T {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  function finish(id: string, status: Exclude<Status, "queued" | "running">, payload: Payload) {
    return transaction(() => {
      const now = Date.now();
      if (!db.prepare("UPDATE tasks SET status=?,updated=? WHERE id=? AND status IN ('running','queued')").run(status, now, id).changes) return false;
      write(id, payload, now);
      return true;
    });
  }
  return {
    get,
    terminal(id: string): Payload | undefined {
      const task = get(id);
      if (!task || task.status === "queued" || task.status === "running") return;
      const row = db.prepare("SELECT payload FROM task_events WHERE id=? ORDER BY seq DESC LIMIT 1").get(id);
      if (row) return JSON.parse(String(row.payload));
    },
    submit(id: string, body: unknown) {
      return transaction(() => {
        const raw = JSON.stringify(body);
        const hash = createHash("sha256").update(raw).digest("hex");
        const previous = get(id);
        if (previous) {
          if (previous.fingerprint !== hash) throw new TaskConflict("该任务编号已经用于另一份提交。");
          return previous;
        }
        const now = Date.now();
        db.prepare("INSERT INTO tasks VALUES (?, ?, ?, 'queued', ?, ?)").run(id, raw, hash, now, now);
        write(id, {queued: true, queuedAt: now}, now);
        return get(id)!;
      });
    },
    claim() {
      return transaction(() => {
        const row = db.prepare("SELECT * FROM tasks WHERE status='queued' ORDER BY created,id LIMIT 1").get() as Task | undefined;
        if (!row) return;
        const now = Date.now();
        db.prepare("UPDATE tasks SET status='running',updated=? WHERE id=?").run(now, row.id);
        write(row.id, {started: true, startedAt: now}, now);
        return {id:row.id, body:JSON.parse(row.body)};
      });
    },
    append(id: string, payload: Payload) {
      transaction(() => { if (get(id)?.status === "running") write(id, payload); });
    },
    finish,
    recoverInterrupted() {
      const rows = db.prepare("SELECT id FROM tasks WHERE status='running'").all() as {id:string}[];
      for (const {id} of rows) finish(id, "failed", {
        error:"后台进程中断。已取得的结果仍可查看，请明确重试未完成的工作。",
        code:"worker_interrupted",
      });
    },
    events(id: string, after: number) {
      return (db.prepare("SELECT seq,at,payload FROM task_events WHERE id=? AND seq>? ORDER BY seq LIMIT 128")
        .all(id, after) as EventRow[]).map(row => ({...JSON.parse(row.payload), seq:row.seq, at:row.at, taskId:id}));
    },
    close: () => db.close(),
  };
}
export type TaskStore = ReturnType<typeof openTaskStore>;

export function taskRoutes(router: Router, base: string, store: TaskStore, validate: (body: unknown) => string | undefined) {
  router.param("taskId", (_req, res, next, id) => {
    if (!taskIdPattern.test(id)) { res.status(400).json({error:"无效的任务编号。"}); return; }
    next();
  });
  router.post(base, (req, res) => {
    const {id, input} = req.body ?? {};
    if (typeof id !== "string" || !taskIdPattern.test(id)) { res.status(400).json({error:"无效的任务编号。"}); return; }
    const issue = validate(input);
    if (issue) { res.status(400).json({error:issue}); return; }
    try {
      const task = store.submit(id, input);
      res.status(202).set("Cache-Control", "no-store").json({id, status:task.status, created:task.created});
    } catch (error) {
      if (!(error instanceof TaskConflict)) throw error;
      res.status(409).json({error:error.message});
    }
  });
  router.get(base + "/:taskId", (req, res) => {
    const task = store.get(String(req.params.taskId));
    if (!task) { res.status(404).json({error:"任务不存在。"}); return; }
    res.set("Cache-Control", "no-store").json({id:task.id, status:task.status, created:task.created, updated:task.updated});
  });
  router.delete(base + "/:taskId", (req, res) => {
    if (!store.get(String(req.params.taskId))) { res.status(404).json({error:"任务不存在。"}); return; }
    const cancelled = store.finish(String(req.params.taskId), "cancelled", {error:"任务已取消。", code:"cancelled"});
    res.sendStatus(cancelled ? 204 : 409);
  });
  router.get(base + "/:taskId/events", (req, res) => {
    const id = String(req.params.taskId);
    if (!store.get(id)) { res.status(404).json({error:"任务不存在。"}); return; }
    let cursor = Number(req.query.after ?? 0);
    if (!Number.isSafeInteger(cursor) || cursor < 0) { res.status(400).json({error:"无效的事件序号。"}); return; }
    res.type("application/x-ndjson").set({"Cache-Control":"no-store", "X-Accel-Buffering":"no"}).flushHeaders();
    let heartbeat = Date.now();
    const timer = setInterval(flush, 150);
    res.once("close", () => clearInterval(timer));
    function flush() {
      if (res.destroyed || res.writableEnded || res.writableNeedDrain) return;
      const task = store.get(id);
      const rows = store.events(id, cursor);
      for (const row of rows) {
        cursor = row.seq;
        if (!res.write(JSON.stringify(row) + "\n")) return;
      }
      if (task && task.status !== "queued" && task.status !== "running" && rows.length < 128) res.end();
      else if (Date.now() - heartbeat >= 10000) { res.write("\n"); heartbeat = Date.now(); }
    }
    flush();
  });
}

export function workTasks(store: TaskStore, run: (task: {id:string; body:any}, signal: AbortSignal, emit: (payload:Payload) => void) => Promise<Payload>) {
  store.recoverInterrupted();
  let active: AbortController | undefined;
  const clock = setInterval(() => {
    if (active) return;
    const task = store.claim();
    if (!task) return;
    const controller = new AbortController();
    active = controller;
    const watch = setInterval(() => {
      if (store.get(task.id)?.status === "cancelled") controller.abort();
    }, 150);
    void run(task, controller.signal, payload => store.append(task.id, payload)).then(
      payload => store.finish(task.id, payload.error ? "failed" : "complete", payload),
      () => store.finish(task.id, "failed", {error:"后台执行未完成，请查看已取得的结果。", code:"worker_error"}),
    ).finally(() => { clearInterval(watch); active = undefined; });
  }, 100);
  return () => { clearInterval(clock); active?.abort(); };
}
