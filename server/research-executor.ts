import type {ChatModel} from "../src/domain/chat-model";
import type {DeepSeekTools} from "../src/domain/deepseek-tools";
import {discoverThroughService, discoveryCancellation, type DiscoveryEvent, type DiscoveryInput} from "./discovery-contract";
import {runExecutor, type ExecutorOptions} from "./executor";
import {readPlannedSources} from "./turn-reading";
import {discoverThroughA2A,discoveryA2ACancellation,type DiscoveryA2AOptions,type DiscoveryBusinessInput,type DiscoveryClarificationInput} from "./discovery-a2a-client";

export function discoveryProtocol():"a2a"|"v1"{
  const protocol=process.env.ONEEARTH_DISCOVERY_PROTOCOL||"a2a";
  if(protocol!=="a2a"&&protocol!=="v1")throw Error("发现服务协议必须明确使用 a2a 或兼容 v1。");
  return protocol;
}

/** Bind the turn's authorized model and channel configuration once. */
export function researchExecutor(config:ChatModel,deepseekTools:DeepSeekTools|undefined,signal:AbortSignal){
  const protocol=discoveryProtocol();
  const cancellation=protocol==="v1"?discoveryCancellation(signal):undefined;
  const a2aCancellation=protocol==="a2a"?discoveryA2ACancellation(signal):undefined;
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
    read:(plan:Parameters<typeof readPlannedSources>[0],question:string,deps:Parameters<typeof readPlannedSources>[3])=>
      readPlannedSources(plan,question,signal,{...deps,configuredFetch:deepseekTools?.fetch}),
    close:async()=>{await cancellation?.close();await a2aCancellation?.close();},
  };
}
