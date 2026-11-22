import path from "node:path";
import { mkdirSync } from "node:fs";
import { workTasks } from "./task-store";
import { postgresTaskStore } from "./postgres-task-store";
import { executeTurn, type RuntimeServices } from "./runtime-turn";
import { requestPerformance, type ExecutorTiming } from "./request-performance";
import { paperCache } from "./earthnano";
import { hainaService } from "./haina-search";
import { constellationService, parseSources } from "./constellations";
import { spatialCoverageClient } from "./spatial-coverage-client";
import { researchRegions } from "./research-region";
import { registerObservations, registerPapers } from "../src/domain/datasets";

const state = process.env.ONEEARTH_STATE_DIR || path.resolve(".local/state");
mkdirSync(state, {recursive:true, mode:0o700});
const adminBoundaryDir=process.env.ONEEARTH_ADMIN_BOUNDARY_DIR || path.join(state,"admin-boundaries");
const services:RuntimeServices = {
  tasks:await postgresTaskStore("runtime"),
  cachedPapers:paperCache(path.join(state,"paper-evidence.sqlite")),
  haina:hainaService(path.join(state,"haina-catalog.json")),
  push:constellationService(process.env.ONEEARTH_OBSERVATION_DB || path.join(state,"observations.sqlite"),
    parseSources(process.env.ONEEARTH_PUSH_SOURCES)),
  coverage:spatialCoverageClient(),
  researchRegionService:researchRegions(adminBoundaryDir),
  adminBoundaryDir,
  canonicalCache:new Map(),
};
registerPapers(services.cachedPapers.list());
registerObservations(services.push.latest().records,true);
await workTasks(services.tasks, ({id,body}, signal, emit) => {
  const timings:ExecutorTiming[]=[];
  return requestPerformance.run(timings, () => executeTurn(services,id,body,signal,emit));
});
console.log("OneEarth runtime worker started");
