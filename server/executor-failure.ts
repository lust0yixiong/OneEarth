export type ExecutorFailureKind='schema'|'authentication'|'rate-limit'|'context-limit'|'network'|'timeout'|'aborted'|'output-limit'|'spawn'|'unknown';
export type ExecutorDiagnostic={kind:ExecutorFailureKind;exitCode:number|null;signal:string|null;elapsedMs:number;outputChars:number;diagnosticTailChars:number};
export class ExecutorFailure extends Error {
  readonly code:string;
  constructor(readonly diagnostic:ExecutorDiagnostic){
    const kind=diagnostic.kind;
    super(kind==='schema'?'当前回答格式与模型接口不兼容，暂未生成答复。':kind==='authentication'?'执行器未通过认证，请检查本机登录状态。':kind==='rate-limit'?'模型服务当前限流，可稍后按原条件重试。':kind==='context-limit'?'本轮材料超过模型可处理的范围，暂未生成答复。':kind==='timeout'?'模型请求超时，可按原条件重试。':kind==='aborted'?'本轮模型请求已中止。':kind==='output-limit'?'模型回复超出本轮处理范围，可按原条件重试。':kind==='spawn'?'无法启动所选执行器，请检查本机安装与可执行权限。':'模型请求未完成，可按原条件重试。');
    this.code='EXECUTOR_'+kind.toUpperCase().replace(/-/g,'_');
  }
}
function errorLines(stderr:string,stdout:string){
  // CLI prompts and generated scientific prose are not process error diagnostics.
  const lines:string[]=[];
  for(const raw of (stderr+'\n'+stdout).split('\n')){
    const line=raw.replace(/\x1b\[[0-9;]*m/g,'').trim();
    if(/^(?:ERROR|Error|error|fatal)\s*[:\[]/.test(line))lines.push(line);
    else if(line.startsWith('{'))try{
      const event=JSON.parse(line);
      if(event.type==='error'&&typeof event.message==='string')lines.push(event.message);
      else if(event.type==='turn.failed'&&typeof event.error?.message==='string')lines.push(event.error.message);
    }catch{}
    else if(/^(?:You are not logged in|Not logged in|Authentication failed|Unauthorized)\b/i.test(line))lines.push(line);
  }
  return lines.join('\n');
}
export function executorDiagnostic(input:{exitCode:number|null;signal:string|null;elapsedMs:number;stdout:string;stderr:string;aborted?:boolean;outputLimited?:boolean;spawnFailed?:boolean;timedOut?:boolean}):ExecutorDiagnostic {
 const text=errorLines(input.stderr,input.stdout);
 const kind:ExecutorFailureKind=input.aborted?'aborted':input.outputLimited?'output-limit':input.spawnFailed?'spawn':input.timedOut?'timeout':input.signal?'unknown':
  /\b(?:invalid_json_schema|invalid schema for response_format|schema\.required)\b/i.test(text)?'schema':
  /\b(?:unauthorized|authentication failed|not logged in|invalid[_ -]api[_ -]key|invalid[_ -]token|refresh[_ -]token[_ -](?:expired|reused)|401\s*Unauthorized)\b/i.test(text)?'authentication':
  /\b(?:429|too many requests|rate[_ -]?limit(?:[_ -]exceeded)?|quota exceeded|insufficient_quota|usage[_ -]limit(?:[_ -]reached)?)\b/i.test(text)?'rate-limit':
  /\b(?:context[_ -](?:length|window|limit)|maximum context|context_length_exceeded|input too long|too many (?:input )?tokens|token[_ -]limit[_ -]exceeded)\b/i.test(text)?'context-limit':
  /\b(?:connection (?:reset|refused)|stream disconnected|timed? out|network error|ECONNRESET|ECONNREFUSED|ENOTFOUND|ETIMEDOUT)\b/i.test(text)?'network':'unknown';
 return {kind,exitCode:input.exitCode,signal:input.signal,elapsedMs:input.elapsedMs,outputChars:input.stdout.length,diagnosticTailChars:input.stderr.length};
}
