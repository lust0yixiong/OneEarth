import {makeQuestionDecision} from "../src/domain/question-confirmation";
import type {QuestionCheck} from "../src/domain/types";
import type {OneEarthAgUiInterruptRecord} from "../src/domain/native-ag-ui";
import {validateTurnStructure} from "./runtime-input";
import {discoveryConfirmation} from "./discovery-bindings";
import {clarificationParent} from "./clarification-guard";
import {assertDiscoveryWaiting} from "./discovery-a2a-client";
import {validClarificationPrompt,clarificationAnswerText,validClarificationAnswer,type ClarificationPrompt} from "../src/domain/clarification";
import type {TaskStore} from "./task-store";
import type {RuntimeTurnInput} from "./runtime-turn-handoff";
import {AgUiInputError} from "./ag-ui-input";

export type AgUiResume={interruptId:string;status:"resolved"|"cancelled";payload?:unknown};
export type AgUiInterruptRecord=OneEarthAgUiInterruptRecord;
export function validAgUiQuestionCheck(value:unknown):value is QuestionCheck{
 if(!value||typeof value!=="object"||Array.isArray(value))return false;
 const check=value as QuestionCheck;
 return [check.originalQuestion,check.proposedQuestion].every(text=>typeof text==="string"&&!!text.trim()&&text.length<=4000&&!text.includes("\0"));
}
export function agUiQuestionCheckDefinition(id:string,message:string){
 return {id,reason:"oneearth.question-check",message,responseSchema:{oneOf:[
  {type:"object",additionalProperties:false,properties:{choice:{enum:["original","proposed"]}},required:["choice"]},
  {type:"object",additionalProperties:false,properties:{choice:{const:"edited"},dataQuestion:{type:"string",minLength:1,maxLength:4000}},required:["choice","dataQuestion"]},
 ]},metadata:{oneearth:{version:1,kind:"question-check"}}};
}
export function agUiInterruptDefinition(id:string,prompt:ClarificationPrompt){
 const optionIds=prompt.options?.map(option=>option.id),exclusive=prompt.kind==="confirmation";
 return {id,reason:"oneearth.clarification",message:prompt.question,responseSchema:{
  type:"object",additionalProperties:false,properties:{...(optionIds?.length?{optionId:{type:"string",enum:optionIds}}:{}),text:{type:"string",minLength:1,maxLength:4000}},
  anyOf:[...(optionIds?.length?[{required:["optionId"],...(exclusive?{not:{required:["text"]}}:{})}]:[]),{required:["text"],...(exclusive?{not:{required:["optionId"]}}:{})}],
 },metadata:{oneearth:{version:1,kind:prompt.kind,...(prompt.options?{options:prompt.options}:{})}}};
}
export type AgUiResumeStore=TaskStore&{chat:{agUiInterrupt(id:string):Promise<AgUiInterruptRecord|undefined>;agUiPending(threadId:string):Promise<AgUiInterruptRecord|undefined>}};
/** Parent cards and choices come only from the persisted native ending. */
export async function bindAgUiResume(tasks:AgUiResumeStore,body:RuntimeTurnInput,resume:AgUiResume|undefined){
 const latest=await tasks.chat.agUiPending(body.conversationId);
 if(!resume){if(latest)throw new AgUiInputError("当前会话有待回答的原问题，请明确回答或放弃。",409);return body;}
 if(body.previousTaskId!==resume.interruptId)throw new AgUiInputError("续接必须明确引用同一原问题。",409);
 const stored=await tasks.chat.agUiInterrupt(resume.interruptId),parent=await tasks.get(resume.interruptId);
 if(!stored||!parent)throw new AgUiInputError("找不到原生追问。",404);
 const original=JSON.parse(parent.body) as RuntimeTurnInput;
 if(original.conversationId!==body.conversationId||body.turnId===original.turnId||body.previousTaskId===undefined||
   latest?.id!==stored.id||stored.resumedBy)throw new AgUiInputError("原问题已过期、已回答或不属于当前会话。",409);
 if(stored.kind==="question-check"?!validAgUiQuestionCheck(stored.questionCheck):!validClarificationPrompt(stored.prompt))throw new AgUiInputError("原问题记录不可用。",409);
 if(resume.status==="cancelled"){if(resume.payload!==undefined)throw new AgUiInputError("放弃追问不能同时提交答案。");return body;}
 if(stored.status!=="pending")throw new AgUiInputError("原问题已不可回答，请明确放弃后重新提出。",409);
 const payload=resume.payload;
 if(stored.kind==="question-check"){
  const value=payload as {choice?:unknown;dataQuestion?:unknown}|undefined;
  if(!value||typeof value!=="object"||Array.isArray(value)||!["original","proposed","edited"].includes(String(value.choice))||
    typeof value.choice!=="string"||Object.keys(value).some(key=>key!=="choice"&&(value.choice!=="edited"||key!=="dataQuestion")))throw new AgUiInputError("问题确认只接受原有三种选择及明确的编辑问题。");
  if(value.choice==="edited"&&(typeof value.dataQuestion!=="string"||value.dataQuestion.length>4000||!value.dataQuestion.trim()||value.dataQuestion.includes("\0")))throw new AgUiInputError("编辑选择需要明确的有界研究问题。");
  if(body.query!==stored.questionCheck.originalQuestion)throw new AgUiInputError("本轮原话与持久原问题不一致。",409);
  let questionDecision;
  try{questionDecision=makeQuestionDecision(stored.questionCheck,stored.id,value.choice as "original"|"proposed"|"edited",typeof value.dataQuestion==="string"?value.dataQuestion:undefined);}
  catch{throw new AgUiInputError("编辑选择需要明确填写研究问题。");}
  const checked={...body,questionDecision};
  const issue=await validateTurnStructure(tasks,checked);if(issue)throw new AgUiInputError(issue,409);
  try{
   const bound=await discoveryConfirmation(tasks,body.conversationId,stored.id);
   if(bound.options.target){if(bound.options.afterSeq===undefined)throw Error();await assertDiscoveryWaiting(bound.options.target,bound.options.afterSeq,AbortSignal.timeout(3000));}
  }catch{throw new AgUiInputError("原问题确认的受托身份或等待水位已不可确认。",409);}
  return checked;
 }
 if(!payload||typeof payload!=="object"||Array.isArray(payload)||Object.keys(payload).some(key=>!["optionId","text"].includes(key)))throw new AgUiInputError("追问答案格式无效。");
 const answer={...payload,parentTaskId:stored.id};
 if(!validClarificationAnswer(answer))throw new AgUiInputError("追问答案缺少有效选项或补充文字。");
 const query=clarificationAnswerText(stored.prompt,answer);
 if(query===undefined||query!==body.query)throw new AgUiInputError("用户消息与原问题的实际答复不一致。",409);
 const checked={...body,query,clarificationAnswer:answer};
 if(stored.prompt.kind==="research"){
  const {previousTaskId:_parent,...rest}=checked,result={...rest,clarificationReply:{parentTaskId:stored.id}};
  try{const parent=await clarificationParent(tasks,result);if(!parent)throw Error();await assertDiscoveryWaiting(parent.binding,parent.binding.lastSeq,AbortSignal.timeout(3000));}
  catch{throw new AgUiInputError("原研究委托的等待身份或水位已不可确认，请查看原记录。",409);}
  return result;
 }
 return checked;
}
