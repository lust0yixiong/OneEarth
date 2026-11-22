import {spawn} from "node:child_process";
import {fileURLToPath} from "node:url";
import {type ObservationReadTarget,type ObservationEvidence,type ObservationFailure,validObservationResult,validObservationEvidence} from "./observation-check-contract";

const reader=fileURLToPath(new URL("./observation-file-reader.ts",import.meta.url));
type Notify=(kind:string,detail:Record<string,unknown>)=>Promise<void>;

/** C is an isolated read-only method. Its process gets just the authorized registry and content identity. */
export type ObservationReadReceipt = {status:"read";evidence:ObservationEvidence}|ObservationFailure;

export async function executeObservationRead(check:ObservationReadTarget,registry:string,sha256:string,
  callId:string,parentSignal:AbortSignal,notify:Notify,requireModelGrant=false):Promise<ObservationReadReceipt>{
  const signal=AbortSignal.any([parentSignal,AbortSignal.timeout(25000)]);
  signal.throwIfAborted();
  const processEnv:NodeJS.ProcessEnv={LANG:"C.UTF-8"};
  if(process.env.TMPDIR)processEnv.TMPDIR=process.env.TMPDIR;
  const child=spawn(process.execPath,["--import","tsx",reader],{
    signal,killSignal:"SIGKILL",env:processEnv,stdio:["pipe","pipe","ignore"],
  });
  let bytes=0;
  const closed=new Promise<{code:number|null;error?:string}>(resolve=>{
    child.once("error",error=>resolve({code:null,error:error.name}));
    child.once("close",code=>resolve({code}));
  });
  child.stdin.on("error",()=>{});
  try{
    await notify("reader_spawned",{pid:child.pid,executor:"node-readonly"});
    child.stdin.end(JSON.stringify({check,registry,sha256,callId,requireModelGrant,receiptGate:process.env.ONEEARTH_SKILL_RECEIPT_GATE_DIR}));
    let buffer="",raw,resultReceived=false,read=false;
    child.stdout.setEncoding("utf8");
    for await(const chunk of child.stdout){
      bytes+=Buffer.byteLength(chunk);
      if(bytes>16384)throw Error("reader output limit");
      buffer+=chunk;
      for(;;){
        const newline=buffer.indexOf("\n");
        if(newline===-1)break;
        const frame=JSON.parse(buffer.slice(0,newline));
        buffer=buffer.slice(newline+1);
        if(frame.kind==="read"&&!read&&!resultReceived&&frame.sha256===sha256){
          read=true;
          await notify("file_read",{pid:child.pid,sha256,artifactId:check.artifactId,version:check.version,variable:check.variable});
        }else if(frame.kind==="result"&&!resultReceived){
          raw=frame;
          resultReceived=true;
        }else throw Error("invalid reader receipt");
      }
    }
    const outcome=await closed;
    signal.throwIfAborted();
    if(outcome.code!==0)return {status:"failed",reason:"reader_exit"};
    if(buffer||!raw)return {status:"failed",reason:"reader_output"};
    if(!raw.evidence){
      const failed={status:"failed",reason:raw.reason};
      return validObservationResult(failed)&&failed.status==="failed"?failed:{status:"failed",reason:"reader_output"};
    }
    const evidence:unknown=raw.evidence;
    if(!read||!validObservationEvidence(evidence)||evidence.sha256!==sha256||
       evidence.artifactId!==check.artifactId||evidence.version!==check.version||evidence.variable!==check.variable)
      return {status:"failed",reason:"reader_output"};
    return {status:"read",evidence};
  }catch(error){
    child.kill("SIGKILL");
    await closed;
    if(parentSignal.aborted)return {status:"cancelled",reason:"parent_cancelled"};
    if(signal.aborted)return {status:"unknown",reason:"reader_deadline"};
    throw error;
  }
}
