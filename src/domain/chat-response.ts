import type { DiscoveryResponse, SearchRun, RunTrace, ProviderReasoningSnapshot } from "./types";
import {mergeProviderReasoning,traceWithProviderReasoning} from "./provider-reasoning";
import {validResearchRegion,type ResearchRegion} from "./research-region";
import {readTaskLifecycle,type TaskLifecycle} from "./task-lifecycle-client";
export class ChatResponseError extends Error {
  constructor(message:string,readonly code?:string,readonly runTrace?:RunTrace){super(message);this.name="ChatResponseError";}
}
export type ChatPhase = "foreground" | "research";
export async function readChatResponse(response:Response,onStage:(text:string,searches?:SearchRun[],trace?:RunTrace,phase?:ChatPhase)=>void,onRegion?:(region:ResearchRegion|null)=>void,
  initialReasoning?:ProviderReasoningSnapshot[],retiredReasoning=new Set<string>(),
  onLifecycle?:(facts:TaskLifecycle,seq?:number)=>void):Promise<DiscoveryResponse> {
  let reasoning=initialReasoning;
  if(!response.headers.get("content-type")?.includes("application/x-ndjson")){
    const data=await response.json();
    const facts=readTaskLifecycle(data);
    if(facts)onLifecycle?.(facts);
    reasoning=mergeProviderReasoning(reasoning,data.runTrace?.providerReasoning,retiredReasoning);
    const trace=traceWithProviderReasoning(data.runTrace,reasoning);
    if(!response.ok) throw new ChatResponseError(data.error || "数据发现请求失败。",data.code,trace);
    return reasoning ? {...data,runTrace:trace} : data;
  }
  const reader=response.body!.pipeThrough(new TextDecoderStream()).getReader();
  let pending="",stageText="";
  let trace:RunTrace|undefined;
  try {
    while(true){
      const {value,done}=await reader.read();
      pending+=value || "";
      const lines=pending.split("\n");pending=lines.pop()!;
      for(const line of lines){
        if(!line.trim())continue;
        const event=JSON.parse(line);
        const facts=readTaskLifecycle(event);
        if(facts)onLifecycle?.(facts,Number.isSafeInteger(event.seq)?event.seq:undefined);
        if(Object.hasOwn(event,"researchRegion") && (event.researchRegion===null || validResearchRegion(event.researchRegion)))onRegion?.(event.researchRegion);
        if(event.runTrace)trace=event.runTrace;
        if(!trace && typeof event.traceStarted==="number")trace={started:event.traceStarted,stages:[],calls:[]};
        const previousReasoning=reasoning;
        reasoning=mergeProviderReasoning(reasoning,event.runTrace?.providerReasoning,retiredReasoning);
        reasoning=mergeProviderReasoning(reasoning,event.providerReasoning,retiredReasoning);
        trace=traceWithProviderReasoning(trace,reasoning);
        const reasoningChanged=previousReasoning!==reasoning;
        if(trace && event.call){
          const calls=[...trace.calls],index=calls.findIndex(c=>c.id===event.call.id);
          if(index<0)calls.push(event.call);else calls[index]=event.call;
          trace={...trace,calls};
        }
        if(event.stage){
          stageText=event.stage;
          if(trace && trace.stages.at(-1)!==stageText)trace={...trace,stages:[...trace.stages,stageText]};
        }
        if(trace && event.finding){
          const findings=[...(trace.findings||[])],index=findings.findIndex(f=>f.id===event.finding.id);
          if(index<0)findings.push(event.finding);else findings[index]=event.finding;
          trace={...trace,findings};
        }
        if(trace && event.searches)trace={...trace,searches:event.searches};
        if(event.error)throw new ChatResponseError(event.error,event.code,trace);
        const phase = event.chatPhase === "research" || event.queued === true ? "research"
          : event.chatPhase === "foreground" ? "foreground" : undefined;
        if(event.stage || event.call || event.finding || event.runTrace || phase || reasoningChanged)
          onStage(stageText,event.searches,trace,phase);
        if(event.result){
          reasoning=mergeProviderReasoning(reasoning,event.result.runTrace?.providerReasoning,retiredReasoning);
          return reasoning ? {...event.result,runTrace:traceWithProviderReasoning(event.result.runTrace ?? trace,reasoning)} : event.result;
        }
      }
      if(done)throw Error("连接在回复完成前中断，请重试。");
    }
  } finally {reader.releaseLock();}
}
