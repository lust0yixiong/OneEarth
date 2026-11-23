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
import {validClarificationAnswer,validClarificationPrompt,clarificationAnswerText} from "../src/domain/clarification";

/** The archived parent owns choices; request mirrors and edited history do not. */
export async function clarificationAnswerContext(tasks:TaskStore,body:Record<string,any>){
  const answer=body.clarificationAnswer;
  if(!validClarificationAnswer(answer)||body.questionDecision!==undefined)throw Error("追问答复需要明确引用原问题，不能替代研究确认。");
  const parent=await tasks.get(answer.parentTaskId);
  if(!parent||parent.status!=="complete"||JSON.parse(parent.body).conversationId!==body.conversationId)throw Error("原追问不属于当前会话或已不可回答。");
  const result=(await tasks.terminal(parent.id))?.result as DiscoveryResponse|undefined,prompt=result?.clarificationPrompt;
  if(!validClarificationPrompt(prompt))throw Error("原记录没有可回答的结构化追问。");
  const query=clarificationAnswerText(prompt,answer);
  if(query===undefined||body.query!==query)throw Error("答复内容与原追问选项或补充文字不一致。");
  if(prompt.kind==="research"){
    if(body.clarificationReply?.parentTaskId!==parent.id)throw Error("研究追问必须沿同一原受托记录继续。");
  }else if(body.previousTaskId!==parent.id||body.clarificationReply!==undefined)throw Error("追问答复必须引用当前原父消息。");
  return {parent,result:result!,prompt,answer};
}

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
  if(body.clarificationAnswer!==undefined){
    try{await clarificationAnswerContext(tasks,body);}catch(error){return error instanceof Error?error.message:"追问答复无效。";}
  }
  if(body.observationCheck!==undefined){
    const check=parseObservationCheck(body.observationCheck);
    if(!check)return "观测核对的能力版本、资料版本、变量、单位或时段无效。";
    if(body.questionDecision!==undefined||body.clarificationReply!==undefined||body.clarificationAnswer!==undefined)return "观测核对不能代替原研究的问题确认或澄清。";
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
  if((value as {clarificationAnswer?:unknown}).clarificationAnswer!==undefined){
    const parent=await clarificationAnswerContext(tasks,value as Record<string,any>);
    if(parent.prompt.kind!=="research")return "普通追问和动作确认请通过 Chat 入口回答。";
  }
  const check=parseObservationCheck((value as {observationCheck?:unknown}).observationCheck);
  if(check){
    try{if(!await capabilities.observationCheck?.(check))return "当前未获准对该资料版本执行观测核对。";}
    catch{return "观测核对授权暂时无法确认。";}
  }
}

