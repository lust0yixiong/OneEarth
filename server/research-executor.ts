import type {ChatModel} from "../src/domain/chat-model";
import type {DeepSeekTools} from "../src/domain/deepseek-tools";
import {discoverThroughService, discoveryCancellation, type DiscoveryEvent, type DiscoveryInput} from "./discovery-contract";
import {runExecutor, type ExecutorOptions} from "./executor";
import {discoverThroughA2A,readSourcesThroughA2A,DiscoveryA2AError,discoveryA2ACancellation,type DiscoveryA2AOptions,type DiscoveryBusinessInput,type DiscoveryClarificationInput} from "./discovery-a2a-client";
import {randomUUID} from "node:crypto";
import {paperId} from "../src/domain/paper-record";
import type {TurnPlan} from "./turn-planning";
import type {SearchRun,ToolCall} from "../src/domain/types";
import type {SourceReadInput,SourceReadResult} from "./discovery-materials-contract";

type ReadDependencies={stage:(text:string,searches?:SearchRun[])=>void;report:(call:ToolCall)=>void;callPrefix?:string;
  options?:DiscoveryA2AOptions;onResult?:(result:SourceReadResult)=>Promise<void>};

export function discoveryProtocol():"a2a"|"v1"{
  const protocol=process.env.ONEEARTH_DISCOVERY_PROTOCOL||"a2a";
  if(protocol!=="a2a"&&protocol!=="v1")throw Error("发现服务协议必须明确使用 a2a 或兼容 v1。");
  return protocol;
}

/** Bind the turn's authorized model and channel configuration once. */
export function researchExecutor(config:ChatModel,deepseekTools:DeepSeekTools|undefined,signal:AbortSignal){
  const protocol=discoveryProtocol();
  const cancellation=protocol==="v1"?discoveryCancellation(signal):undefined;
  const a2aCancellation=discoveryA2ACancellation(signal);
  return {
    name:config.executor,
    model:(prompt:string,options?:ExecutorOptions,modelSignal=signal)=>runExecutor(config,prompt,modelSignal,options),
    discover:(id:string,input:Omit<DiscoveryBusinessInput,"deepseekTools">|DiscoveryClarificationInput,emit:(event:DiscoveryEvent)=>void,options?:DiscoveryA2AOptions)=>{
      if("clarificationReply" in input){
        if(protocol!=="a2a")throw Error("该受托澄清需要原发现服务的 A2A 续行接口。");
        return discoverThroughA2A(id,input,signal,emit,options,a2aCancellation);
      }
      if(protocol==="v1"&&options?.target)throw Error("该研究记录需要原发现服务的 A2A 续行接口。");
      return protocol==="a2a"?discoverThroughA2A(id,{...input,deepseekTools},signal,emit,options,a2aCancellation):
        discoverThroughService(id,{...input,config,deepseekTools},signal,emit,cancellation);
    },
    read:async(plan:TurnPlan,question:string,deps:ReadDependencies):Promise<SearchRun[]>=>{
      if(plan.action!=="read")return [];
      const targets=[...new Map(plan.targets.flatMap<SourceReadInput["targets"][number]>(t=>t.kind==="asset"&&t.id&&paperId(t.id)?[{kind:"paper",id:t.id}]:t.url?
        [{kind:"web",url:t.url,title:t.title,...(t.discoveredBy?{discoveredBy:t.discoveredBy}:{})}]:[])
        .map(t=>[t.kind==="web"?t.url:t.id,t])).values()].slice(0,3);
      if(!targets.length)return [];
      const messageId=randomUUID(),call={id:(deps.callPrefix||"read-source-")+messageId,kind:"tool" as const,name:"委托发现服务读取指定来源",
        input:JSON.stringify({messageId,targets})};
      deps.stage("正在委托发现服务读取指定来源");deps.report({...call,status:"running"});
      try{
        const result=await readSourcesThroughA2A(messageId,{question,targets,deepseekFetch:deepseekTools?.fetch===true},signal,
          update=>{if(update.stage)deps.stage(update.stage,update.searches);if(update.call)deps.report({...update.call,id:call.id+":"+update.call.id});},
          {...deps.options,onEvent:async event=>{
            await deps.options?.onEvent?.(event);
            const value=event.sourceReadResult||event.sourceReadProgress;
            const completed=event.searches?.filter(run=>run.status==="done"&&run.hits.some(hit=>
              ["abstract","page-excerpt","pdf-excerpt"].includes(hit.stage||"")&&!!hit.pageExcerpt));
            if(value||completed?.length)await deps.onResult?.({papers:value?.papers||[],searches:value?.searches||completed||[],
              issues:value?.issues||[],...(value?.paperEvidence?{paperEvidence:value.paperEvidence}:{})});
          }},a2aCancellation);
        deps.report({...call,status:result.issues.length?"partial":"done",output:JSON.stringify({papers:result.papers.map(p=>p.id),
          paperEvidence:result.paperEvidence?.map(p=>({id:p.id,readAt:p.readAt})),sources:result.searches.map(r=>({url:r.requestUrl||r.query,status:r.status})),issues:result.issues})});
        deps.stage("已取得发现服务的指定来源读取结果",result.searches);return result.searches;
      }catch(error){
        signal.throwIfAborted();if(error instanceof DiscoveryA2AError&&error.reason==="RUNTIME_PERSISTENCE_FAILED")throw error;
        const message=error instanceof Error?error.message:"发现服务未完成精确补读。";
        deps.report({...call,status:"failed",error:message});
        deps.stage("发现服务尚未交付本轮精确读取材料");return [];
      }
    },
    close:async()=>{await cancellation?.close();await a2aCancellation?.close();},
  };
}
