import type {Router} from "express";
import {validBrowserWorkspaceReceipt} from "../src/domain/turn-context";
import {workspaceToolCallId} from "../src/domain/native-workspace-tool";
import {taskIdPattern,TaskConflict} from "./task-store";
import type {PostgresChatMessages} from "./postgres-chat-messages";

export function nativeWorkspaceReceiptRoutes(app:Router,chat:PostgresChatMessages){
 app.put("/api/tasks/:taskId/tool-calls/:toolCallId/receipt",async(req,res)=>{
  const id=String(req.params.taskId),callId=String(req.params.toolCallId);
  if(!req.is("application/json")||!taskIdPattern.test(id)||id!==id.toLowerCase()||callId!==workspaceToolCallId(id)||!validBrowserWorkspaceReceipt(req.body)||req.body.effectId!==callId){res.status(400).json({error:"原生工作台调用回执格式无效。"});return;}
  try{
   const receipt=await chat.recordWorkspaceReceipt(id,req.body,callId);
   if(!receipt){res.status(409).json({error:"回执与原任务、会话、轮次或已核发布目标不一致。"});return;}
   res.set("Cache-Control","no-store").json(receipt);
  }catch(error){if(error instanceof TaskConflict){res.status(409).json({error:error.message});return;}res.status(503).json({error:"工作台回执未能持久保存。"});}
 });
}
