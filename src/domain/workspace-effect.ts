import type {EvidenceDocument,DiscoveryResponse} from "./types";
import type {BrowserWorkspaceReceipt,WorkspaceEffect,WorkspaceObservation} from "./turn-context";
import type {State} from "./store";
import {datasetLayerFromView} from "./globe-dataset-layers";

type Operation=NonNullable<DiscoveryResponse["workspaceAction"]|DiscoveryResponse["workspaceOperation"]|DiscoveryResponse["workspaceLayerOpen"]>|WorkspaceEffect;
type Status=BrowserWorkspaceReceipt["state"]|"not-applied"|"proposed";
const prefix="workspace-effect/";
const label:Record<Status,string>={
  applied:"浏览器已应用",
  stale:"工作台已变化 · 未应用",
  failed:"浏览器无法应用",
  declined:"用户已拒绝 · 未应用",
  "not-applied":"浏览器未应用",
  proposed:"运行时已提出 · 应用状态未知",
};

export function workspaceEffectActivity(taskId:string,operation:Operation,status:Status,proposal:string,detail:string,
  receipt?:BrowserWorkspaceReceipt):EvidenceDocument {
  return {id:prefix+taskId,title:"工作台操作记录",scope:label[status],source:status==="proposed"?"运行时归档":"浏览器回执",
    tabs:[
      {kind:"trace",label:"操作记录",steps:[{title:"运行时提案",detail:proposal},{title:label[status],detail}]},
      {kind:"code",label:"操作记录",language:"json",body:JSON.stringify({taskId,operation,status,receipt},null,2)},
    ]};
}

export function isWorkspaceEffect(activity:EvidenceDocument|undefined) {
  return !!activity?.id.startsWith(prefix);
}

export function workspaceEffectFor(result:DiscoveryResponse,taskId:string) {
  const effect=result.workspaceEffect;
  return effect?.state==="proposed" && effect.effectId==="workspace:"+taskId && Array.isArray(effect.fields) &&
    effect.fields.length>0 && effect.fields.every(field=>typeof field==="string") ? effect : undefined;
}

export function submitsWorkspaceFields(result:DiscoveryResponse,effect:WorkspaceEffect,next:Partial<State>,current:State) {
  if(next.error)return false;
  if(result.visualization || result.dataView || result.visualizeNeed!==undefined){
    const target=datasetLayerFromView({
      ...current,...next,visualization:next.visualization ?? null,dataView:next.dataView ?? null,
      fieldLayer:null,publicLayer:null,
    });
    if(!target || current.globeLayers.some(layer=>layer.id===target.id && !layer.visible))return false;
  }
  return effect.fields.every(field=>{
    switch(field){
      case "inspectId": return !!next.inspector && "assetId" in next.inspector && next.inspector.assetId===result.inspectId;
      case "previewNeed":
      case "previewCaseId":
      case "previewKind": return !!next.evidence;
      case "visualizeNeed": return !!next.dataView;
      case "clearSelection": return !result.clearSelection || next.selection===null;
      case "selectCenter": return !result.selectCenter || !!next.selection;
      case "camera": {
        const target=next.flight?.camera ?? next.camera;
        return !!target && target.zoom===result.camera?.zoom &&
          target.center.every((coordinate,index)=>coordinate===result.camera?.center[index]);
      }
      case "catalogQuery": return next.search?.query===result.catalogQuery;
      case "filters":
      case "dataView":
      case "visualization": return Object.hasOwn(next,field);
      case "caseId":
      case "view":
      case "mesh":
      case "gridSystem":
      case "layer": return next[field]===result[field];
      default: return false;
    }
  });
}

export function workspaceReceiptDetail(state:BrowserWorkspaceReceipt["state"]|undefined) {
  switch(state){
    case "applied": return "原浏览器已提交该操作。镜头到达与图层载入由工作台单独显示。";
    case "stale": return "收到操作时工作台或当前轮次已变化，原浏览器未应用。";
    case "failed": return "原浏览器无法应用运行时提出的工作台操作。";
    case "declined": return "用户明确拒绝了这项操作，原浏览器未应用。";
    default: return "此记录未保存原浏览器的应用回执。";
  }
}

export function workspaceObservationLabel(state:WorkspaceObservation["state"],archived:boolean) {
  switch(state){
    case "rendered": return "图层已绘制在画布上";
    case "load-failed": return "图层图像载入失败";
    case "superseded": return "工作台已变化，停止等待本次图层";
    default: return archived ? "当时尚未确认图层成像" : "等待图层在画布显示";
  }
}
