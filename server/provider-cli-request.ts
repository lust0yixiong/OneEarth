import {gunzipSync} from "node:zlib";
import {assertModelContextSafe} from "./model-context-safety";

export const providerCliInstructions =
  "You are a research synthesis assistant. Answer the provided task using only the supplied materials. Do not invoke tools or external sources. Follow the response contract in the task.";

const wireLimit=1024*1024;
const knownTools=new Set(["request_user_input","view_image"]);
const supportedKeys=new Set(["model","stream","input","tools","tool_choice","parallel_tool_calls","reasoning",
  "store","include","prompt_cache_key","client_metadata","max_output_tokens","temperature","top_p","text"]);
const hostPath=/(?:file:\/\/|(?:^|[\s"'=:])\/(?:Users|home|private\/var|var\/folders|tmp\/oneearth-chat|Volumes)\/|https?:\/\/(?:localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+)(?=[:/]|$))/i;

function reject():never {
  throw Error("The model CLI request did not match the isolated provider contract.");
}

function record(value:unknown):Record<string,unknown> {
  if(!value||typeof value!=="object"||Array.isArray(value))return reject();
  return value as Record<string,unknown>;
}

/** Reads only the encodings used by the Responses CLI. */
export function decodeProviderCliRequest(bytes:Buffer,encoding?:string):unknown {
  if(bytes.length>wireLimit)return reject();
  try {
    const kind=(encoding??"identity").trim().toLowerCase();
    const decoded=kind==="identity"||kind===""?bytes:kind==="gzip"?gunzipSync(bytes,{maxOutputLength:wireLimit}):reject();
    return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(decoded));
  } catch {
    return reject();
  }
}

function messageTexts(input:unknown) {
  if(!Array.isArray(input)||input.length>8)return reject();
  return input.flatMap(value=>{
    const row=record(value);
    if(row.type!=="message"||!["developer","user"].includes(String(row.role))||
      !Array.isArray(row.content)||row.content.length<1||row.content.length>4)return reject();
    return row.content.map(value=>{
      const part=record(value);
      if(part.type!=="input_text"||typeof part.text!=="string")return reject();
      return {role:row.role,text:part.text};
    });
  });
}

function knownLocalContext(role:unknown,text:string) {
  if(role==="developer"){
    return text.trim()===providerCliInstructions||
      /^<permissions instructions>\s*[\s\S]*<\/permissions instructions>$/u.test(text.trim())||
      (/^<skills_instructions>\s*[\s\S]*<\/skills_instructions>$/u.test(text.trim())&&text.includes("### Available skills"));
  }
  return /^<environment_context>\s*[\s\S]*<\/environment_context>$/u.test(text.trim())&&text.includes("<cwd>");
}

function cleanToolList(value:unknown) {
  if(value===undefined)return;
  if(!Array.isArray(value)||value.length>knownTools.size)return reject();
  const seen=new Set<string>();
  for(const entry of value){
    const tool=record(entry),name=tool.name;
    if(tool.type!=="function"||typeof name!=="string"||!knownTools.has(name)||seen.has(name))return reject();
    seen.add(name);
  }
  return value;
}

/**
 * The executor supplies the exact stdin. Codex can append local skills and
 * environment messages even with an empty profile. Only its known local
 * envelopes may be dropped, and the original prompt must be present exactly
 * once. Neither of the two optional CLI declarations is a tool authorization.
 */
export function projectProviderRequest(bytes:Buffer,encoding:string|undefined,expectedPrompt:string):Buffer {
  const request=record(decodeProviderCliRequest(bytes,encoding));
  if(!expectedPrompt||request.model!=="deepseek-flash"||request.stream!==true||
    Object.keys(request).some(key=>!supportedKeys.has(key)))return reject();
  const input=messageTexts(request.input);
  const matching=input.filter(({role,text})=>role==="user"&&text===expectedPrompt);
  if(matching.length!==1||input.some(({role,text})=>!(role==="user"&&text===expectedPrompt)&&!knownLocalContext(role,text)))return reject();
  const tools=cleanToolList(request.tools);
  const {client_metadata:_client,prompt_cache_key:_cache,include:_include,input:_input,...parameters}=request;
  const forwarded={...parameters,tools,store:false,input:[
    {type:"message",role:"developer",content:[{type:"input_text",text:providerCliInstructions}]},
    {type:"message",role:"user",content:[{type:"input_text",text:expectedPrompt}]},
  ]};
  const result=JSON.stringify(forwarded);
  assertModelContextSafe(expectedPrompt);
  assertModelContextSafe(result);
  if(hostPath.test(expectedPrompt)||hostPath.test(result))return reject();
  return Buffer.from(result);
}
