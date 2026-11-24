import {requestPerformance,type ExecutorTiming} from './request-performance';
import {ExecutorFailure,executorDiagnostic} from "./executor-failure";
import { configureService } from "./model-service";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {resolvedChatModel, type ChatModel} from "../src/domain/chat-model";
import {assertModelContextSafe,modelSafeText} from "./model-context-safety";
import https from "node:https";
import {providerReasoningRelay,publicFlashResponses} from "./provider-reasoning-relay";
import {isolateProviderCli} from "./provider-cli-isolation";
import type {ProviderReasoningSink} from "./provider-reasoning";

export interface ExecutorOptions {
  webSearch?: true;
  outputSchema?: Record<string, unknown>;
  providerReasoning?: ProviderReasoningSink;
}

export function createModelExecutor(configure = configureService,providerTransport?:typeof https.request) {
  const slots = {active:0};
  return (config:ChatModel,prompt:string,signal:AbortSignal,options?:ExecutorOptions) =>
    executeModel(config,prompt,signal,options,configure,slots,providerTransport??https.request);
}

export const runExecutor = createModelExecutor();

async function executeModel(config:ChatModel,prompt:string,signal:AbortSignal,options:ExecutorOptions|undefined,
  configure:typeof configureService,slots:{active:number},providerTransport:typeof https.request) {
  if(options?.webSearch && (config.executor!=="codex" || (config.provider && config.provider!=="native")))
    throw Error("当前执行器未接入原生联网检索。");
  prompt=modelSafeText(prompt);
  assertModelContextSafe(prompt);
  const schema=options?.outputSchema?modelSafeText(JSON.stringify(options.outputSchema)):undefined;
  if(schema!==undefined)assertModelContextSafe(schema);
  config=resolvedChatModel(config);
  if(slots.active>=10) throw Error("模型执行器正在处理其他请求，请稍后重试。");
  const timing:ExecutorTiming={kind:'model-executor',model:config.model,executor:config.executor,startedAt:Date.now(),activeAtStart:slots.active,localQueueMs:0,
    elapsedMs:0,promptBytes:Buffer.byteLength(prompt),outputBytes:0};
  slots.active++;
  let dir:string|undefined;
  let relay:Awaited<ReturnType<typeof providerReasoningRelay>>|undefined;
  try {
    dir=await mkdtemp(path.join(tmpdir(),"oneearth-chat-"));
    const args=config.executor==="codex"
      ? ["exec","--ignore-user-config","--ephemeral","--skip-git-repo-check","-s","read-only","--disable","shell_tool","--disable","unified_exec","--disable","plugins","--disable","multi_agent"]
      : ["--safe-mode","-p","--tools","","--strict-mcp-config","--mcp-config",'{"mcpServers":{}}',"--no-session-persistence","--disable-slash-commands","--setting-sources","user","--output-format","text"];
    if(options?.webSearch){args.unshift("--search");args.push("--json");}
    if(schema!==undefined && config.executor==="codex" && (!config.provider || config.provider==="native")){
      const schemaPath=path.join(dir,"answer-schema.json");
      await writeFile(schemaPath,schema);
      args.push("--output-schema",schemaPath);
    }
    const env:NodeJS.ProcessEnv = {};
    for (const [name,value] of Object.entries(process.env)) {
      if (/^(?:HOME|PATH|SHELL|USER|LOGNAME|TMPDIR|LANG|LC_[A-Z_]+|XDG_[A-Z_]+|CODEX_HOME|CLAUDE_CONFIG_DIR|OPENAI_API_KEY|ANTHROPIC_[A-Z_]+|HTTPS?_PROXY|NO_PROXY|NODE_EXTRA_CA_CERTS)$/.test(name)) env[name]=value;
    }
    configure(config,args,env);
    if(options?.providerReasoning&&publicFlashResponses(config)){
      const key=env.ONEEARTH_EXECUTOR_KEY;
      if(!key)throw Error("The authorized model service is unavailable.");
      // Qualification uses the original server-pinned provider, never a local
      // endpoint claimed by the browser. The temporary token cannot reach it.
      relay=await providerReasoningRelay(key,options.providerReasoning,signal,prompt,providerTransport);
      const base='model_providers.oneearth_service.base_url="https://api.deepseek.com"';
      if(args.filter(arg=>arg===base).length!==1)throw Error("The authorized provider configuration could not be verified.");
      args[args.indexOf(base)]="model_providers.oneearth_service.base_url="+JSON.stringify(relay.baseUrl);
      env.ONEEARTH_EXECUTOR_KEY=relay.token;
      await isolateProviderCli(dir,args,env);
    }
    if(config.provider && config.provider!=="native" && !config.model)throw Error("请选择模型服务提供的模型。");
    if(config.model) args.push("--model",config.model);
    if(config.executor==="codex") args.push("-");
    return await new Promise<string>((resolve,reject)=>{
      signal.throwIfAborted();
      const child=spawn(config.executor,args,{cwd:dir,stdio:"pipe",env,signal,killSignal:"SIGKILL"});
      child.once('spawn',()=>{timing.spawnMs=Date.now()-timing.startedAt;});
      let out="",errors="",outputLimited=false,timedOut=false;const launched=Date.now();
      const deadline=setTimeout(()=>{timedOut=true;child.kill("SIGKILL");},110000);
      child.stdin.on("error",()=>{});
      child.stdout.on("data",chunk=>{timing.firstStdoutMs??=Date.now()-timing.startedAt;timing.outputBytes+=Buffer.byteLength(chunk);out+=chunk;if(out.length>150000){outputLimited=true;child.kill("SIGKILL");}});
      child.stderr.on("data",chunk=>{errors=(errors+chunk).slice(-4096);});
      child.on("error",()=>{clearTimeout(deadline);reject(new ExecutorFailure(executorDiagnostic({exitCode:null,signal:null,elapsedMs:Date.now()-launched,stdout:out,stderr:errors,aborted:signal.aborted,spawnFailed:!signal.aborted})));});
      child.on("close",(code,killed)=>{
        clearTimeout(deadline);
        if(code===0) resolve(out.trim());
        else reject(new ExecutorFailure(executorDiagnostic({exitCode:code,signal:killed,elapsedMs:Date.now()-launched,stdout:out,stderr:errors,aborted:signal.aborted,outputLimited,timedOut})));
      });
      child.stdin.end(prompt);
    });
  } finally {timing.elapsedMs=Date.now()-timing.startedAt;requestPerformance.getStore()?.push(timing);slots.active--;try{await relay?.close();}finally{if(dir) await rm(dir,{recursive:true,force:true});}}
}
