export type ClarificationOption = {id:string;label:string};
export type ClarificationKind = "chat" | "confirmation" | "research";
export type ClarificationPrompt = {kind:ClarificationKind;question:string;options?:ClarificationOption[]};
export type ClarificationAnswer = {parentTaskId:string;optionId?:string;text?:string};

const taskId = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const choiceId = /^[a-z][a-z0-9-]{0,31}$/;
const kinds: ClarificationKind[] = ["chat","confirmation","research"];
const approvalOptions: readonly ClarificationOption[] = [
  {id:"approve",label:"确认执行"},
  {id:"decline",label:"不执行"},
];
const object = (value:unknown):value is Record<string,unknown> =>
  !!value && typeof value==="object" && !Array.isArray(value);
const only = (value:Record<string,unknown>, keys:string[]) =>
  Object.keys(value).every(key=>keys.includes(key));
const text = (value:unknown,max:number):value is string =>
  typeof value==="string" && value.trim().length>0 && value.length<=max && !value.includes("\0");
const label = (value:unknown):value is string => text(value,100) && !/[\u0000-\u001f\u007f]/.test(value);

/** Stable option IDs are assigned by the server. Model labels have no authority. */
export function clarificationOptions(input:unknown):ClarificationOption[] {
  if(!Array.isArray(input) || input.length<2 || input.length>4 || !input.every(label)) return [];
  const labels = input.map(value=>value.trim());
  if(new Set(labels.map(value=>value.normalize("NFKC").toLowerCase())).size!==labels.length) return [];
  return labels.map((label,index)=>({id:"option-"+(index+1),label}));
}

export function validClarificationPrompt(value:unknown):value is ClarificationPrompt {
  if(!object(value) || !only(value,["kind","question","options"]) || !kinds.includes(value.kind as ClarificationKind) ||
    !text(value.question,500)) return false;
  const options=value.options;
  if(value.kind==="confirmation")return Array.isArray(options) && options.length===approvalOptions.length &&
    options.every((entry,index)=>object(entry)&&only(entry,["id","label"])&&entry.id===approvalOptions[index].id&&entry.label===approvalOptions[index].label);
  if(options===undefined)return true;
  if(!Array.isArray(options)||options.length<2||options.length>4||
    !options.every(entry=>object(entry) && only(entry,["id","label"]) && typeof entry.id==="string"&&choiceId.test(entry.id)&&label(entry.label))) return false;
  return new Set(options.map(entry=>entry.id)).size===options.length &&
    new Set(options.map(entry=>entry.label.trim().normalize("NFKC").toLowerCase())).size===options.length;
}

export function createClarificationPrompt(kind:ClarificationKind, question:string, options?:ClarificationOption[]):ClarificationPrompt|undefined {
  const prompt:ClarificationPrompt={kind,question:question.trim(),
    ...(kind==="confirmation"?{options:approvalOptions.map(option=>({...option}))}:options?.length?{options}:{})};
  return validClarificationPrompt(prompt)?prompt:undefined;
}

export function validClarificationAnswer(value:unknown):value is ClarificationAnswer {
  if(!object(value)||!only(value,["parentTaskId","optionId","text"])||
    typeof value.parentTaskId!=="string"||!taskId.test(value.parentTaskId))return false;
  const option=value.optionId, note=value.text;
  return (option!==undefined||note!==undefined) &&
    (option===undefined || typeof option==="string" && choiceId.test(option)) &&
    (note===undefined || text(note,4000));
}

export function clarificationAnswerText(prompt:ClarificationPrompt, answer:ClarificationAnswer):string|undefined {
  if(!validClarificationPrompt(prompt)||!validClarificationAnswer(answer))return;
  const choice=answer.optionId===undefined?undefined:prompt.options?.find(option=>option.id===answer.optionId);
  if(answer.optionId!==undefined&&!choice)return;
  const note=answer.text?.trim();
  if(prompt.kind==="confirmation" && choice && note)return;
  const response=choice && note?choice.label+"\n"+note:choice?.label??note;
  return text(response,4000)?response:undefined;
}
