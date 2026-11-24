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
import {webGrantInput,type RuntimeWebToolContext} from "./runtime-web-tool-authority";
import {modelSafeText,modelSafeValue,assertModelContextSafe} from "./model-context-safety";

type ReadDependencies={stage:(text:string,searches?:SearchRun[])=>void;report:(call:ToolCall)=>void;callPrefix?:string;
  options?:DiscoveryA2AOptions;onFailure?:(message:string)=>void;onResult?:(result:SourceReadResult)=>Promise<void>};

export function discoveryProtocol():"a2a"|"v1"{
  const protocol=process.env.ONEEARTH_DISCOVERY_PROTOCOL||"a2a";
  if(protocol!=="a2a"&&protocol!=="v1")throw Error("发现服务协议必须明确使用 a2a 或兼容 v1。");
  return protocol;
}

/** Bind the turn's authorized model and channel configuration once. */
export function researchExecutor(config:ChatModel,deepseekTools:DeepSeekTools|undefined,signal:AbortSignal,webTools?:RuntimeWebToolContext){
  const protocol=discoveryProtocol();
  const cancellation=protocol==="v1"?discoveryCancellation(signal):undefined;
  const a2aCancellation=discoveryA2ACancellation(signal);
  const granted=new Set<string>();
  async function reserve(messageId:string,scope:Parameters<typeof webGrantInput>[4]){
    if(!webTools)return;
    signal.throwIfAborted();const input=webGrantInput(webTools.researchTaskId,messageId,config,deepseekTools,scope);if(!input)return;
    const token=await webTools.authority.reserve(input);granted.add(token);return token;
  }
  async function revoke(token:string|undefined){if(token&&webTools){try{await webTools.authority.revoke(token);granted.delete(token);}
    catch{console.error("OneEarth web tool grant revocation unconfirmed; parent state and expiry remain authoritative");}}}
  return {
    name:config.executor,
    model:async(prompt:string,options?:ExecutorOptions,modelSignal=signal)=>{
      const safe=modelSafeText(prompt),schema=options?.outputSchema?modelSafeValue(options.outputSchema):undefined;
      assertModelContextSafe(safe);if(schema)assertModelContextSafe(JSON.stringify(schema));
      return modelSafeText(await runExecutor(config,safe,modelSignal,options?{...options,outputSchema:schema}:options));
    },
    discover:async(id:string,input:Omit<DiscoveryBusinessInput,"deepseekTools">|DiscoveryClarificationInput,emit:(event:DiscoveryEvent)=>void,options:DiscoveryA2AOptions&{webToolQuestion?:string}={})=>{
      if(protocol==="v1"&&("clarificationReply" in input||options.target))throw Error("该研究记录需要原发现服务的 A2A 续行接口。");
      const question="clarificationReply" in input?options.webToolQuestion:input.query;
      const grant=question?await reserve(id,{kind:"discovery",question}):undefined;
      const bind=async(taskId:string)=>{if(grant)await webTools!.authority.bind(grant,taskId);};
      const boundOptions:DiscoveryA2AOptions={...options,onAccepted:async binding=>{await options.onAccepted?.(binding);await bind(binding.discoveryId);}};
      try{
      if("clarificationReply" in input){
        return await discoverThroughA2A(id,{...input,runtimeWebToolGrant:grant},signal,emit,boundOptions,a2aCancellation);
      }
      const safeInput={...input,history:modelSafeValue(input.history),references:modelSafeValue(input.references),conversationEvidence:modelSafeValue(input.conversationEvidence),
        conversationContext:input.conversationContext?modelSafeText(input.conversationContext):input.conversationContext,
        scope:input.scope?{...input.scope,citation:modelSafeValue(input.scope.citation)}:input.scope};
      return protocol==="a2a"?await discoverThroughA2A(id,{...safeInput,deepseekTools,runtimeWebToolGrant:grant},signal,emit,boundOptions,a2aCancellation):
        await discoverThroughService(id,{...safeInput,config,deepseekTools,runtimeWebToolGrant:grant},signal,emit,cancellation,bind);
      }finally{await revoke(grant);}
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
      const grant=await reserve(messageId,{kind:"source-read",question,urls:targets.flatMap(t=>t.kind==="web"?[t.url]:[])});
      try{
        const result=await readSourcesThroughA2A(messageId,{question,targets,deepseekFetch:deepseekTools?.fetch===true,runtimeWebToolGrant:grant},signal,
          update=>{if(update.stage)deps.stage(update.stage,update.searches);if(update.call)deps.report({...update.call,id:call.id+":"+update.call.id});},
          {...deps.options,onAccepted:async binding=>{await deps.options?.onAccepted?.(binding);if(grant)await webTools!.authority.bind(grant,binding.discoveryId);},onEvent:async event=>{
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
        deps.report({...call,status:"failed",error:message});deps.onFailure?.(modelSafeText(message));
        deps.stage("发现服务尚未交付本轮精确读取材料");return [];
      }finally{await revoke(grant);}
    },
    close:async()=>{try{await cancellation?.close();await a2aCancellation?.close();}finally{await Promise.all([...granted].map(revoke));}},
  };
}
