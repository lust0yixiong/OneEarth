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
 if(run.resume!==undefined||run.parentRunId!==undefined||run.tools.length)throw new AgUiInputError("此入口尚不受理恢复或客户端工具调用。",422);
 const latest=run.messages.at(-1),submission=readOneEarthAgUiSubmission(run.forwardedProps);
 if(latest?.role!=="user"||typeof latest.content!=="string"||!taskIdPattern.test(latest.id)||!latest.content.trim()||!submission)
  throw new AgUiInputError("请提交实际用户消息与 OneEarth 工作台输入。");
 const allowed=new Set(["context","config","deepseekTools","previousTaskId","questionDecision","clarificationReply","clarificationAnswer","observationCheck"]);
 if(Object.keys(submission).some(key=>!allowed.has(key)))throw new AgUiInputError("工作台输入含未登记的字段。");
 if([run.runId,run.threadId,latest.id].some(id=>id!==id.toLowerCase()))throw new AgUiInputError("运行、会话和用户消息编号必须使用规范小写UUID。");
 if(new Set(run.messages.map(message=>message.id)).size!==run.messages.length)throw new AgUiInputError("消息编号不能重复。");
 // Client transcript/state/context are untrusted display input. Existing PG
 // conversationHistory supplies model history after this run is admitted.
 const body={...submission,query:latest.content,history:[],conversationId:run.threadId.toLowerCase(),turnId:latest.id.toLowerCase()} as unknown as RuntimeTurnInput;
 const canonical=(value:any):any=>Array.isArray(value)?value.map(canonical):value&&typeof value==="object"?Object.fromEntries(Object.keys(value).sort().filter(key=>value[key]!==undefined).map(key=>[key,canonical(value[key])])):value;
 const fingerprint=createHash("sha256").update(JSON.stringify(canonical(body))).digest("hex");
 return {id:run.runId.toLowerCase(),body:canonical(body) as RuntimeTurnInput,fingerprint,protocolVersion:version};
}
