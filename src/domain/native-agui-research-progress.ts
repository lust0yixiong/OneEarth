export const researchProgressAreas = {
  catalog: {label:"OneEarth 数据目录",unit:"项候选"},
  haina: {label:"海纳专区",unit:"项候选"},
  web: {label:"公开网络检索",unit:"条结果"},
  literature: {label:"文献资料检索",unit:"条线索"},
  reading: {label:"读取来源",unit:"份已读取"},
  synthesis: {label:"整理答复",unit:undefined},
} as const;

export const researchProgressStates = {
  running:"进行中",
  done:"已完成",
  partial:"部分完成",
  failed:"未完成",
  timeout:"超时",
} as const;

type Area = keyof typeof researchProgressAreas;
type ActivityStatus = keyof typeof researchProgressStates;
type ResearchAction = {id:string; order:number; area:Area; status:ActivityStatus; count?:number};

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
    ids.add(action.id);
    previousOrder=action.order;
    actions.push({id:action.id,order:action.order,area,status,...(count!==undefined ? {count} : {})});
  }
  return {version:1,runId,revision:value.revision,actions};
}

export function readResearchProgressState(state:unknown,runId:string) {
  if(object(state) && object(state.oneearth))return readResearchProgress(state.oneearth.researchProgress,runId);
}
