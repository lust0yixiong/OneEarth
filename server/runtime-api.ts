import express from "express";
import path from "node:path";
import { mkdirSync } from "node:fs";
import { accessGuard } from "./access";
import { validateTurn } from "./runtime-input";
import { openTaskStore, taskRoutes } from "./task-store";

const state=process.env.ONEEARTH_STATE_DIR || path.resolve(".local/state");
mkdirSync(state,{recursive:true,mode:0o700});
const tasks=openTaskStore(path.join(state,"runtime.sqlite"));
const app=express();
app.disable("x-powered-by");
app.use(accessGuard());
app.use(express.json({limit:"256kb"}));
app.get("/api/health",(_req,res)=>res.json({status:"ok",service:"runtime",version:"0.1.0"}));
taskRoutes(app,"/api/tasks",tasks,input=>validateTurn(tasks,input));
app.use((_error:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{
  res.status(400).json({error:"运行时任务请求无效。"});
});
const port=Number(process.env.ONEEARTH_RUNTIME_PORT || 5277);
app.listen(port,"127.0.0.1",()=>console.log("OneEarth runtime API listening on "+port));
