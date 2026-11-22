import path from "node:path";
import { mkdirSync } from "node:fs";
import { workTasks } from "./task-store";
import { postgresTaskStore } from "./postgres-task-store";
import { type RuntimeServices } from "./runtime-turn";
import {observationExecution} from "./observation-execution";
import {runtimeWorkerRunner} from "./runtime-worker-runner";
import { requestPerformance, type ExecutorTiming } from "./request-performance";
import { constellationService, parseSources } from "./constellations";
import { spatialCoverageClient } from "./spatial-coverage-client";
import { researchRegions } from "./research-region";
import { registerObservations } from "../src/domain/datasets";

const state = process.env.ONEEARTH_STATE_DIR || path.resolve(".local/state");
mkdirSync(state, {recursive:true, mode:0o700});
const adminBoundaryDir=process.env.ONEEARTH_ADMIN_BOUNDARY_DIR || path.join(state,"admin-boundaries");
const services:RuntimeServices = {
  tasks:await postgresTaskStore("runtime"),
  push:constellationService(process.env.ONEEARTH_OBSERVATION_DB || path.join(state,"observations.sqlite"),
    parseSources(process.env.ONEEARTH_PUSH_SOURCES)),
  coverage:spatialCoverageClient(),
  researchRegionService:researchRegions(adminBoundaryDir),
  adminBoundaryDir,
  canonicalCache:new Map(),
};
registerObservations(services.push.latest().records,true);
const engine=process.env.ONEEARTH_SKILL_REGISTRY&&(process.env.ONEEARTH_SKILL_SERVICE_TOKEN?.length??0)>=32?await observationExecution():undefined;
const runner=runtimeWorkerRunner(services,engine);
const stop=await workTasks(services.tasks, (task, signal, emit) => {
  const timings:ExecutorTiming[]=[];
  return requestPerformance.run(timings, () => runner.run(task,signal,emit));
},{maintenance:runner.maintenance});
let stopping=false;
const shutdown=()=>{if(stopping)return;stopping=true;void stop().then(()=>engine?.close()).then(()=>services.tasks.close()).then(()=>process.exit(0),()=>process.exit(1));};
process.once("SIGTERM",shutdown);process.once("SIGINT",shutdown);
console.log("OneEarth runtime worker started");
