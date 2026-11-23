import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import type { Router } from "express";
import { TaskCancelled } from "./task-cancellation";

export const taskIdPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export type TaskStatus = "queued" | "running" | "complete" | "failed" | "cancelled";
export type Payload = Record<string, unknown>;
export type Task = {id: string; body: string; fingerprint: string; status: TaskStatus; created: number; updated: number};
type EventRow = {seq: number; at: number; payload: string};

export class TaskConflict extends Error {}
/** A trusted worker outcome: the durable checkpoint owns continuation now. */
export class TaskParked {}
export type TaskStep = {id:string;body:any;checkpoint:Payload};

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
    CREATE TABLE IF NOT EXISTS task_steps (
      id TEXT PRIMARY KEY REFERENCES tasks(id), checkpoint TEXT NOT NULL, wake_at INTEGER
    );
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
  function finish(id: string, status: Exclude<TaskStatus, "queued" | "running">, payload: Payload) {
    return transaction(() => {
      const now = Date.now();
      if (!db.prepare("UPDATE tasks SET status=?,updated=? WHERE id=? AND status IN ('running','queued')").run(status, now, id).changes) return false;
      const step=db.prepare("SELECT checkpoint FROM task_steps WHERE id=?").get(id) as {checkpoint:string}|undefined;
      const retained=payload.result===undefined&&step&&status!=="complete"?JSON.parse(step.checkpoint)[status==="cancelled"?"cancelledResult":"failedResult"]:undefined;
      write(id,retained?{...payload,result:retained}:payload,now);
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
    submit(id: string, body: unknown, checkpoint?:Payload) {
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
        if(checkpoint)db.prepare("INSERT INTO task_steps VALUES (?,?,?)").run(id,JSON.stringify(checkpoint),now);
        write(id, {queued: true, queuedAt: now}, now);
        return get(id)!;
      });
    },
    claim() {
      return transaction(() => {
        const row = db.prepare(`SELECT t.* FROM tasks t LEFT JOIN task_steps s ON s.id=t.id
          WHERE t.status='queued' OR (t.status='running' AND s.wake_at<=?) ORDER BY t.updated,t.created,t.id LIMIT 1`).get(Date.now()) as Task | undefined;
        if (!row) return;
        const now = Date.now();
        db.prepare("UPDATE tasks SET status='running',updated=? WHERE id=?").run(now, row.id);
        if(row.status==="queued")write(row.id, {started: true, startedAt: now}, now);
        const step=db.prepare("SELECT checkpoint FROM task_steps WHERE id=?").get(row.id) as {checkpoint:string}|undefined;
        if(step)db.prepare("UPDATE task_steps SET wake_at=NULL WHERE id=?").run(row.id);
        return {id:row.id, body:JSON.parse(row.body),...(step?{checkpoint:JSON.parse(step.checkpoint) as Payload}:{})};
      });
    },
    append(id: string, payload: Payload) {
      transaction(() => { if (get(id)?.status === "running") write(id, payload); });
    },
    finish,
    step(id:string):Payload|undefined{const row=db.prepare("SELECT checkpoint FROM task_steps WHERE id=?").get(id) as {checkpoint:string}|undefined;return row?JSON.parse(row.checkpoint):undefined;},
    clearStep(id:string){return transaction(()=>get(id)?.status==="running"?!!db.prepare("DELETE FROM task_steps WHERE id=?").run(id).changes:false);},
    saveStep(id:string,checkpoint:Payload,event?:Payload){return transaction(()=>{
      if(get(id)?.status!=="running")return false;
      db.prepare("INSERT INTO task_steps VALUES (?,?,NULL) ON CONFLICT(id) DO UPDATE SET checkpoint=excluded.checkpoint").run(id,JSON.stringify(checkpoint));
      if(event)write(id,event);return true;
    });},
    cancelStep(id:string,cancellation:Payload,event?:Payload){return transaction(()=>{
      if(get(id)?.status!=="cancelled")return false;
      const row=db.prepare("SELECT checkpoint FROM task_steps WHERE id=?").get(id) as {checkpoint:string}|undefined;
      if(!row)return false;
      const checkpoint=JSON.parse(row.checkpoint);checkpoint.cancellation={...checkpoint.cancellation,...cancellation};
      db.prepare("UPDATE task_steps SET checkpoint=? WHERE id=?").run(JSON.stringify(checkpoint),id);
      if(event)write(id,{error:"任务已取消。",code:"cancelled",...event,result:checkpoint.cancelledResult});return true;
    });},
    park(id:string,checkpoint:Payload,wakeAt:number,event?:Payload){return transaction(()=>{
      if(get(id)?.status!=="running")return false;
      db.prepare("INSERT INTO task_steps VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET checkpoint=excluded.checkpoint,wake_at=excluded.wake_at").run(id,JSON.stringify(checkpoint),wakeAt);
      const now=Date.now();db.prepare("UPDATE tasks SET updated=? WHERE id=?").run(now,id);if(event)write(id,event,now);return true;
    });},
    cancelledSteps():TaskStep[]{return (db.prepare(`SELECT t.id,t.body,s.checkpoint FROM task_steps s JOIN tasks t ON t.id=s.id
      WHERE t.status='cancelled' AND json_extract(s.checkpoint,'$.cancellation.reconciled') IS NOT 1 ORDER BY t.updated LIMIT 20`).all() as {id:string;body:string;checkpoint:string}[])
      .map(row=>({id:row.id,body:JSON.parse(row.body),checkpoint:JSON.parse(row.checkpoint)}));},
    recoverInterrupted() {
      const rows = db.prepare("SELECT id FROM tasks WHERE status='running'").all() as {id:string}[];
      for (const {id} of rows) {
        if(db.prepare("UPDATE task_steps SET wake_at=? WHERE id=?").run(Date.now(),id).changes){write(id,{stepRecovered:true});continue;}
        finish(id, "failed", {
        error:"后台进程中断。已取得的结果仍可查看，请明确重试未完成的工作。",
        code:"worker_interrupted",
        });
      }
    },
    events(id: string, after: number) {
      return (db.prepare("SELECT seq,at,payload FROM task_events WHERE id=? AND seq>? ORDER BY seq LIMIT 128")
        .all(id, after) as EventRow[]).map(row => ({...JSON.parse(row.payload), seq:row.seq, at:row.at, taskId:id}));
    },
    materialEvents(id:string) {
      return (db.prepare(`SELECT seq,at,payload FROM task_events WHERE id=? AND
        json_type(payload,'$.researchMaterials')='object' ORDER BY seq`)
        .all(id) as EventRow[]).map(row=>({...JSON.parse(row.payload),seq:row.seq,at:row.at,taskId:id}));
    },
    close: () => db.close(),
  };
}
type LocalTaskStore = ReturnType<typeof openTaskStore>;
export type TaskStore = {
  [Method in Exclude<keyof LocalTaskStore,"materialEvents"|"step"|"clearStep"|"saveStep"|"park"|"cancelStep"|"cancelledSteps">]: (...args: Parameters<LocalTaskStore[Method]>) =>
    ReturnType<LocalTaskStore[Method]> | Promise<ReturnType<LocalTaskStore[Method]>>;
}&{materialEvents?:(id:string)=>Payload[]|Promise<Payload[]>;researchHandoff?:(id:string)=>Promise<Payload|undefined>}&{
  [Method in "step"|"clearStep"|"saveStep"|"park"|"cancelStep"|"cancelledSteps"]?:(...args:Parameters<LocalTaskStore[Method]>)=>ReturnType<LocalTaskStore[Method]>|Promise<ReturnType<LocalTaskStore[Method]>>;
};

export type TaskPreparation={checkpoint?:Payload;error?:string};
export function taskRoutes(router: Router, base: string, store: TaskStore, validate: (body: unknown) => string | undefined | Promise<string | undefined>, options:{researchRecords?:boolean;initialCheckpoint?:(id:string,input:unknown)=>Payload|undefined;recoverRecord?:(task:Task)=>Promise<unknown>;
  prepareWhen?:(input:unknown)=>boolean|Promise<boolean>;prepare?:(id:string,input:unknown)=>Promise<TaskPreparation>;onCancelled?:(id:string)=>void}={}) {
  router.param("taskId", (_req, res, next, id) => {
    if (!taskIdPattern.test(id)) { res.status(400).json({error:"无效的任务编号。"}); return; }
    next();
  });
  router.post(base, async (req, res) => {
    const {id, input} = req.body ?? {};
    if (typeof id !== "string" || !taskIdPattern.test(id)) { res.status(400).json({error:"无效的任务编号。"}); return; }
    const prepare=options.prepare&&(!options.prepareWhen||await options.prepareWhen(input))?options.prepare:undefined;
    if(!prepare){const issue=await validate(input);if(issue){res.status(400).json({error:issue});return;}}
    try {
      let checkpoint:Payload|undefined;
      if(prepare&&!await store.get(id)){
        const prepared=await prepare(id,input);
        if(prepared.error){
          // A concurrent first acceptance wins even if authorization was revoked
          // while this request was preparing. submit still checks the input hash.
          if(!await store.get(id)){res.status(400).json({error:prepared.error});return;}
        }else checkpoint=prepared.checkpoint;
      }
      const task = await store.submit(id, input,prepare?checkpoint:options.initialCheckpoint?.(id,input));
      res.status(202).set("Cache-Control", "no-store").json({id, status:task.status, created:task.created});
    } catch (error) {
      if (!(error instanceof TaskConflict)) throw error;
      res.status(409).json({error:error.message});
    }
  });
  router.get(base + "/:taskId", async (req, res) => {
    const task = await store.get(String(req.params.taskId));
    if (!task) { res.status(404).json({error:"任务不存在。"}); return; }
    res.set("Cache-Control", "no-store").json({id:task.id, status:task.status, created:task.created, updated:task.updated});
  });
  if(options.researchRecords)router.get(base+"/:taskId/record",async(req,res)=>{
    const id=String(req.params.taskId);
    const task=await store.get(id);
    const result=(await store.terminal(id))?.result??(task?await options.recoverRecord?.(task):undefined);
    if(!task||!result){res.status(404).json({error:"没有找到已完成的研究记录。"});return;}
    const {query,turnId,conversationId}=JSON.parse(task.body);
    res.set("Cache-Control","no-store").json({id,question:query,turnId,conversationId,created:task.created,updated:task.updated,result});
  });
  router.delete(base + "/:taskId", async (req, res) => {
    const id=String(req.params.taskId);
    if (!await store.get(id)) { res.status(404).json({error:"任务不存在。"}); return; }
    const cancelled = await store.finish(id, "cancelled", {error:"任务已取消。", code:"cancelled"});
    if(cancelled)options.onCancelled?.(id);
    res.sendStatus(cancelled ? 204 : 409);
  });
  router.get(base + "/:taskId/events", async (req, res) => {
    const id = String(req.params.taskId);
    if (!await store.get(id)) { res.status(404).json({error:"任务不存在。"}); return; }
    let cursor = Number(req.query.after ?? 0);
    if (!Number.isSafeInteger(cursor) || cursor < 0) { res.status(400).json({error:"无效的事件序号。"}); return; }
    res.type("application/x-ndjson").set({"Cache-Control":"no-store", "X-Accel-Buffering":"no"}).flushHeaders();
    let heartbeat=Date.now();
    let timer:ReturnType<typeof setTimeout>|undefined;
    res.once("close",()=>clearTimeout(timer));
    async function flush(){
      if(res.destroyed || res.writableEnded)return;
      try{
        if(!res.writableNeedDrain){
          const task=await store.get(id);
          const rows=await store.events(id,cursor);
          if(res.destroyed || res.writableEnded)return;
          let buffered=false;
          for(const event of rows){
            cursor=event.seq;
            if(!res.write(JSON.stringify(event)+"\n")){buffered=true;break;}
          }
          if(!buffered && task && task.status!=="queued"&&task.status!=="running"&&rows.length<128){res.end();return;}
          if(Date.now()-heartbeat>=10000){res.write("\n");heartbeat=Date.now();}
        }
        timer=setTimeout(()=>void flush(),150);
      }catch{res.destroy();}
    }
    await flush();
  });
}

export async function workTasks(store: TaskStore, run: (task: {id:string; body:any;checkpoint?:Payload}, signal: AbortSignal, emit: (payload:Payload) => void) => Promise<Payload|TaskParked>,options:{maintenance?:()=>Promise<void>}={}) {
  await store.recoverInterrupted();
  let active:AbortController|undefined;
  let stopped=false;
  let timer:ReturnType<typeof setTimeout>|undefined;
  let polling:Promise<void>;
  async function poll(){
    if(stopped)return;
    try{
      await options.maintenance?.();
      const task=await store.claim();
      if(!task)return;
      const controller=new AbortController();
      active=controller;
      let checking=false;
      const watch=setInterval(async()=>{
        if(checking)return;
        checking=true;
        try{
          if((await store.get(task.id))?.status==="cancelled")controller.abort(new TaskCancelled());
        }catch{controller.abort();}
        finally{checking=false;}
      },200);
      let pending=Promise.resolve();
      let appendFailed=false;
      try{
        const payload=await run(task,controller.signal,event=>{
          pending=pending.then(async()=>{
            if(!appendFailed)await store.append(task.id,event);
          }).catch(()=>{appendFailed=true;controller.abort();});
        });
        await pending;
        if(appendFailed)throw Error("Could not persist task events");
        if(!(payload instanceof TaskParked))await store.finish(task.id,payload.error?"failed":"complete",payload);
      }catch{
        await pending;
        const checkpoint=controller.signal.aborted&&!appendFailed?await store.step?.(task.id):undefined;
        if(checkpoint){
          if(!stopped&&(await store.get(task.id))?.status==="running")await store.park?.(task.id,checkpoint,Date.now()+500,{stepInterrupted:true,workerReleased:true});
        }else await store.finish(task.id,"failed",{error:"后台执行未完成，请查看已取得的结果。",code:"worker_error"});
      }finally{clearInterval(watch);active=undefined;}
    }catch{console.error("OneEarth task worker could not use its task store");}
    finally{if(!stopped)timer=setTimeout(()=>{polling=poll();},100);}
  }
  polling=poll();
  return ()=>{stopped=true;clearTimeout(timer);active?.abort();return polling;};
}
