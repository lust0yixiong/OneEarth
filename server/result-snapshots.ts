import express from "express";
import { resultIdPattern,snapshotMaxBytes,validResultSnapshot } from "../src/domain/result-snapshot";
import { productDatabase } from "./product-database";

export async function resultSnapshots(){
  const database=productDatabase("RUNTIME");
  try{
    await database.query("CREATE TABLE IF NOT EXISTS result_snapshots (id uuid PRIMARY KEY, snapshot jsonb NOT NULL)");
  }catch(error){await database.end();throw error;}
  const router=express.Router();
  router.param("id",(_req,res,next,id)=>{
    if(!resultIdPattern.test(id)){res.status(400).json({error:"结果链接编号无效。"});return;}
    next();
  });
  router.get("/:id",async(req,res)=>{
    const row=(await database.query("SELECT snapshot FROM result_snapshots WHERE id=$1",[req.params.id])).rows[0];
    if(!row){res.status(404).json({error:"此服务没有该结果快照。"});return;}
    res.set("Cache-Control","no-store").json(row.snapshot);
  });
  router.put("/:id",express.json({limit:snapshotMaxBytes}),async(req,res)=>{
    if(!validResultSnapshot(req.body)){
      res.status(400).json({error:"结果快照的格式或范围无效。"});return;
    }
    const input=JSON.stringify(req.body);
    const prior=await database.query("INSERT INTO result_snapshots VALUES ($1,$2::jsonb) ON CONFLICT(id) DO NOTHING",
      [req.params.id,input]);
    if(prior.rowCount){res.sendStatus(201);return;}
    const row=(await database.query("SELECT snapshot=$2::jsonb AS equal FROM result_snapshots WHERE id=$1",[req.params.id,input])).rows[0];
    if(!row?.equal){res.status(409).json({error:"该编号已属于另一份结果。"});return;}
    res.sendStatus(200);
  });
  return {router,close:()=>database.end()};
}
