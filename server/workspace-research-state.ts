import {createHash} from "node:crypto";
import {isDeepStrictEqual} from "node:util";
import {setTimeout as pause} from "node:timers/promises";
import type {Router} from "express";
import type {Pool,PoolClient} from "pg";
import {productDatabase} from "./product-database";
import {spatialCoverageClient} from "./spatial-coverage-client";
import type {GridCoverageEvidence} from "../src/domain/grid-coverage";
import {normalizeResearchCoverage,readWorkspaceResearchAction,readWorkspaceResearchObservation,workspaceIdPattern,
  type WorkspaceResearchAction,type WorkspaceResearchErrorCode,type WorkspaceResearchReference,
  type WorkspaceResearchState} from "../src/domain/workspace-research-state";

const schema=`
  CREATE TABLE IF NOT EXISTS runtime_workspace_research_states (
    conversation_id uuid PRIMARY KEY,
    revision bigint NOT NULL CHECK(revision > 0),
    action_id uuid NOT NULL,
    range jsonb
  );
  CREATE TABLE IF NOT EXISTS runtime_workspace_research_actions (
    conversation_id uuid NOT NULL,
    action_id uuid NOT NULL,
    digest text NOT NULL,
    origin jsonb NOT NULL,
    decision jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(conversation_id,action_id)
  );`;

const messages:Record<WorkspaceResearchErrorCode,string>={
  WORKSPACE_REVISION_CONFLICT:"会话研究范围已变化，请读取当前范围后重新确认。",
  WORKSPACE_ACTION_ID_CONFLICT:"该动作编号已用于另一份提交。",
  WORKSPACE_COVERAGE_STALE:"覆盖句柄已过期或发布修订已更新，请明确重新采用。",
  WORKSPACE_COVERAGE_UNAVAILABLE:"时空服务暂时无法确认原选格的覆盖。",
  WORKSPACE_ACTION_NOT_AUTHORIZED:"本轮没有仍有效的研究范围操作授权。",
  WORKSPACE_STATE_UNAVAILABLE:"会话研究范围暂时无法读取。",
};
type Decision={status:200;state:WorkspaceResearchState} |
  {status:409|503;code:WorkspaceResearchErrorCode;error:string;state?:WorkspaceResearchState};
type Origin={source:"workspace"} | {source:"chat";runId:string;turnId:string};
type StateRow={revision:string;action_id:string;range:WorkspaceResearchState["range"]};
type ActionRow={digest:string;decision:Decision};
type Reader=Pool|PoolClient;
type Coverage=ReturnType<typeof spatialCoverageClient>;
type ResearchScope=NonNullable<WorkspaceResearchState["range"]>["scope"];
type BoundState=WorkspaceResearchState&{range:NonNullable<WorkspaceResearchState["range"]>};

function rejected(status:409|503,code:WorkspaceResearchErrorCode,state?:WorkspaceResearchState):Decision {
  return {status,code,error:messages[code],...(state?{state}:{})};
}
function digestAction(action:WorkspaceResearchAction) {
  const {kind,expectedRevision}=action;
  // Hash only the frozen conditions and publication identity. A scope handle
  // may expire or be reissued without changing the intended action.
  const range=kind==="adopt-research-range"?{
    place:action.range.scope.place,revision:action.range.scope.coverageScope.revision,
    summary:action.range.scope.coverageScope.summary,
  }:null;
  return createHash("sha256").update(JSON.stringify({kind,expectedRevision,range})).digest("hex");
}
async function read(db:Reader,conversationId:string):Promise<WorkspaceResearchState> {
  const row=(await db.query<StateRow>(`SELECT revision,action_id,range FROM runtime_workspace_research_states
    WHERE conversation_id=$1`,[conversationId])).rows[0];
  return {conversationId,revision:Number(row?.revision??0),actionId:row?.action_id??null,range:row?.range??null};
}
async function previous(db:Reader,conversationId:string,actionId:string,digest:string):Promise<Decision|undefined> {
  const saved=(await db.query<ActionRow>(`SELECT digest,decision FROM runtime_workspace_research_actions
    WHERE conversation_id=$1 AND action_id=$2`,[conversationId,actionId])).rows[0];
  if(saved)return saved.digest===digest?saved.decision:rejected(409,"WORKSPACE_ACTION_ID_CONFLICT");
}
async function lock(db:PoolClient,conversationId:string){
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,7142581))",[conversationId]);
}

export class WorkspaceResearchConflict extends Error {
  readonly code="WORKSPACE_REVISION_CONFLICT";
  constructor(readonly state:WorkspaceResearchState){super(messages.WORKSPACE_REVISION_CONFLICT);}
}

export async function assertWorkspaceResearchBinding(
  db:PoolClient,conversationId:string,reference:WorkspaceResearchReference,
) {
  await lock(db,conversationId);
  await requireWorkspaceResearchReference(db,conversationId,reference);
}
async function requireWorkspaceResearchReference(db:Reader,conversationId:string,reference:WorkspaceResearchReference):Promise<BoundState>{
  const state=await read(db,conversationId);
  if(!state.range||state.revision!==reference.revision||state.actionId!==reference.actionId)
    throw new WorkspaceResearchConflict(state);
  return {...state,range:state.range};
}

export function sameWorkspaceCoverageSummary(a:ResearchScope["coverageScope"]["summary"],b:ResearchScope["coverageScope"]["summary"]) {
  return isDeepStrictEqual(normalizeResearchCoverage(a),normalizeResearchCoverage(b));
}

export async function readWorkspaceResearchCoverage(scope:Omit<ResearchScope,"conditionRevision">,coverage:Coverage,signal:AbortSignal,allowRebind=false):Promise<GridCoverageEvidence> {
  const {selection,coverageScope}=scope;
  const deadline=AbortSignal.any([signal,AbortSignal.timeout(4500)]);
  let attachment=coverageScope;
  const unknown=(reason:"unavailable"|"pending"|"expired")=>({
    cellId:selection.id,gridKey:selection.grid.key,revision:coverageScope.revision,status:"unknown" as const,reason,
  });
  let timedOut:"unavailable"|"pending"="unavailable";
  try {
    for(;;){
      const checked=await coverage({cell:selection,scope:attachment},deadline);
      if(checked.status==="ready") {
        if(checked.scopeId!==attachment.id||checked.revision!==coverageScope.revision||
          !checked.summary||!sameWorkspaceCoverageSummary(checked.summary,coverageScope.summary))return unknown("expired");
        return checked;
      }
      if(checked.reason==="expired") {
        if(!allowRebind||attachment!==coverageScope||!coverage.rebind||coverageScope.summary.candidateCount!==null)return unknown("expired");
        const renewed=await coverage.rebind(coverageScope,deadline);
        if(typeof renewed==="string")return unknown(renewed);
        if(renewed.revision!==coverageScope.revision||!sameWorkspaceCoverageSummary(renewed.summary,coverageScope.summary))
          return unknown("expired");
        attachment=renewed;
        continue;
      }
      if(checked.reason==="unavailable")return unknown("unavailable");
      timedOut="pending";
      await pause(120,undefined,{signal:deadline});
    }
  } catch {
    signal.throwIfAborted();
    return unknown(timedOut);
  }
}

export async function workspaceResearchStateStore(pool=productDatabase("RUNTIME"),coverage=spatialCoverageClient()){
  try{await pool.query(schema);}catch(error){await pool.end();throw error;}
  async function apply(conversationId:string,input:WorkspaceResearchAction,origin:Origin,signal:AbortSignal=new AbortController().signal):Promise<Decision>{
    const action=readWorkspaceResearchAction(input);
    if(!action||!workspaceIdPattern.test(conversationId))throw Error("研究范围操作无效。");
    const digest=digestAction(action);
    const replay=await previous(pool,conversationId,action.actionId,digest);
    const observed=await read(pool,conversationId);
    const checked=!replay&&observed.revision<=action.expectedRevision&&action.kind==="adopt-research-range"
      ?await readWorkspaceResearchCoverage(action.range.scope,coverage,signal):undefined;
    const db=await pool.connect();
    try{
      await db.query("BEGIN");
      await lock(db,conversationId);
      const replay=await previous(db,conversationId,action.actionId,digest);
      if(replay){await db.query("COMMIT");return replay;}
      signal.throwIfAborted();
      const state=await read(db,conversationId);
      let decision:Decision;
      const taskObservation=origin.source==="chat"?(await db.query<{observation:unknown}>(`SELECT body::jsonb->'serverWorkspaceResearchAction' AS observation FROM runtime_chat_messages
        WHERE id=$1 AND status='planning' AND body::jsonb->>'conversationId'=$2 AND body::jsonb->>'turnId'=$3
        AND body::jsonb->'serverWorkspaceResearchAction'->>'actionId'=$4 FOR UPDATE`,
        [origin.runId,conversationId,origin.turnId,action.actionId])).rows[0]:undefined;
      const authorized=readWorkspaceResearchObservation(taskObservation?.observation);
      if(origin.source==="chat"&&(!authorized||authorized.expectedRevision!==action.expectedRevision||
        action.kind==="adopt-research-range"&&!isDeepStrictEqual(authorized.range,action.range))){
        decision=rejected(409,"WORKSPACE_ACTION_NOT_AUTHORIZED");
      }else if(state.revision!==action.expectedRevision){
        decision=rejected(409,"WORKSPACE_REVISION_CONFLICT",state);
      }else if(action.kind==="adopt-research-range"&&(checked?.status!=="ready"||!checked.summary)){
        decision=checked?.status==="unknown"&&checked.reason==="expired"?rejected(409,"WORKSPACE_COVERAGE_STALE"):rejected(503,"WORKSPACE_COVERAGE_UNAVAILABLE");
      }else{
        signal.throwIfAborted();
        const revision=state.revision+1;
        const range=action.kind==="adopt-research-range"&&checked?.status==="ready"&&checked.summary?{scope:{
          kind:"grid" as const,selection:checked.summary.selection,place:action.range.scope.place,conditionRevision:revision,
          coverageScope:{id:checked.scopeId,revision:checked.revision,summary:normalizeResearchCoverage(checked.summary)},
        }}:null;
        await db.query(`INSERT INTO runtime_workspace_research_states VALUES($1,$2,$3,$4)
          ON CONFLICT(conversation_id) DO UPDATE SET revision=EXCLUDED.revision,action_id=EXCLUDED.action_id,range=EXCLUDED.range`,
          [conversationId,revision,action.actionId,range]);
        decision={status:200,state:{conversationId,revision,actionId:action.actionId,range}};
      }
      await db.query(`INSERT INTO runtime_workspace_research_actions
        (conversation_id,action_id,digest,origin,decision) VALUES($1,$2,$3,$4,$5)`,[conversationId,action.actionId,digest,origin,decision]);
      await db.query("COMMIT");
      return decision;
    }catch(error){
      await db.query("ROLLBACK").catch(()=>{});
      throw error;
    }finally{db.release();}
  }
  return {
    read:(conversationId:string)=>read(pool,conversationId),
    bind:(conversationId:string,reference:WorkspaceResearchReference)=>requireWorkspaceResearchReference(pool,conversationId,reference),
    apply,
    close:()=>pool.end(),
  };
}

export type WorkspaceResearchStateStore=Awaited<ReturnType<typeof workspaceResearchStateStore>>;

export function workspaceResearchStateRoutes(router:Router,store:WorkspaceResearchStateStore){
  router.param("conversationId",(_req,res,next,id)=>{
    if(typeof id!=="string"||!workspaceIdPattern.test(id)){res.status(400).json({error:"会话编号无效。"});return;}
    next();
  });
  router.get("/api/workspaces/:conversationId/research-state",async(req,res)=>{
    res.set("Cache-Control","no-store");
    try{res.json(await store.read(req.params.conversationId));}
    catch{res.status(503).json(rejected(503,"WORKSPACE_STATE_UNAVAILABLE"));}
  });
  router.post("/api/workspaces/:conversationId/actions",async(req,res)=>{
    res.set("Cache-Control","no-store");
    if(!req.is("application/json")){res.status(415).json({error:"研究范围动作需要 application/json。"});return;}
    const action=readWorkspaceResearchAction(req.body);
    if(!action){res.status(400).json({error:"研究范围动作或原覆盖条件无效。"});return;}
    try{
      const decision=await store.apply(req.params.conversationId,action,{source:"workspace"});
      if(decision.status===200)res.json(decision.state);
      else res.status(decision.status).json({error:decision.error,code:decision.code,...(decision.state?{state:decision.state}:{})});
    }catch{res.status(503).json({error:messages.WORKSPACE_STATE_UNAVAILABLE,code:"WORKSPACE_STATE_UNAVAILABLE"});}
  });
}
