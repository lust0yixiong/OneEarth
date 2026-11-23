import {authorizeObservationDigest} from "./observation-execution";
import type {PinnedObservationMaterial} from "./observation-artifacts";
import {hasObservationCheck, prepareObservationInput} from "./runtime-observation";
import {hasObservationResearch, observationOrdinaryInput, prepareObservationResearch} from "./runtime-observation-authority";
import {priorResult, validateTurnStructure} from "./runtime-input";
import {runForegroundTurn, validRuntimeTurnHandoff, type RuntimeServices, type RuntimeTurnInput} from "./runtime-turn";
import type {ChatPreparation} from "./runtime-chat-channel";
import type {Payload} from "./task-store";

export type ChatResearchHandoff = {
  body: RuntimeTurnInput;
  plan: import("./runtime-turn").RuntimeTurnHandoff;
};

export function readChatResearchHandoff(raw: Payload): ChatResearchHandoff {
  if (raw.kind !== "chat-research.v1" || !raw.body || !validRuntimeTurnHandoff(raw.plan))
    throw Error("找不到这条 Chat 消息的有效研究决定。");
  return {body: raw.body as RuntimeTurnInput, plan: raw.plan};
}

export async function prepareRuntimeChat(services: RuntimeServices, id: string, input: unknown,
  latestCompleted: (conversationId: string) => Promise<string | undefined>): Promise<ChatPreparation> {
  const {tasks} = services;
  const issue = await validateTurnStructure(tasks, input);
  if (issue) return {error: issue};
  if (hasObservationCheck(input)) {
    const prepared = await prepareObservationInput(tasks, id, input, authorizeObservationDigest);
    return prepared.error ? {error: prepared.error} : {kind: "research", checkpoint: prepared.checkpoint};
  }
  const original = input as RuntimeTurnInput;
  if (original.questionDecision || original.clarificationReply) return {kind: "research"};

  const observation = await hasObservationResearch(tasks, input) ? await prepareObservationResearch(tasks, id, input) : undefined;
  if (observation && "error" in observation) return {error: observation.error};
  const checkpoint = observation?.checkpoint;
  const archivedObservation = checkpoint?.observationParent === true;
  const unavailable = checkpoint?.ordinaryFallback === true;
  const materials = (checkpoint?.materials ?? []) as PinnedObservationMaterial[];
  const modelMaterials = materials.map(({artifactId, version, title, variables}) => ({artifactId, version, title, variables}));
  const cleanBody = observationOrdinaryInput(original, unavailable, archivedObservation) as RuntimeTurnInput;
  const parentId = original.previousTaskId;
  const previous = parentId ? await priorResult(tasks, original.conversationId, parentId) : undefined;
  const workspacePending = previous?.workspacePending;
  const pending = parentId && workspacePending && await latestCompleted(original.conversationId) === parentId
    ? {taskId: parentId, ...workspacePending} : undefined;

  return {
    kind: "foreground",
    async run(taskId, signal, emit) {
      const outcome = await runForegroundTurn(services, taskId, cleanBody, signal, emit, {
        observationAvailable: modelMaterials.length > 0,
        observationMaterials: modelMaterials.length ? modelMaterials : undefined,
        observationUnavailable: unavailable,
        pending,
      });
      if (outcome.kind === "reply") return outcome;
      const selectedObservation = outcome.checkpoint.plan.observationUse === "selected";
      if (selectedObservation && (!modelMaterials.length || !checkpoint)) throw Error("观测研究的授权准备已失效。");
      return {kind: "research", handoff: {kind: "chat-research.v1", body: cleanBody, plan: outcome.checkpoint},
        ...(selectedObservation ? {checkpoint} : {})};
    },
  };
}
