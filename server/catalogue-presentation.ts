import express,{type Router} from "express";
import {readCataloguePresentationWrite} from "../src/domain/catalogue-presentation";
import {taskIdPattern,TaskConflict} from "./task-store";
import type {CataloguePresentationStore} from "./postgres-catalogue-presentation";

export function cataloguePresentationRoutes(router:Router,store:CataloguePresentationStore) {
  router.put("/api/tasks/:taskId/catalogue-presentation",express.json({limit:"16kb"}),async (req,res)=>{
    const id=String(req.params.taskId);
    const input=req.is("application/json") ? readCataloguePresentationWrite(req.body) : undefined;
    if(!taskIdPattern.test(id)||id!==id.toLowerCase()||!input){
      res.status(400).json({error:"目录绘制回执格式无效。"});return;
    }
    try {
      const saved=await store.write(id,input);
      if(!saved){
        res.status(409).json({error:"目录绘制回执与原任务、批次、覆盖修订或条目版本不一致。"});return;
      }
      res.set("Cache-Control","no-store").json(saved);
    }catch(error){
      if(error instanceof TaskConflict){res.status(409).json({error:error.message});return;}
      res.status(503).json({error:"目录绘制回执未能持久保存。"});
    }
  });
}
