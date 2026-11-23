import {createHash} from "node:crypto";
import {isDeepStrictEqual} from "node:util";
import {resolvedChatModel, validChatModel, type ChatModel} from "../src/domain/chat-model";
import {validDeepSeekTools, toolsOff} from "../src/domain/deepseek-tools";
import {validQuestionDecision} from "../src/domain/question-confirmation";
import {validResearchIntent} from "../src/domain/research-intent";
import {validReadEvidence} from "../src/domain/read-evidence";
import {validConversationReferences} from "../src/domain/reference-memory";
import {validHistory} from "./turn-history";
import {validContext} from "./validation";
import {TaskConflict, taskIdPattern, type TaskStore} from "./task-store";
import {allowedDiscoveryTools, type DiscoveryConfiguration} from "./discovery-config";
import type {DiscoveryInput} from "./discovery-contract";
import type {DiscoveryA2aStore, DiscoveryContinuation} from "./discovery-a2a-store";
import type {DataSearchResult} from "./data-search";
import {webToolGrantPattern} from "./web-tool-contract";

const businessFields = new Set([
  "query","deepseekTools","decision","clarificationReply","continuedFrom","continuation","researchGoal","evidenceGap",
  "conversationContext","previousResearchIntent","history","references","scope","currentDatasets","conversationEvidence","runtimeWebToolGrant",
]);
const shortText = (value: unknown, limit: number): value is string =>
  typeof value === "string" && !!value.trim() && value.length <= limit;

function validClarificationReply(value: unknown): value is NonNullable<DiscoveryInput["clarificationReply"]> {
  const reply = value as {text?:unknown;afterSeq?:unknown}|null;
  return !!reply && typeof reply === "object" && !Array.isArray(reply) && Object.keys(reply).length === 2 &&
    shortText(reply.text,4000) && typeof reply.afterSeq === "number" && Number.isSafeInteger(reply.afterSeq) && reply.afterSeq > 0;
}

export function sameModel(left:ChatModel, right:ChatModel|undefined) {
  if (!right) return false;
  const a = resolvedChatModel(left), b = resolvedChatModel(right);
  return a.executor === b.executor && a.model === b.model &&
    (a.provider ?? "native") === (b.provider ?? "native") && a.endpoint === b.endpoint;
}

export function discoveryInput(store: Pick<TaskStore,"get"|"terminal">, configuration: DiscoveryConfiguration, delegations: Pick<DiscoveryA2aStore,"progress"|"hasJob">) {
  function effective(input: DiscoveryInput): DiscoveryInput {
    if (configuration.kind !== "configured") return input;
    return {...input, config:configuration.model, deepseekTools:allowedDiscoveryTools(input.deepseekTools,configuration.tools)};
  }
  async function validate(value: unknown, a2a: boolean, confirmingA2a = false) {
    const input = value as Partial<DiscoveryInput> | null;
    if (!input || !shortText(input.query,4000) || !validChatModel(input.config) || !validHistory(input.history) ||
      (input.runtimeWebToolGrant !== undefined &&
        (typeof input.runtimeWebToolGrant !== "string" || !webToolGrantPattern.test(input.runtimeWebToolGrant))) ||
      (input.deepseekTools !== undefined && !validDeepSeekTools(input.deepseekTools)) ||
      (input.decision !== undefined && !validQuestionDecision(input.decision,input.query)) ||
      input.clarificationReply !== undefined ||
      (input.researchGoal !== undefined && !shortText(input.researchGoal,1200)) ||
      (input.evidenceGap !== undefined && !shortText(input.evidenceGap,500)) ||
      (input.initialPlan !== undefined && typeof input.initialPlan !== "string") ||
      !Array.isArray(input.references) || !Array.isArray(input.currentDatasets) || !input.scope ||
      !validContext({...input.scope,camera:{center:[105,25],zoom:1,reason:"发现"},gridSystem:"h3",layer:"all"}))
      return "数据发现请求的模型、上下文或确认信息无效。";

    if (a2a && (!validConversationReferences(input.references) ||
      (input.conversationContext !== undefined && (typeof input.conversationContext !== "string" || input.conversationContext.length > 1600)) ||
      (input.previousResearchIntent !== undefined && !validResearchIntent(input.previousResearchIntent)) ||
      (input.conversationEvidence !== undefined && !validReadEvidence(input.conversationEvidence)) ||
      (input.deepseekTools && Object.keys(input.deepseekTools).some(key => key !== "search" && key !== "fetch")) ||
      (input.continuedFrom !== undefined && (typeof input.continuedFrom !== "string" || !input.decision)) ||
      (input.decision && !input.continuedFrom && input.continuation === undefined) ||
      !input.currentDatasets.every(asset => asset && shortText(asset.id,500) && shortText(asset.title,2000) &&
        typeof asset.source === "string" && asset.source.length <= 2000)))
      return "发现委托的已得资料、访问授权或确认信息无效。";

    if (input.continuation !== undefined) {
      const next = input.continuation;
      if (!next || typeof next.previousId !== "string" || !taskIdPattern.test(next.previousId) ||
        !shortText(next.focus,500) || input.initialPlan !== undefined)
        return "补充发现需要原任务编号和具体证据缺口。";
      if (!a2a && await delegations.hasJob(next.previousId)) return "前一次发现任务没有可用于继续发现的结果。";
      const parent = await store.get(next.previousId);
      const result = (await store.terminal(next.previousId))?.result as DataSearchResult|undefined;
      if (parent?.status !== "complete" || !result || result.questionCheck || result.clarification)
        return "前一次发现任务没有可用于继续发现的结果。";
      const prior = JSON.parse(parent.body) as DiscoveryInput;
      const current = effective(input as DiscoveryInput);
      const sameAccess = configuration.kind === "configured"
        ? sameModel(prior.config,current.config) && isDeepStrictEqual(prior.deepseekTools ?? toolsOff,current.deepseekTools)
        : isDeepStrictEqual(prior.config,input.config) && isDeepStrictEqual(prior.deepseekTools,input.deepseekTools);
      if (prior.query !== input.query || !isDeepStrictEqual(prior.decision,input.decision) || !sameAccess ||
        (a2a && !isDeepStrictEqual(prior.scope,input.scope)) ||
        (prior.researchGoal !== undefined && input.researchGoal !== undefined && prior.researchGoal !== input.researchGoal))
        return "补充发现必须沿用本轮问题、确认结果和访问配置。";
      if (input.evidenceGap !== undefined && input.evidenceGap !== next.focus)
        return "补充发现只能使用本次续查所指定的证据缺口。";
    }
    if (input.decision && input.continuedFrom && !confirmingA2a && !(a2a && input.continuation)) {
      const parent = taskIdPattern.test(input.continuedFrom) && !await delegations.hasJob(input.continuedFrom)
        ? await store.terminal(input.continuedFrom) : undefined;
      const check = (parent?.result as DataSearchResult|undefined)?.questionCheck;
      if (!check || check.originalQuestion !== input.query ||
        (input.decision.choice === "proposed" && check.proposedQuestion !== input.decision.dataQuestion))
        return "发现服务没有对应的待确认问题。";
      if (a2a) {
        const prior = await store.get(input.continuedFrom);
        if (!prior || !isDeepStrictEqual((JSON.parse(prior.body) as DiscoveryInput).scope,input.scope))
          return "确认须沿用原委托的已授权范围。";
      }
    }
  }

  return {
    effective,
    legacy: (input: unknown) => validate(input,false),
    async a2a(input: Record<string,unknown>, confirmation?: DiscoveryContinuation) {
      if (Object.keys(input).some(key => !businessFields.has(key)))
        return {issue:"发现委托仅接受业务输入，模型及渠道计划由发现服务配置。"};
      const grant = input.runtimeWebToolGrant;
      if (grant !== undefined && (typeof grant !== "string" || !webToolGrantPattern.test(grant)))
        return {issue:"公开网络工具授权格式无效。"};
      if (configuration.kind !== "configured") return {issue:configuration.issue,unavailable:true};
      if ("clarificationReply" in input) {
        const reply = input.clarificationReply;
        if (!confirmation || input.continuedFrom !== confirmation.id || !validClarificationReply(reply) ||
          Object.keys(input).some(key => !["continuedFrom","clarificationReply","runtimeWebToolGrant"].includes(key)))
          return {issue:"澄清续行只接受原 taskId、continuedFrom 及有效的澄清回复。"};
        if (reply.afterSeq !== confirmation.waitingSeq)
          return {issue:"该澄清回复对应的等待阶段已变更，请查看最新研究进展。"};
        const parent = await store.get(confirmation.jobId);
        const result = (await store.terminal(confirmation.jobId))?.result as DataSearchResult|undefined;
        if (!parent || !result?.clarification || result.questionCheck)
          return {issue:"发现服务没有对应的待澄清问题。"};
        const prior = JSON.parse(parent.body) as DiscoveryInput;
        const authorized = effective(prior);
        if (!sameModel(prior.config,authorized.config) || !isDeepStrictEqual(prior.deepseekTools,authorized.deepseekTools))
          return {issue:"发现服务模型或工具授权已经改变，请重新委托。"};
        const {runtimeWebToolGrant: _priorGrant,...context} = authorized;
        return {body:{...context,continuedFrom:confirmation.jobId,clarificationReply:reply,
          ...(grant !== undefined ? {runtimeWebToolGrant:grant} : {})}};
      }

      const body = {...input,config:configuration.model} as DiscoveryInput;
      if (confirmation) {
        if (body.continuedFrom !== confirmation.id || !body.decision || body.continuation !== undefined)
          return {issue:"续行需要本发现任务的 continuedFrom 和研究者确认。"};
        body.continuedFrom = confirmation.jobId;
      } else if (typeof body.continuedFrom === "string" && taskIdPattern.test(body.continuedFrom)) {
        if (await delegations.hasJob(body.continuedFrom))
          return {issue:"确认须引用实际发现任务编号。"};
        const original = await delegations.progress(body.continuedFrom);
        if (original && !original.privateTask) {
          if (body.continuedFrom !== body.continuation?.previousId)
            return {issue:"待确认的 A2A 委托请通过原 taskId 续行。"};
        }
      }
      if (body.continuation && typeof body.continuation.previousId === "string" && taskIdPattern.test(body.continuation.previousId)) {
        const parent = await delegations.progress(body.continuation.previousId);
        if (parent && !parent.privateTask) body.continuation = {...body.continuation,previousId:parent.jobId};
        else if (await delegations.hasJob(body.continuation.previousId))
          return {issue:"补充发现须引用实际发现任务编号。"};
      }
      const issue = await validate(body,true,!!confirmation);
      if (issue) return {issue};
      const authorized = effective(body);
      if (confirmation) {
        const parent = await store.get(confirmation.jobId);
        const result = (await store.terminal(confirmation.jobId))?.result as DataSearchResult|undefined;
        if (!parent || !result) return {issue:"发现服务没有对应的待确认结果。"};
        const prior = JSON.parse(parent.body) as DiscoveryInput;
        if (prior.query !== body.query || !isDeepStrictEqual(prior.scope,body.scope) ||
          !sameModel(prior.config,authorized.config) || !isDeepStrictEqual(prior.deepseekTools,authorized.deepseekTools))
          return {issue:"续行须对应原委托的问题、范围及访问授权。"};
        const check = result.questionCheck;
        const decision = body.decision!;
        if (!check || check.originalQuestion !== body.query ||
          (decision.choice === "proposed" && decision.dataQuestion !== check.proposedQuestion) ||
          (body.researchGoal !== undefined && body.researchGoal !== prior.researchGoal && body.researchGoal !== decision.dataQuestion))
          return {issue:"问题确认须对应已经存档的提议和原委托目标。"};
      }
      return {body:authorized};
    },
  };
}

export function discoveryLegacyStore(store: TaskStore, delegations: Pick<DiscoveryA2aStore,"hasJob">,
  configuration: DiscoveryConfiguration, prepare: ReturnType<typeof discoveryInput>): TaskStore {
  return {
    ...store,
    async get(id) {return await delegations.hasJob(id) ? undefined : store.get(id);},
    async submit(id,input) {
      if (await delegations.hasJob(id)) throw new TaskConflict("该任务编号已经用于另一份提交。");
      if (configuration.kind !== "configured") return store.submit(id,input);
      const previous = await store.get(id);
      const raw = createHash("sha256").update(JSON.stringify(input)).digest("hex");
      if (previous?.fingerprint === raw) return previous;
      if (previous && (JSON.parse(previous.body) as {_legacyRequestFingerprint?:string})._legacyRequestFingerprint === raw)
        return previous;
      return store.submit(id,{...prepare.effective(input as DiscoveryInput),_legacyRequestFingerprint:raw});
    },
  };
}
