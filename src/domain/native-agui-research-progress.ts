export const researchProgressAreas = {
  catalog: {label:"OneEarth 数据目录",unit:"项候选"},
  haina: {label:"海纳专区",unit:"项候选"},
  web: {label:"公开网络检索",unit:"条结果"},
  literature: {label:"文献资料检索",unit:"条线索"},
  reading: {label:"读取来源",unit:"份已读取"},
  synthesis: {label:"整理答复",unit:undefined},
} as const;

export const researchProgressStates = {
  queued:"等待查询",
  not_started:"本轮未查",
  running:"进行中",
  done:"已完成",
  partial:"部分完成",
  failed:"未完成",
  timeout:"超时",
} as const;

type Area = keyof typeof researchProgressAreas;
type ActivityStatus = keyof typeof researchProgressStates;
export type ResearchProgressEvidence = {assetId:string;title:string};
type ResearchAction = {
  id:string; order:number; area:Area; status:ActivityStatus; count?:number;
  topic?:string; evidence?:ResearchProgressEvidence[];
};

// Public labels are short plain text. Reject links, path fragments, opaque
// tokens and control/format characters before they can become display data.
export function publicResearchLabel(value:unknown,max:number):value is string {
  return typeof value==="string" && value.length<=max && value===value.trim() &&
    /[\p{L}\p{N}]/u.test(value) &&
    !/[\p{C}\p{Zl}\p{Zp}<>\\`=]|(?:https?|file):\/\/|(?:data|javascript):\S|(?:^|\s)\/(?!\s)|(?:^|\W)(?:token|password|api[_ -]?key|authorization)\s*[:：]|[A-Za-z0-9_]{40}/iu.test(value);
}

export type ResearchProgress = {
  version:1;
  runId:string;
  revision:number;
  actions:ResearchAction[];
};

function object(value:unknown):value is Record<string,unknown> {
  return !!value && typeof value==="object" && !Array.isArray(value);
}

export function readResearchProgress(value:unknown,runId:string):ResearchProgress|undefined {
  if(!object(value) || value.version!==1 || value.runId!==runId ||
    typeof value.revision!=="number" || !Number.isSafeInteger(value.revision) || value.revision<1 ||
    !Array.isArray(value.actions) || !value.actions.length || value.actions.length>64)return;

  const actions:ResearchAction[]=[];
  const ids=new Set<string>();
  let previousOrder=0;
  for(const action of value.actions){
    if(!object(action) || typeof action.id!=="string" || !/^[a-zA-Z0-9_-]{1,64}$/u.test(action.id) || ids.has(action.id) ||
      typeof action.order!=="number" || !Number.isSafeInteger(action.order) || action.order<=previousOrder ||
      typeof action.area!=="string" || typeof action.status!=="string" ||
      !Object.hasOwn(researchProgressAreas,action.area) || !Object.hasOwn(researchProgressStates,action.status))return;
    const area=action.area as Area, status=action.status as ActivityStatus, count=action.count;
    if(count!==undefined && (!researchProgressAreas[area].unit ||
      (status!=="done" && status!=="partial") || typeof count!=="number" ||
      !Number.isSafeInteger(count) || count<0 || count>1_000_000))return;
    const topic=action.topic;
    if(topic!==undefined && (area!=="literature" || !publicResearchLabel(topic,100)))return;
    if((status==="queued" || status==="not_started") && topic===undefined)return;
    let evidence:ResearchProgressEvidence[]|undefined;
    if(action.evidence!==undefined){
      if(!topic || (status!=="done" && status!=="partial") || count===0 ||
        !Array.isArray(action.evidence) || !action.evidence.length || action.evidence.length>4)return;
      evidence=[];
      const assets=new Set<string>();
      for(const item of action.evidence){
        if(!object(item) || typeof item.assetId!=="string" || !/^earthnano:[a-f0-9]{64}$/u.test(item.assetId) ||
          assets.has(item.assetId) || !publicResearchLabel(item.title,180))return;
        assets.add(item.assetId);
        evidence.push({assetId:item.assetId,title:item.title});
      }
    }
    ids.add(action.id);
    previousOrder=action.order;
    actions.push({id:action.id,order:action.order,area,status,...(count!==undefined ? {count} : {}),
      ...(topic!==undefined ? {topic} : {}),...(evidence ? {evidence} : {})});
  }
  return {version:1,runId,revision:value.revision,actions};
}

export function readResearchProgressState(state:unknown,runId:string) {
  if(object(state) && object(state.oneearth))return readResearchProgress(state.oneearth.researchProgress,runId);
}
