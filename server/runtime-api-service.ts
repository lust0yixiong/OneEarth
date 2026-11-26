import express from "express";
import { mkdirSync } from "node:fs";
import { resultSnapshots } from "./result-snapshots";
import { taskStatusRoutes } from "./task-store";
import { postgresTaskStore } from "./postgres-task-store";
import { runtimePaperRoutes } from "./runtime-paper-routes";
import { queryHainaCatalog, queryPapers } from "./discovery-a2a-client";
import { runtimeWorkbenchQueries } from "./runtime-workbench-queries";
import { recoverObservationRecord } from "./runtime-observation";
import { observationMaterialsRoutes } from "./runtime-observation-authority";
import { recoverObservationResearchRecord } from "./runtime-observation-research";
import { runtimeWebToolStore } from "./runtime-web-tool-store";
import { runtimeWebToolChannel } from "./runtime-web-tool-router";
import { agUiWorkbench } from "./ag-ui-workbench";
import { agUiWorkspaceInventory } from "./ag-ui-workspace-inventory";
import { nativeAgUiPath } from "../src/domain/native-ag-ui";
import { prepareRuntimeChat } from "./runtime-chat-turn";
import { runtimeServices } from "./runtime-services";
import { closeRuntimeModelCapacity } from "./runtime-model-capacity";

const badRequest: express.ErrorRequestHandler = (_error, _req, res, next) => {
  if (res.headersSent) { next(_error); return; }
  res.status(400).json({error:"运行时任务请求无效。"});
};

/** The workbench serves the business API and mounts the tool callback on loopback. */
export async function createRuntimeApi(state: string) {
  mkdirSync(state, {recursive:true, mode:0o700});
  const dispose: (() => void | Promise<void>)[] = [];
  dispose.push(closeRuntimeModelCapacity);
  let stop: Promise<void> | undefined;
  let close: Promise<void> | undefined;
  const stopWork: (() => void | Promise<void>)[] = [];
  const stopAccepting = () => stop ??= stopWorkers();
  async function stopWorkers() {
    const results = await Promise.allSettled(stopWork.map(async quit => { await quit(); }));
    const failed = results.find(result => result.status === "rejected");
    if (failed) throw failed.reason;
  }
  const closeResources = () => close ??= cleanUp();
  async function cleanUp() {
    let failure = await stopAccepting().catch((error: unknown) => ({error}));
    for (const cleanup of dispose.reverse()) {
      try { await cleanup(); } catch (error) { failure ??= {error}; }
    }
    if (failure) throw failure.error;
  }

  try {
    const tasks = await postgresTaskStore("runtime");
    dispose.push(() => tasks.close());
    const webTools = await runtimeWebToolStore();
    dispose.push(() => webTools.close());
    const webChannel = await runtimeWebToolChannel(webTools);
    stopWork.push(() => webChannel.close());
    const services = runtimeServices(state, tasks, webTools);
    dispose.push(() => services.push.close());
    stopWork.push(() => services.push.endStreams());
    const queries = runtimeWorkbenchQueries(state, queryPapers, queryHainaCatalog, services.push);
    dispose.push(() => queries.close());
    const snapshots = await resultSnapshots();
    dispose.push(() => snapshots.close());

    const business = express.Router();
    // Coverage and feed routes own their streaming formats and body limits.
    business.use(queries.router);
    business.use("/api/results", snapshots.router);
    business.use(["/api/paper-records", nativeAgUiPath], express.json({limit:"256kb"}));
    business.put("/api/tasks/:taskId/tool-calls/:toolCallId/receipt", express.json({limit:"16kb"}));
    business.use("/api/paper-records", runtimePaperRoutes());
    business.use(observationMaterialsRoutes());
    const chat = await agUiWorkbench(business, tasks, (id,input) =>
      prepareRuntimeChat(services, id, input, tasks.chat.latestCompleted, {publicAnswer:true}));
    stopWork.push(() => chat.close());
    agUiWorkspaceInventory(business, tasks, tasks.chat.agUiPendingWorkspaceCalls,
      async id => typeof await tasks.chat.agUiFingerprint(id) === "string");
    taskStatusRoutes(business, "/api/tasks", tasks,
      {researchRecords:true,chatIdentity:true,
        readInterrupt:id=>tasks.chat.agUiInterrupt(id),
        readWorkspaceTool:id=>tasks.chat.agUiWorkspaceRecord(id),
        recoverRecord:async task=>(await recoverObservationRecord(tasks,task))??recoverObservationResearchRecord(tasks,task),
        onCancelled:id=>chat.cancel(id)});
    business.use(badRequest);

    const internal = express.Router();
    internal.use(webChannel.router);
    internal.use(badRequest);
    return {business, internal, stopAccepting, close:closeResources};
  } catch (error) {
    await closeResources().catch(() => console.error("OneEarth could not release runtime API resources"));
    throw error;
  }
}
