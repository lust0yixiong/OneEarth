import type {QuestionCheck,QuestionDecision} from "./types";

const question=(value:unknown):value is string=>typeof value==="string" && !!value.trim() && value.length<=4000;
/** Approval belongs to this original question, never to a later follow-up. */
export function validQuestionDecision(value:unknown,original:string):value is QuestionDecision {
  if(!value || typeof value!=="object")return false;
  const v=value as Partial<QuestionDecision>;
  return typeof v.checkMessageId==="string" && !!v.checkMessageId && v.checkMessageId.length<=200 &&
    v.originalQuestion===original && question(v.dataQuestion) &&
    (v.choice==="proposed" || v.choice==="edited" || (v.choice==="original" && v.dataQuestion===original));
}
export function makeQuestionDecision(check:QuestionCheck,checkMessageId:string,choice:QuestionDecision["choice"],edited?:string):QuestionDecision {
  const dataQuestion=choice==="original"?check.originalQuestion:choice==="edited"?edited?.trim():check.proposedQuestion;
  const decision={checkMessageId,originalQuestion:check.originalQuestion,dataQuestion,choice};
  if(!validQuestionDecision(decision,check.originalQuestion))throw Error("请填写要继续讨论的问题。");
  return decision;
}
