import {isDeepStrictEqual} from "node:util";
import {AgUiInputError} from "./ag-ui-input";
import {
  layerObservationMatchesView,readLayerObservation,readLayerObservationRef,
  type LayerObservation,type LayerObservationRef,type LayerObservationStatus,
} from "../src/domain/layer-observations";
import type {DiscoveryContext,DiscoveryResponse,RunTrace} from "../src/domain/types";
import {validWorkspaceViewContext} from "../src/domain/workspace-view-context";
import {ctdSamples,frontsFor,selectedStation} from "../src/domain/visualization";

export type LayerObservationBinding =
  | {kind:LayerObservationRef["kind"];status:LayerObservationStatus}
  | {kind:LayerObservationRef["kind"];status:"ready";observation:LayerObservation};
export type ResolveLayerObservation = (value:LayerObservationRef,signal:AbortSignal)=>Promise<LayerObservation|undefined>;

function currentLayerObservation(context:DiscoveryContext|undefined) {
  const view=context?.workspaceView;
  if(view?.surface!=="earth"||!validWorkspaceViewContext(view))return;
  const layer=view.activeLayer;
  if(layer?.id==="rain"||layer?.id==="ctd"||layer?.id==="front")return layer;
}

export function readLayerObservationRequest(context:DiscoveryContext|undefined):LayerObservationRef|undefined {
  const layer=currentLayerObservation(context);
  if(!context||!layer||layer.status!=="ready"||context.caseObservationRef!==undefined)return;
  const ref=readLayerObservationRef(context.layerObservationRef);
  if(!ref||!layerObservationMatchesView(ref,context.workspaceView))return;
  const data=context.dataView;
  if(data?.kind==="ctd"&&ref.kind==="ctd"){
    const station=selectedStation(data);
    const sample=station&&ctdSamples(data,context.filters).find(item=>item.name===station.name);
    if(!station||station.id!==ref.stationId||station.date!==ref.sampledAt||data.variable!==ref.variable||
      !sample||sample.depth!==ref.depthM)return;
  }else if(data?.kind==="front"&&ref.kind==="glacier-front"){
    if(!frontsFor(data,context.filters).some(shape=>shape.key===ref.objectId&&shape.label.endsWith(" · "+ref.observedOn)))return;
  }else if(data){
    return;
  }
  return ref;
}

export async function bindLayerObservation(context:DiscoveryContext,resolve:ResolveLayerObservation|undefined):Promise<LayerObservationBinding|undefined> {
  const layer=currentLayerObservation(context);
  const kind=layer?.id==="rain"?"imerg-cell":layer?.id==="ctd"?"ctd":layer?.id==="front"?"glacier-front":undefined;
  if(context?.layerObservationRef===undefined)return kind?{kind,status:layer?.status==="ready"?"not-selected":"unavailable"}:undefined;
  const ref=readLayerObservationRequest(context);
  if(!ref)throw new AgUiInputError("所选图层观测引用与发问时的显示目标不一致。");
  const observation=readLayerObservation(await resolve?.(ref,AbortSignal.timeout(4_500)));
  if(!observation||!Object.entries(ref).every(([key,value])=>
    isDeepStrictEqual(observation[key as keyof typeof observation],value)))return {kind:ref.kind,status:"unavailable"};
  return {kind:ref.kind,status:"ready",observation};
}

export function stripLayerObservationContext(context:DiscoveryContext):DiscoveryContext {
  const {layerObservationRef,...rest}=context;
  if(layerObservationRef===undefined)return context;
  const view=rest.workspaceView;
  if(!currentLayerObservation(context)||!view?.activeLayer)return rest;
  const {display:_display,...activeLayer}=view.activeLayer;
  return {...rest,workspaceView:{...view,activeLayer}};
}

const label=(value:string)=>value.replace(/[\\`*_{\[\]<>|}]/gu,"\\$&");
const readout=(value:number|null,unit:string)=>value===null?"原记录未提供":value+" "+unit;

export function answerLayerObservation(binding:LayerObservationBinding,runTrace:RunTrace):DiscoveryResponse {
  const subject=binding.kind==="imerg-cell"?"IMERG 降水格点":binding.kind==="ctd"?"CTD 测站样点":"冰川前缘对象";
  if(binding.status!=="ready")return {
    message:binding.status==="not-selected"?`请先在当前图层选择一个${subject}，再问该观测。`:
      `所选${subject}的原记录当前无法核对。请重新选择当前图层上的对象后发问。`,
    layerObservationStatus:binding.status,
    runTrace,
  };
  const {observation}=binding;
  const anchor="经度 "+observation.point[0]+"°，纬度 "+observation.point[1]+"°";
  let title:string,message:string,limitation:string;
  switch(observation.kind){
    case "imerg-cell": {
      const derived=observation.run==="Derived";
      title=(derived?"NASA POWER IMERG 派生":"NASA GPM IMERG")+" "+observation.month;
      message=`所选 ${observation.month} 的 ${derived?"NASA POWER IMERG 派生格点":"IMERG 原始格点"}〔1〕\n\n- 格点中心 ${anchor}\n- 行 ${observation.row}，列 ${observation.column}\n- 降水量 ${observation.value===null?"原记录缺测":readout(observation.value,observation.unit)}\n- 发布版本 ${observation.run} ${observation.productVersion}${observation.through?"，截至 "+observation.through:""}`;
      limitation=observation.complete?(derived?"本轮数值来自该月已发布的 NASA POWER 派生格点。":"本轮数值来自该月已发布的单一原始格点。"):
        "该发布期尚未覆盖完整月份；保留原发布截止日。";
      break;
    }
    case "ctd":
      title="PANGAEA 891386 CTD 样点";
      message=`所选测站 ${label(observation.stationId)} 的 CTD 样点〔1〕\n\n- 采样时间 ${label(observation.sampledAt)}\n- 位置 ${anchor}\n- 实际采样深度 ${observation.depthM} m\n- ${observation.variable==="temperature"?"温度":"盐度"} ${readout(observation.value,observation.unit)}`;
      limitation="本轮只采用该采样时间、测站和深度的原记录。";
      break;
    case "glacier-front":
      title="Zenodo 15241675 冰川前缘";
      message=`所选冰川前缘 ${label(observation.label)}〔1〕\n\n- 日期 ${observation.observedOn}\n- 对象 ${label(observation.objectId)}\n- 索引中心 ${anchor}`;
      limitation="坐标是所选前缘的索引中心；原对象是前缘线。本轮没有计算位移、面积或变化率。";
      break;
  }
  return {
    message,layerObservation:observation,runTrace,
    answerNotes:{
      references:[{kind:"web",url:observation.sourceUrl,title,sourceChannel:"web"}],
      basis:"本轮采用用户所选显示目标对应的已核图层记录。",
      sources:[],limitation,followUp:"",reviewed:1,elapsedMs:Date.now()-runTrace.started,executor:"图层观测",
    },
  };
}
