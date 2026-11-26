import type {ToolCall,ToolMessage} from "@ag-ui/core";
import type {Pool,PoolClient} from "pg";
import {isDeepStrictEqual} from "node:util";
import {AgUiInputError} from "./ag-ui-input";
import {matchesWorkspaceToolCall,workspaceToolResult,unverifiedWorkspaceToolResult} from "../src/domain/native-workspace-tool";
import {workspaceObservationTarget} from "../src/domain/workspace-published-layer";
import type {DiscoveryResponse} from "../src/domain/types";
import type {WorkspaceReceipt} from "../src/domain/turn-context";

export type AgUiWorkspaceReply={runId:string;call:ToolCall;message:ToolMessage};
export type AgUiWorkspaceRecord={call:ToolCall;result?:ToolMessage;consumedBy?:string};
export class AgUiWorkspacePendingError extends AgUiInputError{
 constructor(readonly pendingToolCallIds:string[],message="请先提交同会话全部原工作台调用的真实结果；尚未核实的结果不能记为成功。") {super(message,409);}
}
export const agUiWorkspaceSchema=`
 ALTER TABLE runtime_agui_runs ADD COLUMN IF NOT EXISTS workspace_tool boolean NOT NULL DEFAULT false;
 ALTER TABLE runtime_agui_runs ADD COLUMN IF NOT EXISTS workspace_call jsonb;
 ALTER TABLE runtime_agui_runs ADD COLUMN IF NOT EXISTS workspace_result jsonb;
 ALTER TABLE runtime_agui_runs ADD COLUMN IF NOT EXISTS workspace_consumed_by uuid REFERENCES runtime_chat_messages(id);
 CREATE INDEX IF NOT EXISTS runtime_agui_workspace_pending ON runtime_agui_runs(thread_id,id) WHERE terminal AND workspace_call IS NOT NULL AND workspace_consumed_by IS NULL;
 CREATE INDEX IF NOT EXISTS runtime_agui_workspace_consumed ON runtime_agui_runs(workspace_consumed_by) WHERE workspace_consumed_by IS NOT NULL;
`;
type DB=Pick<Pool,"query">;
export async function readAgUiWorkspaceRecord(db:DB,id:string):Promise<AgUiWorkspaceRecord|undefined>{
 const {rows:[row]}=await db.query<{workspace_call:ToolCall;workspace_result:ToolMessage|null;workspace_consumed_by:string|null}>(
  "SELECT workspace_call,workspace_result,workspace_consumed_by FROM runtime_agui_runs WHERE id=$1 AND terminal AND workspace_call IS NOT NULL",[id]);
 return row?{call:row.workspace_call,...(row.workspace_result?{result:row.workspace_result}:{}),...(row.workspace_consumed_by?{consumedBy:row.workspace_consumed_by}:{})}:undefined;
}
export async function pendingAgUiWorkspaceCalls(db:DB,threadId:string){
 const {rows}=await db.query<{runId:string;toolCallId:string}>(`SELECT r.id AS "runId",r.workspace_call->>'id' AS "toolCallId" FROM runtime_agui_runs r
 JOIN runtime_chat_messages m ON m.id=r.id WHERE r.thread_id=$1 AND r.terminal AND r.workspace_call IS NOT NULL AND r.workspace_consumed_by IS NULL ORDER BY m.created,r.id`,[threadId]);
 return rows;
}
function matchesMessage(actual:ToolMessage,expected:ToolMessage){
 if(actual.id!==expected.id||actual.role!==expected.role||actual.toolCallId!==expected.toolCallId||actual.error!==expected.error||actual.subagentRunId!==undefined||typeof actual.content!=="string"||typeof expected.content!=="string")return false;
 try{return isDeepStrictEqual(JSON.parse(actual.content),JSON.parse(expected.content));}catch{return false;}
}
/** Read-only preflight; the original admission transaction repeats the check
 * under its per-thread lock and freezes only server-generated result objects. */
export async function bindAgUiWorkspaceReplies(db:DB,threadId:string,_previousTaskId:string|undefined,replies:AgUiWorkspaceReply[],claimRunId?:string,expectedPending?:string[]){
 const pending=await pendingAgUiWorkspaceCalls(db,threadId),pendingIds=pending.map(row=>row.toolCallId);
 if(pending.some(row=>!replies.some(reply=>reply.runId===row.runId)))throw new AgUiWorkspacePendingError(pendingIds);
 if(expectedPending&&!isDeepStrictEqual([...expectedPending].sort(),[...pendingIds].sort()))throw new AgUiWorkspacePendingError(pendingIds,"原待答调用已由另一轮接收或发生变化，请只读刷新。");
 const accepted:{runId:string;result:ToolMessage}[]=[];
 for(const reply of replies){
  const {rows:[row]}=await db.query<{thread_id:string;workspace_call:ToolCall;workspace_result:ToolMessage|null;workspace_consumed_by:string|null;terminal:{result?:DiscoveryResponse}}>(`SELECT r.thread_id,r.workspace_call,r.workspace_result,r.workspace_consumed_by,m.terminal
    FROM runtime_agui_runs r JOIN runtime_chat_messages m ON m.id=r.id
    WHERE r.id=$1 AND r.terminal AND r.workspace_call IS NOT NULL${claimRunId?" FOR UPDATE OF r,m":""}`,[reply.runId]);
  if(!row||row.thread_id!==threadId||!matchesWorkspaceToolCall(reply.call,row.workspace_call))throw new AgUiWorkspacePendingError(pendingIds,"工具调用与同会话持久原提案不一致。");
  // Read the receipt after locking the original message. Its writer uses
  // that same row lock; a join snapshot taken before a lock wait is too old.
  const receipt=(await db.query<{receipt:WorkspaceReceipt}>("SELECT receipt FROM runtime_workspace_receipts WHERE task_id=$1",[reply.runId])).rows[0]?.receipt;
  const expected=row.workspace_result??(receipt?workspaceToolResult(receipt,!!workspaceObservationTarget(row.terminal?.result)):undefined)??unverifiedWorkspaceToolResult(reply.runId);
  if(!matchesMessage(reply.message,expected))throw new AgUiWorkspacePendingError(pendingIds,"工具结果与原任务的真实回执或明确未核实状态不一致。");
  if(!row.workspace_consumed_by)accepted.push({runId:reply.runId,result:expected});
 }
 if(claimRunId)for(const {runId,result} of accepted){
  const changed=await (db as PoolClient).query("UPDATE runtime_agui_runs SET workspace_result=$2,workspace_consumed_by=$3 WHERE id=$1 AND workspace_consumed_by IS NULL",[runId,result,claimRunId]);
  if(!changed.rowCount)throw new AgUiWorkspacePendingError(pendingIds,"原工具结果已由另一轮受理。");
 }
 return pendingIds;
}
export async function agUiWorkspaceResults(db:DB,runId:string,threadId:string){
 const {rows}=await db.query<{taskId:string;message:ToolMessage}>(`SELECT id AS "taskId",workspace_result AS message FROM runtime_agui_runs
 WHERE workspace_consumed_by=$1 AND thread_id=$2 AND workspace_result IS NOT NULL ORDER BY id`,[runId,threadId]);
 return rows;
}
