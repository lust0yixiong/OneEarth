import http from "node:http";
import https from "node:https";
import {once} from "node:events";
import {randomBytes,randomUUID} from "node:crypto";
import {gunzipSync} from "node:zlib";
import {ProviderReasoningObserver,type ProviderReasoningSink} from "./provider-reasoning";
import {assertModelContextSafe} from "./model-context-safety";
import type {ChatModel} from "../src/domain/chat-model";
import {projectProviderRequest} from "./provider-cli-request";

export function publicFlashResponses(config:ChatModel){
 return config.executor==="codex"&&config.model==="deepseek-flash"&&(config.provider==="deepseek"||config.provider==="custom"&&config.endpoint==="https://api.deepseek.com");
}
const maxBodyBytes=524288;
/** Inspect the final CLI wire without altering the actual model input. */
export function validProviderRequest(bytes:Buffer,encoding:string|undefined){
 const decoded=encoding==="gzip"?gunzipSync(bytes,{maxOutputLength:maxBodyBytes}):!encoding||encoding==="identity"?bytes:undefined;
 if(!decoded||decoded.length>maxBodyBytes)throw Error("Provider request refused.");
 const text=decoded.toString("utf8");assertModelContextSafe(text);const value=JSON.parse(text);
 if(value?.model!=="deepseek-flash"||value.stream!==true||value.store===true||value.previous_response_id||value.conversation||
  !Array.isArray(value.input)||!value.input.length||value.input.length>16)throw Error("Provider request refused.");
 for(const item of value.input){
  if(item?.type!=="message"||!["user","assistant","system","developer"].includes(item.role)||!Array.isArray(item.content)||!item.content.length||
   item.content.some((part:any)=>!["input_text","output_text"].includes(part?.type)||typeof part.text!=="string"||Object.keys(part).some(key=>!["type","text"].includes(key))))throw Error("Provider request refused.");
 }
 if(value.tools!==undefined&&(!Array.isArray(value.tools)||value.tools.length>2||new Set(value.tools.map((tool:any)=>tool?.name)).size!==value.tools.length||
  value.tools.some((tool:any)=>tool?.type!=="function"||!["request_user_input","view_image"].includes(tool.name))))throw Error("Provider request refused.");
 return true;
}

/** One authenticated loopback listener per actual CLI invocation. Production
 * always uses this pinned HTTPS origin; transport injection is server-only. */
export async function providerReasoningRelay(apiKey:string,sink:ProviderReasoningSink,signal:AbortSignal,expectedPrompt:string,transport:typeof https.request=https.request){
 signal.throwIfAborted();const token=randomBytes(32).toString("base64url"),attempt=randomUUID();
 const active=new Set<http.ClientRequest>(),observers=new Set<ProviderReasoningObserver>();let requests=0,closed=false;
 const server=http.createServer(async(req,res)=>{
  if(closed||signal.aborted||req.method!=="POST"||req.url!=="/responses"||req.headers.authorization!=="Bearer "+token){res.writeHead(403).end();return;}
  if(++requests>4){res.writeHead(429).end();return;}
  let bytes:Buffer=Buffer.alloc(0);
  try{for await(const chunk of req){if(bytes.length+chunk.length>maxBodyBytes)throw Error();bytes=Buffer.concat([bytes,chunk]);}
   bytes=projectProviderRequest(bytes,req.headers["content-encoding"] as string|undefined,expectedPrompt);
   validProviderRequest(bytes,undefined);
  }catch{res.writeHead(400).end('Provider request refused.');return;}
  if(closed||signal.aborted){res.destroy();return;}
  const observer=new ProviderReasoningObserver(sink.taskId+":"+attempt+":"+requests,sink.onSnapshot);observers.add(observer);
  let upstream:http.ClientRequest;
  try{upstream=transport({protocol:"https:",hostname:"api.deepseek.com",port:443,path:"/responses",method:"POST",headers:{authorization:"Bearer "+apiKey,"content-type":"application/json",accept:"text/event-stream","accept-encoding":"identity","content-length":bytes.length},signal},response=>{
    if(response.headers["content-encoding"]&&response.headers["content-encoding"]!=="identity"){response.destroy();res.writeHead(502).end("Unsupported provider response encoding.");return;}
    const streaming=response.statusCode===200&&String(response.headers["content-type"]||"").split(";")[0].trim()==="text/event-stream";
    res.writeHead(response.statusCode||502,{"content-type":response.headers["content-type"]||"application/octet-stream","cache-control":"no-store",...(response.headers["content-encoding"]?{"content-encoding":response.headers["content-encoding"]}:{})});
    response.on("data",chunk=>{if(streaming&&!observer.feed(Buffer.from(chunk))){response.destroy();upstream.destroy();res.destroy();return;}if(!res.write(chunk))response.pause();});
    res.on("drain",()=>response.resume());response.on("end",()=>res.end());response.on("error",()=>res.destroy());
   });}catch{observer.close();observers.delete(observer);res.writeHead(502).end();return;}
  active.add(upstream);upstream.on("error",()=>res.destroy());upstream.on("close",()=>{active.delete(upstream);observer.close();observers.delete(observer);});
  res.on("close",()=>{if(!res.writableEnded)upstream.destroy();});upstream.end(bytes);bytes=Buffer.alloc(0);
 });
 server.listen(0,"127.0.0.1");await once(server,"listening");const address=server.address();if(!address||typeof address==="string")throw Error("Provider listener unavailable.");
 const close=async()=>{if(closed)return;closed=true;signal.removeEventListener("abort",abort);for(const observer of observers)observer.close();observers.clear();for(const req of active)req.destroy();active.clear();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));};
 const abort=()=>{void close();};signal.addEventListener("abort",abort,{once:true});if(signal.aborted){await close();signal.throwIfAborted();}
 return {baseUrl:"http://127.0.0.1:"+address.port,token,close};
}
