import type {EvidenceDocument,DiscoveryResponse} from "./types";

type Operation=NonNullable<DiscoveryResponse["workspaceAction"]|DiscoveryResponse["workspaceOperation"]>;
type Status="applied"|"not-applied"|"proposed";
const prefix="workspace-effect/";
const label:Record<Status,string>={
  applied:"浏览器已应用",
  "not-applied":"浏览器未应用",
  proposed:"运行时提案",
};

export function workspaceEffectActivity(taskId:string,operation:Operation,status:Status,proposal:string,detail:string):EvidenceDocument {
  const receipt={taskId,operation,status};
  return {id:prefix+taskId,title:"工作台操作记录",scope:label[status],source:status==="proposed"?"运行时归档":"当前浏览器",
    tabs:[
      {kind:"trace",label:"操作记录",steps:[{title:"运行时提案",detail:proposal},{title:label[status],detail}]},
      {kind:"code",label:"操作回执",language:"json",body:JSON.stringify(receipt,null,2)},
    ]};
}

export function isWorkspaceEffect(activity:EvidenceDocument|undefined) {
  return !!activity?.id.startsWith(prefix);
}
