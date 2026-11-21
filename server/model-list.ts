import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { createInterface } from "node:readline";
import { validChatModel, type ChatModel } from "../src/domain/chat-model";

type Executor = ChatModel["executor"];
type Choice = {id:string; label:string};
const pending = new Map<Executor, Promise<Choice[]>>();

export function listModels(executor:Executor) {
  const existing = pending.get(executor);
  if (existing) return existing;
  const job = readList(executor).finally(()=>pending.delete(executor));
  pending.set(executor,job);
  return job;
}

function readList(executor:Executor):Promise<Choice[]> {
  return new Promise((resolve,reject)=>{
    const codex = executor === "codex";
    const args = codex ? ["app-server","--stdio"] : ["--safe-mode","-p","--verbose","--input-format","stream-json","--output-format","stream-json","--tools","","--strict-mcp-config","--setting-sources","user","--no-session-persistence"];
    const child = spawn(executor,args,{cwd:tmpdir(),stdio:["pipe","pipe","ignore"],env:{...process.env,CLAUDECODE:undefined}});
    const lines = createInterface({input:child.stdout});
    const choices = new Map<string,Choice>();
    const cursors = new Set<string>();
    const timer = setTimeout(()=>finish("读取模型列表超时。"),20000);
    let done=false;
    function finish(error?:string) {
      if(done)return;
      done=true;
      clearTimeout(timer);
      lines.close();
      child.kill("SIGKILL");
      if(error)reject(Error(error));
      else resolve([...choices.values()]);
    }
    const send=(value:unknown)=>child.stdin.write(JSON.stringify(value)+"\n");
    child.stdin.on("error",()=>finish("执行器连接中断。"));
    child.on("error",()=>finish("无法启动执行器，请检查本机安装。"));
    child.on("close",()=>finish("执行器未返回模型列表。"));
    lines.on("line",line=>{
      try {
        const reply=JSON.parse(line);
        if(codex && reply.id===1 && !reply.error){
          send({method:"initialized"});
          send({method:"model/list",id:2,params:{limit:100}});
          return;
        }
        if(codex ? reply.id!==2 && reply.id!==1 : reply.type!=="control_response" || reply.response?.request_id!=="models")return;
        const rows=codex ? reply.result?.data : reply.response?.response?.models;
        if(!Array.isArray(rows))return finish("执行器未提供模型清单，请检查登录配置。");
        for(const row of rows) {
          const id=codex ? row.model : row.value;
          if(!id || row.hidden || id==="default" || !validChatModel({executor,model:id}))continue;
          choices.set(id,{id,label:typeof row.displayName==="string"?row.displayName:id});
        }
        const cursor=codex && reply.result?.nextCursor;
        if(cursor){
          if(cursors.has(cursor))return finish("模型列表分页异常。");
          cursors.add(cursor);
          send({method:"model/list",id:2,params:{limit:100,cursor}});
        } else finish();
      } catch { finish("执行器返回了无法读取的模型列表。"); }
    });
    send(codex ? {method:"initialize",id:1,params:{clientInfo:{name:"oneearth",version:"1"}}}
      : {type:"control_request",request_id:"models",request:{subtype:"initialize"}});
  });
}
