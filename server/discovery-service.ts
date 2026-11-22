import express from "express";
import path from "node:path";
import { mkdirSync } from "node:fs";
import { accessGuard } from "./access";
import { taskRoutes, taskIdPattern, workTasks } from "./task-store";
import { postgresTaskStore } from "./postgres-task-store";
import { runExecutor } from "./executor";
import { validHistory } from "./turn-history";
import { validChatModel } from "../src/domain/chat-model";
import { validDeepSeekTools } from "../src/domain/deepseek-tools";
import { validQuestionDecision } from "../src/domain/question-confirmation";
import { validContext } from "./validation";
import { dataSearchInstructions, dataSearchSchema, requiredDataSearch } from "./data-search";
import { paperCache, searchPapers } from "./earthnano";
import { paperCatalog } from "./paper-catalog";
import { productDatabase } from "./product-database";
import { validPaperRecord } from "../src/domain/paper-record";
import { registerPapers } from "../src/domain/datasets";
import { hainaService } from "./haina-search";
import { searchSources } from "./web-search";
import { nativeWebSearch } from "./native-web-search";
import { webComplementInstructions, complementSchema } from "./web-complement";
import type { DiscoveryInput } from "./discovery-contract";

const state = process.env.ONEEARTH_STATE_DIR || path.resolve(".local/state");
mkdirSync(state, {recursive:true, mode:0o700});
const store = await postgresTaskStore("discovery");
const papers = paperCache(path.join(state,"paper-evidence.sqlite"));
const records=productDatabase("DISCOVERY");
try{
  const saved=await records.query("SELECT record FROM discovery_papers ORDER BY id");
  for(const {record} of saved.rows)if(validPaperRecord(record))papers.save(record);
}finally{await records.end();}
registerPapers(papers.list());
const haina = hainaService(path.join(state, "haina-catalog.json"));
haina.start();
const app = express();
app.disable("x-powered-by");
app.use(accessGuard());
app.use(express.json({limit:"384kb"}));
app.use("/api/paper-records",paperCatalog(papers));
app.get("/api/health", (_req, res) => res.json({status:"ok", service:"discovery"}));
taskRoutes(app, "/v1/discoveries", store, async value => {
  const input = value as Partial<DiscoveryInput> | null;
  if (!input || typeof input.query !== "string" || !input.query.trim() || input.query.length > 4000 ||
    !validChatModel(input.config) || !validHistory(input.history) ||
    (input.deepseekTools !== undefined && !validDeepSeekTools(input.deepseekTools)) ||
    (input.decision !== undefined && !validQuestionDecision(input.decision, input.query)) ||
    (input.initialPlan !== undefined && typeof input.initialPlan !== "string") ||
    !Array.isArray(input.references) || !Array.isArray(input.currentDatasets) || !input.scope ||
    !validContext({...input.scope, camera:{center:[105,25],zoom:1,reason:"发现"},gridSystem:"h3",layer:"all"})) {
    return "数据发现请求的模型、上下文或确认信息无效。";
  }
  if(input.continuation!==undefined){
    const next=input.continuation;
    if(!next||typeof next.previousId!=="string"||!taskIdPattern.test(next.previousId)||
      typeof next.focus!=="string"||!next.focus.trim()||next.focus.length>500||input.initialPlan!==undefined)
      return "补充发现需要原任务编号和具体证据缺口。";
    const parent=await store.get(next.previousId);
    const result=(await store.terminal(next.previousId))?.result as import("./data-search").DataSearchResult|undefined;
    if(parent?.status!=="complete"||!result||result.questionCheck||result.clarification)
      return "前一次发现任务没有可用于继续发现的结果。";
    const prior=JSON.parse(parent.body) as DiscoveryInput;
    if(prior.query!==input.query||JSON.stringify(prior.decision)!==JSON.stringify(input.decision)||
      JSON.stringify(prior.config)!==JSON.stringify(input.config)||JSON.stringify(prior.deepseekTools)!==JSON.stringify(input.deepseekTools))
      return "补充发现必须沿用本轮问题、确认结果和访问配置。";
  }
  if (input.decision && input.continuedFrom) {
    const parent = taskIdPattern.test(input.continuedFrom) ? await store.terminal(input.continuedFrom) : undefined;
    const check = (parent?.result as import("./data-search").DataSearchResult | undefined)?.questionCheck;
    if (!check || check.originalQuestion !== input.query ||
      (input.decision.choice === "proposed" && check.proposedQuestion !== input.decision.dataQuestion))
      return "发现服务没有对应的待确认问题。";
  }

});
await workTasks(store, async ({body: input}: {body: DiscoveryInput}, signal, emit) => {
  const {query, config, deepseekTools, decision, scope, initialPlan, conversationContext, previousResearchIntent,
    history, references, currentDatasets, conversationEvidence, continuation} = input;
  const previous=continuation
    ? (await store.terminal(continuation.previousId))?.result as import("./data-search").DataSearchResult|undefined
    : undefined;
  const previousDiscovery=previous?{
    terms:{paper:previous.plan.paper,haina:previous.plan.hainaQueries,web:previous.plan.web},
    materials:{papers:previous.papers.slice(0,12).map(record=>({id:record.id,title:record.paperTitle,data:record.need.product})),
      haina:previous.haina.slice(0,12).map(asset=>({id:asset.id,title:asset.title})),
      web:[...new Set(previous.searches.flatMap(run=>run.hits.map(hit=>hit.url)))].slice(0,18)},
  }:undefined;
  const stage = (message: string) => emit({stage:message});
  const result = await requiredDataSearch(query, signal, {
    initialPlan, conversationContext, previousResearchIntent, history, references, lockQuestion:!!continuation,
    planned: planned => emit({planned}),
    finding: finding => emit({finding}),
    report: call => emit({call}),
    stage,
    plan: correction => runExecutor(config, dataSearchInstructions +
      (continuation ? "\n这是已经开始的发现任务。固定原问题及确认范围，只为 evidenceGap 补查新的证据。沿用已有资料身份，避免重新执行上一轮通用检索。必须使用 preserve。缺少供用户决定的关键条件时才澄清。evidenceGap 是待查字段，不是改写原问题的授权。对外检索词仅使用公开主题。" : "") +
      (deepseekTools?.search ? "\n若已知相关产品名或发布方，请在网页检索词中使用。未知时保留研究主题。" : "") +
      "\n" + JSON.stringify({
        question:query, evidenceGap:continuation?.focus, previousDiscovery, ...(decision ? {originalQuestion:query, confirmedQuestion:decision.dataQuestion} : {}),
        history: history.map(({conversationEvidence:_, conversationAssertionEvidence:__, ...turn}) => turn),
        conversationContext, userAttachments:scope.attachedScope, scope, currentDatasets,
        ...(correction ? {planningCorrection:correction, correctionRule:"只修正参数格式与检索短语，保留原问题和已确认的意图，不添加研究条件。"} : {}),
      }), signal, {outputSchema:dataSearchSchema}),
    paper: async plan => {
      const batch = await searchPapers(plan, signal, stage, call => emit({call}));
      for (const record of batch.records) papers.save(record);
      registerPapers(batch.records);
      return batch;
    },
    haina: queries => haina.search(queries, signal),
    refineWeb: (request, readSignal) => runExecutor(config, webComplementInstructions + "\n" + JSON.stringify(request),
      readSignal, {outputSchema:complementSchema(request)}),
    web: async (queries, options) => {
      if (process.env.ONEEARTH_TEST_FAIL_CHANNEL === "web") {
        await import("node:timers/promises").then(({setTimeout})=>setTimeout(2500,undefined,{signal}));
        throw Error("验收故障注入：网页检索渠道不可用。");
      }
      return searchSources(queries, signal, searches => emit({stage:"正在检索公开网络来源", searches}), {
      ...options, deepseekTools, archiveQuestion:query, priorArchiveTargets:conversationEvidence,
      ...((!config.provider || config.provider === "native") && config.executor === "codex"
        ? {nativeSearch:(terms:string[], searchSignal:AbortSignal) => nativeWebSearch(config, terms, searchSignal)} : {}),
      });
    },
  }, decision);
  return {result};
});
const port = Number(process.env.ONEEARTH_DISCOVERY_PORT || 5275);
app.listen(port, "127.0.0.1", () => console.log("OneEarth discovery listening on " + port));
