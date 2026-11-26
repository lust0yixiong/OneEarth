import {discoveryDelegationLookupPath,discoveryRequestFingerprint} from "./discovery-request-fingerprint";
import {skillRequestKind,skillResultKind} from "./observation-check-contract";
import {observationResearchKind} from "./observation-research-contract";

export type DiscoverySubmissionIdentity = {
  messageId:string;
  kind:string;
  input:Record<string,unknown>;
  taskId?:string;
};
export type DiscoveryRecovery = {state:"accepted";taskId:string}|{state:"missing"}|{state:"unknown"};

/** Only the identified receiver can attest whether replay is safe. */
export async function lookupDiscoveryDelegation(base:string,identity:DiscoverySubmissionIdentity,signal:AbortSignal,
  {token=process.env.ONEEARTH_DISCOVERY_RECOVERY_TOKEN,fetcher=fetch,timeoutMs=2000}:
    {token?:string;fetcher?:typeof fetch;timeoutMs?:number}={}):Promise<DiscoveryRecovery>{
  signal.throwIfAborted();
  if(!token || token.length<32)return {state:"unknown"};
  const url=URL.parse(base);
  if(!url||url.protocol!=="http:"||url.hostname!=="127.0.0.1"||url.username||url.password)return {state:"unknown"};
  const {messageId,kind,input,taskId}=identity;
  const observation=kind===skillRequestKind||kind===skillResultKind||kind===observationResearchKind;
  const headers:Record<string,string>={
    Authorization:"Bearer "+token,
    "X-OneEarth-Request-Fingerprint":discoveryRequestFingerprint(kind,input,taskId),
  };
  if(observation)headers["X-OneEarth-Delegation-Family"]="observation";
  try{
    const endpoint=new URL(discoveryDelegationLookupPath+"/"+encodeURIComponent(messageId),url);
    const response=await fetcher(endpoint,{method:"GET",headers,redirect:"error",
      signal:AbortSignal.any([signal,AbortSignal.timeout(timeoutMs)])});
    if(response.status!==200&&response.status!==404){await response.body?.cancel();return {state:"unknown"};}
    const receipt=await response.json();
    signal.throwIfAborted();
    if(receipt?.idempotentReplay!==true)return {state:"unknown"};
    if(response.status===404&&receipt.code==="DELEGATION_NOT_FOUND")return {state:"missing"};
    if(response.status===200&&typeof receipt.taskId==="string"&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(receipt.taskId)&&
        (!taskId||receipt.taskId===taskId))return {state:"accepted",taskId:receipt.taskId};
    return {state:"unknown"};
  }catch{
    signal.throwIfAborted();
    return {state:"unknown"};
  }
}
