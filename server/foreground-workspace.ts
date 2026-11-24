import type {DiscoveryContext,DiscoveryResponse} from "../src/domain/types";
import {caseById} from "../src/domain/catalog";
import {validVisualization} from "../src/domain/visualization-catalog";
import {ctdStations} from "../src/domain/visualization";
import type {TurnTarget} from "./turn-planning";
import {workspaceCandidateOperationAllowed} from "../src/domain/workspace-operations";
import {publishedWorkspaceLayerRecipes} from "../src/domain/workspace-published-layer";

const shape=(kind:string,properties:Record<string,unknown>)=>({type:"object",additionalProperties:false,required:["kind",...Object.keys(properties)],properties:{kind:{type:"string",enum:[kind]},...properties}});
export function foregroundWorkspaceSchemas(context?:DiscoveryContext){
  const result:unknown[]=[
    shape("workspace-view",{view:{type:"string",enum:["earth","discover","cases"]}}),
    shape("workspace-filter",{field:{type:"string",enum:["type","source","place"]},value:{type:"string",maxLength:100}}),
    shape("workspace-catalogue",{query:{type:"string",maxLength:200}}),
    shape("open-target",{targetKey:{type:"string",maxLength:2300}}),
    shape("workspace-candidates",{operation:{type:"string",enum:["open-candidate","compare-candidates"]},ids:{type:"array",minItems:1,maxItems:6,items:{type:"string",maxLength:160}}}),
  ];
  if(context?.workspaceView?.publishedLayerActions===true)result.push(shape("open-published-layer",{
    datasetId:{type:"string",enum:Object.keys(publishedWorkspaceLayerRecipes)},selection:{type:"string",minLength:1,maxLength:200}}));
  // Visualization is a registered, finite UI state, never an arbitrary patch.
  result.push(shape("workspace-visualization",{value:{anyOf:[{type:"null"},{type:"object",additionalProperties:false,
    required:["id","level","forecastHour","playing","color"],properties:{id:{type:"string",enum:["gfs-wind"]},level:{type:"string",enum:["10m","250hPa"]},
      forecastHour:{type:"integer",enum:[0,6,12]},playing:{type:"boolean"},color:{type:"boolean"}}}]}}));
  const count=caseById(context?.caseId??null)?.needs.length||0;
  if(count)result.push(shape("workspace-preview",{index:{type:"integer",minimum:0,maximum:count-1}}));
  if(context?.caseId==="Q19")result.push(shape("workspace-data-view",{value:{type:"object",additionalProperties:false,
    required:["kind","stationId","variable","depth"],properties:{kind:{type:"string",enum:["ctd"]},stationId:{type:"string",enum:ctdStations.map(station=>station.name)},
      variable:{type:"string",enum:["temperature","salinity"]},depth:{type:"number",minimum:0,maximum:600}}}}));
  if(context?.caseId==="Q20")result.push(shape("workspace-data-view",{value:{type:"object",additionalProperties:false,
    required:["kind","glacier","epoch"],properties:{kind:{type:"string",enum:["front"]},glacier:{type:"string",enum:["Mendenhall","Alsek"]},epoch:{type:"string",enum:["first","last","compare"]}}}}));
  return result;
}

const text=(value:unknown,max:number):value is string=>typeof value==="string"&&value.length<=max&&!/[\u0000-\u001f\u007f]/u.test(value);
export function foregroundWorkspaceReply(action:any,context:DiscoveryContext,targets:TurnTarget[]):DiscoveryResponse|undefined{
  if(!action||typeof action!=="object"||Array.isArray(action))return;
  const exact=(keys:string[])=>Object.keys(action).every(key=>["kind",...keys].includes(key));
  const base={message:"将更新当前工作台。"};
  switch(action.kind){
    case "workspace-view":if(exact(["view"])&&["earth","discover","cases"].includes(action.view))return {...base,view:action.view};break;
    case "workspace-filter":if(exact(["field","value"])&&["type","source","place"].includes(action.field)&&text(action.value,100))
      return {...base,filters:{...context.filters,...context.workspaceView?.map?.filters,[action.field]:action.value}};break;
    case "workspace-catalogue":if(exact(["query"])&&text(action.query,200))return {...base,view:"discover",catalogQuery:action.query};break;
    case "open-target":{
      const target=targets.find(target=>target.key===action.targetKey);
      if(exact(["targetKey"])&&target?.kind==="asset"&&target.id)return {...base,inspectId:target.id};break;
    }
    case "workspace-preview":{
      const needs=caseById(context.caseId)?.needs;
      if(exact(["index"])&&Number.isInteger(action.index)&&action.index>=0&&needs&&action.index<needs.length)return {...base,previewNeed:action.index};break;
    }
    case "workspace-visualization":if(exact(["value"])&&(action.value===null||validVisualization(action.value)))return {...base,visualization:action.value,
      ...(action.value?{caseId:"wind"}:{}),dataView:null};break;
    case "workspace-data-view":{
      const v=action.value;
      if(!exact(["value"])||!v||typeof v!=="object"||Array.isArray(v))break;
      if(context.caseId==="Q19"&&v.kind==="ctd"&&Object.keys(v).every(key=>["kind","stationId","variable","depth"].includes(key))&&
        ctdStations.some(station=>station.name===v.stationId)&&["temperature","salinity"].includes(v.variable)&&Number.isFinite(v.depth)&&v.depth>=0&&v.depth<=600)
        return {...base,dataView:v,visualization:null};
      if(context.caseId==="Q20"&&v.kind==="front"&&Object.keys(v).every(key=>["kind","glacier","epoch"].includes(key))&&
        ["Mendenhall","Alsek"].includes(v.glacier)&&["first","last","compare"].includes(v.epoch))return {...base,dataView:v,visualization:null};break;
    }
    case "workspace-candidates":{
      if(!exact(["operation","ids"])||!workspaceCandidateOperationAllowed(context.workspaceView?.candidateItems,action.operation,action.ids))break;
      const reply={...base,workspaceOperation:{kind:action.operation,ids:[...action.ids]}};return reply;
    }
    default:return;
  }
  throw Error("当前工作台的受约束动作或目标无效。");
}
