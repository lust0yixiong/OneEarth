import {createHash,randomUUID,timingSafeEqual} from "node:crypto";
import type {Router,Response} from "express";
import type {PoolClient} from "pg";
import {workspaceIdPattern} from "../src/domain/workspace-research-state";
import {readWorkspaceDiscoveryAccepted,readWorkspaceDiscoveryAction,readWorkspaceDiscoveryReference,readWorkspaceDiscoveryResult,
  validWorkspaceDiscoveryKey,workspaceDiscoveryAccessHeader,type WorkspaceDiscoveryAccepted,type WorkspaceDiscoveryAction,
  type WorkspaceDiscoveryReference,type WorkspaceDiscoveryView} from "../src/domain/workspace-discovery";
import type {RuntimeOperation,RuntimeOperationsStore} from "./runtime-operations";
import type {WorkspaceDiscoveryArchiveBinding} from "./workspace-discovery-archive";
import {lockWorkspaceResearchState,WorkspaceResearchConflict} from "./workspace-research-state";
import {modelSafeText} from "./model-context-safety";
import {assertPublicAnswerSafe} from "./public-answer-stream";

const operationKind="discover-materials";
const dispatchWindow=180_000;
const digest=(data:string)=>createHash("sha256").update(data).digest("hex");
const id=(value:unknown):value is string=>typeof value==="string"&&workspaceIdPattern.test(value);

export class WorkspaceDiscoveryConflict extends Error {
  constructor(readonly status:404|409|503,readonly code:string,message:string){super(message);}
}
const missing=()=>new WorkspaceDiscoveryConflict(404,"DISCOVERY_OPERATION_NOT_FOUND","找不到这项资料发现操作。");
const conflict=()=>new WorkspaceDiscoveryConflict(409,"WORKSPACE_ACTION_ID_CONFLICT","该动作编号已用于另一份提交。");

function authorized(op:RuntimeOperation|undefined,conversationId:string,accessKey:unknown):op is RuntimeOperation{
  if(!op||op.kind!==operationKind||op.conversationId!==conversationId||!validWorkspaceDiscoveryKey(accessKey))return false;
  const hash=op.input.accessHash;
  return typeof hash==="string"&&validWorkspaceDiscoveryKey(hash)&&
    timingSafeEqual(Buffer.from(hash,"hex"),Buffer.from(digest(accessKey),"hex"));
}
function publicView(op:RuntimeOperation):WorkspaceDiscoveryView {
  const result=readWorkspaceDiscoveryResult(op.result?.result);
  return {version:1,operationId:op.operationId,actionId:String(op.input.actionId),conversationId:op.conversationId,
    status:op.status,query:String(op.input.query),revision:Number(op.input.researchRevision),...(result?{result}:{})};
}
async function previous(db:PoolClient,conversationId:string,actionId:string){
  return (await db.query<{digest:string;decision:unknown}>(`SELECT digest,decision FROM runtime_workspace_research_actions
    WHERE conversation_id=$1 AND action_id=$2`,[conversationId,actionId])).rows[0];
}
type Run={runId:string;turnId:string};
type Projection=(db:PoolClient,runId:string,status:"cancelled",result?:WorkspaceDiscoveryView["result"])=>Promise<boolean>;

export function workspaceDiscoveryOperations(operations:RuntimeOperationsStore,projectRun?:Projection){
  async function admitInTransaction(db:PoolClient,conversationId:string,input:WorkspaceDiscoveryAction,accessKey:string,origin?:Run){
    const action=readWorkspaceDiscoveryAction(input);
    if(!action||!id(conversationId)||!validWorkspaceDiscoveryKey(accessKey))throw missing();
    try{
      if(modelSafeText(action.query)!==action.query)throw Error("unsafe discovery query");
      assertPublicAnswerSafe(action.query);
    }catch{
      throw new WorkspaceDiscoveryConflict(409,"DISCOVERY_QUERY_REQUIRES_REDACTION","请删去问题中的内部地址或凭据信息再提交。");
    }
    const expected=digest(JSON.stringify(action));
    const state=await lockWorkspaceResearchState(db,conversationId);
    const saved=await previous(db,conversationId,action.actionId);
    if(saved){
      const accepted=readWorkspaceDiscoveryAccepted(saved.decision);
      if(!accepted)throw conflict();
      const op=await operations.readInTransaction(db,accepted.operationId,!!origin);
      if(!authorized(op,conversationId,accessKey))throw missing();
      if(expected!==saved.digest)throw conflict();
      if(origin&&op.activeRunId!==origin.runId){
        if(op.activeRunId||(op.status!=="running"&&op.status!=="queued")||
          !await operations.linkRunInTransaction(db,op.operationId,{...origin,conversationId}))
          throw new WorkspaceDiscoveryConflict(409,"DISCOVERY_USE_ORIGINAL_OPERATION","该操作已受理，请读取或引用原结果。");
      }
      return accepted;
    }
    if(state.revision!==action.expectedRevision)throw new WorkspaceResearchConflict(state);
    const accepted:WorkspaceDiscoveryAccepted={operationId:randomUUID(),actionId:action.actionId,conversationId,status:"queued"};
    const stepId=randomUUID(),now=Date.now();
    await operations.createInTransaction(db,{...origin,operationId:accepted.operationId,conversationId,kind:operationKind,
      input:{actionId:action.actionId,accessHash:digest(accessKey),query:action.query,researchRevision:state.revision,
        ...(state.range?{scope:state.range.scope}:{})},
      checkpoint:{stepId,phase:"discover",expiresAt:now+dispatchWindow},
      wait:{stepId,kind:"service",request:{capability:operationKind},expiresAt:now+dispatchWindow},wakeAt:now});
    await db.query(`INSERT INTO runtime_workspace_research_actions(conversation_id,action_id,digest,origin,decision)
      VALUES ($1,$2,$3,$4,$5)`,[conversationId,action.actionId,expected,origin?{source:"chat",...origin}:{source:"workspace"},accepted]);
    return accepted;
  }

  async function read(conversationId:unknown,operationId:unknown,key:unknown){
    if(!id(conversationId)||!id(operationId)||!validWorkspaceDiscoveryKey(key))return;
    const op=await operations.read(operationId);
    if(authorized(op,conversationId,key))return publicView(op);
  }

  async function cancelLocked(db:PoolClient,op:RuntimeOperation){
    const saved=readWorkspaceDiscoveryResult(op.checkpoint?.validatedResult);
    const result=saved?{...saved,complete:false,limitation:"操作已取消。以下仅为取消前已保存的结果。"}:undefined;
    if(!await operations.cancelInTransaction(db,op.operationId,result?{result}:undefined))return false;
    if(op.activeRunId&&!(await projectRun?.(db,op.activeRunId,"cancelled",result)))
      throw Error("原资料发现答复无法归档取消回执。");
    return true;
  }
  return {
    admitInTransaction,
    admit:(conversationId:string,action:WorkspaceDiscoveryAction,key:string)=>
      operations.transaction(db=>admitInTransaction(db,conversationId,action,key)),
    read,
    async authorizeArchive(binding:WorkspaceDiscoveryArchiveBinding,conversationId:unknown,key:unknown) {
      if(!id(binding.operationId)||!id(conversationId)||!validWorkspaceDiscoveryKey(key))return false;
      return authorized(await operations.read(binding.operationId),conversationId,key);
    },
    async readAction(conversationId:unknown,actionId:unknown,key:unknown){
      if(!id(conversationId)||!id(actionId)||!validWorkspaceDiscoveryKey(key))return;
      return operations.transaction(async db=>{
        const accepted=readWorkspaceDiscoveryAccepted((await previous(db,conversationId,actionId))?.decision);
        if(!accepted)return;
        if(authorized(await operations.readInTransaction(db,accepted.operationId),conversationId,key))return accepted;
      });
    },
    async readReference(conversationId:string,input:WorkspaceDiscoveryReference){
      const reference=readWorkspaceDiscoveryReference(input);
      if(!reference)return;
      const op=await read(conversationId,reference.operationId,reference.accessKey);
      if(op?.result?.batchId===reference.batchId)return op.result;
    },
    async cancel(conversationId:unknown,operationId:unknown,key:unknown){
      if(!id(conversationId)||!id(operationId)||!validWorkspaceDiscoveryKey(key))return;
      return operations.transaction(async db=>{
        const op=await operations.readInTransaction(db,operationId,true);
        if(authorized(op,conversationId,key))return cancelLocked(db,op);
      });
    },
    async cancelForRun(runId:string,key:unknown){
      if(!id(runId))return;
      return operations.transaction(async db=>{
        const alias=await operations.readForRunInTransaction(db,runId);
        if(alias?.kind!==operationKind)return;
        const op=await operations.readInTransaction(db,alias.operationId,true);
        if(!authorized(op,alias.conversationId,key)||op.activeRunId!==runId)return "missing" as const;
        return cancelLocked(db,op);
      });
    },
  };
}

export type WorkspaceDiscovery=ReturnType<typeof workspaceDiscoveryOperations>;

export function workspaceDiscoveryRoutes(router:Router,discovery:WorkspaceDiscovery){
  const noCache=(res:Response)=>res.set("Cache-Control","no-store");
  const notFound=(res:Response)=>res.status(404).json({code:"DISCOVERY_OPERATION_NOT_FOUND",error:"找不到这项资料发现操作。"});
  router.post("/api/workspaces/:conversationId/actions",async(req,res,next)=>{
    if(req.body?.kind!==operationKind){next();return;}
    noCache(res);
    const action=readWorkspaceDiscoveryAction(req.body),key=req.get(workspaceDiscoveryAccessHeader);
    if(!req.is("application/json")){res.sendStatus(415);return;}
    if(!action||!id(req.params.conversationId)||!validWorkspaceDiscoveryKey(key)){
      res.status(400).json({code:"DISCOVERY_ACTION_INVALID",error:"资料发现动作或访问凭据格式无效。"});return;
    }
    try{
      const accepted=await discovery.admit(req.params.conversationId,action,key);
      res.status(202).location("/api/workspaces/"+accepted.conversationId+"/operations/"+accepted.operationId).json(accepted);
    }catch(error){
      if(error instanceof WorkspaceDiscoveryConflict){res.status(error.status).json({code:error.code,error:error.message});return;}
      if(error instanceof WorkspaceResearchConflict){res.status(409).json({code:error.code,error:error.message,state:error.state});return;}
      res.status(503).json({code:"DISCOVERY_OPERATION_UNAVAILABLE",error:"资料发现暂时不能受理。"});
    }
  });
  router.get("/api/workspaces/:conversationId/actions/:actionId",async(req,res)=>{
    noCache(res);
    const accepted=await discovery.readAction(req.params.conversationId,req.params.actionId,req.get(workspaceDiscoveryAccessHeader));
    if(!accepted){notFound(res);return;}
    res.json(accepted);
  });
  const path="/api/workspaces/:conversationId/operations/:operationId";
  router.get([path,path+"/record"],async(req,res)=>{
    noCache(res);
    const found=await discovery.read(req.params.conversationId,req.params.operationId,req.get(workspaceDiscoveryAccessHeader));
    if(!found||req.path.endsWith("/record")&&!found.result){notFound(res);return;}
    res.json(found);
  });
  router.delete(path,async(req,res)=>{
    noCache(res);
    const cancelled=await discovery.cancel(req.params.conversationId,req.params.operationId,req.get(workspaceDiscoveryAccessHeader));
    if(cancelled===undefined){notFound(res);return;}
    res.sendStatus(cancelled?204:409);
  });
}
