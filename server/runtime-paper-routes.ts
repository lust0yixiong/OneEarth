import {Router} from "express";
import {gzipSync} from "node:zlib";
import {paperId} from "../src/domain/paper-record";
import {literatureDisplay} from "../src/domain/literature-label";
import {DiscoveryA2AError,queryPapers} from "./discovery-a2a-client";
import type {PaperQuery} from "./discovery-materials-contract";

/** Public catalogue requests never search private runtime research archives. */
export function runtimePaperRoutes(query:typeof queryPapers=queryPapers){
  const router=Router();
  async function send(req:import("express").Request,res:import("express").Response,input:PaperQuery,gzip=false){
    const controller=new AbortController();
    const close=()=>{if(!res.writableEnded)controller.abort();};res.once("close",close);
    try{
      const value=literatureDisplay(await query(input,controller.signal));
      res.set("Cache-Control","no-store");
      if(gzip&&req.acceptsEncodings("gzip"))res.vary("Accept-Encoding").type("application/json").set("Content-Encoding","gzip").send(gzipSync(JSON.stringify(value),{level:1}));
      else res.json(value);
    }catch(error){
      if(controller.signal.aborted)return;
      const status=error instanceof DiscoveryA2AError&&error.status&&[400,404,409,415,422,429].includes(error.status)?error.status:503;
      res.status(status).set("Cache-Control","no-store").json({error:error instanceof Error?error.message:"文献资料暂时无法读取。",
        ...(input.operation==="search"?{records:[]}:{})});
    }finally{res.off("close",close);}
  }
  router.get("/",async(req,res)=>{
    if(req.query.ids!==undefined){
      const ids=typeof req.query.ids==="string"?req.query.ids.split(","):[];
      if(!ids.length||ids.length>20||!ids.every(paperId)){res.sendStatus(400);return;}
      await send(req,res,{operation:"records",ids});return;
    }
    const cursor=req.query.cursor??"",limit=Number(req.query.limit??250);
    if(typeof cursor!=="string"||cursor.length>1000||!Number.isInteger(limit)||limit<1||limit>500){res.sendStatus(400);return;}
    const view=req.query.view==="map"?"map":req.query.view==="catalog"?"catalog":"full";
    await send(req,res,{operation:"list",view,cursor,limit},true);
  });
  router.get("/:id/evidence",async(req,res)=>{
    const id=String(req.params.id);if(!paperId(id)){res.sendStatus(404);return;}
    await send(req,res,{operation:"evidence",id});
  });
  router.get("/:id/questions",async(req,res)=>{
    const id=String(req.params.id),cursor=req.query.cursor||"";
    if(!paperId(id)||typeof cursor!=="string"||cursor.length>3000){res.sendStatus(400);return;}
    await send(req,res,{operation:"questions",id,cursor});
  });
  router.post("/search",async(req,res)=>{
    if(!req.is("application/json")){res.sendStatus(415);return;}
    const value=req.body?.query;
    if(typeof value!=="string"||!value.trim()||value.trim().length>240){res.status(400).json({error:"请输入数据集名称或 DOI（不超过 240 字）。"});return;}
    await send(req,res,{operation:"search",query:value.trim()});
  });
  return router;
}
