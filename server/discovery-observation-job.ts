import {randomUUID} from "node:crypto";
import {
  skillRequestKind, skillResultKind, type ObservationCheck, type SkillDemand, type SkillResultSubmission,
} from "./observation-check-contract";
import {observationResearchKind, type ObservationResearchRequest} from "./observation-research-contract";

export type ObservationCheckRequest = {researchTaskId: string; check: ObservationCheck};
export type ObservationCheckJob =
  | {kind: typeof skillRequestKind; input: ObservationCheckRequest}
  | {kind: typeof skillResultKind; demand: SkillDemand; receipt: SkillResultSubmission; research?:true};
export type ObservationResearchJob = {kind:typeof observationResearchKind; input:ObservationResearchRequest};

export function runObservationCheckJob(job: ObservationCheckJob, signal: AbortSignal) {
  signal.throwIfAborted();
  // The task store commits this checkpoint event together with retiring the current job.
  if (job.kind === skillRequestKind)
    return {skillDemand:{...job.input,requestId:randomUUID()} satisfies SkillDemand};
  return {result:{observationCheckResult:job.receipt.result}};
}
