import {discover} from "../src/domain/discovery";
import {isWorkspaceCommand} from "../src/domain/research-question";
import type {DiscoveryContext,DiscoveryResponse} from "../src/domain/types";

const operations=["camera","gridSystem","clearSelection","view","selectCenter","previewNeed","previewKind","inspectId","dataView","visualization","catalogQuery"] as const;

// Summaries help resolve the research object, but are never fresh UI commands.
export function discoverConversation(query:string,context:DiscoveryContext,summary?:string):DiscoveryResponse {
  const direct=discover(query,context);
  const inferred=summary?discover(query+"\n"+summary,context):direct;
  const contextAction=operations.some(key=>JSON.stringify(inferred[key])!==JSON.stringify(direct[key]));
  const result={...inferred,...(contextAction?{message:direct.message}:{})};
  for(const key of operations){
    if(Object.hasOwn(direct,key))Object.assign(result,{[key]:direct[key]});
    else delete result[key];
  }
  const gridRequest=/^(?:(?:请|麻烦|能否|能不能|可以|可不可以|帮我|我想|先|再)\s*)*(?:把(?:显示网格|网格|视图|层级|地球|球)\s*)?(?:切换(?:到|为)?|切到|改(?:为|成|用)|设(?:为|成)|调整到|换成)\s*(?:H3(?:\s*R[2-7])?|S2(?:\s*L\d+)?|R[2-7])\b/i.test(query)
    && !/为什么|为何|原因|区别|是否|有什么|有何|意味着|会怎样|会如何|会不会/.test(query);
  const navigation=isWorkspaceCommand(query) || gridRequest || /^\s*(?:S2\s*L\d+|H3\s*R\d+|R[2-7])\s*[。.!！]?\s*$/i.test(query);
  const implicitGridCommand=!!result.gridSystem || /^用户指定 [RL]\d+/.test(result.camera?.reason || "");
  if(!navigation && (context.selection || implicitGridCommand)){
    if(result.camera || result.gridSystem)result.message="继续核对研究资料的依据。";
    delete result.camera;delete result.gridSystem;
    if(context.selection)result.clearSelection=false;else delete result.clearSelection;
  }
  return result;
}
