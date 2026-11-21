import type {SearchRun,ToolCall,WebHit} from "../src/domain/types";
import type {TurnPlan,TurnTarget} from "./turn-planning";
import {readOriginPage} from "./origin-page";
import {readPdfPage} from "./read-pdf-page";

/** Exact public identities only. The existing transport pins DNS and redirects.
 * No keyword lookup, library discovery or alternate-source substitution here. */
export async function readTurnSource(target:TurnTarget,question:string,signal:AbortSignal){
  const hit:WebHit={title:target.title,url:target.url!,snippet:"本轮指定的来源身份，尚未读取正文。"};
  const pdf=/\.pdf(?:\/content)?$/i.test(new URL(target.url!).pathname)||/\.pdf(?:$|[?#])/i.test(target.title);
  const page=new URL(target.url!).hash.match(/^#page=(\d+)$/)?.[1],focus=page?question+" 第 "+page+" 页":question;
  if(pdf)return {...await readPdfPage(hit,target.url!,signal,undefined,focus,question),engine:"PDF 原文" as const};
  try{
    const result=await readOriginPage(hit,target.url!,signal);
    return {...result,engine:"原站读取" as const,warning:result.warning.replace("DeepSeek Fetch 未取得正文，已从公开原站读取文本片段","按本轮指定对象读取公开原站文本片段")};
  }catch(error){
    signal.throwIfAborted();
    // A publisher's /content address can be PDF without a .pdf suffix.
    if(error instanceof Error&&error.message==="原站回退未取得 HTML 或纯文本正文。")
      return {...await readPdfPage(hit,target.url!,signal,undefined,focus,question),engine:"PDF 原文" as const};
    throw error;
  }
}

export async function readPlannedSources(plan:TurnPlan,question:string,signal:AbortSignal,deps:{
  read?:typeof readTurnSource;stage:(text:string,searches?:SearchRun[])=>void;report:(call:ToolCall)=>void;
}){
  if(plan.action!=="read")return [];
  const targets=[...new Map(plan.targets.filter(t=>t.url).map(t=>[t.url!,t])).values()].slice(0,3),runs:SearchRun[]=[];
  if(!targets.length)return runs;
  deps.stage("正在读取本轮指定的来源");
  await Promise.all(targets.map(async(target,i)=>{
    signal.throwIfAborted();const started=Date.now(),call={id:"read-target-"+i,kind:"tool" as const,name:"读取指定来源",input:target.url!};
    const row:SearchRun={engine:/\.pdf/i.test(target.url!)?"PDF 原文":"原站读取",query:target.url!,status:"running",hits:[],startedAt:new Date(started).toISOString()};
    runs.push(row);deps.report({...call,status:"running"});deps.stage("正在读取本轮指定的来源",runs);
    try{
      const result=await (deps.read||readTurnSource)(target,question,AbortSignal.any([signal,AbortSignal.timeout(16000)]));signal.throwIfAborted();
      Object.assign(row,result,{status:"done",hits:result.hits.map(h=>({...h,discoveredBy:target.discoveredBy,readAt:new Date().toISOString(),stage:result.engine==="PDF 原文"?"pdf-excerpt":"page-excerpt"}))});
      deps.report({...call,status:"done",output:JSON.stringify({url:row.requestUrl||target.url,hits:row.hits.length,warning:row.warning})});
    }catch(error){
      signal.throwIfAborted();row.status="failed";row.error=error instanceof Error?error.message:"指定来源读取失败。";
      deps.report({...call,status:"failed",error:row.error});
    }
    row.elapsedMs=Date.now()-started;deps.stage("已完成本轮指定来源的读取尝试",runs);
  }));
  return runs;
}
