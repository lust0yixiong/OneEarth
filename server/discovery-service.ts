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
    history, references, currentDatasets, conversationEvidence} = input;
  const stage = (message: string) => emit({stage:message});
  const result = await requiredDataSearch(query, signal, {
    initialPlan, conversationContext, previousResearchIntent, history, references,
    planned: planned => emit({planned}),
    finding: finding => emit({finding}),
    report: call => emit({call}),
    stage,
    plan: correction => runExecutor(config, dataSearchInstructions +
      (deepseekTools?.search ? "\n若已知相关产品名或发布方，请在网页检索词中使用。未知时保留研究主题。" : "") +
      "\n" + JSON.stringify({
        question:query, ...(decision ? {originalQuestion:query, confirmedQuestion:decision.dataQuestion} : {}),
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
