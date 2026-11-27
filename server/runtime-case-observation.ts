import {AgUiInputError} from "./ag-ui-input";
import {
  readCaseObservation,readCaseObservationRef,
  type CaseObservation,type CaseObservationKind,type CaseObservationRef,
} from "../src/domain/case-observations";
import {validWorkspaceViewContext} from "../src/domain/workspace-view-context";
import type {DiscoveryContext,DiscoveryResponse,RunTrace} from "../src/domain/types";

export type CaseObservationBinding =
  | {kind:CaseObservationKind;status:"not-selected"|"unavailable"}
  | {kind:CaseObservationKind;status:"ready";observation:CaseObservation};
export type ResolveCaseObservation = (ref:CaseObservationRef)=>CaseObservation|undefined;

export function caseObservationKind(context:DiscoveryContext|undefined):CaseObservationKind|undefined {
  const view=context?.workspaceView;
  if(view?.surface!=="cases"||!validWorkspaceViewContext(view))return;
  if(view.case?.id==="earthquakes")return "usgs-earthquake";
  if(view.case?.id==="live-lightning")return "awc-metar";
}

export function bindCaseObservation(context:DiscoveryContext,resolve:ResolveCaseObservation|undefined):CaseObservationBinding|undefined {
  const kind=caseObservationKind(context);
  const supplied=context?.caseObservationRef;
  if(supplied===undefined)return kind?{kind,status:"not-selected"}:undefined;
  const ref=readCaseObservationRef(supplied);
  if(!ref||!kind||kind!==ref.kind)
    throw new AgUiInputError("所选观测引用与当前案例不一致。");
  const observation=readCaseObservation(resolve?.(ref));
  if(!observation||observation.kind!==ref.kind||observation.snapshotId!==ref.snapshotId||
    observation.id!==ref.id||observation.observedAt!==ref.observedAt)return {kind,status:"unavailable"};
  return {kind,status:"ready",observation};
}

const value=(number:number|null,unit="")=>number===null?"未提供":String(number)+unit;
const plainLabel=(label:string)=>label.replace(/[\\`*_{\[\]<>|}]/gu,"\\$&");

export function answerCaseObservation(binding:CaseObservationBinding,runTrace:RunTrace):DiscoveryResponse {
  const label=binding.kind==="usgs-earthquake"?"地震事件":"METAR 地面气象站";
  if(binding.status!=="ready")return {
    message:binding.status==="not-selected"?`请先在当前案例中选择一个${label}，再问这条观测。`:
      `这条${label}的原观测快照已失效或无法核对。请重新选择当前案例中的观测，再发问。`,
    caseObservationStatus:binding.status,
    runTrace,
  };
  const {observation}=binding;
  const time=new Date(observation.observedAt).toISOString();
  const title=observation.kind==="usgs-earthquake"?`USGS 地震事件 ${observation.id}`:`NOAA AWC METAR ${observation.id}`;
  const facts=observation.kind==="usgs-earthquake"?
    [`事件 ${observation.id}（${plainLabel(observation.place)}）`,`震级 ${value(observation.magnitude)}`,`深度 ${value(observation.depthKm," km")}`]:
    [`测站 ${observation.id}（${plainLabel(observation.stationName)}）`,`报告天气 ${plainLabel(observation.weather)||"未提供"}`,
      `气温 ${value(observation.temperatureC," °C")}`,`风速 ${value(observation.windKnots," kt")}`];
  facts.push(`位置 经度 ${observation.point[0]}°，纬度 ${observation.point[1]}°`);
  return {
    message:`所选观测时间为 ${time}（UTC）。〔1〕\n\n${facts.map(fact=>"- "+fact).join("\n")}`,
    caseObservation:observation,
    runTrace,
    answerNotes:{
      references:[{kind:"web",url:observation.sourceUrl,title,sourceChannel:"web"}],
      basis:"本轮采用用户选中的已发布观测快照。",
      sources:[],limitation:"数值和时间以本轮保存的单条观测为准。打开来源时，上游返回内容可能已经更新。",
      followUp:"",reviewed:1,elapsedMs:Date.now()-runTrace.started,executor:"观测快照",
    },
  };
}
