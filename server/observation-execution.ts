import {createHash,randomUUID} from "node:crypto";
import {isDeepStrictEqual} from "node:util";
import {setTimeout as wait} from "node:timers/promises";
import type {PoolClient} from "pg";
import {productDatabase} from "./product-database";
import {observationArtifact} from "./observation-artifacts";
import {executeObservationRead,type ObservationReadReceipt} from "./observation-adapter";
import {
  parseObservationCheck,observationResultMatchesRequest,validObservationResult,validObservationEvidence,
  type ObservationCheck,type ObservationCheckResult,type SkillExecutionRequest,
} from "./observation-check-contract";

export {authorizeObservationCheck} from "./observation-artifacts";

type Mode="suspend"|"retained";
type Stage="A"|"B"|"C";
type State="queued"|"running"|"waiting"|"done";
type Lane="regular"|"reserved";
type Outcome=ObservationCheckResult;
type Root={
  id:string; research_id:string; discovery_id:string; input:ObservationCheck; sha256:string;
  reservation:number|null; mode:Mode; outcome:Outcome|null;
};
type Call={
  id:string; root_id:string; parent_id:string|null; stage:Stage; state:State;
  lane:Lane|null; slot:number|null; lease:string|null; outcome:Outcome|ObservationReadReceipt|null;
};
type Claimed=Call & {lane:Lane;slot:number;lease:string;root:Root};

const schedulerLock="7239031040";
const transactionLock="7239031041";
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const cancelled:Outcome={status:"cancelled",reason:"parent_cancelled"};

function capacity(name:string,fallback:number,min:number,max:number){
  const count=Number(process.env[name]??fallback);
  if(!Number.isInteger(count)||count<min||count>max)throw Error(name+" is outside the supported capacity");
  return count;
}

function freeSlot(count:number,used:Set<number>):number|undefined {
  for(let slot=1;slot<=count;slot++)if(!used.has(slot))return slot;
}

async function event(db:PoolClient,rootId:string,call:Pick<Call,"id"|"parent_id">|null,
  kind:string,detail:Record<string,unknown>={}){
  await db.query(`INSERT INTO observation_skill_events(root_id,call_id,parent_id,kind,detail)
    VALUES($1,$2,$3,$4,$5::jsonb)`,[rootId,call?.id??null,call?.parent_id??null,kind,JSON.stringify(detail)]);
}

async function finishCall(db:PoolClient,call:Call,outcome:Outcome|ObservationReadReceipt){
  await db.query(`UPDATE observation_skill_calls SET state='done',lane=NULL,slot=NULL,lease=NULL,outcome=$2::jsonb WHERE id=$1`,
    [call.id,JSON.stringify(outcome)]);
  await event(db,call.root_id,call,"finished",{stage:call.stage,outcome});
}

async function wakeParent(db:PoolClient,call:Call){
  if(!call.parent_id)return;
  const parent=(await db.query<Call>(`UPDATE observation_skill_calls AS c SET state='queued'
    FROM observation_skill_runs r WHERE c.id=$1 AND c.state='waiting' AND c.root_id=r.id
    AND r.mode='suspend' AND r.outcome IS NULL RETURNING c.*`,[call.parent_id])).rows[0];
  if(parent)await event(db,call.root_id,parent,"step_ready",{childId:call.id});
}

type ReadReceipt = {
  callId:string; rootId:string; parentId:string; lease:string; outcome:ObservationReadReceipt;
};

/** The adapter's durable write-back. The transaction covers receipt, C completion, and B eligibility. */
export async function persistObservationReadReceipt(db:PoolClient,receipt:ReadReceipt){
  const outcome=receipt.outcome;
  if(outcome.status==="read"?!validObservationEvidence(outcome.evidence):
     !validObservationResult(outcome))return "conflict";
  await db.query("SELECT pg_advisory_xact_lock($1::bigint)",[transactionLock]);
  const call=(await db.query<Call>(`SELECT * FROM observation_skill_calls
    WHERE id=$1 AND stage='C' AND root_id=$2 AND parent_id=$3 FOR UPDATE`,
    [receipt.callId,receipt.rootId,receipt.parentId])).rows[0];
  if(!call)return "stale";
  const previous=(await db.query<{lease:string;outcome:ObservationReadReceipt}>(
    "SELECT lease,outcome FROM observation_read_receipts WHERE call_id=$1",[call.id])).rows[0];
  if(previous){
    if(previous.lease!==receipt.lease)return "stale";
    return isDeepStrictEqual(previous.outcome,outcome)?"duplicate":"conflict";
  }
  if(call.state!=="running"||call.lease!==receipt.lease)return "stale";
  await db.query("INSERT INTO observation_read_receipts(call_id,lease,outcome) VALUES($1,$2,$3::jsonb)",
    [call.id,receipt.lease,JSON.stringify(outcome)]);
  await finishCall(db,call,outcome);
  await wakeParent(db,call);
  return "saved";
}

/** One persistent coordinator per runtime database. Slots are enforced at the real claim boundary. */
export async function observationExecution(){
  const registry=process.env.ONEEARTH_SKILL_REGISTRY;
  if(!registry||!process.env.ONEEARTH_SKILL_SERVICE_TOKEN||process.env.ONEEARTH_SKILL_SERVICE_TOKEN.length<32)
    throw Error("Observation Skill requires an approved registry and service authorization");
  const mode=process.env.ONEEARTH_SKILL_MODE??"suspend";
  if(mode!=="suspend"&&mode!=="retained")throw Error("Invalid observation execution mode");
  const regularCount=capacity("ONEEARTH_SKILL_CAPACITY",1,1,8);
  const reserveCount=mode==="retained"?capacity("ONEEARTH_SKILL_CHILD_CAPACITY",1,0,8):0;
  const pool=productDatabase("RUNTIME");
  const active=new Map<string,{rootId:string;controller:AbortController;done:Promise<void>}>();
  let stopped=false;
  let timer:ReturnType<typeof setTimeout>|undefined;
  let tick:Promise<void>|undefined;

  async function transaction<T>(run:(db:PoolClient)=>Promise<T>):Promise<T>{
    const db=await pool.connect();
    try{
      await db.query("BEGIN");
      await db.query("SELECT pg_advisory_xact_lock($1::bigint)",[transactionLock]);
      const result=await run(db);
      await db.query("COMMIT");
      return result;
    }catch(error){
      await db.query("ROLLBACK").catch(()=>{});
      throw error;
    }finally{db.release();}
  }

  const owner=await pool.connect().catch(async error=>{await pool.end();throw error;});
  try{
    if(!(await owner.query("SELECT pg_try_advisory_lock($1::bigint) AS locked",[schedulerLock])).rows[0].locked)
      throw Error("Observation Skill already has a coordinator on this runtime database");
    owner.on("error",()=>{
      stopped=true;clearTimeout(timer);
      for(const job of active.values())job.controller.abort();
    });
    await transaction(async db=>{
      await db.query(`
        CREATE TABLE IF NOT EXISTS observation_skill_runs (
          id uuid PRIMARY KEY, research_id uuid NOT NULL, discovery_id uuid NOT NULL,
          fingerprint text NOT NULL, input jsonb NOT NULL, sha256 text NOT NULL, mode text NOT NULL,
          reservation smallint, outcome jsonb, created timestamptz NOT NULL DEFAULT now()
        );
        CREATE UNIQUE INDEX IF NOT EXISTS observation_skill_reservation
          ON observation_skill_runs(reservation) WHERE reservation IS NOT NULL AND outcome IS NULL;
        CREATE TABLE IF NOT EXISTS observation_skill_calls (
          id uuid PRIMARY KEY, root_id uuid NOT NULL REFERENCES observation_skill_runs(id),
          parent_id uuid REFERENCES observation_skill_calls(id), stage text NOT NULL,
          state text NOT NULL, lane text, slot smallint, lease uuid, outcome jsonb, UNIQUE(root_id,stage),
          CHECK(state IN ('queued','running','waiting','done')), CHECK(stage IN ('A','B','C'))
        );
        CREATE UNIQUE INDEX IF NOT EXISTS observation_skill_slot
          ON observation_skill_calls(lane,slot) WHERE slot IS NOT NULL;
        CREATE TABLE IF NOT EXISTS observation_skill_events (
          seq bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
          root_id uuid NOT NULL REFERENCES observation_skill_runs(id), call_id uuid, parent_id uuid,
          kind text NOT NULL, detail jsonb NOT NULL, recorded timestamptz NOT NULL DEFAULT clock_timestamp()
        );
        CREATE TABLE IF NOT EXISTS observation_skill_cancelled (id uuid PRIMARY KEY);
        CREATE TABLE IF NOT EXISTS observation_read_receipts (
          call_id uuid PRIMARY KEY REFERENCES observation_skill_calls(id),
          lease uuid NOT NULL, outcome jsonb NOT NULL
        );
      `);
      // Interrupted reads are ambiguous. A completed read is never re-issued on restart.
      const interrupted=(await db.query<Call>(`SELECT * FROM observation_skill_calls WHERE stage='C' AND state='running'`)).rows;
      for(const call of interrupted){
        const outcome:Outcome={status:"unknown",reason:"read_interrupted"};
        await finishCall(db,call,outcome);
        await wakeParent(db,call);
      }
      await db.query(`UPDATE observation_skill_calls SET state='queued',lane=NULL,slot=NULL,lease=NULL
        WHERE stage<>'C' AND state='running' AND slot IS NOT NULL`);
    });
  }catch(error){
    owner.release(true);
    await pool.end();
    throw error;
  }

  async function insertCall(db:PoolClient,rootId:string,parentId:string|null,stage:Stage,state:State="queued"){
    const id=randomUUID();
    const call=(await db.query<Call>(`INSERT INTO observation_skill_calls(id,root_id,parent_id,stage,state)
      VALUES($1,$2,$3,$4,$5) RETURNING *`,[id,rootId,parentId,stage,state])).rows[0];
    await event(db,rootId,call,"requested",{stage,state});
    return call;
  }

  async function callFor(db:Pick<PoolClient,"query">,rootId:string,stage:Stage){
    return (await db.query<Call>("SELECT * FROM observation_skill_calls WHERE root_id=$1 AND stage=$2",[rootId,stage])).rows[0];
  }

  async function current(db:PoolClient,call:Claimed){
    return (await db.query<Call>("SELECT * FROM observation_skill_calls WHERE id=$1 AND lease=$2 AND state='running'",
      [call.id,call.lease])).rows[0];
  }

  async function finishRoot(db:PoolClient,root:Root,outcome:Outcome){
    const updated=await db.query(`UPDATE observation_skill_runs SET outcome=$2::jsonb,reservation=NULL
      WHERE id=$1 AND outcome IS NULL`,[root.id,JSON.stringify(outcome)]);
    if(updated.rowCount)await event(db,root.id,null,"result_saved",{outcome});
  }

  async function claim():Promise<Claimed|undefined>{
    return transaction(async db=>{
      const calls=(await db.query<Call>(`SELECT c.* FROM observation_skill_calls c JOIN observation_skill_runs r ON r.id=c.root_id
        WHERE c.state='queued' AND r.outcome IS NULL ORDER BY r.created,r.id,c.stage`)).rows;
      const used=(await db.query<Pick<Call,"lane"|"slot">>("SELECT lane,slot FROM observation_skill_calls WHERE slot IS NOT NULL")).rows;
      const regular=freeSlot(regularCount,new Set(used.flatMap(x=>x.lane==="regular"&&x.slot!==null?[x.slot]:[])));
      for(const call of calls){
        const root=(await db.query<Root>("SELECT * FROM observation_skill_runs WHERE id=$1",[call.root_id])).rows[0];
        let lane:Lane="regular";
        let slot=regular;
        if(root.mode==="retained"&&call.stage==="C"){
          lane="reserved";
          const ancestor=await callFor(db,root.id,"A");
          if(ancestor?.state!=="running"||root.reservation===null||root.reservation>reserveCount||
             used.some(x=>x.lane==="reserved"&&x.slot===root.reservation))continue;
          slot=root.reservation;
        }
        if(slot===undefined)continue;
        if(root.mode==="retained"&&call.stage==="A"&&root.reservation===null&&!(await callFor(db,root.id,"B"))){
          const taken=(await db.query<{reservation:number}>(`SELECT reservation FROM observation_skill_runs
            WHERE outcome IS NULL AND reservation IS NOT NULL`)).rows;
          const reservation=freeSlot(reserveCount,new Set(taken.map(x=>x.reservation)));
          if(reservation!==undefined){
            await db.query("UPDATE observation_skill_runs SET reservation=$2 WHERE id=$1",[root.id,reservation]);
            root.reservation=reservation;
            await event(db,root.id,call,"capacity_reserved",{pool:"reserved",slot:reservation});
          }
        }
        const lease=randomUUID();
        await db.query(`UPDATE observation_skill_calls SET state='running',lane=$2,slot=$3,lease=$4 WHERE id=$1`,
          [call.id,lane,slot,lease]);
        await event(db,root.id,call,"slot_claimed",{stage:call.stage,pool:lane,slot,pid:process.pid,lease});
        return {...call,state:"running",lane,slot,lease,root};
      }
    });
  }

  function verifyObservation(root:Root,receipt:Call["outcome"]):Outcome {
    if(receipt?.status!=="read"){
      if(validObservationResult(receipt)&&receipt.status!=="verified")return receipt;
      return {status:"failed",reason:"result_provenance"};
    }
    const e=receipt.evidence;
    const check=root.input;
    if(!validObservationEvidence(e)||e.sha256!==root.sha256||
       e.artifactId!==check.artifactId||e.version!==check.version||e.variable!==check.variable)
      return {status:"failed",reason:"result_provenance"};
    return {status:"verified",evidence:e,
      matches:e.unit===check.unit&&e.first!==null&&e.last!==null&&e.first<=check.start&&e.last>=check.end};
  }

  function deliverAssessment(root:Root,assessment:Call["outcome"]):Outcome {
    if(validObservationResult(assessment)&&observationResultMatchesRequest(assessment,root.input))return assessment;
    return {status:"failed",reason:"result_provenance"};
  }

  async function suspendable(call:Claimed){
    await transaction(async db=>{
      if(!await current(db,call))return;
      const childStage=call.stage==="A"?"B":"C";
      const child=await callFor(db,call.root_id,childStage)??await insertCall(db,call.root_id,call.id,childStage);
      if(child.parent_id!==call.id)throw Error("Unexpected observation step dependency");
      if(!child.outcome){
        await db.query(`UPDATE observation_skill_calls SET state='waiting',lane=NULL,slot=NULL,lease=NULL WHERE id=$1`,[call.id]);
        await event(db,call.root_id,call,"slot_released",{stage:call.stage,slot:call.slot,waitingFor:child.id});
        return;
      }
      const outcome=call.stage==="B"?verifyObservation(call.root,child.outcome):deliverAssessment(call.root,child.outcome);
      await event(db,call.root_id,call,"result_consumed",{childId:child.id});
      await finishCall(db,call,outcome);
      if(call.stage==="A")await finishRoot(db,call.root,outcome);
      else await wakeParent(db,call);
    });
  }

  async function runInlineVerification(a:Claimed,b:Call,signal:AbortSignal):Promise<Outcome|undefined>{
    const child=await transaction(async db=>{
      if(!await current(db,a))return;
      let c=await callFor(db,b.root_id,"C");
      if(!c)c=await insertCall(db,b.root_id,b.id,"C");
      if(c.parent_id!==b.id)throw Error("Unexpected observation reader parent");
      if(!c.outcome&&c.state==="queued"&&(a.root.reservation===null||a.root.reservation>reserveCount)){
        const outcome:Outcome={status:"not_started",reason:"no_reserved_capacity"};
        await event(db,b.root_id,c,"not_started",{reason:outcome.reason});
        await finishCall(db,c,outcome);
        c={...c,state:"done",outcome};
      }
      await event(db,b.root_id,b,"inline_wait",{waitingFor:c.id,inheritedLease:a.lease});
      return c;
    });
    if(!child)return;
    let delivered=child;
    while(!delivered.outcome){
      signal.throwIfAborted();
      await wait(40,undefined,{signal});
      const latest=await callFor(pool,b.root_id,"C");
      if(!latest||latest.id!==child.id)throw Error("Observation reader binding was lost");
      delivered=latest;
    }
    if(stopped)return;
    return transaction(async db=>{
      if(!await current(db,a))return;
      const assessment=verifyObservation(a.root,delivered.outcome);
      await event(db,b.root_id,b,"result_consumed",{childId:delivered.id});
      await finishCall(db,b,assessment);
      return assessment;
    });
  }

  async function withInlineB(a:Claimed,signal:AbortSignal){
    const b=await transaction(async db=>{
      if(!await current(db,a))return;
      const previous=await callFor(db,a.root_id,"B");
      const step=previous??await insertCall(db,a.root_id,a.id,"B","running");
      if(step.parent_id!==a.id)throw Error("Unexpected observation verification parent");
      if(!previous)await event(db,a.root_id,step,"inline_started",{inheritedLease:a.lease,slot:a.slot,pid:process.pid});
      await event(db,a.root_id,a,"retained_wait",{waitingFor:step.id,slot:a.slot});
      return step;
    });
    if(!b)return;
    // This call executes B on A's stack and retains A's ordinary lease.
    const assessment=b.outcome??await runInlineVerification(a,b,signal);
    if(!assessment||stopped)return;
    await transaction(async db=>{
      if(!await current(db,a))return;
      const outcome=deliverAssessment(a.root,assessment);
      await event(db,a.root_id,a,"result_consumed",{childId:b.id});
      await finishCall(db,a,outcome);
      await finishRoot(db,a.root,outcome);
    });
  }

  async function readC(call:Claimed,signal:AbortSignal){
    const {artifactId,version,variable}=call.root.input;
    const outcome=await executeObservationRead({artifactId,version,variable},registry!,call.root.sha256,call.id,signal,
      (kind,detail)=>transaction(async db=>{
        if(!await current(db,call))throw Error("read admission revoked");
        await event(db,call.root_id,call,kind,detail);
      }));
    if(stopped)return;
    if(!call.parent_id)throw Error("Missing observation reader parent");
    const receipt={callId:call.id,rootId:call.root_id,parentId:call.parent_id,lease:call.lease,outcome};
    const disposition=await transaction(db=>persistObservationReadReceipt(db,receipt));
    if(disposition==="conflict")throw Error("Observation reader receipt conflicts with its archived version");
  }

  async function fail(call:Claimed){
    await transaction(async db=>{
      if(!await current(db,call))return;
      const outcome:Outcome={status:"unknown",reason:"execution_interrupted"};
      if(call.stage==="C"){
        await finishCall(db,call,outcome);
        await wakeParent(db,call);
        return;
      }
      const pending=(await db.query<Call>(`SELECT * FROM observation_skill_calls WHERE root_id=$1 AND state<>'done'`,[call.root_id])).rows;
      for(const child of pending)await finishCall(db,child,outcome);
      await finishRoot(db,call.root,outcome);
    });
    if(call.stage!=="C")for(const job of active.values())if(job.rootId===call.root_id)job.controller.abort();
  }

  async function poll(){
    while(!stopped){
      const call=await claim();
      if(!call)return;
      if(stopped)return;
      const controller=new AbortController();
      const execute=call.stage==="C"?readC:
        call.root.mode==="retained"?withInlineB:suspendable;
      const done=execute(call,controller.signal).catch(async()=>{
        if(!stopped)await fail(call);
      }).catch(()=>console.error("OneEarth observation execution could not persist a result"))
        .finally(()=>active.delete(call.id));
      active.set(call.id,{rootId:call.root_id,controller,done});
    }
  }

  function schedule(){
    if(stopped)return;
    tick=poll().catch(()=>console.error("OneEarth observation execution could not claim work")).finally(()=>{
      if(!stopped)timer=setTimeout(schedule,40).unref();
    });
  }
  schedule();

  return {
    async submit(request:SkillExecutionRequest){
      const {requestId,researchTaskId,discoveryTaskId}=request;
      const check=parseObservationCheck(request.check);
      if(!check||![requestId,researchTaskId,discoveryTaskId].every(v=>typeof v==="string"&&uuid.test(v)))
        throw Error("Invalid observation execution request");
      const fingerprint=createHash("sha256").update(JSON.stringify({researchTaskId,discoveryTaskId,check})).digest("hex");
      const grant=await observationArtifact(check,registry).catch(()=>undefined);
      await transaction(async db=>{
        const previous=(await db.query<{fingerprint:string}>("SELECT fingerprint FROM observation_skill_runs WHERE id=$1",[requestId])).rows[0];
        if(previous){
          if(previous.fingerprint!==fingerprint)throw Error("Observation request identity was already used with different input");
          return;
        }
        const wasCancelled=!!(await db.query("SELECT 1 FROM observation_skill_cancelled WHERE id=$1",[requestId])).rowCount;
        const outcome:Outcome|null=wasCancelled?cancelled:grant?null:{status:"not_started",reason:"artifact_not_authorized"};
        await db.query(`INSERT INTO observation_skill_runs(id,research_id,discovery_id,fingerprint,input,sha256,mode,outcome)
          VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8::jsonb)`,
          [requestId,researchTaskId,discoveryTaskId,fingerprint,JSON.stringify(check),grant?.sha256??"",mode,outcome&&JSON.stringify(outcome)]);
        await event(db,requestId,null,"accepted");
        if(outcome)await event(db,requestId,null,"result_saved",{outcome});
        else await insertCall(db,requestId,null,"A");
      });
    },
    async result(requestId:string):Promise<Outcome|undefined>{
      return (await pool.query<{outcome:Outcome|null}>("SELECT outcome FROM observation_skill_runs WHERE id=$1",[requestId])).rows[0]?.outcome??undefined;
    },
    async cancel(requestId:string){
      await transaction(async db=>{
        await db.query("INSERT INTO observation_skill_cancelled VALUES($1) ON CONFLICT DO NOTHING",[requestId]);
        const root=(await db.query<Root>("SELECT * FROM observation_skill_runs WHERE id=$1 AND outcome IS NULL",[requestId])).rows[0];
        if(!root)return;
        const pending=(await db.query<Call>(`SELECT * FROM observation_skill_calls WHERE root_id=$1 AND state<>'done'`,[root.id])).rows;
        for(const call of pending)await finishCall(db,call,cancelled);
        await finishRoot(db,root,cancelled);
      });
      for(const job of active.values())if(job.rootId===requestId)job.controller.abort();
    },
    async close(){
      stopped=true;
      clearTimeout(timer);
      await tick;
      for(const job of active.values())job.controller.abort();
      await Promise.allSettled([...active.values()].map(job=>job.done));
      owner.release(true);
      await pool.end();
    },
  };
}
