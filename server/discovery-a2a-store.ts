import {createHash, randomUUID} from "node:crypto";
import type {Pool, PoolClient} from "pg";
import {TaskConflict, type Payload, type Task} from "./task-store";
import {
  observationResultMatchesRequest, skillRequestKind, skillResultKind, type SkillDemand, type SkillResultSubmission,
} from "./observation-check-contract";
import type {ObservationCheckJob, ObservationCheckRequest, ObservationResearchJob} from "./discovery-observation-job";
import {observationResearchKind, type ObservationResearchRequest} from "./observation-research-contract";

export type StoredDiscoveryEvent = Payload & {seq: number; at: number; taskId: string};
export type DiscoveryProgress = Pick<Task,"id"|"status"|"updated"> & {
  jobId: string; needsInput: boolean; waitingSeq?:number; privateTask:boolean; machineWaiting:boolean;
};
export type DiscoveryContinuation = {id:string; jobId:string; waitingSeq:number};
export class DiscoveryContinuationConflict extends Error {}
export class DiscoveryTaskMissing extends Error {}

type Submission =
  | {body:object; continuation?:DiscoveryContinuation}
  | {observation:ObservationCheckRequest}
  | {observationResearch:ObservationResearchRequest}
  | {taskId:string; receipt:SkillResultSubmission};

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
    ALTER TABLE discovery_a2a_tasks ADD COLUMN IF NOT EXISTS private_task boolean NOT NULL DEFAULT false;
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
  type StatusRow = Omit<DiscoveryProgress,"updated"|"needsInput"|"waitingSeq"|"machineWaiting"> & {
    updated:string; waitingSeq:string|null; machineSeq:string|null; demand:SkillDemand|null; research:boolean;
  };
  const select = `SELECT a.id, t.id AS "jobId",
    CASE WHEN a.private_task AND t.status='queued' AND t.body::jsonb->>'kind'='${skillResultKind}'
      THEN 'running' ELSE t.status END AS status,
    t.updated, a.private_task AS "privateTask",
    terminal."waitingSeq", terminal."machineSeq", terminal.demand,
    a.private_task AND t.body::jsonb->>'kind'='${observationResearchKind}' AS research`;
  const from = `FROM discovery_a2a_tasks a JOIN discovery_tasks t ON t.id=a.current_job_id
    LEFT JOIN LATERAL (
      SELECT CASE WHEN NOT a.private_task AND COALESCE(e.payload->'result'->>'questionCheck',e.payload->'result'->>'clarification') IS NOT NULL
        THEN e.seq END AS "waitingSeq",
        CASE WHEN a.private_task AND jsonb_typeof(e.payload->'skillDemand')='object' THEN e.seq END AS "machineSeq",
        CASE WHEN a.private_task THEN e.payload->'skillDemand' END AS demand
      FROM discovery_events e WHERE e.id=t.id ORDER BY e.seq DESC LIMIT 1
    ) terminal ON t.status='complete' WHERE a.id=$1`;
  function progress(row:StatusRow):DiscoveryProgress {
    const {updated,waitingSeq,machineSeq,demand:_,research:__,...task} = row;
    return {...task,updated:Number(updated),needsInput:waitingSeq !== null,machineWaiting:machineSeq !== null,
      ...(waitingSeq !== null ? {waitingSeq:Number(waitingSeq)} : {})};
  }
  const skillMessageId = (messageId:string) => "\x1fobservation:" + messageId;
  async function submit(messageId:string, fingerprint:string, submission:Submission) {
    return transaction(async db => {
      const privateTask = !("body" in submission);
      const human = "body" in submission ? submission.continuation : undefined;
      const continuing = "receipt" in submission ? submission.taskId : human?.id;
      const id = continuing ?? randomUUID(), job = randomUUID();
      const reserved = await db.query(`INSERT INTO discovery_a2a_delegations VALUES($1,$2,$3,$4)
        ON CONFLICT(message_id) DO NOTHING RETURNING task_id`, [messageId,id,job,fingerprint]);
      if (!reserved.rowCount) {
        const previous = await find(messageId, fingerprint, db);
        if (!previous) throw Error("A2A delegation reservation disappeared");
        return previous;
      }
      let current:StatusRow|undefined;
      if (continuing) {
        // Serialize resume and cancel on the public task before checking the current job.
        await db.query("SELECT id FROM discovery_a2a_tasks WHERE id=$1 FOR UPDATE", [id]);
        current = (await db.query<StatusRow>(select + " " + from,[id])).rows[0];
      }
      let body:object;
      if ("receipt" in submission) {
        if (!current?.privateTask) throw new DiscoveryTaskMissing();
        const {receipt} = submission, demand = current.demand;
        if (!demand || current.machineSeq !== String(receipt.afterSeq) ||
            demand.requestId !== receipt.requestId || !observationResultMatchesRequest(receipt.result,demand.check))
          throw new DiscoveryContinuationConflict("观测核对结果与当前待续接的需求、序号或资料版本不匹配。");
        body = {kind:skillResultKind,demand,receipt,...(current.research ? {research:true as const} : {})} satisfies ObservationCheckJob;
      } else if ("observation" in submission) {
        body = {kind:skillRequestKind,input:submission.observation} satisfies ObservationCheckJob;
      } else if ("observationResearch" in submission) {
        body = {kind:observationResearchKind,input:submission.observationResearch} satisfies ObservationResearchJob;
      } else {
        if (human && (current?.privateTask || current?.jobId !== human.jobId || current.waitingSeq !== String(human.waitingSeq))) {
          throw new DiscoveryContinuationConflict("该委托已结束或已受理另一条确认。");
        }
        body = submission.body;
      }
      if (continuing) await db.query("UPDATE discovery_a2a_tasks SET current_job_id=$2 WHERE id=$1",[id,job]);
      else await db.query("INSERT INTO discovery_a2a_tasks(id,current_job_id,private_task) VALUES($1,$2,$3)",[id,job,privateTask]);
      const raw = JSON.stringify(body);
      const hash = createHash("sha256").update(raw).digest("hex");
      const now = Date.now();
      await db.query(`INSERT INTO discovery_tasks(id,body,fingerprint,status,created,updated)
        VALUES($1,$2,$3,'queued',$4,$4)`, [job,raw,hash,now]);
      await write(db,job,now,{queued:true,queuedAt:now});
      return id;
    });
  }
  return {
    find,
    findAccepted: (messageId:string, fingerprint:string, observation:boolean) =>
      find(observation ? skillMessageId(messageId) : messageId, fingerprint),
    submit: (messageId:string, fingerprint:string, body:object, continuation?:DiscoveryContinuation) =>
      submit(messageId,fingerprint,{body,continuation}),
    submitObservationCheck: (messageId:string, fingerprint:string, observation:ObservationCheckRequest) =>
      submit(skillMessageId(messageId),fingerprint,{observation}),
    submitObservationResearch: (messageId:string, fingerprint:string, observationResearch:ObservationResearchRequest) =>
      submit(skillMessageId(messageId),fingerprint,{observationResearch}),
    acceptObservationResult: (messageId:string, fingerprint:string, taskId:string, receipt:SkillResultSubmission) =>
      submit(skillMessageId(messageId),fingerprint,{taskId,receipt}),
    async jobDelegation(id:string) {
      const {rows} = await pool.query<{taskId:string;messageId:string}>(
        'SELECT task_id AS "taskId", message_id AS "messageId" FROM discovery_a2a_delegations WHERE job_id=$1',[id]);
      return rows[0];
    },
    async hasJob(id: string) {
      const result = await pool.query("SELECT 1 FROM discovery_a2a_delegations WHERE job_id=$1",[id]);
      return !!result.rowCount;
    },
    async progress(id:string): Promise<DiscoveryProgress|undefined> {
      const row = (await pool.query<StatusRow>(select + " " + from,[id])).rows[0];
      if (row) return progress(row);
    },
    async snapshot(id: string, after = 0, limit?: number, allowPrivate = false) {
      const {rows} = await pool.query<StatusRow & {events:StoredDiscoveryEvent[]}>(`
        ${select}, COALESCE((
          SELECT jsonb_agg(event.payload || jsonb_build_object('seq',event.seq,'at',event.at,'taskId',a.id) ORDER BY event.seq)
          FROM (
            SELECT e.seq,e.at,e.payload
            FROM discovery_a2a_delegations d JOIN discovery_events e ON e.id=d.job_id
            WHERE d.task_id=a.id AND e.seq>$2 ORDER BY e.seq LIMIT $3
          ) event
        ),'[]'::jsonb) AS events
        ${from} AND ($4 OR NOT a.private_task)`, [id,after,limit ?? null,allowPrivate]);
      if (rows[0]) {
        const {events,...task} = rows[0];
        return {task:progress(task),events};
      }
    },
    async cancel(id: string, allowPrivate = false) {
      return transaction(async db => {
      const task = await db.query("SELECT id FROM discovery_a2a_tasks WHERE id=$1 AND ($2 OR NOT private_task) FOR UPDATE",
        [id,allowPrivate]);
      if (!task.rowCount) return "missing";
        // Lock the worker job too so its terminal result and our decision are consistent.
        await db.query("SELECT current_job_id FROM discovery_a2a_tasks a JOIN discovery_tasks t ON t.id=a.current_job_id WHERE a.id=$1 FOR UPDATE OF t",[id]);
        const current = (await db.query<StatusRow>(select + " " + from,[id])).rows[0];
      if (!current) return "missing";
        if (current.status === "cancelled") return "cancelled";
      if (current.waitingSeq === null && current.machineSeq === null && current.status !== "queued" && current.status !== "running")
        return "terminal";
        const now = Date.now();
        await db.query("UPDATE discovery_tasks SET status='cancelled',updated=$2 WHERE id=$1",[current.jobId,now]);
        await write(db,current.jobId,now,{error:"任务已取消。",code:"cancelled"});
        return "cancelled";
      });
    },
  };
}

export type DiscoveryA2aStore = Awaited<ReturnType<typeof discoveryA2aStore>>;
