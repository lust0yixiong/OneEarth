import {createHash} from "node:crypto";
import type {Pool, PoolClient} from "pg";
import {TaskConflict, taskIdPattern, type Payload, type Task} from "./task-store";
import {validClarificationAnswer} from "../src/domain/clarification";

type ChatStatus = "planning" | "handed_off" | "complete" | "failed" | "cancelled";
type ChatRow = Omit<Task, "status"> & {status: ChatStatus};
type Transaction = <T>(work: (client: PoolClient) => Promise<T>) => Promise<T>;
type Queue = (db: PoolClient, id: string, body: unknown, checkpoint?: Payload, options?: {
  created: number; handoff: true;
}) => Promise<Task>;

export const chatSchema = `
  CREATE TABLE IF NOT EXISTS runtime_chat_messages (
    id uuid PRIMARY KEY, body text NOT NULL, fingerprint text NOT NULL,
    status text NOT NULL CHECK(status IN ('planning','handed_off','complete','failed','cancelled')),
    created bigint NOT NULL, updated bigint NOT NULL, terminal jsonb, handoff jsonb
  );
  CREATE INDEX IF NOT EXISTS runtime_chat_planning ON runtime_chat_messages(id) WHERE status='planning';
  CREATE TABLE IF NOT EXISTS runtime_chat_events (
    seq bigint PRIMARY KEY DEFAULT nextval(pg_get_serial_sequence('runtime_events','seq')),
    id uuid NOT NULL REFERENCES runtime_chat_messages(id), at bigint NOT NULL, payload jsonb NOT NULL
  );
  CREATE INDEX IF NOT EXISTS runtime_chat_events_replay ON runtime_chat_events(id,seq);
  CREATE TABLE IF NOT EXISTS runtime_clarification_answers (
    parent_task_id uuid PRIMARY KEY,
    answer_id uuid NOT NULL UNIQUE
  );
`;

export const submissionFingerprint = (raw: string) => createHash("sha256").update(raw).digest("hex");

/** Serializes legacy task acceptance and Chat acceptance for the same ID. */
export async function lockRuntimeSubmission(db: PoolClient, id: string) {
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended(($1::uuid)::text,7142530))", [id]);
}

/** Called only for first admission, in the same transaction as the receipt. */
export async function claimClarificationAnswer(db:PoolClient, id:string, input:unknown) {
  const body=input as {clarificationAnswer?:unknown;clarificationReply?:unknown} | null;
  const legacy=body?.clarificationAnswer===undefined;
  const answer=legacy?body?.clarificationReply:body?.clarificationAnswer;
  if(answer===undefined)return;
  const parent=(answer as {parentTaskId?:unknown}|null)?.parentTaskId;
  if(typeof parent!=="string"||!taskIdPattern.test(parent)||
    (!legacy&&!validClarificationAnswer(answer))||parent.toLowerCase()===id.toLowerCase()){
    throw new TaskConflict("本轮补充与原追问编号不一致。");
  }
  const claim=await db.query(`INSERT INTO runtime_clarification_answers(parent_task_id,answer_id)
    VALUES($1,$2) ON CONFLICT(parent_task_id) DO NOTHING`,[parent,id]);
  if(!claim.rowCount)throw new TaskConflict("这条追问已有一份提交，请查看原答复的进度。");
}

function view(row: ChatRow): Task {
  return {...row, status: row.status === "planning" ? "running" : row.status === "handed_off" ? "queued" : row.status,
    created: Number(row.created), updated: Number(row.updated)};
}

export function postgresChatMessages(pool: Pool, transaction: Transaction, queue: Queue) {
  let owner: PoolClient | undefined;
  const columns = "id,body,fingerprint,status,created,updated";
  async function write(db: PoolClient, id: string, payload: Payload, now: number) {
    await db.query("INSERT INTO runtime_chat_events(id,at,payload) VALUES ($1,$2,$3)", [id, now, payload]);
  }
  async function find(db: Pool | PoolClient, id: string) {
    return (await db.query<ChatRow>(`SELECT ${columns} FROM runtime_chat_messages WHERE id=$1`, [id])).rows[0];
  }
  async function finish(db: PoolClient, id: string, status: "complete" | "failed" | "cancelled", payload: Payload) {
    const now = Date.now();
    const updated = await db.query("UPDATE runtime_chat_messages SET status=$2,terminal=$3,updated=$4 WHERE id=$1 AND status='planning'",
      [id, status, payload, now]);
    if (!updated.rowCount) return false;
    await write(db, id, payload, now);
    return true;
  }
  return {
    async existing(db: PoolClient, id: string) { const row = await find(db, id); return row && view(row); },
    async get(id: string) { const row = await find(pool, id); return row && view(row); },
    async terminal(id: string) {
      return (await pool.query<{terminal: Payload | null}>("SELECT terminal FROM runtime_chat_messages WHERE id=$1", [id])).rows[0]?.terminal ?? undefined;
    },
    async latestCompleted(conversationId: string) {
      return (await pool.query<{id: string}>(`
        SELECT id FROM (
          SELECT id,created FROM runtime_chat_messages WHERE status='complete' AND body::jsonb->>'conversationId'=$1
          UNION ALL
          SELECT id,created FROM runtime_tasks WHERE status='complete' AND body::jsonb->>'conversationId'=$1
        ) AS conversation
        ORDER BY created DESC,id DESC LIMIT 1`, [conversationId])).rows[0]?.id;
    },
    async acquire() {
      const client = await pool.connect();
      try {
        if (!(await client.query("SELECT pg_try_advisory_lock(7142531) AS acquired")).rows[0].acquired)
          throw Error("同一运行时任务库已有 Chat 接收进程。");
        // An interrupted plan may have reached the model. Keep the original ID
        // and acknowledge interruption instead of issuing another model call.
        await transaction(async db => {
          const {rows} = await db.query<{id: string}>("SELECT id FROM runtime_chat_messages WHERE status='planning'");
          for (const {id} of rows)
            await finish(db, id, "failed", {error: "服务重启中断了本轮消息。请重新发送以继续。", code: "chat_interrupted"});
        });
        client.on("error", () => {
          console.error("OneEarth Chat lost its PostgreSQL ownership");
          process.exit(1);
        });
        owner = client;
      } catch (error) { client.release(true); throw error; }
    },
    async admit(id: string, body: unknown, limit: number) {
      return transaction(async db => {
        await db.query("SELECT pg_advisory_xact_lock(7142532)");
        await lockRuntimeSubmission(db, id);
        const raw = JSON.stringify(body), fingerprint = submissionFingerprint(raw);
        const task = (await db.query<Task>(`SELECT ${columns} FROM runtime_tasks WHERE id=$1`, [id])).rows[0];
        const existing = task ?? (await find(db, id));
        if (existing) {
          if (existing.fingerprint !== fingerprint) throw new TaskConflict("该消息编号已经用于另一份提交。");
          const current = task ? {...task, created: Number(task.created), updated: Number(task.updated)} : view(existing as ChatRow);
          return {task: current, started: false};
        }
        const {rows} = await db.query<{active: number}>("SELECT count(*)::int AS active FROM runtime_chat_messages WHERE status='planning'");
        if (rows[0].active >= limit) return;
        await claimClarificationAnswer(db,id,body);
        const now = Date.now();
        const {rows: [saved]} = await db.query<ChatRow>(`
          INSERT INTO runtime_chat_messages(id,body,fingerprint,status,created,updated)
          VALUES ($1,$2,$3,'planning',$4,$4) RETURNING ${columns}`, [id, raw, fingerprint, now]);
        await write(db, id, {chatPhase: "foreground"}, now);
        return {task: view(saved), started: true};
      });
    },
    async append(id: string, event: Payload) {
      await transaction(async db => {
        const result = await db.query("SELECT id FROM runtime_chat_messages WHERE id=$1 AND status='planning' FOR UPDATE", [id]);
        if (result.rowCount) await write(db, id, event, Date.now());
      });
    },
    finish: (id: string, status: "complete" | "failed", payload: Payload) => transaction(db => finish(db, id, status, payload)),
    cancel: (db: PoolClient, id: string, payload: Payload) => finish(db, id, "cancelled", payload),
    async promote(id: string, handoff?: Payload, checkpoint?: Payload) {
      return transaction(async db => {
        const {rows: [message]} = await db.query<{body: string; created: string}>(`
          SELECT body,created FROM runtime_chat_messages WHERE id=$1 AND status='planning' FOR UPDATE`, [id]);
        if (!message) return false;
        await queue(db, id, JSON.parse(message.body), checkpoint, {created: Number(message.created), handoff: true});
        await db.query("UPDATE runtime_chat_messages SET status='handed_off',handoff=$2,updated=$3 WHERE id=$1",
          [id, handoff ?? null, Date.now()]);
        return true;
      });
    },
    async handoff(id: string) {
      return (await pool.query<{handoff: Payload | null}>(
        "SELECT handoff FROM runtime_chat_messages WHERE id=$1 AND status='handed_off'", [id])).rows[0]?.handoff ?? undefined;
    },
    release() { owner?.release(true); owner = undefined; },
  };
}

export type PostgresChatMessages = ReturnType<typeof postgresChatMessages>;
