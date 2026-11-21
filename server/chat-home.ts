import {Router} from "express";
import {createHash,randomUUID} from "node:crypto";
import {mkdirSync,readFileSync,writeFileSync,renameSync,rmSync} from "node:fs";
import path from "node:path";
import {defaultHomeQuestions,parseHomeQuestions} from "../src/domain/chat-home";

export function chatHomeSettings(filename:string){
  const router=Router();
  function read(){
    let questions:string[];
    try{questions=parseHomeQuestions(JSON.parse(readFileSync(filename,"utf8")).questions);}
    catch(error){
      if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;
      questions=[...defaultHomeQuestions];
    }
    return {questions,revision:createHash("sha256").update(JSON.stringify(questions)).digest("hex")};
  }
  router.get("/",(_req,res)=>{
    try{res.set("Cache-Control","no-store").json(read());}
    catch{res.status(500).json({error:"无法读取首页问题配置，请稍后重试。"});}
  });
  router.put("/",(req,res)=>{
    if(!req.is("application/json")){res.status(403).json({error:"请通过设置页面保存首页问题。"});return;}
    let questions:string[];
    try{
      questions=parseHomeQuestions(req.body?.questions);
      if(typeof req.body.revision!=="string" || !/^[a-f0-9]{64}$/.test(req.body.revision))throw Error("配置版本无效，请重新读取后保存。");
    }catch(error){res.status(400).json({error:error instanceof Error?error.message:"首页问题格式无效。"});return;}
    const temporary=filename+"."+randomUUID();
    try{
      if(read().revision!==req.body.revision){res.status(409).json({error:"其他页面已更新首页问题，请取消修改后重新编辑。"});return;}
      mkdirSync(path.dirname(filename),{recursive:true});
      writeFileSync(temporary,JSON.stringify({questions},null,2)+"\n",{mode:0o600});
      renameSync(temporary,filename);
      res.set("Cache-Control","no-store").json(read());
    }catch{res.status(500).json({error:"首页问题保存失败，请稍后重试。"});}
    finally{rmSync(temporary,{force:true});}
  });
  return router;
}
