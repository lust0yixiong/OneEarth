import type {ChatModel} from "../src/domain/chat-model";
import type {DeepSeekTools} from "../src/domain/deepseek-tools";
import {discoverThroughService, discoveryCancellation, type DiscoveryEvent, type DiscoveryInput} from "./discovery-contract";
import {runExecutor, type ExecutorOptions} from "./executor";
import {readPlannedSources} from "./turn-reading";

/** Bind the turn's authorized model and channel configuration once. */
export function researchExecutor(config:ChatModel,deepseekTools:DeepSeekTools|undefined,signal:AbortSignal){
  const cancellation=discoveryCancellation(signal);
  return {
    name:config.executor,
    model:(prompt:string,options?:ExecutorOptions,modelSignal=signal)=>runExecutor(config,prompt,modelSignal,options),
    discover:(id:string,input:Omit<DiscoveryInput,"config"|"deepseekTools">,emit:(event:DiscoveryEvent)=>void)=>
      discoverThroughService(id,{...input,config,deepseekTools},signal,emit,cancellation),
    read:(plan:Parameters<typeof readPlannedSources>[0],question:string,deps:Parameters<typeof readPlannedSources>[3])=>
      readPlannedSources(plan,question,signal,{...deps,configuredFetch:deepseekTools?.fetch}),
    close:()=>cancellation.close(),
  };
}
