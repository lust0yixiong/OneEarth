import {randomUUID} from "node:crypto";
import {isDeepStrictEqual} from "node:util";
import type {Pool,PoolClient} from "pg";
import {cataloguePresentationTarget} from "../src/domain/catalogue-presentation";
import type {WorkspaceActionEffect,WorkspaceEffectCommand,WorkspaceEffectReceipt} from "../src/domain/workspace-action-effect";
import type {DiscoveryResponse} from "../src/domain/types";
import {publicAgUiResponse,writeAgUiWorkspaceEffect} from "./ag-ui-persistence";
import {runtimeTaskLease} from "./runtime-task-lease";
import {workspacePageHash} from "./ag-ui-input";

export const workspaceEffectsSchema=`
  CREATE TABLE IF NOT EXISTS runtime_workspace_action_effects (
    run_id uuid PRIMARY KEY REFERENCES runtime_tasks(id),
    effect_id uuid UNIQUE NOT NULL,
    page_hash text NOT NULL,
    started_at bigint NOT NULL,
    effect jsonb NOT NULL
  );`;
type Reader=Pool|PoolClient;
type StoredEffect=WorkspaceActionEffect&{command:WorkspaceEffectCommand};
type EffectRow={effect:StoredEffect;started_at:string;page_hash:string};
type Transaction=<T>(work:(client:PoolClient)=>Promise<T>)=>Promise<T>;
const waitMs=45000;
export function workspaceEffectCommand(result:DiscoveryResponse|undefined,owner:{runId:string;conversationId:string;turnId:string}):WorkspaceEffectCommand|undefined{
  if(result?.flightCatalogue===true&&result.camera&&result.placeLabel)
    return {kind:"flight",camera:result.camera,placeLabel:result.placeLabel};
  const target=result?.workspaceOperation?.kind==="present-catalogue"&&cataloguePresentationTarget(result,owner);
  const coverage=result?.gridCoverage,batch=result?.resultBatch;
  if(result&&target&&coverage?.status==="ready"&&batch){
    const eligible=new Set(target.items.map(item=>item.datasetId));
    const notes=result.answerNotes;
    const answerNotes=notes&&{
      sources:notes.sources.filter(source=>eligible.has(source.id)),
      references:notes.references?.filter(reference=>reference.kind==="asset"&&eligible.has(reference.id)),
      limitation:notes.limitation,followUp:notes.followUp,reviewed:notes.reviewed,elapsedMs:notes.elapsedMs,executor:notes.executor,
    };
    return {kind:"catalogue-presentation",target,result:publicAgUiResponse({
      message:"等待原页面确认本轮目录绘制。",
      resultBatch:batch,workspaceOperation:result.workspaceOperation,answerNotes,
      gridCoverage:{...coverage,members:[],sourceIds:batch.itemIds},
      hainaRecords:result.hainaRecords?.filter(record=>eligible.has("haina:"+record.id)),
      hainaCatalog:result.hainaCatalog,
    })};
  }
}
export function retainedWorkspaceEffectResult(result:DiscoveryResponse):DiscoveryResponse{
  const {workspaceEffect:_legacyEffect,workspaceOperation:_operation,camera:_camera,fly:_fly,flightCatalogue:_flight,...retained}=result;
  return retained;
}
function publicEffect(stored:StoredEffect,allowCommand=false):WorkspaceActionEffect {
  const {command,...effect}=stored;
  return allowCommand&&effect.status==="waiting"&&effect.expiresAt>Date.now()?{...effect,command}:effect;
}
async function find(db:Reader,id:string,lock=false){
  return (await db.query<EffectRow>("SELECT effect,started_at,page_hash FROM runtime_workspace_action_effects WHERE run_id=$1"+(lock?" FOR UPDATE":""),[id])).rows[0];
}
export function newWorkspaceEffect(owner:{runId:string;conversationId:string;turnId:string},command:WorkspaceEffectCommand,now:number):StoredEffect{
  return {version:1,...owner,actionId:owner.runId,effectId:randomUUID(),kind:command.kind,status:"waiting",expiresAt:now+waitMs,command};
}
export async function saveWorkspaceEffect(db:PoolClient,effect:StoredEffect,pageHash:string,now:number){
  await db.query("INSERT INTO runtime_workspace_action_effects VALUES($1,$2,$3,$4,$5)",[effect.runId,effect.effectId,pageHash,now,effect]);
  await writeAgUiWorkspaceEffect(db,effect.runId,publicEffect(effect),effect.command);
}
async function update(db:PoolClient,effect:StoredEffect,active:boolean){
  await db.query("UPDATE runtime_workspace_action_effects SET effect=$2 WHERE run_id=$1",[effect.runId,effect]);
  if(active)await writeAgUiWorkspaceEffect(db,effect.runId,publicEffect(effect));
}
export async function cancelWorkspaceEffect(db:PoolClient,id:string){
  const row=await find(db,id,true);
  if(row&&row.effect.status!=="cancelled")await update(db,{...row.effect,status:"cancelled"},true);
}
function receiptTimeFits(time:number,start:number,now:number){return time>=start-10000&&time<=now+10000;}
export function mergeWorkspaceEffectReceipt(effect:StoredEffect,receipt:WorkspaceEffectReceipt,start:number,now:number):WorkspaceEffectReceipt|undefined {
  const prior=effect.receipt;
  if(receipt.kind==="flight"&&effect.command.kind==="flight"){
    if(prior)return isDeepStrictEqual(prior,receipt)?prior:undefined;
    const flight=receipt.flight;
    if(!receiptTimeFits(flight.observedAt,start,now))return;
    if(flight.state==="arrived"){
      const [lon,lat]=flight.ground.point,[x,y]=effect.command.camera.center;
      if(Math.abs((((lon-x+180)%360+360)%360)-180)>.5||Math.abs(lat-y)>.5)return;
    }
    return receipt;
  }
  if(receipt.kind!=="catalogue-presentation"||effect.command.kind!=="catalogue-presentation")return;
  const {presentation}=receipt,{target}=effect.command;
  if(presentation.conversationId!==effect.conversationId||presentation.turnId!==effect.turnId||
    presentation.batchId!==target.batchId||presentation.coverageRevision!==target.coverageRevision||
    !presentation.items.every(item=>receiptTimeFits(item.observedAt,start,now)&&
      target.items.some(expected=>expected.datasetId===item.datasetId&&expected.version===item.version)))return;
  const saved=prior?.kind==="catalogue-presentation"?prior.presentation.items:[];
  if(presentation.items.some(item=>saved.some(old=>old.datasetId===item.datasetId&&!isDeepStrictEqual(old,item))))return;
  const items=target.items.flatMap(target=>{
    const record=saved.find(item=>item.datasetId===target.datasetId)??presentation.items.find(item=>item.datasetId===target.datasetId);
    return record?[record]:[];
  });
  return {kind:receipt.kind,presentation:{...presentation,items}};
}

export function postgresWorkspaceEffects(pool:Pool,transaction:Transaction){
  return {
    async read(id:string,token?:string){
      const row=await find(pool,id);
      if(row)return publicEffect(row.effect,workspacePageHash(token)===row.page_hash);
    },
    execution:(id:string)=>transaction(async db=>{
      const lease=runtimeTaskLease.getStore();
      const now=Date.now();
      const task=(await db.query<{status:string}>(`SELECT status FROM runtime_tasks WHERE id=$1 AND
        lease_owner=$2 AND lease_fence=$3 AND lease_until>$4 FOR UPDATE`,[id,lease?.owner,lease?.fence,now])).rows[0];
      if(task?.status!=="running")return;
      const row=await find(db,id,true);
      if(!row)return;
      if(row.effect.status==="waiting"){
        if(row.effect.expiresAt<=now){
          row.effect={...row.effect,status:"expired"};
          await update(db,row.effect,true);
        }else await db.query("UPDATE runtime_steps SET wake_at=$2 WHERE id=$1",[id,row.effect.expiresAt]);
      }
      return row.effect;
    }),
    write:(conversationId:string,id:string,effectId:string,token:string,receipt:WorkspaceEffectReceipt)=>transaction(async db=>{
      const task=(await db.query<{status:string}>("SELECT status FROM runtime_tasks WHERE id=$1 FOR UPDATE",[id])).rows[0];
      const row=task&&await find(db,id,true);
      if(!row||row.effect.conversationId!==conversationId||row.effect.effectId!==effectId||workspacePageHash(token)!==row.page_hash)
        return {status:404 as const};
      const now=Date.now(),fact=mergeWorkspaceEffectReceipt(row.effect,receipt,Number(row.started_at),now);
      if(!fact)return {status:409 as const};
      const active=task.status==="running"||task.status==="queued";
      const expired=row.effect.status==="waiting"&&row.effect.expiresAt<=now;
      const complete=fact.kind==="flight"||row.effect.command.kind==="catalogue-presentation"&&
        fact.presentation.items.length===row.effect.command.target.items.length;
      const status=expired?"expired":row.effect.status==="waiting"&&active&&complete?"received":row.effect.status;
      const effect:StoredEffect={...row.effect,status,receipt:fact};
      if(!isDeepStrictEqual(effect,row.effect)){
        await update(db,effect,active);
        if(active&&row.effect.status==="waiting"&&(status==="expired"||status==="received"))
          await db.query("UPDATE runtime_steps SET wake_at=$2 WHERE id=$1",[id,now]);
      }
      return {status:200 as const,effect:publicEffect(effect)};
    }),
  };
}
export type WorkspaceEffectsStore=ReturnType<typeof postgresWorkspaceEffects>;
