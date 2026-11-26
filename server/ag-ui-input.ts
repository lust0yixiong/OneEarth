import {isDeepStrictEqual} from "node:util";
import {nativeWorkspaceTool,nativeWorkspaceToolName} from "../src/domain/native-workspace-tool";
import type {AgUiWorkspaceReply} from "./postgres-ag-ui-workspace";
import type {AgUiResume} from "./ag-ui-interrupt";
import {createHash} from "node:crypto";
import {RunAgentInputSchema} from "@ag-ui/core/schemas";
import {nativeAgUiProtocolVersion,readOneEarthAgUiSubmission} from "../src/domain/native-ag-ui";
import {taskIdPattern} from "./task-store";
import type {RuntimeTurnInput} from "./runtime-turn-handoff";

export class AgUiInputError extends Error {constructor(message:string,readonly status=400){super(message);}}
export function readAgUiInput(raw:unknown){
 const parsed=RunAgentInputSchema.safeParse(raw);
 if(!parsed.success)throw new AgUiInputError("AG-UI 请求格式无效。");
 const run=parsed.data;
 const version=run.protocolVersion??nativeAgUiProtocolVersion;
 if(/^\d+\.\d+$/u.test(version)&&Number(version.split(".")[0])!==1)throw new AgUiInputError("此服务只支持 AG-UI 1.x。",422);
 if(!taskIdPattern.test(run.runId)||!taskIdPattern.test(run.threadId))throw new AgUiInputError("运行与会话编号必须是有效 UUID。");
 if(run.parentRunId!==undefined)throw new AgUiInputError("此入口不将父运行作为历史或执行权限。",422);
 if(run.tools.length>1||run.tools.some(tool=>tool.name!==nativeWorkspaceToolName||!isDeepStrictEqual(tool.parameters,nativeWorkspaceTool.parameters)))throw new AgUiInputError("此入口只接受已登记的工作台工具声明。",422);
 const workspaceTool=run.tools.length===1;
 let resume:AgUiResume|undefined;
 if(run.resume!==undefined){
  if(run.resume.length!==1)throw new AgUiInputError("请明确回答同一原问题。",409);
  const item=run.resume[0];
  if(!taskIdPattern.test(item.interruptId)||item.interruptId!==item.interruptId.toLowerCase()||Object.keys(item).some(key=>!["interruptId","status","payload"].includes(key)))throw new AgUiInputError("原生追问编号或答复字段无效。");
  resume={interruptId:item.interruptId,status:item.status,...(item.payload!==undefined?{payload:item.payload}:{})};
 }
 const latest=run.messages.at(-1),submission=readOneEarthAgUiSubmission(run.forwardedProps);
 if(latest?.role!=="user"||typeof latest.content!=="string"||!taskIdPattern.test(latest.id)||!latest.content.trim()||!submission)
  throw new AgUiInputError("请提交实际用户消息与 OneEarth 工作台输入。");
 const allowed=new Set(["context","config","deepseekTools","previousTaskId","clarificationReply","clarificationAnswer","observationCheck"]);
 if(Object.keys(submission).some(key=>!allowed.has(key)))throw new AgUiInputError("工作台输入含未登记的字段。");
 if(resume&&["questionDecision","clarificationReply","clarificationAnswer","observationCheck"].some(key=>Object.hasOwn(submission,key)))throw new AgUiInputError("原生续接不接受第二份确认或执行镜像。");
 if([run.runId,run.threadId,latest.id].some(id=>id!==id.toLowerCase()))throw new AgUiInputError("运行、会话和用户消息编号必须使用规范小写UUID。");
 if(new Set(run.messages.map(message=>message.id)).size!==run.messages.length)throw new AgUiInputError("消息编号不能重复。");
 // Client transcript/state/context are untrusted display input. Existing PG
 // conversationHistory supplies model history after this run is admitted.
 const body={...submission,query:latest.content,history:[],conversationId:run.threadId.toLowerCase(),turnId:latest.id.toLowerCase()} as unknown as RuntimeTurnInput;
 const canonical=(value:any):any=>Array.isArray(value)?value.map(canonical):value&&typeof value==="object"?Object.fromEntries(Object.keys(value).sort().filter(key=>value[key]!==undefined).map(key=>[key,canonical(value[key])])):value;
 const workspaceReplies:AgUiWorkspaceReply[]=[],calls=run.messages.flatMap(message=>message.role==="assistant"?(message.toolCalls??[]).map(call=>({message,call})):[]),results=run.messages.filter(message=>message.role==="tool");
 if(calls.length>64||results.length!==calls.length||new Set(calls.map(entry=>entry.call.id)).size!==calls.length||new Set(results.map(entry=>entry.toolCallId)).size!==results.length)throw new AgUiInputError("工作台调用及结果必须逐一明确对应。");
 for(const {message,call} of calls){
  const result=results.find(entry=>entry.toolCallId===call.id);
  if(!taskIdPattern.test(message.id)||message.id!==message.id.toLowerCase()||call.function.name!==nativeWorkspaceToolName||call.id!=="workspace:"+message.id||call.function.arguments.length>32768||!result||typeof result.content!=="string"||result.content.length>4096||run.messages.indexOf(result)<=run.messages.indexOf(message)||run.messages.indexOf(result)>=run.messages.length-1)throw new AgUiInputError("工具结果必须引用原助手调用并位于新的实际用户消息之前。");
  workspaceReplies.push({runId:message.id,call,message:result});
 }
 const identity=!workspaceTool&&!workspaceReplies.length?(resume?{body,resume}:body):{body,...(resume?{resume}:{}),...(workspaceTool?{workspaceTool:true}:{}),...(workspaceReplies.length?{workspaceReplies}:{})};
 const fingerprint=createHash("sha256").update(JSON.stringify(canonical(identity))).digest("hex");
 return {id:run.runId.toLowerCase(),body:canonical(body) as RuntimeTurnInput,fingerprint,protocolVersion:version,workspaceTool,workspaceReplies,...(resume?{resume}:{})};
}
