import {getResolution,isValidCell,latLngToCell} from "h3-js";
import type {Selection} from "./types";

export type FlightGround = {id:string;level:number;point:[number,number]};
export type FlightMapReceipt = {state:"arrived";observedAt:number;ground:FlightGround}
  | {state:"cancelled"|"superseded"|"ground-unavailable"|"coverage-unavailable";observedAt:number};
export const flightCatalogueFollowUp = "请列出上一轮飞行完成后的中心地面网格命中的目录条目。只读取当前覆盖结果，不要扩大范围或另行搜索。";

export function flightCatalogueIntent(query:string) {
  const match=/^(?:请|帮我)?(?:飞到|飞往|飞向)\s*([^，,。；;！？?\n]{1,80})\s*[，,；;]\s*(?:然后|再|接着)(?:查|查询|检索)(?:一下)?(?:这里|到达点|中心(?:地面)?网格)(?:的?(?:真实)?(?:数据|资料)?目录)?(?:\s*[，,；;]\s*(?:(?:然后|再|接着)\s*)?((?:把|将)(?:本轮|这次)?(?:查询)?(?:的)?结果(?:上球|绘制到球上|显示在球上)))?[。！!]?$/u.exec(query.trim());
  return match?{place:match[1].trim(),present:!!match[2]}:undefined;
}

export function flightCataloguePlace(query:string) {
  return flightCatalogueIntent(query)?.place;
}

export function validFlightMapReceipt(value:unknown):value is FlightMapReceipt {
  const v=value as Partial<FlightMapReceipt>|undefined;
  if(!v || typeof v!=="object" || !Number.isSafeInteger(v.observedAt) || v.observedAt!<=0)return false;
  if(v.state!=="arrived")return ["cancelled","superseded","ground-unavailable","coverage-unavailable"].includes(String(v.state))&&
    Object.keys(v).every(k=>k==="state"||k==="observedAt");
  const g=v.ground;
  return Object.keys(v).every(k=>k==="state"||k==="observedAt"||k==="ground")&&!!g&&
    Object.keys(g).every(k=>k==="id"||k==="level"||k==="point")&&
    typeof g.id==="string"&&isValidCell(g.id)&&Number.isInteger(g.level)&&g.level>=2&&g.level<=7&&getResolution(g.id)===g.level&&
    Array.isArray(g.point)&&g.point.length===2&&g.point.every(Number.isFinite)&&
    Math.abs(g.point[0])<=180&&Math.abs(g.point[1])<=90&&latLngToCell(g.point[1],g.point[0],g.level)===g.id;
}

export function matchesFlightGround(ground:FlightGround,selection:Pick<Selection,"grid"|"id"|"point">) {
  return selection.grid.system==="h3"&&selection.grid.n===ground.level&&selection.id===ground.id&&
    selection.point[0]===ground.point[0]&&selection.point[1]===ground.point[1];
}
