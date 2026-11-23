import path from "node:path";
import {constellationService, parseSources} from "./constellations";
import {researchRegions} from "./research-region";
import {spatialCoverageClient} from "./spatial-coverage-client";
import type {TaskStore} from "./task-store";
import type {RuntimeServices} from "./runtime-turn";
import {registerObservations} from "../src/domain/datasets";

export function runtimeServices(state: string, tasks: TaskStore, webTools?: RuntimeServices["webTools"]): RuntimeServices {
  const adminBoundaryDir = process.env.ONEEARTH_ADMIN_BOUNDARY_DIR || path.join(state, "admin-boundaries");
  const push = constellationService(process.env.ONEEARTH_OBSERVATION_DB || path.join(state, "observations.sqlite"),
    parseSources(process.env.ONEEARTH_PUSH_SOURCES));
  registerObservations(push.latest().records, true);
  return {tasks, push, webTools, coverage: spatialCoverageClient(), researchRegionService: researchRegions(adminBoundaryDir),
    adminBoundaryDir, canonicalCache: new Map()};
}
