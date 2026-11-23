import type {ChatModel} from "../src/domain/chat-model";
import type {DeepSeekTools} from "../src/domain/deepseek-tools";
import {explicitDiscoverySourcePolicy} from "../src/domain/discovery-source-policy";
import {deepSeekKey} from "./model-service";
import type {RuntimeWebToolAuthority,WebGrantInput} from "./runtime-web-tool-store";

export type RuntimeWebToolContext={researchTaskId:string;authority:RuntimeWebToolAuthority};
/** Browser switches select only the DeepSeek suppliers. Basic public keyword
 * search and explicitly requested origin/PDF reading keep their old semantics. */
export function webGrantInput(researchTaskId:string,messageId:string,config:ChatModel,tools:DeepSeekTools|undefined,
  scope:{kind:"discovery";question:string}|{kind:"source-read";question:string;urls:string[]},env=process.env):WebGrantInput|undefined{
  const policy=explicitDiscoverySourcePolicy(scope.question);
  if(policy?.mode==="restricted"&&!policy.sources.includes("web"))return;
  if(scope.kind==="source-read"&&!scope.urls.length)return;
  const hasKey=!!deepSeekKey()?.trim(),deepseekSearch=tools?.search===true&&env.ONEEARTH_DEEPSEEK_SEARCH==="true"&&hasKey,
    deepseekFetch=tools?.fetch===true&&env.ONEEARTH_DEEPSEEK_FETCH==="true"&&hasKey;
  const nativeModel=config.executor==="codex"&&(!config.provider||config.provider==="native")?
    {executor:"codex" as const,provider:"native" as const,model:config.model}:undefined;
  return {researchTaskId,messageId,kind:scope.kind,allowSearch:scope.kind==="discovery",
    allowFetch:scope.kind==="source-read"||tools?.fetch===true&&env.ONEEARTH_DEEPSEEK_FETCH==="true",
    deepseekSearch:scope.kind==="discovery"&&deepseekSearch,deepseekFetch,
    ...(scope.kind==="source-read"?{urls:scope.urls}:{}),...(scope.kind==="discovery"&&nativeModel?{nativeModel}:{})};
}
