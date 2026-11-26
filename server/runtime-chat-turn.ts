import {authorizedFlashApi} from "./flash-api";
import {authorizeObservationDigest} from "./observation-execution";
import type {PinnedObservationMaterial} from "./observation-artifacts";
import {hasObservationCheck, prepareObservationInput} from "./runtime-observation";
import {hasObservationResearch, observationOrdinaryInput, prepareObservationResearch} from "./runtime-observation-authority";
import {clarificationAnswerContext,priorResult,validateTurnStructure} from "./runtime-input";
import {runForegroundTurn, validRuntimeTurnHandoff, type RuntimeServices, type RuntimeTurnInput} from "./runtime-turn";
import type {ChatPreparation} from "./runtime-chat-channel";
import type {Payload,TaskStore} from "./task-store";
import {workspaceActionState} from "../src/domain/workspace-view-projection";
import {isDeepStrictEqual} from "node:util";
import {RuntimeConversationHistory} from "./conversation-history";
import {runtimeTurnContext,boundTurnContext} from "./runtime-turn-context";

export type ChatResearchHandoff = {
  body: RuntimeTurnInput;
  plan: import("./runtime-turn").RuntimeTurnHandoff;
};

export function readChatResearchHandoff(raw: Payload): ChatResearchHandoff {
  if (raw.kind !== "chat-research.v1" || !raw.body || !validRuntimeTurnHandoff(raw.plan))
    throw Error("找不到这条 Chat 消息的有效研究决定。");
  return {body: raw.body as RuntimeTurnInput, plan: raw.plan};
}

async function originalChatQuestion(tasks:TaskStore,first:RuntimeTurnInput) {
  let original=first;
  const visited=new Set<string>();
  while(original.clarificationAnswer){
    const id=original.clarificationAnswer.parentTaskId;
    if(visited.has(id)||visited.size>=32)throw Error("原追问关联无法恢复。");
    const previous=await clarificationAnswerContext(tasks,original);
    if(previous.prompt.kind!=="chat")break;
    visited.add(id);
    original=JSON.parse(previous.parent.body);
  }
  return original;
}

export async function prepareRuntimeChat(services: RuntimeServices, id: string, input: unknown,
  latestCompleted: (conversationId: string) => Promise<string | undefined>,mode:{publicAnswer?:true}={}): Promise<ChatPreparation> {
  const {tasks} = services;
  const issue = await validateTurnStructure(tasks, input);
  if (issue) return {error: issue};
  if (hasObservationCheck(input)) {
    const prepared = await prepareObservationInput(tasks, id, input, authorizeObservationDigest);
    return prepared.error ? {error: prepared.error} : {kind: "research", checkpoint: prepared.checkpoint};
  }
  const original = input as RuntimeTurnInput;
  const answered=original.clarificationAnswer?await clarificationAnswerContext(tasks,original):undefined;
  if(answered?.prompt.kind==="confirmation"&&await latestCompleted(original.conversationId)!==answered.parent.id)
    return {error:"原追问已过期，请查看当前会话最新的问题。"};
  if (original.questionDecision || original.clarificationReply) return {kind: "research"};

  const previousId=original.previousTaskId,previous=answered?.result??(previousId?await priorResult(tasks,original.conversationId,previousId):undefined);
  const parentBody=answered?JSON.parse(answered.parent.body) as RuntimeTurnInput:undefined;
  const originalQuestion=answered?.prompt.kind==="chat"&&parentBody?await originalChatQuestion(tasks,parentBody):parentBody;
  const actionState=(body:RuntimeTurnInput|undefined)=>{
    const view=body?.context.workspaceView;
    // A newly supported delivery capability does not change the archived view
    // or approve an action. Keep checking every actual view/control field.
    const {publishedLayerActions:_capability,...state}=view||{};
    const raw=workspaceActionState(view?state as typeof view:undefined);return raw?JSON.parse(raw):undefined;
  };
  if(answered&&previous?.workspacePending&&!isDeepStrictEqual(actionState(parentBody),actionState(original)))
    return {error:"回答前工作台已改变，原追问已失效。请按当前视图重新发问。"};
  const continuation=answered&&answered.prompt.kind!=="research"&&parentBody?{
    ...original,context:{...originalQuestion!.context,workspaceView:original.context.workspaceView,browserTurnFrame:original.context.browserTurnFrame},deepseekTools:originalQuestion!.deepseekTools,
    history:[...parentBody.history.slice(-5),{role:"user" as const,text:parentBody.query},{role:"assistant" as const,text:answered.prompt.question}],
  }:original;
  const observation = answered?.prompt.kind==="confirmation"?undefined:
    await hasObservationResearch(tasks, continuation) ? await prepareObservationResearch(tasks, id, continuation) : undefined;
  if (observation && "error" in observation) return {error: observation.error};
  const checkpoint = observation?.checkpoint;
  const archivedObservation = checkpoint?.observationParent === true;
  const unavailable = checkpoint?.ordinaryFallback === true;
  const materials = (checkpoint?.materials ?? []) as PinnedObservationMaterial[];
  const modelMaterials = materials.map(({artifactId, version, title, variables}) => ({artifactId, version, title, variables}));
  const preparedBody = observationOrdinaryInput(continuation, unavailable, archivedObservation) as RuntimeTurnInput;
  // Full server history is loaded only by run(), after this message is admitted.
  const parentId = previousId;
  const workspacePending = previous?.workspacePending;
  const eligible=parentId&&(answered?.prompt.kind==="chat"||await latestCompleted(original.conversationId)===parentId);
  const prompt=previous?.clarificationPrompt;
  const storedParent=parentBody??(eligible&&(prompt||workspacePending)?JSON.parse((await tasks.get(parentId!))!.body) as RuntimeTurnInput:undefined);
  const proposal=workspacePending?.proposedAction,originLayer=storedParent?.context.workspaceView?.activeLayer;
  const originControl=proposal&&originLayer?.id===proposal.layerId?originLayer.controls.find(control=>control.id===proposal.controlId):undefined;
  const proposalOrigin=workspacePending?.proposalOrigin??(proposal&&originControl?{layerId:proposal.layerId,controlId:proposal.controlId,valueId:originControl.current.id}:undefined);
  const pending=eligible&&(workspacePending||prompt)?{taskId:parentId!,question:prompt?.question??workspacePending!.question,
    originalQuestion:workspacePending?.originalQuestion??originalQuestion?.query??storedParent?.query,...workspacePending,
    ...(proposalOrigin?{proposalOrigin}:{}),
    ...(prompt?{clarificationPrompt:prompt}:{}),...(answered?{answer:answered.answer}:{})}:undefined;

  return {
    kind: "foreground",
    async run(taskId, signal, emit) {
      signal.throwIfAborted();
      const rows=await tasks.conversationHistory?.(original.conversationId,taskId);
      const conversationHistory=rows?new RuntimeConversationHistory(rows,taskId):undefined;
      const turnContext=await runtimeTurnContext(tasks,taskId,preparedBody);
      if(conversationHistory)turnContext.conversation=conversationHistory.projection();
      const cleanBody={...preparedBody,context:boundTurnContext(preparedBody.context,turnContext)};
      const outcome = await runForegroundTurn(services, taskId, cleanBody, signal, emit, {
        observationAvailable: modelMaterials.length > 0,
        observationMaterials: modelMaterials.length ? modelMaterials : undefined,
        observationUnavailable: unavailable,
        pending,turnContext,conversationHistory,...(mode.publicAnswer&&authorizedFlashApi(original.config)?{publicAnswer:true as const}:{}),
      });
      if (outcome.kind === "reply") return outcome;
      const selectedObservation = outcome.checkpoint.plan.observationUse === "selected";
      if (selectedObservation && (!modelMaterials.length || !checkpoint)) throw Error("观测研究的授权准备已失效。");
      return {kind: "research", handoff: {kind: "chat-research.v1", body: cleanBody, plan: outcome.checkpoint},
        ...(selectedObservation ? {checkpoint} : {})};
    },
  };
}
