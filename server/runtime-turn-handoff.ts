import {createHash} from "node:crypto";
import type {DiscoveryContext,DiscoveryResponse,RunTrace,QuestionDecision} from "../src/domain/types";
import {validResearchIntent} from "../src/domain/research-intent";
import type {ChatModel} from "../src/domain/chat-model";
import type {DeepSeekTools} from "../src/domain/deepseek-tools";
import type {ClarificationReply} from "./clarification-guard";
import type {TurnHistory,TurnPlan} from "./turn-planning";
import type {ClarificationPrompt,ClarificationAnswer} from "../src/domain/clarification";
import type {RuntimeConversationHistory} from "./conversation-history";
import type {LayerObservationBinding} from "./runtime-layer-observation";
import type {CaseObservationBinding} from "./runtime-case-observation";
import type {RuntimeTurnContext} from "./runtime-turn-context";
import type {WorkspaceResearchObservation,WorkspaceResearchReference} from "../src/domain/workspace-research-state";

export type RuntimeTurnInput={query:string;conversationId:string;turnId:string;previousTaskId?:string;context:DiscoveryContext;
  history:TurnHistory;config:ChatModel;questionDecision?:QuestionDecision;deepseekTools?:DeepSeekTools;clarificationReply?:ClarificationReply;clarificationAnswer?:ClarificationAnswer;
  serverWorkspaceResearch?:WorkspaceResearchReference;serverWorkspaceResearchAction?:WorkspaceResearchObservation};
export type ObservationTurnMaterial={artifactId:string;version:string;title:string;variables:string[]};
export type RuntimeWorkspacePending={taskId:string;question:string;originalQuestion?:string;proposedAction?:import("../src/domain/workspace-view-context").WorkspaceViewAction;
  proposalOrigin?:{layerId:string;controlId:string;valueId:string};clarificationPrompt?:ClarificationPrompt;answer?:ClarificationAnswer};
export type RuntimeTurnOptions={publicAnswer?:true;caseObservation?:CaseObservationBinding;layerObservation?:LayerObservationBinding;historicalTargets?:import("./turn-planning").TurnTarget[];conversationHistory?:RuntimeConversationHistory;observationUnavailable?:boolean;observationAvailable?:boolean;priorResult?:DiscoveryResponse|null;observationMaterials?:ObservationTurnMaterial[];pending?:RuntimeWorkspacePending;turnContext?:RuntimeTurnContext};
/** Private server record, never a browser input or a replacement for source authorization. */
export type RuntimeTurnHandoff={version:1;kind:"runtime-turn-plan";inputFingerprint:string;plannedAt:number;historicalTargets?:import("./turn-planning").TurnTarget[];plan:TurnPlan;runTrace:RunTrace;
  observationUnavailable?:true;observationAvailable?:true;observationMaterials?:ObservationTurnMaterial[];pending?:RuntimeWorkspacePending;priorOverride?:true;turnContext?:RuntimeTurnContext};
export type ForegroundTurnOutcome={kind:"reply";payload:Record<string,unknown>}|{kind:"research";checkpoint:RuntimeTurnHandoff};

function canonical(value:any):any{
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==="object")return Object.fromEntries(Object.keys(value).sort().filter(key=>value[key]!==undefined).map(key=>[key,canonical(value[key])]));
  return value;
}
export function runtimeTurnFingerprint(body:RuntimeTurnInput){
  const {query,conversationId,turnId,previousTaskId,context,history,config,questionDecision,deepseekTools,clarificationReply,clarificationAnswer,serverWorkspaceResearch,serverWorkspaceResearchAction}=body;
  return createHash("sha256").update(JSON.stringify(canonical({query,conversationId,turnId,previousTaskId,context,history,config,questionDecision,deepseekTools,clarificationReply,clarificationAnswer,serverWorkspaceResearch,serverWorkspaceResearchAction}))).digest("hex");
}
export function validRuntimeTurnHandoff(value:unknown):value is RuntimeTurnHandoff{
  if(!value||typeof value!=="object"||Array.isArray(value))return false;
  const v=value as RuntimeTurnHandoff,p=v.plan;
  try{return v.version===1&&v.kind==="runtime-turn-plan"&&/^[a-f0-9]{64}$/.test(v.inputFingerprint)&&Number.isSafeInteger(v.plannedAt)&&v.plannedAt>0&&
    !!p&&p.caseObservationUse===undefined&&p.layerObservationUse===undefined&&(["read","search"].includes(p.action)||p.observationUse==="selected"&&p.action==="respond")&&typeof p.goal==="string"&&p.goal.length>0&&p.goal.length<=1200&&
    typeof p.reason==="string"&&p.reason.length>0&&p.reason.length<=600&&validResearchIntent(p.researchIntent)&&
    typeof p.conversationContext==="string"&&p.conversationContext.length<=1600&&Array.isArray(p.targets)&&p.targets.length<=8&&
    p.targets.every(target=>!!target&&typeof target.key==="string"&&target.key.length<=2300)&&
    !!v.runTrace&&Number.isFinite(v.runTrace.started)&&Array.isArray(v.runTrace.stages)&&Array.isArray(v.runTrace.calls)&&
    v.runTrace.stages.length<=64&&v.runTrace.calls.length<=64&&(v.observationUnavailable===undefined||v.observationUnavailable===true)&&
    (v.observationAvailable===undefined||v.observationAvailable===true)&&
    (v.observationMaterials===undefined||Array.isArray(v.observationMaterials)&&v.observationMaterials.length<=16)&&
    Buffer.byteLength(JSON.stringify(v))<=1024*1024;}catch{return false;}
}
export function runtimeTurnHandoff(body:RuntimeTurnInput,plan:TurnPlan,runTrace:RunTrace,options:RuntimeTurnOptions):RuntimeTurnHandoff{
  return JSON.parse(JSON.stringify({version:1,kind:"runtime-turn-plan",inputFingerprint:runtimeTurnFingerprint(body),plannedAt:Date.now(),plan,runTrace,
    ...(options.historicalTargets?.length?{historicalTargets:options.historicalTargets}:{}),
    ...(options.observationUnavailable?{observationUnavailable:true}:{}),...(options.observationAvailable?{observationAvailable:true}:{}),
    ...(options.observationMaterials?{observationMaterials:options.observationMaterials}:{}),...(options.pending?{pending:options.pending}:{}),...(options.turnContext?{turnContext:options.turnContext}:{}),
    ...(Object.hasOwn(options,"priorResult")?{priorOverride:true}:{})}));
}
