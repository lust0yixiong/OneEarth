import {requestPerformance,type ExecutorTiming} from './request-performance';
import {ExecutorFailure,executorDiagnostic} from "./executor-failure";
import { configureService } from "./model-service";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {nativeCodexSummaryModel, resolvedChatModel, type ChatModel} from "../src/domain/chat-model";
import {assertModelContextSafe,modelSafeText} from "./model-context-safety";
import https from "node:https";
import {providerReasoningRelay,publicFlashResponses} from "./provider-reasoning-relay";
import {isolateProviderCli} from "./provider-cli-isolation";
import {runtimeModelCapacity,runtimeLeaseMs} from "./runtime-model-capacity";
import {assertRuntimeModelRequestSize,type ReserveModelRequest} from "./runtime-model-budget";
import {modelExecutionContext} from "./model-execution-context";
import {authorizedFlashApi,runFlashApi} from "./flash-api";
import type {ProviderReasoningSink} from "./provider-reasoning";
import {CodexSummaryOutput} from "./codex-summary-output";

export interface ExecutorOptions {
  publicText?:{onDelta:(delta:string)=>void};
  singleRequest?:boolean;
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
  const execution=modelExecutionContext.getStore();
  if(options?.publicText&&(!authorizedFlashApi(config)||execution?.role!=="foreground"))throw Error("此模型尚未接入经过审核的公开正文增量通道。");
  const capacity=runtimeModelCapacity();
  const resource=capacity?await (await capacity).acquire(execution?.role??"background",execution?.taskId):undefined;
  const ownership=new AbortController();signal=AbortSignal.any([signal,ownership.signal]);
  let lost:ReturnType<typeof setTimeout>|undefined,checking=false;
  const reset=()=>{clearTimeout(lost);lost=setTimeout(()=>ownership.abort(Error("模型容量租约已失效。")),runtimeLeaseMs-1000);lost.unref();};
  if(resource)reset();
  const heartbeat=resource?setInterval(async()=>{if(checking)return;checking=true;try{if(await resource.renew())reset();else ownership.abort(Error("模型容量租约已失效。"));}catch{ownership.abort(Error("模型容量租约无法续期。"));}finally{checking=false;}},5000):undefined;
  heartbeat?.unref();
  if(slots.active>=10&&!resource) throw Error("模型执行器正在处理其他请求，请稍后重试。");
  const timing:ExecutorTiming={kind:'model-executor',model:config.model,executor:config.executor,startedAt:Date.now(),activeAtStart:slots.active,localQueueMs:0,
    elapsedMs:0,promptBytes:Buffer.byteLength(prompt),outputBytes:0};
  slots.active++;
  const reserveRequest:ReserveModelRequest|undefined=execution?.taskId?async (body,kind)=>{
    signal.throwIfAborted();
    assertRuntimeModelRequestSize(body.length);
    const reservation=await resource?.reserveRequest(body,kind);
    signal.throwIfAborted();
    return reservation;
  }:undefined;
  let dir:string|undefined;
  let relay:Awaited<ReturnType<typeof providerReasoningRelay>>|undefined;
  try {
    if(modelExecutionContext.getStore()?.role==="foreground"&&authorizedFlashApi(config)){
      if(options?.webSearch)throw Error("前台模型未获准直接调用网络工具。");
      const args:string[]=[],env:NodeJS.ProcessEnv={};configure(config,args,env);
      const key=env.ONEEARTH_EXECUTOR_KEY||env.ANTHROPIC_API_KEY;
      if(!key)throw Error("The authorized model service is unavailable.");
      timing.transport="api";
      const value=await runFlashApi(prompt,key,signal,{transport:providerTransport,reasoning:options?.providerReasoning,schema:options?.outputSchema,onOutputDelta:options?.publicText?.onDelta,reserveRequest});
      timing.outputBytes=Buffer.byteLength(value);return value;
    }
    timing.transport="cli";
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
    if((options?.providerReasoning||options?.singleRequest||modelExecutionContext.getStore()?.role==="background")&&publicFlashResponses(config)){
      const key=env.ONEEARTH_EXECUTOR_KEY;
      if(!key)throw Error("The authorized model service is unavailable.");
      // Qualification uses the original server-pinned provider, never a local
      // endpoint claimed by the browser. The temporary token cannot reach it.
      const background=options?.singleRequest===true||modelExecutionContext.getStore()?.role==="background";
      relay=await providerReasoningRelay(key,options?.providerReasoning??{taskId:execution?.taskId??"single-model-request",onSnapshot:()=>{}},signal,prompt,providerTransport,{maxRequests:background?1:4,reserveRequest});
      if(background)args.push("-c","model_providers.oneearth_service.request_max_retries=0","-c","model_providers.oneearth_service.stream_max_retries=0");
      const base='model_providers.oneearth_service.base_url="https://api.deepseek.com"';
      if(args.filter(arg=>arg===base).length!==1)throw Error("The authorized provider configuration could not be verified.");
      args[args.indexOf(base)]="model_providers.oneearth_service.base_url="+JSON.stringify(relay.baseUrl);
      env.ONEEARTH_EXECUTOR_KEY=relay.token;
      await isolateProviderCli(dir,args,env);
    }
    if(config.provider && config.provider!=="native" && !config.model)throw Error("请选择模型服务提供的模型。");
    const summaryOutput=options?.providerReasoning&&!options.webSearch&&nativeCodexSummaryModel(config)
      ? new CodexSummaryOutput(options.providerReasoning) : undefined;
    if(summaryOutput)args.push("--json","-c",'model_reasoning_summary="auto"');
    if(config.model) args.push("--model",config.model);
    if(config.executor==="codex") args.push("-");
    if(!relay&&reserveRequest)
      await reserveRequest(Buffer.from(JSON.stringify({prompt,outputSchema:schema,webSearch:options?.webSearch})),"cli-visible-input");
    return await new Promise<string>((resolve,reject)=>{
      signal.throwIfAborted();
      const child=spawn(config.executor,args,{cwd:dir,stdio:"pipe",env,signal,killSignal:"SIGKILL"});
      child.once('spawn',()=>{timing.spawnMs=Date.now()-timing.startedAt;});
      let out="",errors="",outputLimited=false,timedOut=false,settled=false;const launched=Date.now();
      let exit: {code:number|null;signal:NodeJS.Signals|null}|undefined;
      const deadline=setTimeout(()=>{timedOut=true;child.kill("SIGKILL");},110000);
      const finish=(code:number|null,killed:NodeJS.Signals|null,spawnFailed=false,startupError?:Error)=>{
        if(settled)return;
        settled=true;
        clearTimeout(deadline);
        signal.removeEventListener("abort",finishCancelledExit);
        if(startupError && !signal.aborted)reject(startupError);
        else if(code===0 && !signal.aborted&&!outputLimited){
          const answer=summaryOutput?.finish()??out.trim();
          if(summaryOutput&&!answer)reject(Error("Codex 未返回完整的答复事件。"));
          else resolve(answer);
        }
        else reject(new ExecutorFailure(executorDiagnostic({exitCode:code,signal:killed,elapsedMs:Date.now()-launched,
          stdout:out,stderr:errors,aborted:signal.aborted,outputLimited,timedOut,spawnFailed})));
      };
      function finishCancelledExit(){
        if(!exit || !signal.aborted || settled)return;
        // The killed CLI can exit while another process still holds its pipes.
        child.stdin.destroy();
        child.stdout.destroy();
        child.stderr.destroy();
        finish(exit.code,exit.signal);
      }
      child.stdin.on("error",()=>{});
      child.stdout.on("data",(chunk:Buffer)=>{
        if(outputLimited||signal.aborted)return;
        timing.firstStdoutMs??=Date.now()-timing.startedAt;
        timing.outputBytes+=chunk.length;
        if(!summaryOutput)out+=chunk;
        if(summaryOutput?!summaryOutput.feed(chunk):out.length>150000){outputLimited=true;child.kill("SIGKILL");}
      });
      child.stderr.on("data",chunk=>{errors=(errors+chunk).slice(-4096);});
      child.on("error",()=>{if(!child.pid)finish(null,null,!signal.aborted);});
      child.once("exit",(code,killed)=>{
        exit={code,signal:killed};
        finishCancelledExit();
      });
      child.once("close",finish);
      signal.addEventListener("abort",finishCancelledExit,{once:true});
      void (async()=>{
        if(resource){if(!child.pid)throw Error("模型子进程未建立。");await resource.attachProcess(child.pid);}
        signal.throwIfAborted();
        child.stdin.end(prompt);
      })().catch(()=>{
        if(settled)return;
        child.kill("SIGKILL");
        if(!signal.aborted)finish(null,null,false,Error("模型执行容量或子进程归属无法确认，未发送提示。"));
      });
    });
  } finally {clearTimeout(lost);clearInterval(heartbeat);await resource?.release().catch(()=>{});timing.elapsedMs=Date.now()-timing.startedAt;requestPerformance.getStore()?.push(timing);slots.active--;try{await relay?.close();}finally{if(dir) await rm(dir,{recursive:true,force:true});}}
}
