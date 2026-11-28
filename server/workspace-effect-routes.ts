import express,{type Router} from "express";
import {readWorkspaceEffectReceipt,workspacePageHeader,workspacePageTokenPattern} from "../src/domain/workspace-action-effect";
import {workspaceIdPattern} from "../src/domain/workspace-research-state";
import type {WorkspaceEffectsStore} from "./postgres-workspace-effects";

export function workspaceEffectRoutes(router:Router,store:WorkspaceEffectsStore){
  router.put("/api/workspaces/:conversationId/actions/:actionId/effects/:effectId/receipt",express.json({limit:"16kb"}),async(req,res)=>{
    const {conversationId,actionId,effectId}=req.params;
    const token=req.get(workspacePageHeader),receipt=req.is("application/json")?readWorkspaceEffectReceipt(req.body):undefined;
    res.set("Cache-Control","no-store");
    if(![conversationId,actionId,effectId].every(value=>workspaceIdPattern.test(value))||!receipt){res.status(400).json({error:"工作台效果回执格式无效。"});return;}
    if(!token||!workspacePageTokenPattern.test(token)){res.status(404).json({error:"找不到原页面的工作台操作。"});return;}
    try{
      const saved=await store.write(conversationId,actionId,effectId,token,receipt);
      if(saved.status===200)res.json(saved.effect);
      else res.status(saved.status).json({error:saved.status===404?"找不到原页面的工作台操作。":"回执与原待办或已保存事实不一致。"});
    }catch{res.status(503).json({error:"工作台效果回执未能持久保存。"});}
  });
}
