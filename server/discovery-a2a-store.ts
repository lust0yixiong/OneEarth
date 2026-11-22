import {createHash, randomUUID} from "node:crypto";
import type {Pool, PoolClient} from "pg";
import {TaskConflict, type Payload, type Task} from "./task-store";

export type StoredDiscoveryEvent = Payload & {seq: number; at: number; taskId: string};
export type DiscoveryProgress = Pick<Task,"id"|"status"|"updated"> & {jobId: string; needsInput: boolean; waitingSeq?:number};
export type DiscoveryContinuation = {id:string; jobId:string; waitingSeq:number};
export class DiscoveryContinuationConflict extends Error {}

export async function discoveryA2aStore(pool: Pool) {
  async function transaction<T>(run: (db:PoolClient) => Promise<T>) {
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      const result = await run(db);
      await db.query("COMMIT");
      return result;
    } catch (error) {
      await db.query("ROLLBACK").catch(() => {});
      throw error;
    } finally { db.release(); }
  }
  // Worker jobs and their event log still own all work and evidence. A2A only
  // adds a public task identity and associates its submission messages with jobs.
  await transaction(async db => {
    await db.query("SELECT pg_advisory_xact_lock(7142522::bigint)");
    await db.query(`
    CREATE TABLE IF NOT EXISTS discovery_a2a_tasks (
      id uuid PRIMARY KEY,
      current_job_id uuid NOT NULL REFERENCES discovery_tasks(id) DEFERRABLE INITIALLY DEFERRED
    );
    CREATE TABLE IF NOT EXISTS discovery_a2a_delegations (
      message_id text PRIMARY KEY,
      task_id uuid NOT NULL REFERENCES discovery_a2a_tasks(id) DEFERRABLE INITIALLY DEFERRED,
      job_id uuid NOT NULL UNIQUE REFERENCES discovery_tasks(id) DEFERRABLE INITIALLY DEFERRED,
      request_fingerprint text NOT NULL
    );
    CREATE INDEX IF NOT EXISTS discovery_a2a_task_jobs ON discovery_a2a_delegations(task_id);
    `);
  });
  async function find(messageId: string, fingerprint: string, db: Pick<Pool,"query"> = pool) {
    const {rows} = await db.query<{task_id:string; request_fingerprint:string}>(
      "SELECT task_id,request_fingerprint FROM discovery_a2a_delegations WHERE message_id=$1", [messageId]);
    const previous = rows[0];
    if (previous && previous.request_fingerprint !== fingerprint)
      throw new TaskConflict("该 messageId 已经用于其他发现委托。");
    return previous?.task_id;
  }
  async function write(db:PoolClient, id:string, at:number, payload:Payload) {
    await db.query("INSERT INTO discovery_events(id,at,payload) VALUES($1,$2,$3::jsonb)",[id,at,JSON.stringify(payload)]);
  }
  type StatusRow = Omit<DiscoveryProgress,"updated"|"needsInput"|"waitingSeq"> & {updated:string;waitingSeq:string|null};
  const select = `SELECT a.id, t.id AS "jobId", t.status, t.updated, terminal.seq AS "waitingSeq"`;
  const from = `FROM discovery_a2a_tasks a JOIN discovery_tasks t ON t.id=a.current_job_id
    LEFT JOIN LATERAL (
      SELECT CASE WHEN COALESCE(e.payload->'result'->>'questionCheck',e.payload->'result'->>'clarification') IS NOT NULL
        THEN e.seq END AS seq
      FROM discovery_events e WHERE e.id=t.id ORDER BY e.seq DESC LIMIT 1
    ) terminal ON t.status='complete' WHERE a.id=$1`;
  function progress(row:StatusRow):DiscoveryProgress {
    const {updated,waitingSeq,...task} = row;
    return {...task,updated:Number(updated),needsInput:waitingSeq !== null,
      ...(waitingSeq !== null ? {waitingSeq:Number(waitingSeq)} : {})};
  }
  return {
    find,
    async submit(messageId: string, fingerprint: string, body: object, continuation?: DiscoveryContinuation) {
      return transaction(async db => {
        const id = continuation?.id ?? randomUUID(), job = randomUUID();
        const reserved = await db.query(`INSERT INTO discovery_a2a_delegations VALUES($1,$2,$3,$4)
          ON CONFLICT(message_id) DO NOTHING RETURNING task_id`, [messageId,id,job,fingerprint]);
        if (!reserved.rowCount) {
          const previous = await find(messageId, fingerprint, db);
          if (!previous) throw Error("A2A delegation reservation disappeared");
          return previous;
        }
        if (continuation) {
          // Serialize resume and cancel on the public task before checking the current job.
          await db.query("SELECT id FROM discovery_a2a_tasks WHERE id=$1 FOR UPDATE", [id]);
          const current = (await db.query<StatusRow>(select + " " + from,[id])).rows[0];
          if (current?.jobId !== continuation.jobId || current.waitingSeq !== String(continuation.waitingSeq))
            throw new DiscoveryContinuationConflict("该委托已结束或已受理另一条确认。");
          await db.query("UPDATE discovery_a2a_tasks SET current_job_id=$2 WHERE id=$1",[id,job]);
        } else {
          await db.query("INSERT INTO discovery_a2a_tasks VALUES($1,$2)",[id,job]);
        }
        const raw = JSON.stringify(body);
        const hash = createHash("sha256").update(raw).digest("hex");
        const now = Date.now();
        await db.query(`INSERT INTO discovery_tasks(id,body,fingerprint,status,created,updated)
          VALUES($1,$2,$3,'queued',$4,$4)`, [job,raw,hash,now]);
        await write(db,job,now,{queued:true,queuedAt:now});
        return id;
      });
    },
    async hasJob(id: string) {
      const result = await pool.query("SELECT 1 FROM discovery_a2a_delegations WHERE job_id=$1",[id]);
      return !!result.rowCount;
    },
    async progress(id:string): Promise<DiscoveryProgress|undefined> {
      const row = (await pool.query<StatusRow>(select + " " + from,[id])).rows[0];
      if (row) return progress(row);
    },
    async snapshot(id: string, after = 0, limit?: number) {
      const {rows} = await pool.query<StatusRow & {events:StoredDiscoveryEvent[]}>(`
        ${select}, COALESCE((
          SELECT jsonb_agg(event.payload || jsonb_build_object('seq',event.seq,'at',event.at,'taskId',a.id) ORDER BY event.seq)
          FROM (
            SELECT e.seq,e.at,e.payload
            FROM discovery_a2a_delegations d JOIN discovery_events e ON e.id=d.job_id
            WHERE d.task_id=a.id AND e.seq>$2 ORDER BY e.seq LIMIT $3
          ) event
        ),'[]'::jsonb) AS events
        ${from}`, [id,after,limit ?? null]);
      if (rows[0]) {
        const {events,...task} = rows[0];
        return {task:progress(task),events};
      }
    },
    async cancel(id: string) {
      return transaction(async db => {
        await db.query("SELECT id FROM discovery_a2a_tasks WHERE id=$1 FOR UPDATE",[id]);
        // Lock the worker job too so its terminal result and our decision are consistent.
        await db.query("SELECT current_job_id FROM discovery_a2a_tasks a JOIN discovery_tasks t ON t.id=a.current_job_id WHERE a.id=$1 FOR UPDATE OF t",[id]);
        const current = (await db.query<StatusRow>(select + " " + from,[id])).rows[0];
        if (!current) return "missing";
        if (current.status === "cancelled") return "cancelled";
        if (current.waitingSeq === null && current.status !== "queued" && current.status !== "running") return "terminal";
        const now = Date.now();
        await db.query("UPDATE discovery_tasks SET status='cancelled',updated=$2 WHERE id=$1",[current.jobId,now]);
        await write(db,current.jobId,now,{error:"任务已取消。",code:"cancelled"});
        return "cancelled";
      });
    },
  };
}

export type DiscoveryA2aStore = Awaited<ReturnType<typeof discoveryA2aStore>>;
