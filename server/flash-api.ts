import https from "node:https";
import {StringDecoder} from "node:string_decoder";
import {randomUUID} from "node:crypto";
import {ProviderReasoningObserver,type ProviderReasoningSink} from "./provider-reasoning";
import {providerCliInstructions,projectProviderRequest} from "./provider-cli-request";
import {modelSafeText,assertModelContextSafe} from "./model-context-safety";
import {ExecutorFailure,type ExecutorFailureKind} from "./executor-failure";
import type {ChatModel} from "../src/domain/chat-model";

export function authorizedFlashApi(config:ChatModel){return config.model==="deepseek-flash"&&(config.provider==="deepseek"||config.provider==="custom"&&config.endpoint==="https://api.deepseek.com");}
/** One HTTPS request, no CLI, provider tool, automatic retry, or fallback. */
export async function runFlashApi(prompt:string,key:string,signal:AbortSignal,options:{transport?:typeof https.request;reasoning?:ProviderReasoningSink;schema?:Record<string,unknown>}={}){
 signal.throwIfAborted();prompt=modelSafeText(prompt);assertModelContextSafe(prompt);
 if(options.schema)assertModelContextSafe(JSON.stringify(options.schema));
 if(!key)throw Error("The authorized model service is unavailable.");
 const wire=projectProviderRequest(Buffer.from(JSON.stringify({model:"deepseek-flash",stream:true,store:false,tools:[],tool_choice:"none",input:[
  {type:"message",role:"developer",content:[{type:"input_text",text:providerCliInstructions}]},
  {type:"message",role:"user",content:[{type:"input_text",text:prompt}]},
 ]})),undefined,prompt);
 assertModelContextSafe(wire.toString());
 const started=Date.now(),deadline=AbortSignal.any([signal,AbortSignal.timeout(110000)]);
 const fail=(kind:ExecutorFailureKind)=>new ExecutorFailure({kind,exitCode:null,signal:null,elapsedMs:Date.now()-started,outputChars:0,diagnosticTailChars:0});
 const observer=new ProviderReasoningObserver((options.reasoning?.taskId??"foreground")+":"+randomUUID(),value=>{if(!deadline.aborted)options.reasoning?.onSnapshot(value);});
 try{return await new Promise<string>((resolve,reject)=>{
  let completed=false,pending="",sequence=-1,size=0;const outputs=new Map<string,string>(),decoder=new StringDecoder("utf8");
  const transport=options.transport??https.request;
  const request=transport({protocol:"https:",hostname:"api.deepseek.com",port:443,path:"/responses",method:"POST",headers:{authorization:"Bearer "+key,"content-type":"application/json",accept:"text/event-stream","accept-encoding":"identity","content-length":wire.length},signal:deadline},response=>{
   if(response.statusCode!==200){response.resume();reject(fail(response.statusCode===401||response.statusCode===403?"authentication":response.statusCode===429?"rate-limit":"network"));return;}
   if(String(response.headers["content-type"]||"").split(";")[0].trim()!=="text/event-stream"||response.headers["content-encoding"]&&response.headers["content-encoding"]!=="identity"){
    response.destroy();reject(fail("network"));return;
   }
   function frame(text:string){
    const raw=text.split(/\r?\n/u).filter(line=>line.startsWith("data:")).map(line=>line.slice(5).trimStart()).join("\n");
    if(!raw||raw==="[DONE]")return;
    const event=JSON.parse(raw);
    if(typeof event.type!=="string")throw fail("schema");
    if(event.sequence_number!==undefined){if(!Number.isSafeInteger(event.sequence_number)||event.sequence_number<=sequence)throw fail("schema");sequence=event.sequence_number;}
    if(event.type==="response.output_text.delta"||event.type==="response.output_text.done"){
     if(typeof event.item_id!=="string"||!Number.isSafeInteger(event.output_index)||event.output_index<0||!Number.isSafeInteger(event.content_index)||event.content_index<0||typeof (event.type.endsWith(".delta")?event.delta:event.text)!=="string")throw fail("schema");
     const id=event.output_index+":"+event.item_id+":"+event.content_index,old=outputs.get(id)||"",value=event.type.endsWith(".delta")?old+event.delta:event.text;
     if(typeof value!=="string"||event.type.endsWith(".done")&&!value.startsWith(old))throw fail("schema");
     size+=value.length-old.length;if(size>150000)throw fail("output-limit");outputs.set(id,value);
    }else if(event.type==="response.completed"){
     if(event.response?.status&&event.response.status!=="completed")throw fail("unknown");
     if(!outputs.size){
      for(const [i,item] of (event.response?.output||[]).entries()){
       if(item.type!=="message")continue;
       const text=(item.content||[]).filter((part:any)=>part.type==="output_text").map((part:any)=>part.text).join("");
       if(typeof text!=="string")throw fail("schema");size+=text.length;if(size>150000)throw fail("output-limit");outputs.set(String(i),text);
      }
     }
     completed=true;
    }else if(["response.failed","response.incomplete","error"].includes(event.type))throw fail("unknown");
   }
   response.on("data",chunk=>{
    try{
     if(!observer.feed(Buffer.from(chunk)))throw fail("schema");
     pending+=decoder.write(chunk);
     for(;;){const boundary=/\r?\n\r?\n/u.exec(pending);if(!boundary)break;const text=pending.slice(0,boundary.index);pending=pending.slice(boundary.index+boundary[0].length);frame(text);}
     if(Buffer.byteLength(pending)>4*1024*1024)throw fail("output-limit");
    }catch(error){reject(error);response.destroy();request.destroy();}
   });
   response.on("error",()=>reject(fail(deadline.aborted?(signal.aborted?"aborted":"timeout"):"network")));
   response.on("end",()=>{
    if(deadline.aborted){reject(fail(signal.aborted?"aborted":"timeout"));return;}
    if(!completed||!outputs.size){reject(fail("network"));return;}
    const text=modelSafeText([...outputs.values()].join("\n")).trim();
    try{assertModelContextSafe(text);if(!text)throw fail("schema");resolve(text);}catch(error){reject(error);}
   });
  });
  request.on("error",()=>reject(fail(deadline.aborted?(signal.aborted?"aborted":"timeout"):"network")));
  request.end(wire);
 });}finally{observer.close();}
}
