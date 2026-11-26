import {clarificationParent} from "./clarification-guard";
import {assertDiscoveryWaiting} from "./discovery-a2a-client";
import {validClarificationPrompt,clarificationAnswerText,validClarificationAnswer,type ClarificationPrompt} from "../src/domain/clarification";
import type {TaskStore} from "./task-store";
import type {RuntimeTurnInput} from "./runtime-turn-handoff";
import {AgUiInputError} from "./ag-ui-input";

export type AgUiResume={interruptId:string;status:"resolved"|"cancelled";payload?:unknown};
export type AgUiInterruptRecord={id:string;status:"pending"|"resolved"|"cancelled"|"unavailable";prompt:ClarificationPrompt;resumedBy?:string};
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
 if(!validClarificationPrompt(stored.prompt))throw new AgUiInputError("原问题记录不可用。",409);
 if(resume.status==="cancelled"){if(resume.payload!==undefined)throw new AgUiInputError("放弃追问不能同时提交答案。");return body;}
 if(stored.status!=="pending")throw new AgUiInputError("原问题已不可回答，请明确放弃后重新提出。",409);
 const payload=resume.payload;
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
