import {createHash} from "node:crypto";
import {once} from "node:events";
import {setTimeout as delay} from "node:timers/promises";
import express, {type Request, type Response} from "express";
import {TaskConflict, taskIdPattern} from "./task-store";
import {DiscoveryContinuationConflict, type DiscoveryA2aStore, type DiscoveryContinuation, type DiscoveryProgress, type StoredDiscoveryEvent} from "./discovery-a2a-store";
import type {DiscoveryInput} from "./discovery-contract";

const media = "application/a2a+json";
const protocol = "1.0";
const a2aPath = /^\/(?:message:[^/]+|tasks(?:\/.*)?|extendedAgentCard)$/;
const states = {
  queued:"TASK_STATE_SUBMITTED", running:"TASK_STATE_WORKING", complete:"TASK_STATE_COMPLETED",
  failed:"TASK_STATE_FAILED", cancelled:"TASK_STATE_CANCELED",
} as const;
const active = (task: DiscoveryProgress) => task.status === "queued" || task.status === "running";
const status = (task: DiscoveryProgress) => ({
  state:task.needsInput ? "TASK_STATE_INPUT_REQUIRED" : states[task.status], timestamp:new Date(task.updated).toISOString(),
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
export function discoveryA2aRouter(delegations: DiscoveryA2aStore, prepare: Prepare) {
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
      tags:["discovery","research","provenance"]}],
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

  async function submit(req: Request) {
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
    if (data.kind !== "oneearth.discovery.request.v1") throw invalid("不支持此发现委托类型。","CONTENT_TYPE_NOT_SUPPORTED");
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

    // Transport preferences may change when resuming. The authorization-bearing input may not.
    const digest = fingerprint({taskId,input});
    const previous = await delegations.find(message.messageId, digest);
    if (previous) return {id:previous, immediately:config.returnImmediately === true};
    let continuation: DiscoveryContinuation | undefined;
    if (taskId) {
      const task = await delegations.progress(taskId);
      if (!task) throw notFound();
      if (task.waitingSeq === undefined) {
        const accepted = await delegations.find(message.messageId,digest);
        if (accepted) return {id:accepted,immediately:config.returnImmediately === true};
        throw precondition("UNSUPPORTED_OPERATION","只有等待研究者输入的发现任务可以续行。");
      }
      continuation = {id:task.id,jobId:task.jobId,waitingSeq:task.waitingSeq};
    }
    const prepared = await prepare(input,continuation);
    if ("issue" in prepared) {
      const accepted = await delegations.find(message.messageId,digest);
      if (accepted) return {id:accepted,immediately:config.returnImmediately === true};
      throw prepared.unavailable ? unavailable(prepared.issue) : invalid(prepared.issue);
    }
    const id = await delegations.submit(message.messageId,digest,prepared.body,continuation);
    return {id,immediately:config.returnImmediately === true};
  }

  async function read(id: string) {
    const snapshot = await delegations.snapshot(id);
    if (!snapshot) throw notFound();
    return snapshot;
  }
  router.post(/^\/message:send$/, async (req,res) => {
    const {id,immediately} = await submit(req);
    while (!res.destroyed) {
      const progress = immediately ? undefined : await delegations.progress(id);
      if (!immediately && !progress) throw notFound();
      if (!progress || !active(progress)) {
        const snapshot = await read(id);
        if (immediately || !active(snapshot.task)) {
          res.json({task:taskDocument(snapshot.task,snapshot.events)});
          return;
        }
      }
      await delay(150);
    }
  });
  router.get(/^\/tasks\/(?<taskId>[^/:]+)$/, async (req,res) => {
    checkHistoryLength(req.query.historyLength);
    const {task,events} = await read(operationId(req));
    res.json(taskDocument(task,events));
  });
  router.post(/^\/tasks\/(?<taskId>[^/:]+):cancel$/, async (req,res) => {
    const id = operationId(req);
    checkAction(req,id,["id","metadata"]);
    const outcome = await delegations.cancel(id);
    if (outcome === "missing") throw notFound();
    if (outcome === "terminal") throw precondition("TASK_NOT_CANCELABLE","任务已经结束，无法取消。");
    const {task,events} = await read(id);
    res.json(taskDocument(task,events));
  });

  async function stream(res: Response, id: string, subscribe: boolean) {
    const {task,events} = await read(id);
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
          const next = await delegations.snapshot(id,cursor,128);
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
    await stream(res,id,true);
  });
  router.post(/^\/message:stream$/, async (req,res) => {
    const {id} = await submit(req);
    await stream(res,id,false);
  });
  router.all(a2aPath, () => {
    throw precondition("UNSUPPORTED_OPERATION","此发现端点不支持该 A2A 操作。");
  });
  const handleError: express.ErrorRequestHandler = (error, _req, res, _next) => {
    if (res.headersSent || res.destroyed) { if (!res.destroyed) res.destroy(); return; }
    const failure = error instanceof A2aError ? error
      : error instanceof TaskConflict ? new A2aError(409,"ALREADY_EXISTS",error.message)
      : error instanceof DiscoveryContinuationConflict ? new A2aError(409,"FAILED_PRECONDITION",error.message)
      : error.type === "entity.parse.failed" ? invalid("A2A 请求 JSON 无效。")
      : error.type === "entity.too.large" ? new A2aError(413,"RESOURCE_EXHAUSTED","A2A 请求超过容量限制。")
      : new A2aError(500,"INTERNAL","发现服务未能处理 A2A 请求。");
    if (failure.http === 500) console.error("OneEarth discovery could not process an A2A request");
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
