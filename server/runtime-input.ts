import { taskIdPattern, type TaskStore } from "./task-store";
import { validContext } from "./validation";
import { validChatModel } from "../src/domain/chat-model";
import { validHistory } from "./turn-history";
import { validDeepSeekTools } from "../src/domain/deepseek-tools";
import { validQuestionDecision } from "../src/domain/question-confirmation";
import { cases } from "../src/domain/catalog";
import type { DiscoveryResponse } from "../src/domain/types";
import {clarificationParent} from "./clarification-guard";
import {parseObservationCheck,type ObservationCheck} from "./observation-check-contract";

export async function priorResult(tasks: TaskStore, conversationId: string | undefined, parentId: string | undefined): Promise<DiscoveryResponse | undefined> {
  if (!conversationId || !parentId || !taskIdPattern.test(parentId)) return;
  const parent = await tasks.get(parentId);
  if (!parent || JSON.parse(parent.body).conversationId !== conversationId) return;
  return (await tasks.terminal(parentId))?.result as DiscoveryResponse | undefined;
}
export async function validateTurnStructure(tasks: TaskStore, value: unknown): Promise<string | undefined> {
  const body = value as Record<string, unknown> | null;
  if (!body || typeof body.query !== "string" || !body.query.trim() || body.query.length > 4000 || !validContext(body.context))
    return "请输入有效问题，并附带当前查询上下文。";
  if (!validChatModel(body.config) || !validHistory(body.history))
    return "模型配置或对话历史格式无效。";
  if (body.deepseekTools !== undefined && !validDeepSeekTools(body.deepseekTools))
    return "网页工具设置无效。";
  if (typeof body.conversationId !== "string" || body.conversationId.length > 200 || !body.conversationId ||
      typeof body.turnId !== "string" || !body.turnId || body.turnId.length > 200) return "会话或对话轮编号无效。";
  if(body.observationCheck!==undefined){
    const check=parseObservationCheck(body.observationCheck);
    if(!check)return "观测核对的能力版本、资料版本、变量、单位或时段无效。";
    if(body.questionDecision!==undefined||body.clarificationReply!==undefined)return "观测核对不能代替原研究的问题确认或澄清。";
    if(body.expectedSha256!==undefined)return "观测文件摘要由服务端授权登记确定，不能由客户端指定。";
  }
  if (body.questionDecision !== undefined) {
    if (!validQuestionDecision(body.questionDecision, body.query)) return "问题确认与原请求不一致，请重新确认。";
    const check = (await priorResult(tasks,body.conversationId,body.questionDecision.checkMessageId))?.questionCheck;
    if (!check || check.originalQuestion !== body.query ||
      (body.questionDecision.choice === "proposed" && body.questionDecision.dataQuestion !== check.proposedQuestion))
      return "原任务没有可供这次确认的问题，请回到该任务重新确认。";
  }
  const context = body.context as import("../src/domain/types").DiscoveryContext;
  if (context.caseId && !cases.some(c => c.id === context.caseId)) return "未找到对应案例。";
  if(body.clarificationReply!==undefined){
    try{await clarificationParent(tasks,body as Parameters<typeof clarificationParent>[1]);}
    catch(error){return error instanceof Error?error.message:"原澄清无法继续。";}
  }
}

export async function validateTurn(tasks:TaskStore,value:unknown,capabilities:{observationCheck?:(check:ObservationCheck)=>Promise<boolean>}={}):Promise<string|undefined>{
  const issue=await validateTurnStructure(tasks,value);if(issue)return issue;
  const check=parseObservationCheck((value as {observationCheck?:unknown}).observationCheck);
  if(check){
    try{if(!await capabilities.observationCheck?.(check))return "当前未获准对该资料版本执行观测核对。";}
    catch{return "观测核对授权暂时无法确认。";}
  }
}

