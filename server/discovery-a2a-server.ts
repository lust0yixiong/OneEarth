import {createHash,randomUUID} from "node:crypto";
import {once} from "node:events";
import {setTimeout as delay} from "node:timers/promises";
import express, {type Request, type Response} from "express";
import {TaskConflict, taskIdPattern} from "./task-store";
import {DiscoveryContinuationConflict, DiscoveryTaskMissing, type DiscoveryA2aStore, type DiscoveryContinuation, type DiscoveryProgress, type StoredDiscoveryEvent} from "./discovery-a2a-store";
import type {DiscoveryInput} from "./discovery-contract";
import {hainaCatalogQueryKind,hainaCatalogResultKind,paperQueryKind,sceneCatalogQueryKind,sceneCatalogResultKind,sourceReadKind,type HainaCatalogPage} from "./discovery-materials-contract";
import {prepareSourceRead, queryPaperCatalog} from "./discovery-material-operations";
import {PaperCatalogError,type PaperCatalogAccess} from "./paper-catalog-access";
import type {hainaService} from "./haina-search";
import {parseSceneCatalogQuery,querySceneCatalog} from "./earth-search-source";
import {paperId} from "../src/domain/paper-record";
import {paperProjectionPageLimit,paperProjectionQueryKind,paperProjectionResultKind} from "./paper-projection-contract";
import {PaperCatalogBaseUnavailable,PaperCatalogGenerationChanged,PaperCatalogUninitialized,type PostgresPaperCatalog} from "./postgres-paper-catalog";
import {parseObservationCheck, skillRequestKind, skillResultKind, skillServiceAuthorized, validObservationResult} from "./observation-check-contract";

const media = "application/a2a+json";
const protocol = "1.0";
const a2aPath = /^\/(?:message:[^/]+|tasks(?:\/.*)?|extendedAgentCard)$/;
const states = {
  queued:"TASK_STATE_SUBMITTED", running:"TASK_STATE_WORKING", complete:"TASK_STATE_COMPLETED",
  failed:"TASK_STATE_FAILED", cancelled:"TASK_STATE_CANCELED",
} as const;
const active = (task: DiscoveryProgress) => task.machineWaiting || task.status === "queued" || task.status === "running";
const sendReady = (task: DiscoveryProgress) => task.machineWaiting || !active(task);
const status = (task: DiscoveryProgress) => ({
  state:task.machineWaiting ? "TASK_STATE_WORKING" : task.needsInput ? "TASK_STATE_INPUT_REQUIRED" : states[task.status],
  timestamp:new Date(task.updated).toISOString(),
});
const artifact = (event: StoredDiscoveryEvent) => ({
  artifactId:event.taskId + ":" + event.seq,
  parts:[{data:{kind:"oneearth.discovery.event.v1",event}}],
});
function taskDocument(task: DiscoveryProgress, events: StoredDiscoveryEvent[]) {
  return {id:task.id, contextId:task.id, status:status(task), artifacts:events.map(artifact)};
}

class A2aError extends Error {
  constructor(readonly http: number, readonly status: string, message: string, readonly reason?: string) {
    super(message);
  }
}
const invalid = (message: string, reason?: string) => new A2aError(400,"INVALID_ARGUMENT",message,reason);
const unavailable = (message: string) => new A2aError(503,"UNAVAILABLE",message);
const precondition = (reason: string, message: string) => new A2aError(400,"FAILED_PRECONDITION",message,reason);
const notFound = () => new A2aError(404,"NOT_FOUND","任务不存在或不可访问。","TASK_NOT_FOUND");
const authorizedSkillCaller = (req:Request) => skillServiceAuthorized(req.get("authorization"));

function record(value: unknown): Record<string,unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid("A2A 请求需要 JSON 对象。");
  return value as Record<string,unknown>;
}
function only(value: Record<string,unknown>, fields: string[]) {
  if (Object.keys(value).some(key => !fields.includes(key))) throw invalid("A2A 请求包含不受支持的字段。");
}
function fingerprint(value: unknown) {
  const canonical = JSON.stringify(value, (_key, part) => part && typeof part === "object" && !Array.isArray(part)
    ? Object.fromEntries(Object.keys(part).sort().map(key => [key,part[key]]))
    : part);
  return createHash("sha256").update(canonical).digest("hex");
}
function checkHistoryLength(value: unknown) {
  if (value !== undefined && (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value))))
    throw invalid("historyLength 须为非负整数。");
}
function requireVersion(req: Request) {
  if ((req.get("A2A-Version") ?? req.query["A2A-Version"]) !== protocol)
    throw precondition("VERSION_NOT_SUPPORTED","此端点支持 A2A-Version: 1.0。");
}
function operationId(req: Request) {
  const id = String(req.params.taskId);
  if (!taskIdPattern.test(id)) throw notFound();
  if (req.query.tenant !== undefined) throw invalid("此发现端点未配置 A2A tenant。");
  return id.toLowerCase();
}

type Prepare = (input: Record<string,unknown>, continuation?: DiscoveryContinuation) => Promise<{body: DiscoveryInput} | {issue: string; unavailable?: boolean}>;
export function discoveryA2aRouter(delegations: DiscoveryA2aStore, prepare: Prepare,
  materials?: {catalog?:PaperCatalogAccess;fetchAllowed?:()=>boolean;haina?:Pick<ReturnType<typeof hainaService>,"page">;
    sceneFetcher?:typeof fetch;paperProjection?:Pick<PostgresPaperCatalog,"projectionHead"|"projectionPage">}) {
  const {catalog,haina,paperProjection} = materials ?? {};
  const router = express.Router();
  const parse = express.json({type:media,limit:"384kb"});
  router.get("/.well-known/agent-card.json", (req,res) => res.set("Cache-Control","no-store").json({
    name:"OneEarth Discovery",
    description:"Finds and returns traceable materials for a OneEarth research delegation.",
    version:"1.0.0",
    supportedInterfaces:[{url:"http://127.0.0.1:" + req.socket.localPort,protocolBinding:"HTTP+JSON",protocolVersion:protocol}],
    capabilities:{streaming:true,pushNotifications:false,extendedAgentCard:false},
    defaultInputModes:["application/json"],defaultOutputModes:["application/json"],
    skills:[{id:"oneearth.discovery",name:"Data discovery",description:"Find and investigate research materials and report their sources and limitations.",
      tags:["discovery","research","provenance"]},
      {id:"oneearth.scene.catalog",name:"Earth Search scenes",description:"Read scene metadata for a specified point and time from the supported Earth Search collections.",
        tags:["earth-search","scene","catalog"]}, ...(catalog ? [
        {id:"oneearth.paper.query",name:"Paper catalog",description:"Return exact paper records and catalog views as a synchronous Message.",
          tags:["paper","catalog"]},
        {id:"oneearth.source.read",name:"Read specified sources",description:"Read specified paper or public web and PDF sources in a recoverable Task.",
          tags:["paper","web","provenance"]},
      ] : []), ...(haina ? [
        {id:"oneearth.haina.catalog",name:"Haina catalog",description:"Return a page from the published Haina catalog as a synchronous Message.",
          tags:["data","catalog"]},
      ] : []), ...(paperProjection ? [
        {id:"oneearth.paper.projection",name:"Paper map projection",description:"Read the published head and generation-pinned paper map projection.",
          tags:["paper","map","catalog"]},
      ] : [])],
  }));

  // Only deployed A2A paths enter this parser and error handler. Legacy routes retain their wire format.
  router.use(a2aPath, (req,res,next) => {
    res.type(media).set("Cache-Control","no-store");
    requireVersion(req);
    if (req.method === "POST" && (req.get("content-length") || req.get("transfer-encoding")) &&
      req.get("content-length") !== "0" && !req.is(media))
      throw invalid("A2A POST 请求需要 application/a2a+json。","CONTENT_TYPE_NOT_SUPPORTED");
    next();
  }, parse);

  function decode(req: Request) {
    const envelope = record(req.body);
    only(envelope, ["message","configuration"]);
    const message = record(envelope.message);
    if (message.role !== "ROLE_USER" || typeof message.messageId !== "string" ||
      !message.messageId.trim() || message.messageId.length > 200 || /[\x00-\x1f\x7f]/.test(message.messageId))
      throw invalid("A2A 委托需要 ROLE_USER 及稳定的 messageId。");
    only(message, ["messageId","role","parts","taskId","contextId"]);
    if (message.taskId !== undefined && (typeof message.taskId !== "string" || !taskIdPattern.test(message.taskId)))
      throw notFound();
    const taskId = typeof message.taskId === "string" ? message.taskId.toLowerCase() : undefined;
    if (message.contextId !== undefined && (!taskId || message.contextId !== taskId))
      throw invalid("提交的 contextId 与发现任务不对应。");
    if (!Array.isArray(message.parts) || message.parts.length !== 1) throw invalid("A2A 发现委托需要一个数据 part。");
    const part = record(message.parts[0]);
    only(part, ["data"]);
    const data = record(part.data);
    only(data, ["kind","input"]);
    const available = data.kind === "oneearth.discovery.request.v1" ||
      data.kind === skillRequestKind || data.kind === skillResultKind ||
      (catalog && (data.kind === paperQueryKind || data.kind === sourceReadKind)) ||
      (haina && data.kind === hainaCatalogQueryKind) || data.kind === sceneCatalogQueryKind ||
      (paperProjection && data.kind === paperProjectionQueryKind);
    if (!available)
      throw invalid("不支持此发现委托类型。","CONTENT_TYPE_NOT_SUPPORTED");
    const input = record(data.input);
    const config = envelope.configuration === undefined ? {} : record(envelope.configuration);
    if ("taskPushNotificationConfig" in config)
      throw precondition("PUSH_NOTIFICATION_NOT_SUPPORTED","发现服务未启用推送通知。");
    only(config, ["returnImmediately","acceptedOutputModes","historyLength"]);
    if (config.returnImmediately !== undefined && typeof config.returnImmediately !== "boolean")
      throw invalid("returnImmediately 须为布尔值。");
    if (config.acceptedOutputModes !== undefined && (!Array.isArray(config.acceptedOutputModes) ||
      !config.acceptedOutputModes.every(mode => typeof mode === "string") ||
      !config.acceptedOutputModes.some(mode => ["application/json","*/*","application/*"].includes(mode))))
      throw invalid("发现成果以 JSON 数据 part 返回。","CONTENT_TYPE_NOT_SUPPORTED");
    checkHistoryLength(config.historyLength);
    if (data.kind === skillRequestKind && taskId)
      throw invalid("观测核对须先受理为新的发现委托。");
    if (data.kind !== "oneearth.discovery.request.v1" && data.kind !== skillResultKind && taskId)
      throw invalid("目录查询和精确读取不能绑定到已有发现任务。");
    return {kind:data.kind,input,messageId:message.messageId,taskId,immediately:config.returnImmediately === true};
  }

  async function submit({kind,input,messageId,taskId,immediately}: ReturnType<typeof decode>, skillAuthorized:boolean) {
    if (kind === skillRequestKind || kind === skillResultKind) {
      if (!skillAuthorized) throw new A2aError(401,"UNAUTHENTICATED","观测核对需要服务凭据。");
      const digest = fingerprint({kind,taskId,input});
      if (kind === skillRequestKind) {
        only(input,["researchTaskId","check"]);
        const {researchTaskId} = input, check = parseObservationCheck(input.check);
        if (typeof researchTaskId !== "string" || !taskIdPattern.test(researchTaskId) || !check)
          throw invalid("观测核对需要研究任务编号和有效的观测文件核对条件。");
        return {id:await delegations.submitObservationCheck(messageId,digest,{researchTaskId,check}),immediately};
      }
      only(input,["requestId","afterSeq","result"]);
      const {requestId,afterSeq,result} = input;
      if (!taskId) throw invalid("观测核对结果须提交到受理该需求的发现任务。");
      if (typeof requestId !== "string" || !taskIdPattern.test(requestId) || typeof afterSeq !== "number" ||
          !Number.isSafeInteger(afterSeq) || afterSeq < 1 || typeof record(result).status !== "string" ||
          !validObservationResult(result))
        throw invalid("观测核对结果需要有效的需求编号、等待序号和执行结果。");
      return {id:await delegations.acceptObservationResult(messageId,digest,taskId,{requestId,afterSeq,result}),immediately};
    }
    // Transport preferences may change when resuming. The authorization-bearing input may not.
    const digest = fingerprint(kind === sourceReadKind ? {kind,input} : {taskId,input});
    const previous = await delegations.find(messageId,digest);
    if (previous) return {id:previous,immediately};
    if (kind === sourceReadKind) {
      const prepared = prepareSourceRead(input,materials?.fetchAllowed?.() === true);
      if ("issue" in prepared) throw invalid(prepared.issue);
      return {id:await delegations.submit(messageId,digest,prepared.body),immediately};
    }
    let continuation: DiscoveryContinuation | undefined;
    if (taskId) {
      const task = await delegations.progress(taskId);
      if (!task || task.privateTask) throw notFound();
      if (task.waitingSeq === undefined) {
        const accepted = await delegations.find(messageId,digest);
        if (accepted) return {id:accepted,immediately};
        throw precondition("UNSUPPORTED_OPERATION","只有等待研究者输入的发现任务可以续行。");
      }
      continuation = {id:task.id,jobId:task.jobId,waitingSeq:task.waitingSeq};
    }
    const prepared = await prepare(input,continuation);
    if ("issue" in prepared) {
      const accepted = await delegations.find(messageId,digest);
      if (accepted) return {id:accepted,immediately};
      throw prepared.unavailable ? unavailable(prepared.issue) : invalid(prepared.issue);
    }
    const id = await delegations.submit(messageId,digest,prepared.body,continuation);
    return {id,immediately};
  }

  async function read(id: string, skillAuthorized:boolean) {
    const snapshot = await delegations.snapshot(id,0,undefined,skillAuthorized);
    if (!snapshot) throw notFound();
    return snapshot;
  }
  async function queryHaina(input:Record<string,unknown>,signal:AbortSignal) {
    only(input,["cursor","limit"]);
    const {cursor,limit} = input;
    if (typeof cursor !== "number" || !Number.isSafeInteger(cursor) || cursor < 0 ||
      typeof limit !== "number" || !Number.isSafeInteger(limit) || limit < 1 || limit > 250)
      throw invalid("海纳目录分页参数无效。");
    try {
      const value:HainaCatalogPage = await haina!.page(cursor,limit,signal);
      return {kind:hainaCatalogResultKind,value};
    } catch (error) {
      signal.throwIfAborted();
      throw unavailable(error instanceof Error ? error.message : "海纳目录读取失败。");
    }
  }
  async function queryScenes(input:Record<string,unknown>,signal:AbortSignal) {
    const query = parseSceneCatalogQuery(input);
    if (!query) throw invalid("逐景查询须指定允许的影像集合、有效坐标和一致的时段。");
    return {kind:sceneCatalogResultKind,value:await querySceneCatalog(query,signal,materials?.sceneFetcher)};
  }
  async function queryProjection(input:Record<string,unknown>,signal:AbortSignal) {
    signal.throwIfAborted();
    if (input.operation === "head") {
      only(input,["operation"]);
      return {kind:paperProjectionResultKind,value:await paperProjection!.projectionHead()};
    }
    only(input,["operation","generation","cursor","limit","baseGeneration"]);
    const {generation,cursor,limit,baseGeneration}=input;
    if (input.operation!=="page" || typeof generation!=="string" || !generation || generation.length>200 ||
      typeof cursor!=="string" || (cursor!=="" && !paperId(cursor)) ||
      typeof limit!=="number" || !Number.isSafeInteger(limit) || limit<1 || limit>paperProjectionPageLimit ||
      (baseGeneration!==undefined && (typeof baseGeneration!=="string" || !baseGeneration || baseGeneration.length>200)))
      throw invalid("论文投影分页参数无效。");
    return {kind:paperProjectionResultKind,value:await paperProjection!.projectionPage(generation,cursor,limit,baseGeneration)};
  }
  function directQuery(kind: unknown) {
    if (kind === paperQueryKind && catalog) return (input:Record<string,unknown>,signal:AbortSignal) => queryPaperCatalog(catalog,input,signal);
    if (kind === hainaCatalogQueryKind && haina) return queryHaina;
    if (kind === sceneCatalogQueryKind) return queryScenes;
    if (kind === paperProjectionQueryKind && paperProjection) return queryProjection;
  }
  router.post(/^\/message:send$/, async (req,res) => {
    const request = decode(req);
    const query = directQuery(request.kind);
    if (query) {
      const controller = new AbortController();
      const abort = () => controller.abort();
      res.once("close",abort);
      try {
        const data = await query(request.input,controller.signal);
        if (!res.destroyed) res.json({message:{
          role:"ROLE_AGENT",messageId:randomUUID(),contextId:randomUUID(),parts:[{data}],
        }});
      } finally {res.off("close",abort);}
      return;
    }
    const skillAuthorized = authorizedSkillCaller(req);
    const {id,immediately} = await submit(request,skillAuthorized);
    while (!res.destroyed) {
      const progress = immediately ? undefined : await delegations.progress(id);
      if (!immediately && !progress) throw notFound();
      if (!progress || sendReady(progress)) {
        const snapshot = await read(id,skillAuthorized);
        if (immediately || sendReady(snapshot.task)) {
          res.json({task:taskDocument(snapshot.task,snapshot.events)});
          return;
        }
      }
      await delay(150);
    }
  });
  router.get(/^\/tasks\/(?<taskId>[^/:]+)$/, async (req,res) => {
    checkHistoryLength(req.query.historyLength);
    const {task,events} = await read(operationId(req),authorizedSkillCaller(req));
    res.json(taskDocument(task,events));
  });
  router.post(/^\/tasks\/(?<taskId>[^/:]+):cancel$/, async (req,res) => {
    const id = operationId(req);
    checkAction(req,id,["id","metadata"]);
    const skillAuthorized = authorizedSkillCaller(req);
    const outcome = await delegations.cancel(id,skillAuthorized);
    if (outcome === "missing") throw notFound();
    if (outcome === "terminal") throw precondition("TASK_NOT_CANCELABLE","任务已经结束，无法取消。");
    const {task,events} = await read(id,skillAuthorized);
    res.json(taskDocument(task,events));
  });

  async function stream(res: Response, id: string, subscribe: boolean, skillAuthorized:boolean) {
    const {task,events} = await read(id,skillAuthorized);
    if (subscribe && !active(task) && !task.needsInput)
      throw precondition("UNSUPPORTED_OPERATION","任务已经结束，请通过 GET 读取存档。");
    if (res.destroyed) return;
    const controller = new AbortController();
    const disconnected = () => controller.abort();
    res.once("close",disconnected);
    res.type("text/event-stream").set("X-Accel-Buffering","no").flushHeaders();
    async function frame(chunk: string) {
      controller.signal.throwIfAborted();
      if (!res.write(chunk)) await once(res,"drain",{signal:controller.signal});
    }
    const send = (value: object) => frame("data: " + JSON.stringify(value) + "\n\n");
    try {
      await send({task:taskDocument(task,events)});
      let last = status(task).state;
      let cursor = events.at(-1)?.seq ?? 0;
      let heartbeat = Date.now();
      if (active(task)) {
        while (!controller.signal.aborted) {
          const next = await delegations.snapshot(id,cursor,128,skillAuthorized);
          if (!next) throw notFound();
          for (const event of next.events) {
            await send({artifactUpdate:{taskId:id,contextId:id,artifact:artifact(event),lastChunk:true}});
            cursor = event.seq;
          }
          // A terminal update must follow all persisted event pages.
          if (next.events.length === 128) continue;
          const current = status(next.task);
          if (last !== current.state) {
            await send({statusUpdate:{taskId:id,contextId:id,status:current}});
            last = current.state;
          }
          if (!active(next.task)) break;
          if (Date.now() - heartbeat >= 10000) {
            await frame(": keepalive\n\n");
            heartbeat = Date.now();
          }
          await delay(150,undefined,{signal:controller.signal});
        }
      }
      if (!res.destroyed) res.end();
    } catch {
      if (!res.destroyed) res.destroy();
    } finally { res.off("close",disconnected); }
  }
  router.post(/^\/tasks\/(?<taskId>[^/:]+):subscribe$/, async (req,res) => {
    const id = operationId(req);
    checkAction(req,id,["id"]);
    await stream(res,id,true,authorizedSkillCaller(req));
  });
  router.post(/^\/message:stream$/, async (req,res) => {
    const request = decode(req);
    if (directQuery(request.kind)) throw precondition("UNSUPPORTED_OPERATION","目录查询请使用同步 Send Message。");
    const skillAuthorized = authorizedSkillCaller(req);
    const {id} = await submit(request,skillAuthorized);
    await stream(res,id,false,skillAuthorized);
  });
  router.all(a2aPath, () => {
    throw precondition("UNSUPPORTED_OPERATION","此发现端点不支持该 A2A 操作。");
  });
  const handleError: express.ErrorRequestHandler = (error, _req, res, _next) => {
    if (res.headersSent || res.destroyed) { if (!res.destroyed) res.destroy(); return; }
    const failure = error instanceof A2aError ? error
      : error instanceof DiscoveryTaskMissing ? notFound()
      : error instanceof PaperCatalogGenerationChanged ? precondition("CATALOG_GENERATION_CHANGED",error.message)
      : error instanceof PaperCatalogBaseUnavailable ? precondition("CATALOG_BASE_UNAVAILABLE",error.message)
      : error instanceof PaperCatalogUninitialized ? unavailable(error.message)
      : error instanceof PaperCatalogError ? new A2aError(error.status,
        error.status === 503 ? "UNAVAILABLE" : error.status === 404 ? "NOT_FOUND" : "INVALID_ARGUMENT",
        error.message || (error.status === 404 ? "指定文献资料不存在。" : "论文目录操作或参数无效。"))
      : error instanceof TaskConflict ? new A2aError(409,"ALREADY_EXISTS",error.message)
      : error instanceof DiscoveryContinuationConflict ? new A2aError(409,"FAILED_PRECONDITION",error.message)
      : error.type === "entity.parse.failed" ? invalid("A2A 请求 JSON 无效。")
      : error.type === "entity.too.large" ? new A2aError(413,"RESOURCE_EXHAUSTED","A2A 请求超过容量限制。")
      : new A2aError(500,"INTERNAL","发现服务未能处理 A2A 请求。");
    if (failure.http === 500) console.error("OneEarth discovery could not process an A2A request");
    if (failure.http === 401) res.set("WWW-Authenticate","Bearer");
    res.status(failure.http).type(media).json({error:{
      code:failure.http, status:failure.status, message:failure.message,
      ...(failure.reason ? {details:[{"@type":"type.googleapis.com/google.rpc.ErrorInfo",
        reason:failure.reason,domain:"a2a-protocol.org"}]} : {}),
    }});
  };
  router.use(handleError);
  return router;
}

function checkAction(req: Request, id: string, fields: string[]) {
  if (req.body === undefined) return;
  const body = record(req.body);
  only(body,fields);
  if (body.id !== undefined && body.id !== id) throw invalid("请求中的任务编号和路径不一致。");
  if (body.metadata !== undefined) record(body.metadata);
}
