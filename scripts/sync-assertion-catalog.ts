import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { paperCache } from "../server/earthnano";
import { validPaperRecord, type PaperRecord } from "../src/domain/paper-record";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const local=path.join(root,".local");mkdirSync(local,{recursive:true});
try {process.loadEnvFile(path.join(root,".env"));}catch { /* Environment variables may supply the endpoint. */ }
const args=process.argv.slice(2),value=(flag:string)=>{const i=args.indexOf(flag);return i>=0?args[i+1]:undefined;};
const schema="oneearth-assertion-dataset-catalog-v1";

function ingest(raw:unknown) {
  const source=raw as {schema?:string;complete?:boolean;source?:string;exportedAt?:string;totalDatasets?:number;records?:unknown[]};
  if(source?.schema!==schema || source.complete!==true || !Array.isArray(source.records) ||
    !Number.isSafeInteger(source.totalDatasets) || source.records.length!==source.totalDatasets ||
    !source.source || !source.exportedAt || !Number.isFinite(Date.parse(source.exportedAt)))
    throw Error("导出结果缺少可核对的全量标记、总数或来源时间；保留现有目录，未将部分结果标为全量。见 docs/assertion-catalog.md。");
  const accepted=new Map<string,PaperRecord>();
  let invalid=0,duplicates=0;
  for(const item of source.records){
    if(!validPaperRecord(item)){invalid++;continue;}
    if(accepted.has(item.dsKey))duplicates++;
    accepted.set(item.dsKey,item);
  }
  const cache=paperCache(path.join(local,"paper-evidence.sqlite"));
  try {
    cache.replaceCatalog([...accepted.values()],{source:source.source,sourceTotal:source.totalDatasets!,filteredOut:invalid+duplicates,updatedAt:source.exportedAt});
    const report={...cache.status(),invalid,duplicates};
    writeFileSync(path.join(local,"assertion-catalog-sync-report.json"),JSON.stringify(report,null,2)+"\n");
    console.log(JSON.stringify(report,null,2));
  } finally {cache.close();}
}

async function main(){
  const input=value("--import");
  if(input){ingest(JSON.parse(readFileSync(path.resolve(input),"utf8")));return;}
  if(args.includes("--audit")){
    const cache=paperCache(path.join(local,"paper-evidence.sqlite"));
    try {console.log(JSON.stringify(cache.status(),null,2));}finally{cache.close();}
    return;
  }
  if(!args.includes("--inspect")&&!args.includes("--sync")){
    console.log("检查全量工具：node --import tsx scripts/sync-assertion-catalog.ts --inspect\n导入完整导出：node --import tsx scripts/sync-assertion-catalog.ts --import /path/catalog.json\n调用已确认的全量导出工具：node --import tsx scripts/sync-assertion-catalog.ts --sync --tool EXACT_TOOL_NAME [--args '{}']");return;
  }
  const endpoint=process.env.ONEEARTH_EARTHNANO_URL||"http://10.11.140.149:8767/sse";
  const client=new Client({name:"oneearth-catalog-sync",version:"0.1"});
  const signal=AbortSignal.timeout(120000);
  const transport=new SSEClientTransport(new URL(endpoint),{fetch:(url,init)=>fetch(url,{...init,signal:AbortSignal.any([signal,...(init?.signal?[init.signal]:[])])})});
  try {
    await client.connect(transport,{timeout:10000,signal});
    const tools:Awaited<ReturnType<typeof client.listTools>>["tools"]=[];
    let cursor:string|undefined;
    do{const page=await client.listTools(cursor?{cursor}:undefined,{signal});tools.push(...page.tools);cursor=page.nextCursor;}while(cursor);
    writeFileSync(path.join(local,"assertion-source-tools.json"),JSON.stringify({endpoint,checkedAt:new Date().toISOString(),tools},null,2)+"\n");
    console.log("已保存断言库工具名称及参数：.local/assertion-source-tools.json");
    if(args.includes("--inspect"))return;
    const name=value("--tool")||process.env.ONEEARTH_ASSERTION_CATALOG_TOOL;
    const tool=tools.find(item=>item.name===name);
    if(!tool)throw Error("尚未指定已确认的全量导出工具。工具清单已保存；不会把名称搜索或单次命中当作全量目录。");
    const parameters=JSON.parse(value("--args")||"{}");
    for(const required of tool.inputSchema.required||[])if(!(required in parameters))throw Error("全量工具缺少参数："+required);
    const reply=await client.callTool({name:tool.name,arguments:parameters},undefined,{signal,timeout:90000});
    if(reply.isError)throw Error("断言库全量导出工具返回错误，现有目录未替换。");
    const text=reply.content?.find(item=>item.type==="text");
    const payload=reply.structuredContent|| (text?.type==="text"?JSON.parse(text.text):null);
    writeFileSync(path.join(local,"assertion-source-export.json"),JSON.stringify(payload)+"\n");
    ingest(payload);
  } finally {await client.close();}
}
main().catch(error=>{console.error("断言库目录同步未完成："+(error instanceof Error?error.message:String(error)));process.exitCode=1;});
