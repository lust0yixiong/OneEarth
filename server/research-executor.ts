import {runtimeStepContext} from "./runtime-step";
import {TaskParked} from "./task-store";
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
import type {ProviderReasoningSink} from "./provider-reasoning";

type ReadDependencies={stage:(text:string,searches?:SearchRun[])=>void;report:(call:ToolCall)=>void;callPrefix?:string;executionSignal?:AbortSignal;
  options?:DiscoveryA2AOptions;onFailure?:(message:string)=>void;onResult?:(result:SourceReadResult)=>Promise<void>};

export function discoveryProtocol():"a2a"|"v1"{
  const protocol=process.env.ONEEARTH_DISCOVERY_PROTOCOL||"a2a";
  if(protocol!=="a2a"&&protocol!=="v1")throw Error("发现服务协议必须明确使用 a2a 或兼容 v1。");
  return protocol;
}

/** Bind the turn's authorized model and channel configuration once. */
export function researchExecutor(config:ChatModel,deepseekTools:DeepSeekTools|undefined,signal:AbortSignal,webTools?:RuntimeWebToolContext,providerReasoning?:ProviderReasoningSink){
  const protocol=discoveryProtocol();
  const cancellation=protocol==="v1"?discoveryCancellation(signal):undefined;
  const a2aCancellation=discoveryA2ACancellation(signal);
  const granted=new Set<string>();
  const step=runtimeStepContext.getStore();let parked=false;
  async function reserve(messageId:string,scope:Parameters<typeof webGrantInput>[4]){
    if(!webTools)return;
    signal.throwIfAborted();const input=webGrantInput(webTools.researchTaskId,messageId,config,deepseekTools,scope);if(!input)return;
    const token=await webTools.authority.reserve(input);granted.add(token);return token;
  }
  async function canReplay(grant:string|undefined,messageId:string){
    if(!grant)return true;
    const authority=webTools?.authority;
    return !!await authority?.canReplay?.(grant,webTools!.researchTaskId,messageId);
  }
  async function revoke(token:string|undefined){if(token&&webTools){try{await webTools.authority.revoke(token);granted.delete(token);}
    catch{console.error("OneEarth web tool grant revocation unconfirmed; parent state and expiry remain authoritative");}}}
  return {
    name:config.executor,
    model:async(prompt:string,options?:ExecutorOptions,modelSignal=signal)=>{
      const safe=modelSafeText(prompt),schema=options?.outputSchema?modelSafeValue(options.outputSchema):undefined;
      assertModelContextSafe(safe);if(schema)assertModelContextSafe(JSON.stringify(schema));
      const run=async()=>modelSafeText(await runExecutor(config,safe,modelSignal,{...options,outputSchema:schema,providerReasoning}));
      return step?step.model(safe,schema,run):run();
    },
    discover:async(id:string,input:Omit<DiscoveryBusinessInput,"deepseekTools">|DiscoveryClarificationInput,emit:(event:DiscoveryEvent)=>void,options:DiscoveryA2AOptions&{webToolQuestion?:string;executionSignal?:AbortSignal}={})=>{
      const operationSignal=options.executionSignal?AbortSignal.any([signal,options.executionSignal]):signal;operationSignal.throwIfAborted();
      if(protocol==="v1"&&("clarificationReply" in input||options.target))throw Error("该研究记录需要原发现服务的 A2A 续行接口。");
      const entry=await step?.delegation("discover",id,{input,target:options.target,afterSeq:options.afterSeq});
      if(entry)id=entry.messageId;
      const question="clarificationReply" in input?options.webToolQuestion:input.query;
      const grant=entry?.reserved?entry.grant:question?await reserve(id,{kind:"discovery",question}):undefined;
      if(entry&&!entry.reserved){entry.grant=grant;entry.reserved=true;await step!.save();}
      const bind=async(taskId:string)=>{if(grant)await webTools!.authority.bind(grant,taskId);};
      const callbacks:DiscoveryA2AOptions={...options,authorizeReplay:()=>canReplay(grant,id),onAccepted:async binding=>{await options.onAccepted?.(binding);if(!entry?.binding)await bind(binding.discoveryId);}};
      const boundOptions=entry?step!.options(entry,callbacks):callbacks;
      try{
      if("clarificationReply" in input){
        return await discoverThroughA2A(id,{...input,runtimeWebToolGrant:grant},operationSignal,emit,boundOptions,a2aCancellation);
      }
      const safeInput={...input,history:modelSafeValue(input.history),references:modelSafeValue(input.references),conversationEvidence:modelSafeValue(input.conversationEvidence),
        conversationContext:input.conversationContext?modelSafeText(input.conversationContext):input.conversationContext,
        scope:input.scope?{...input.scope,citation:modelSafeValue(input.scope.citation)}:input.scope};
      return protocol==="a2a"?await discoverThroughA2A(id,{...safeInput,deepseekTools,runtimeWebToolGrant:grant},operationSignal,emit,boundOptions,a2aCancellation):
        await discoverThroughService(id,{...safeInput,config,deepseekTools,runtimeWebToolGrant:grant},operationSignal,emit,cancellation,bind);
      }catch(error){if(error instanceof TaskParked)parked=true;throw error;}finally{if(!parked)await revoke(grant);}
    },
    read:async(plan:TurnPlan,question:string,deps:ReadDependencies):Promise<SearchRun[]>=>{
      const operationSignal=deps.executionSignal?AbortSignal.any([signal,deps.executionSignal]):signal;operationSignal.throwIfAborted();
      if(plan.action!=="read")return [];
      const targets=[...new Map(plan.targets.flatMap<SourceReadInput["targets"][number]>(t=>t.kind==="asset"&&t.id&&paperId(t.id)?[{kind:"paper",id:t.id}]:t.url?
        [{kind:"web",url:t.url,title:t.title,...(t.discoveredBy?{discoveredBy:t.discoveredBy}:{}),...(t.locators?.length?{locators:t.locators}:{})}]:[])
        .map(t=>[t.kind==="web"?t.url:t.id,t])).values()].slice(0,3);
      if(!targets.length)return [];
      const entry=await step?.delegation("read",randomUUID(),{question,targets,deepseekFetch:deepseekTools?.fetch===true,target:deps.options?.target,afterSeq:deps.options?.afterSeq});
      const messageId=entry?.messageId??randomUUID(),call={id:(deps.callPrefix||"read-source-")+messageId,kind:"tool" as const,name:"委托发现服务读取指定来源",
        input:JSON.stringify({messageId,targets})};
      deps.stage("正在委托发现服务读取指定来源");deps.report({...call,status:"running"});
      const grant=entry?.reserved?entry.grant:await reserve(messageId,{kind:"source-read",question,urls:targets.flatMap(t=>t.kind==="web"?[t.url]:[])});
      if(entry&&!entry.reserved){entry.grant=grant;entry.reserved=true;await step!.save();}
      const callbacks:DiscoveryA2AOptions={...deps.options,authorizeReplay:()=>canReplay(grant,messageId),onAccepted:async binding=>{await deps.options?.onAccepted?.(binding);if(grant&&!entry?.binding)await webTools!.authority.bind(grant,binding.discoveryId);},onEvent:async event=>{
            await deps.options?.onEvent?.(event);
            const value=event.sourceReadResult||event.sourceReadProgress;
            const completed=event.searches?.filter(run=>run.status==="done"&&run.hits.some(hit=>["abstract","page-excerpt","pdf-excerpt"].includes(hit.stage||"")&&!!hit.pageExcerpt));
            if(value||completed?.length)await deps.onResult?.({papers:value?.papers||[],searches:value?.searches||completed||[],issues:value?.issues||[],...(value?.paperEvidence?{paperEvidence:value.paperEvidence}:{})});
          }};
      try{
        const result=await readSourcesThroughA2A(messageId,{question,targets,deepseekFetch:deepseekTools?.fetch===true,runtimeWebToolGrant:grant},operationSignal,
          update=>{if(update.stage)deps.stage(update.stage,update.searches);if(update.call)deps.report({...update.call,id:call.id+":"+update.call.id});},
          entry?step!.options(entry,callbacks):callbacks,a2aCancellation);
        deps.report({...call,status:result.issues.length?"partial":"done",output:JSON.stringify({papers:result.papers.map(p=>p.id),
          paperEvidence:result.paperEvidence?.map(p=>({id:p.id,readAt:p.readAt})),sources:result.searches.map(r=>({url:r.requestUrl||r.query,status:r.status})),issues:result.issues})});
        deps.stage("已取得发现服务的指定来源读取结果",result.searches);return result.searches;
      }catch(error){
        if(error instanceof TaskParked){parked=true;throw error;}
        signal.throwIfAborted();if(error instanceof DiscoveryA2AError&&error.reason==="RUNTIME_PERSISTENCE_FAILED")throw error;
        const message=error instanceof Error?error.message:"发现服务未完成精确补读。";
        deps.report({...call,status:"failed",error:message});deps.onFailure?.(modelSafeText(message));
        deps.stage("发现服务尚未交付本轮精确读取材料");return [];
      }finally{if(!parked)await revoke(grant);}
    },
    close:async()=>{try{await cancellation?.close();await a2aCancellation?.close();}finally{if(!parked)await Promise.all([...granted].map(revoke));}},
  };
}
