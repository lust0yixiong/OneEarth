import {createHash} from "node:crypto";
import {readResearchProgress,type ResearchProgress} from "../src/domain/native-agui-research-progress";

type ResearchAction = ResearchProgress["actions"][number];
export type ResearchProgressFact = Omit<ResearchAction,"order">;

/** Internal producer facts carry only the opaque action identity and displayable state. */
export function readResearchProgressFact(value:unknown):ResearchProgressFact|undefined {
  if(!value||typeof value!=="object"||Array.isArray(value))return;
  const source=value as Record<string,unknown>;
  const runId="validation";
  const action=readResearchProgress({version:1,runId,revision:1,actions:[{...source,order:1}]},runId)?.actions[0];
  if(!action)return;
  const {order:_,...fact}=action;
  return fact;
}

export function delegatedResearchProgress(messageId:string,value:unknown,areas:ReadonlySet<ResearchProgressFact["area"]>){
  const fact=readResearchProgressFact(value);
  if(!fact||!areas.has(fact.area))return;
  // A remote action name is scoped to its actual local delegation, and never
  // reaches the browser even if it happens to contain user or provider text.
  const digest=createHash("sha256").update(JSON.stringify([messageId,fact.id])).digest("hex").slice(0,32);
  return {...fact,id:"delegate-"+digest};
}

export function mergeResearchProgress(previous:ResearchProgress|undefined,runId:string,fact:ResearchProgressFact):ResearchProgress|undefined {
  if(previous&&previous.runId!==runId)return;
  const actions=previous?.actions.slice()??[];
  const index=actions.findIndex(action=>action.id===fact.id);
  if(index<0){
    if(actions.length>=64)return;
    actions.push({...fact,order:(actions.at(-1)?.order??0)+1});
  }else{
    const current=actions[index];
    if(current.area!==fact.area||current.topic!==fact.topic)return;
    const advances=current.status==="queued" ? fact.status==="running"||fact.status==="not_started"
      : current.status==="running" && fact.status!=="running" && fact.status!=="queued" && fact.status!=="not_started";
    if(!advances)return;
    actions[index]={...fact,order:current.order};
  }
  return {version:1,runId,revision:(previous?.revision??0)+1,actions};
}

// An interrupted run can end before its delegation sends the remaining facts.
export function settleResearchProgress(previous:ResearchProgress|undefined):ResearchProgress|undefined {
  if(!previous || !previous.actions.some(action=>action.topic && (action.status==="queued" || action.status==="running")))return;
  return {...previous,revision:previous.revision+1,actions:previous.actions.map(action=>
    !action.topic ? action : action.status==="queued" ? {...action,status:"not_started"} :
      action.status==="running" ? {...action,status:"failed"} : action)};
}

export function isResearchTimeout(error:unknown) {
  return error instanceof DOMException&&error.name==="TimeoutError";
}
