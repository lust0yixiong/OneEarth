import {boundCatalogueMapBatch,cataloguePresentationTarget,readCataloguePresentationWrite,type CataloguePresentationTarget,type CataloguePresentationWrite} from "./catalogue-presentation";
import {validFlightMapReceipt,type FlightMapReceipt} from "./flight-catalogue";
import type {Camera,DiscoveryResponse} from "./types";
import {workspaceIdPattern} from "./workspace-research-state";

export const workspacePageHeader="X-OneEarth-Workspace-Page";
export const workspacePageTokenPattern=/^[a-f0-9]{64}$/u;
export const workspaceEffectReceiptPath=(conversationId:string,actionId:string,effectId:string)=>
  "/api/workspaces/"+encodeURIComponent(conversationId)+"/actions/"+encodeURIComponent(actionId)+"/effects/"+encodeURIComponent(effectId)+"/receipt";
export type WorkspaceEffectCommand={kind:"flight";camera:Camera;placeLabel:string}|
  {kind:"catalogue-presentation";target:CataloguePresentationTarget;result:DiscoveryResponse};
export type WorkspaceEffectReceipt={kind:"flight";flight:FlightMapReceipt}|
  {kind:"catalogue-presentation";presentation:CataloguePresentationWrite};
export type WorkspaceActionEffect={
  version:1;conversationId:string;runId:string;turnId:string;actionId:string;effectId:string;
  operationId?:string;stepId?:string;stepOrder?:number;
  kind:WorkspaceEffectCommand["kind"];status:"waiting"|"received"|"expired"|"cancelled";expiresAt:number;
  command?:WorkspaceEffectCommand;receipt?:WorkspaceEffectReceipt;
};

const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==="object"&&!Array.isArray(value);
const id=(value:unknown):value is string=>typeof value==="string"&&workspaceIdPattern.test(value);
export function readWorkspaceEffectReceipt(value:unknown):WorkspaceEffectReceipt|undefined{
  if(!object(value)||Object.keys(value).length!==2)return;
  if(value.kind==="flight"&&validFlightMapReceipt(value.flight))return {kind:value.kind,flight:value.flight};
  if(value.kind==="catalogue-presentation"){
    const presentation=readCataloguePresentationWrite(value.presentation);
    if(presentation)return {kind:value.kind,presentation};
  }
}
export function readWorkspaceActionEffect(value:unknown,runId:string):WorkspaceActionEffect|undefined{
  if(!object(value)||!id(runId)||value.version!==1||value.runId!==runId||
    !id(value.conversationId)||!id(value.turnId)||!id(value.effectId)||typeof value.expiresAt!=="number"||
    !Number.isSafeInteger(value.expiresAt)||value.expiresAt<=0||
    value.status!=="waiting"&&value.status!=="received"&&value.status!=="expired"&&value.status!=="cancelled"||
    value.kind!=="flight"&&value.kind!=="catalogue-presentation")return;
  const {conversationId,turnId,actionId,effectId,kind,status,expiresAt}=value;
  const {operationId,stepId,stepOrder}=value;
  const operation=operationId!==undefined||stepId!==undefined||stepOrder!==undefined;
  if(operation
    ? !id(operationId)||operationId!==actionId||!id(stepId)||stepId!==effectId||
      typeof stepOrder!=="number"||!Number.isSafeInteger(stepOrder)||stepOrder<1
    : actionId!==runId) return;
  if(!id(actionId))return;
  const receipt=readWorkspaceEffectReceipt(value.receipt);
  if(value.receipt!==undefined&&receipt?.kind!==kind||receipt?.kind==="catalogue-presentation"&&
    (receipt.presentation.conversationId!==conversationId||receipt.presentation.turnId!==turnId))return;
  let command:WorkspaceEffectCommand|undefined;
  if(value.command!==undefined){
    if(status!=="waiting"||!object(value.command)||value.command.kind!==kind)return;
    if(kind==="flight"){
      const {camera,placeLabel}=value.command;
      if(!object(camera)||!Array.isArray(camera.center)||camera.center.length!==2||!camera.center.every(Number.isFinite)||
        Math.abs(camera.center[0])>180||Math.abs(camera.center[1])>90||typeof camera.zoom!=="number"||
        !Number.isFinite(camera.zoom)||typeof camera.reason!=="string"||typeof placeLabel!=="string"||!placeLabel.trim())return;
      command={kind,camera:camera as unknown as Camera,placeLabel};
    }else{
      const {result,target}=value.command;
      if(!object(result)||typeof result.message!=="string"||!object(target))return;
      const parsed=result as unknown as DiscoveryResponse,owner={runId,conversationId,turnId};
      const canonical=cataloguePresentationTarget(parsed,owner);
      if(!canonical||!boundCatalogueMapBatch(parsed,owner)||target.runId!==runId||target.conversationId!==conversationId||
        target.turnId!==turnId||target.batchId!==canonical.batchId||target.coverageRevision!==canonical.coverageRevision||
        !Array.isArray(target.items)||target.items.length!==canonical.items.length||target.items.some((item,i)=>
          !object(item)||item.datasetId!==canonical.items[i].datasetId||item.version!==canonical.items[i].version))return;
      command={kind,target:canonical,result:parsed};
    }
  }
  return {version:1,conversationId,runId,turnId,actionId,effectId,kind,status,expiresAt,
    ...(operation?{operationId:operationId as string,stepId:stepId as string,stepOrder:stepOrder as number}:{}),
    ...(command?{command}:{}),...(receipt?{receipt}:{})};
}
