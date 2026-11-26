import {modelExecutionContext} from "./model-execution-context";
import type {Router} from "express";
import type {PostgresChatMessages} from "./postgres-chat-messages";
import {submissionFingerprint} from "./postgres-chat-messages";
import {requestPerformance, type ExecutorTiming} from "./request-performance";
import {TaskCancelled} from "./task-cancellation";
import {TaskConflict, taskIdPattern, type Payload, type TaskStore} from "./task-store";
import {validBrowserWorkspaceReceipt,validWorkspaceRecoveryInput,type WorkspaceEffect} from "../src/domain/turn-context";
import type {DiscoveryResponse} from "../src/domain/types";
import {runtimeTurnContext} from "./runtime-turn-context";
import {reconcileWorkspaceRefusal} from "./workspace-recovery";

export type ChatPreparation = {error: string} | {kind: "research"; checkpoint?: Payload} |
  {kind: "foreground"; run(id: string, signal: AbortSignal, emit: (event: Payload) => void): Promise<
    {kind: "reply"; payload: Payload} | {kind: "research"; handoff: Payload; checkpoint?: Payload}>};

const interrupted = {error: "服务中断了本轮消息。请重新发送以继续。", code: "chat_interrupted"};

const workspaceFields = [
  "workspaceAction", "workspaceLayerOpen", "workspaceOperation", "view", "catalogQuery", "inspectId", "camera",
  "filters", "caseId", "dataView", "visualization", "mesh", "gridSystem", "layer",
  "previewNeed", "previewCaseId", "visualizeNeed", "previewKind", "clearSelection", "selectCenter",
] as const satisfies readonly (keyof DiscoveryResponse)[];

function workspaceReply(id: string, payload: Payload): Payload {
  const result = payload.result as DiscoveryResponse | undefined;
  if (payload.error || !result || result.clarification || result.clarificationPrompt || result.questionCheck) return payload;
  const fields = workspaceFields.filter(field => result[field] !== undefined);
  if (!fields.length) return payload;
  const workspaceEffect: WorkspaceEffect = {effectId: "workspace:" + id, state: "proposed", fields};
  return {...payload, result: {...result, workspaceEffect}};
}

export async function runtimeChatChannel(app: Router, tasks: TaskStore & {chat: PostgresChatMessages},
  prepare: (id: string, input: unknown) => Promise<ChatPreparation>, reconcile = reconcileWorkspaceRefusal) {
  const {chat} = tasks;
  await chat.acquire();
  const active = new Map<string, {controller: AbortController; done: Promise<void>}>();
  const recoveries=new Map<AbortController,Promise<unknown>>();
  let stopping = false;

  function start(id: string, run: Extract<ChatPreparation, {kind: "foreground"}>["run"]) {
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(125000)]);
    const timings: ExecutorTiming[] = [];
    let pending = Promise.resolve();
    let persistFailed = false;
    const emit = (event: Payload) => {
      pending = pending.then(async () => {
        if (!persistFailed) await chat.append(id, event);
      }).catch(() => { persistFailed = true; controller.abort(); });
    };
    const done = (async () => {
      try {
        const outcome = await requestPerformance.run(timings, () => modelExecutionContext.run({role:"foreground",taskId:id,tasks},()=>run(id,signal,emit)));
        await pending;
        signal.throwIfAborted();
        if (outcome.kind === "research") await chat.promote(id, outcome.handoff, outcome.checkpoint);
        else await chat.finish(id, outcome.payload.error ? "failed" : "complete", workspaceReply(id, outcome.payload));
      } catch {
        await pending;
        if (controller.signal.reason instanceof TaskCancelled) return;
        const error = stopping ? interrupted : signal.aborted && !persistFailed
          ? {error: "本轮消息等待模型响应超时，请重新发送。", code: "chat_timeout"}
          : {error: "本轮消息未完成，请查看已有记录。", code: "chat_failed"};
        await chat.finish(id, "failed", error);
      }
    })().catch(() => console.error("OneEarth Chat could not save the message result")).finally(() => active.delete(id));
    active.set(id, {controller, done});
  }

  app.post("/api/chat/messages", async (req, res) => {
    if (!req.is("application/json")) { res.status(403).json({error: "请通过 OneEarth 页面发送消息。"}); return; }
    const {id: suppliedId, input} = req.body ?? {};
    if (typeof suppliedId !== "string" || !taskIdPattern.test(suppliedId) || !input || typeof input !== "object") {
      res.status(400).json({error: "消息编号或输入无效。"}); return;
    }
    if (stopping) { res.status(503).json({error: "正在停止接收新消息。"}); return; }
    const id = suppliedId.toLowerCase();
    const accepted = (task: {id: string; status: string; created: number}) =>
      res.status(202).set("Cache-Control", "no-store").json({id: task.id, status: task.status, created: task.created});
    async function replay() {
      const saved = await tasks.get(id);
      if (saved && saved.fingerprint !== submissionFingerprint(JSON.stringify(input)))
        throw new TaskConflict("该消息编号已经用于另一份提交。");
      return saved;
    }
    try {
      const previous = await replay();
      if (previous) { accepted(previous); return; }
      const prepared = await prepare(id, input);
      if ("error" in prepared) {
        const concurrent = await replay();
        if (concurrent) accepted(concurrent);
        else res.status(400).json({error: prepared.error});
        return;
      }
      if (stopping) { res.status(503).json({error: "正在停止接收新消息。"}); return; }
      if (prepared.kind === "research") { accepted(await tasks.submit(id, input, prepared.checkpoint)); return; }
      const admitted = await chat.admit(id, input, 4);
      if (!admitted) { res.status(429).set("Retry-After", "2").json({error: "前台 Chat 正在处理其他消息，请稍后再发。"}); return; }
      if (admitted.started) {
        if (stopping) await chat.finish(id, "failed", interrupted);
        else start(id, prepared.run);
      }
      accepted(admitted.task);
    } catch (error) {
      if (!(error instanceof TaskConflict)) throw error;
      res.status(409).json({error: error.message});
    }
  });

  app.post("/api/chat/messages/:id/workspace-receipt", async (req, res) => {
    const id = String(req.params.id).toLowerCase();
    if (!req.is("application/json") || !taskIdPattern.test(id) || !validBrowserWorkspaceReceipt(req.body)) {
      res.status(400).json({error: "工作台回执格式无效。"});
      return;
    }
    try {
      const receipt = await chat.recordWorkspaceReceipt(id, req.body);
      if (!receipt) {
        res.status(404).json({error: "找不到此轮对应的工作台操作。"});
        return;
      }
      res.set("Cache-Control", "no-store").json(receipt);
    } catch (error) {
      if (!(error instanceof TaskConflict)) throw error;
      res.status(409).json({error: error.message});
    }
  });

  app.post("/api/chat/messages/:id/workspace-recovery",async (req,res)=>{
    const id=String(req.params.id).toLowerCase();
    if(!req.is("application/json")||!taskIdPattern.test(id)||!validWorkspaceRecoveryInput(req.body)){
      res.status(400).json({error:"工作台复核格式无效。"});return;
    }
    if(stopping){res.status(503).json({error:"工作台正在关闭。"});return;}
    const current=req.body;
    const claim=await chat.claimWorkspaceRecovery(id,current);
    if(!claim){res.status(409).json({error:"原操作或当前视图不符合复核条件。"});return;}
    res.set("Cache-Control","no-store");
    if(!("body" in claim)){res.json(claim.receipt);return;}
    const {body,result,receipt}=claim;
    const controller=new AbortController();
    const abort=()=>controller.abort();
    res.once("close",abort);
    if(res.destroyed||stopping)abort();
    const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(20000)]);
    const recovery=(async()=>{
      try{
        signal.throwIfAborted();
        const turnContext=await runtimeTurnContext(tasks,id,body);
        const advice=await modelExecutionContext.run({role:"foreground",taskId:id,tasks},()=>reconcile({taskId:id,original:body,result,refusal:receipt,current,turnContext},{signal}));
        signal.throwIfAborted();
        return await chat.finishWorkspaceRecovery(id,advice);
      }catch {
        return await chat.finishWorkspaceRecovery(id);
      }
    })();
    recoveries.set(controller,recovery);
    try {
      const finished=await recovery;
      if(!res.destroyed)res.json(finished??receipt);
    }finally{
      recoveries.delete(controller);
      res.off("close",abort);
    }
  });

  return {
    cancel(id: string) { active.get(id.toLowerCase())?.controller.abort(new TaskCancelled()); },
    async close() {
      stopping = true;
      for (const {controller} of active.values()) controller.abort();
      for(const controller of recoveries.keys())controller.abort();
      await Promise.allSettled([...active.values()].map(({done})=>done).concat([...recoveries.values()].map(done=>done.then(()=>{}))));
    },
  };
}
