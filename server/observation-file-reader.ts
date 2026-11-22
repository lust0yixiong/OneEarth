import {access,stat} from "node:fs/promises";
import path from "node:path";
import {setTimeout as wait} from "node:timers/promises";
import {readObservationArtifact,ObservationArtifactError} from "./observation-artifacts";
import {observationId,parseObservationReadTarget} from "./observation-check-contract";

async function awaitReceiptRelease(dir:string,callId:string) {
  if(!path.isAbsolute(dir)||!observationId(callId))throw new ObservationArtifactError("invalid_receipt_gate");
  const meta=await stat(dir);
  if(!meta.isDirectory()||(meta.mode&0o077)!==0||meta.uid!==process.getuid?.())
    throw new ObservationArtifactError("invalid_receipt_gate");
  const marker=path.join(dir,callId+".release");
  const deadline=performance.now()+23000;
  while(performance.now()<deadline){
    try{await access(marker);return;}catch(error){
      if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;
    }
    await wait(40);
  }
  throw new ObservationArtifactError("receipt_gate_timeout");
}

async function main(){
  const chunks:Buffer[]=[];
  let length=0;
  for await (const chunk of process.stdin) {
    const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);
    length+=bytes.length;
    if(length>4096)throw new ObservationArtifactError("reader_input");
    chunks.push(bytes);
  }
  const {check:raw,registry,sha256,callId,receiptGate}=JSON.parse(Buffer.concat(chunks).toString("utf8"));
  const check=parseObservationReadTarget(raw);
  if(!check||typeof registry!=="string"||typeof sha256!=="string")throw new ObservationArtifactError("reader_input");
  const evidence=await readObservationArtifact(check,registry,sha256);
  process.stdout.write(JSON.stringify({kind:"read",sha256:evidence.sha256})+"\n");
  // The optional private evidence barrier delays output while this reader still holds its process.
  if(receiptGate!==undefined)await awaitReceiptRelease(receiptGate,callId);
  process.stdout.write(JSON.stringify({kind:"result",evidence})+"\n");
}

void main().catch(error=>{
  process.stdout.write(JSON.stringify({kind:"result",reason:error instanceof ObservationArtifactError?error.reason:"artifact_unreadable"})+"\n");
});
