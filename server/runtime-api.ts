import { resultSnapshots } from "./result-snapshots";
import { releaseVersion } from "./version";
import express from "express";
import path from "node:path";
import { mkdirSync } from "node:fs";
import { accessGuard } from "./access";
import { validateTurn } from "./runtime-input";
import { taskRoutes } from "./task-store";
import { postgresTaskStore } from "./postgres-task-store";
import {runtimePaperRoutes} from "./runtime-paper-routes";
import { queryHainaCatalog, queryPapers } from "./discovery-a2a-client";
import { runtimeWorkbenchQueries } from "./runtime-workbench-queries";
import {authorizeObservationDigest} from "./observation-execution";
import {prepareObservationInput,hasObservationCheck,recoverObservationRecord} from "./runtime-observation";
import {hasObservationResearch,prepareObservationResearch,observationMaterialsRoutes} from "./runtime-observation-authority";
import {recoverObservationResearchRecord} from "./runtime-observation-research";

const state=process.env.ONEEARTH_STATE_DIR || path.resolve(".local/state");
mkdirSync(state,{recursive:true,mode:0o700});
const tasks=await postgresTaskStore("runtime");
const app=express();
app.disable("x-powered-by");
app.use(accessGuard());
// Spatial and feed routes parse their own payload sizes and stream formats.
app.use(runtimeWorkbenchQueries(state, queryPapers, queryHainaCatalog));
app.use("/api/results",await resultSnapshots());
app.use(express.json({limit:"256kb"}));
app.use("/api/paper-records",runtimePaperRoutes());
app.use(observationMaterialsRoutes());
app.get("/api/health",(_req,res)=>res.json({status:"ok",service:"runtime",version:releaseVersion}));
taskRoutes(app,"/api/tasks",tasks,input=>validateTurn(tasks,input),
  {researchRecords:true,prepareWhen:input=>hasObservationCheck(input)||hasObservationResearch(tasks,input),
    prepare:(id,input)=>hasObservationCheck(input)?prepareObservationInput(tasks,id,input,authorizeObservationDigest):prepareObservationResearch(tasks,id,input),
    recoverRecord:async task=>(await recoverObservationRecord(tasks,task))??recoverObservationResearchRecord(tasks,task)});
app.use((_error:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{
  res.status(400).json({error:"运行时任务请求无效。"});
});
const port=Number(process.env.ONEEARTH_RUNTIME_PORT || 5277);
app.listen(port,"127.0.0.1",()=>console.log("OneEarth runtime API listening on "+port));
