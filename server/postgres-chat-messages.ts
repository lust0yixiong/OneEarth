import {assertWorkspaceResearchBinding} from "./workspace-research-state";
import type {WorkspaceResearchReference} from "../src/domain/workspace-research-state";
import {newWorkspaceEffect,retainedWorkspaceEffectResult,saveWorkspaceEffect} from "./postgres-workspace-effects";
import type {WorkspaceEffectCommand} from "../src/domain/workspace-action-effect";
import {readAgUiWorkspaceRecord,pendingAgUiWorkspaceCalls,bindAgUiWorkspaceReplies,agUiWorkspaceResults,type AgUiWorkspaceReply} from "./postgres-ag-ui-workspace";
import {readAgUiInterrupt,pendingAgUiInterrupt,readAgUiOperationInterrupt} from "./postgres-ag-ui-interrupt";
import {agUiSchema,admitAgUi,appendAgUiText,finishAgUi,projectAgUiProgress,projectAgUiResearchProgress,projectAgUiSummary,type AgUiAdmission} from "./ag-ui-persistence";
import {createHash} from "node:crypto";
import {isDeepStrictEqual} from "node:util";
import type {RuntimeStepState} from "./runtime-step";
import type {OneEarthOperationReply} from "../src/domain/native-ag-ui";
import type {Pool, PoolClient} from "pg";
import {TaskConflict, taskIdPattern, type Payload, type Task} from "./task-store";
import {validClarificationAnswer} from "../src/domain/clarification";
import type {BrowserWorkspaceReceipt, WorkspaceReceipt, WorkspaceRecoveryInput, WorkspaceRecoveryAdvice} from "../src/domain/turn-context";
import type {DiscoveryResponse} from "../src/domain/types";
import {workspaceObservationTarget} from "../src/domain/workspace-published-layer";
import {runtimeTurnFingerprint,type RuntimeTurnInput} from "./runtime-turn-handoff";

const sameReceiptIdentity = (id:string,body:RuntimeTurnInput,result:DiscoveryResponse|undefined,input:Pick<BrowserWorkspaceReceipt,"effectId"|"conversationId"|"turnId">) =>
  input.conversationId===body.conversationId&&input.turnId===body.turnId&&result?.workspaceEffect?.state==="proposed"&&
  input.effectId===result.workspaceEffect.effectId&&input.effectId==="workspace:"+id;

function sameRecoveryWorkspace(body:RuntimeTurnInput, current:WorkspaceRecoveryInput, now:number) {
  const original=body.context.workspaceView,previous=body.context.browserTurnFrame;
  const {workspaceView:latest,browserTurnFrame:frame}=current;
  if(!original||!previous?.capturedAt||frame.capturedAt<previous.capturedAt||frame.capturedAt<now-30000||frame.capturedAt>now+5000)return false;
  const view=(value:typeof original)=>{
    const {display:_display,activeLayer,...rest}=value;
    if(!activeLayer)return rest;
    const {display:_layerDisplay,...layer}=activeLayer;
    return {...rest,activeLayer:layer};
  };
  const globe=(value:typeof previous.globe)=>value?{focusId:value.focusId,
    layers:value.layers.map(({presentation:_presentation,...layer})=>layer)}:undefined;
  return isDeepStrictEqual(view(original),view(latest))&&isDeepStrictEqual(globe(previous.globe),globe(frame.globe));
}

function workspaceReceiptView(receipt:WorkspaceReceipt|undefined) {
  if(receipt?.recovery?.state==="running"&&Date.now()-receipt.recovery.observedAt>40000)
    return {...receipt,recovery:{...receipt.recovery,state:"failed" as const}};
  return receipt;
}


type ChatStatus = "planning" | "handed_off" | "complete" | "failed" | "cancelled";
type ChatRow = Omit<Task, "status"> & {status: ChatStatus};
type Transaction = <T>(work: (client: PoolClient) => Promise<T>) => Promise<T>;
type Queue = (db: PoolClient, id: string, body: unknown, checkpoint?: Payload, options?: {
  created: number; handoff: true;workspaceEffectExpires?:number;
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
  CREATE TABLE IF NOT EXISTS runtime_workspace_receipts (
    task_id uuid PRIMARY KEY REFERENCES runtime_chat_messages(id),
    receipt jsonb NOT NULL
  );
` + agUiSchema;

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
  if((await db.query("SELECT 1 FROM runtime_agui_interrupts WHERE id=$1 AND operation_id IS NOT NULL",[parent])).rowCount)
    throw new TaskConflict("这条追问需要原操作和步骤编号。");
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
    const saved=await db.query<{seq:string}>("INSERT INTO runtime_chat_events(id,at,payload) VALUES ($1,$2,$3) RETURNING seq", [id, now, payload]);
    await projectAgUiProgress(db,id,payload);
    await projectAgUiResearchProgress(db,id,payload);
    await projectAgUiSummary(db,id,payload,saved.rows[0].seq);
  }
  async function find(db: Pool | PoolClient, id: string) {
    return (await db.query<ChatRow>(`SELECT ${columns} FROM runtime_chat_messages WHERE id=$1`, [id])).rows[0];
  }
  async function finish(db: PoolClient, id: string, status: "complete" | "failed" | "cancelled", payload: Payload) {
    const now = Date.now();
    const updated = await db.query("UPDATE runtime_chat_messages SET status=$2,terminal=$3,updated=$4 WHERE id=$1 AND status='planning'",
      [id, status, payload, now]);
    if (!updated.rowCount) return false;
    await finishAgUi(db,id,status,payload);
    await write(db, id, payload, now);
    return true;
  }
  async function getReceipt(db:Pool|PoolClient,id:string) {
    return (await db.query<{receipt:WorkspaceReceipt}>("SELECT receipt FROM runtime_workspace_receipts WHERE task_id=$1",[id])).rows[0]?.receipt;
  }
  async function lockWorkspaceReply(db:PoolClient,id:string) {
    const {rows:[saved]}=await db.query<{body:string;terminal:Payload}>(
      "SELECT body,terminal FROM runtime_chat_messages WHERE id=$1 AND status='complete' FOR UPDATE",[id]);
    if(saved)return {body:JSON.parse(saved.body) as RuntimeTurnInput,result:saved.terminal?.result as DiscoveryResponse|undefined};
  }
  async function updateReceipt(db:PoolClient,id:string,receipt:WorkspaceReceipt) {
    await db.query("UPDATE runtime_workspace_receipts SET receipt=$2 WHERE task_id=$1",[id,receipt]);
    return receipt;
  }
  return {
    async existing(db: PoolClient, id: string) { const row = await find(db, id); return row && view(row); },
    async get(id: string) { const row = await find(pool, id); return row && view(row); },
    async terminal(id: string) {
      return (await pool.query<{terminal: Payload | null}>("SELECT terminal FROM runtime_chat_messages WHERE id=$1", [id])).rows[0]?.terminal ?? undefined;
    },
    async workspaceReceipt(id:string) {
      return workspaceReceiptView(await getReceipt(pool,id));
    },
    async recordWorkspaceReceipt(id:string,input:BrowserWorkspaceReceipt,nativeToolCallId?:string) {
      return transaction(async db=>{
        const saved=await lockWorkspaceReply(db,id);
        if(!saved||!sameReceiptIdentity(id,saved.body,saved.result,input))return;
        if(nativeToolCallId&&(await readAgUiWorkspaceRecord(db,id))?.call.id!==nativeToolCallId)return;
        const observation=input.observation,now=Date.now();
        if(input.flight){
          const center=saved.result?.camera?.center;
          if(saved.result?.flightCatalogue!==true||!center||input.flight.observedAt>now+10000)return;
          if(input.flight.state==="arrived"){
            const [lon,lat]=input.flight.ground.point;
            if(Math.abs((((lon-center[0]+180)%360+360)%360)-180)>.5||Math.abs(lat-center[1])>.5)return;
          }
        }else if(saved.result?.flightCatalogue===true&&input.state==="applied")return;
        if(observation){
          const target=workspaceObservationTarget(saved.result);
          if(!target||observation.datasetId!==target.datasetId||observation.valueId!==target.valueId||
             observation.publicationRevision!==target.publicationRevision||observation.observedAt>now+10000)return;
        }
        const prior=await getReceipt(db,id);
        if(prior){
          if(input.flight&&!isDeepStrictEqual(input.flight,prior.flight))
            throw new TaskConflict("本轮飞行已有一份不同结果的回执。");
          if(prior.state!==input.state||input.reason!==undefined&&prior.reason!==input.reason)
            throw new TaskConflict("本轮操作已有一份不同结果的回执。");
          if(!observation||prior.observation?.state===observation.state||
             observation.state==="loading"&&prior.observation)return workspaceReceiptView(prior);
          if(prior.observation&&prior.observation.state!=="loading")
            throw new TaskConflict("图层已经记录了最终显示结果。");
          if(prior.observation&&observation.observedAt<prior.observation.observedAt)return workspaceReceiptView(prior);
          return updateReceipt(db,id,{...prior,observation,observationReportedAt:now});
        }
        const receipt:WorkspaceReceipt={...input,taskId:id,reportedAt:now,...(observation?{observationReportedAt:now}:{})};
        await db.query("INSERT INTO runtime_workspace_receipts(task_id,receipt) VALUES($1,$2)",[id,receipt]);
        return receipt;
      });
    },
    async claimWorkspaceRecovery(id:string,input:WorkspaceRecoveryInput) {
      return transaction(async db=>{
        const saved=await lockWorkspaceReply(db,id);
        if(!saved?.result||!sameReceiptIdentity(id,saved.body,saved.result,input)||!workspaceObservationTarget(saved.result))return;
        const prior=await getReceipt(db,id),now=Date.now();
        if(prior?.state!=="failed"||prior.reason!=="publication-unverified")return;
        if(prior.recovery)return {receipt:workspaceReceiptView(prior)!};
        if(now-prior.reportedAt>30000||!sameRecoveryWorkspace(saved.body,input,now))return;
        const receipt=await updateReceipt(db,id,{...prior,recovery:{state:"running",observedAt:input.browserTurnFrame.capturedAt}});
        return {...saved,result:saved.result,receipt};
      });
    },
    async finishWorkspaceRecovery(id:string,advice?:WorkspaceRecoveryAdvice) {
      return transaction(async db=>{
        if(!await lockWorkspaceReply(db,id))return;
        const prior=await getReceipt(db,id);
        if(prior?.recovery?.state!=="running")return prior;
        return updateReceipt(db,id,{...prior,recovery:{observedAt:prior.recovery.observedAt,
          ...(advice?{state:"complete",...advice}:{state:"failed"})}});
      });
    },
    async latestCompleted(conversationId: string) {
      return (await pool.query<{id: string}>(`
        SELECT id FROM (
          SELECT id,created FROM runtime_chat_messages WHERE status='complete' AND body::jsonb->>'conversationId'=$1
          UNION ALL
          SELECT id,created FROM runtime_tasks WHERE task_type='run' AND status='complete' AND body::jsonb->>'conversationId'=$1
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
    async admit(id: string, body: unknown, limit: number, agUi?:AgUiAdmission, research?:WorkspaceResearchReference) {
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
        if(research && agUi)await assertWorkspaceResearchBinding(db,agUi.threadId,research);
        if(!agUi?.resume)await claimClarificationAnswer(db,id,body);
        const now = Date.now();
        const {rows: [saved]} = await db.query<ChatRow>(`
          INSERT INTO runtime_chat_messages(id,body,fingerprint,status,created,updated)
          VALUES ($1,$2,$3,'planning',$4,$4) RETURNING ${columns}`, [id, raw, fingerprint, now]);
        if(agUi)await admitAgUi(db,id,agUi,body as RuntimeTurnInput);
        if(agUi?.resume?.operation){
          if(agUi.resume.status==="cancelled"){
            await finish(db,id,"cancelled",{error:"研究者明确放弃原追问。",code:"cancelled"});
            return {task:view({...saved,status:"cancelled"}),started:true};
          }
          const checkpoint:RuntimeStepState={kind:"runtime-turn-step.v1",fingerprint:runtimeTurnFingerprint(body as RuntimeTurnInput),
            startedAt:now,models:[],delegations:[],ids:{},windows:[]};
          const task=await queue(db,id,body,checkpoint,{created:now,handoff:true});
          await db.query("UPDATE runtime_chat_messages SET status='handed_off' WHERE id=$1",[id]);
          return {task,started:true};
        }
        await write(db, id, {chatPhase: "foreground"}, now);
        return {task: view(saved), started: true};
      });
    },
    agUiWorkspaceRecord:(id:string)=>readAgUiWorkspaceRecord(pool,id),
    async agUiWorkspaceCall(id:string){return (await readAgUiWorkspaceRecord(pool,id))?.call;},
    agUiPendingWorkspaceCalls:(threadId:string)=>pendingAgUiWorkspaceCalls(pool,threadId),
    checkAgUiWorkspace:(threadId:string,previousTaskId:string|undefined,replies:AgUiWorkspaceReply[])=>bindAgUiWorkspaceReplies(pool,threadId,previousTaskId,replies),
    agUiWorkspaceResults:(runId:string,threadId:string)=>agUiWorkspaceResults(pool,runId,threadId),
    async agUiFingerprint(id:string){return (await pool.query<{fingerprint:string}>("SELECT fingerprint FROM runtime_agui_runs WHERE id=$1",[id])).rows[0]?.fingerprint;},
    agUiInterrupt:(id:string)=>readAgUiInterrupt(pool,id),
    agUiPending:(threadId:string)=>pendingAgUiInterrupt(pool,threadId),
    agUiOperationInterrupt:(threadId:string,operation:OneEarthOperationReply)=>readAgUiOperationInterrupt(pool,threadId,operation),
    async agUiEvents(id:string,after=0){return (await pool.query<{seq:string;event:Payload}>("SELECT seq,event FROM runtime_agui_events WHERE run_id=$1 AND seq>$2 ORDER BY seq LIMIT 128",[id,after])).rows.map(row=>({seq:Number(row.seq),event:row.event}));},
    async appendAgUiText(id:string,delta:string){return transaction(async db=>{
      if(!(await db.query("SELECT id FROM runtime_chat_messages WHERE id=$1 AND status='planning' FOR UPDATE",[id])).rowCount)return false;
      return appendAgUiText(db,id,delta);
    });},
    async append(id: string, event: Payload) {
      await transaction(async db => {
        const result = await db.query("SELECT id FROM runtime_chat_messages WHERE id=$1 AND status='planning' FOR UPDATE", [id]);
        if (result.rowCount) await write(db, id, event, Date.now());
      });
    },
    finish: (id: string, status: "complete" | "failed", payload: Payload) => transaction(db => finish(db, id, status, payload)),
    cancel: (db: PoolClient, id: string, payload: Payload) => finish(db, id, "cancelled", payload),
    async waitForWorkspaceEffect(id:string,body:RuntimeTurnInput,pageHash:string,command:WorkspaceEffectCommand,result:DiscoveryResponse){
      const retained=retainedWorkspaceEffectResult(result);
      if(command.kind==="flight")retained.message="已为本轮保存飞行目标。目录查询须等待原页面的真实到达回执。";
      return transaction(async db=>{
        const {rows:[message]}=await db.query<{body:string;created:string}>(
          "SELECT body,created FROM runtime_chat_messages WHERE id=$1 AND status='planning' FOR UPDATE",[id]);
        if(!message)return false;
        const original=JSON.parse(message.body) as RuntimeTurnInput;
        if(original.conversationId!==body.conversationId||original.turnId!==body.turnId)throw Error("工作台待办归属不一致。");
        const now=Date.now(),effect=newWorkspaceEffect({runId:id,conversationId:body.conversationId,turnId:body.turnId},command,now);
        const checkpoint={kind:"workspace-action-effect.v1",effectId:effect.effectId,result:retained,cancelledResult:retained,failedResult:retained};
        await queue(db,id,original,checkpoint,{created:Number(message.created),handoff:true,workspaceEffectExpires:effect.expiresAt});
        await saveWorkspaceEffect(db,effect,pageHash,now);
        await db.query("UPDATE runtime_chat_messages SET status='handed_off',updated=$2 WHERE id=$1",[id,now]);
        return true;
      });
    },
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
