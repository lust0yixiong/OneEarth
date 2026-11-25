import { mkdirSync,renameSync,rmSync,writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertionReader, assertionPgConfig, assertionCatalogSource } from "../server/assertion-postgres";
import { assertionDataset } from "../server/assertion-dataset";
import {postgresPaperCatalog,withPaperCatalogSync} from "../server/postgres-paper-catalog";
import {productDatabase} from "../server/product-database";
import { validPaperRecord, type PaperRecord } from "../src/domain/paper-record";

const root=fileURLToPath(new URL("..",import.meta.url));
try{process.loadEnvFile(path.join(root,".env"));}catch{/* Environment variables may provide the configuration. */}

function options(args:string[]){
  const opts:{verifySource?:boolean;expectedCount?:number;expectedSha?:string;report?:string}={};
  for(let i=0;i<args.length;i++){
    const name=args[i];
    if(name==="--verify-source"&&!opts.verifySource){opts.verifySource=true;continue;}
    const value=args[++i];
    if(name==="--expected-count"&&!opts.expectedCount&&value&&/^\d+$/.test(value)&&Number(value)>0&&Number.isSafeInteger(Number(value)))opts.expectedCount=Number(value);
    else if(name==="--expected-sha256"&&!opts.expectedSha&&value&&/^[a-f0-9]{64}$/.test(value))opts.expectedSha=value;
    else if(name==="--report"&&!opts.report&&value&&!value.startsWith("--"))opts.report=path.resolve(value);
    else throw Error("用法：sync:research-data [--verify-source] [--expected-count N] [--expected-sha256 HEX] [--report PATH]");
  }
  return opts;
}
function report(value:object,destination?:string){
  const body=JSON.stringify(value,null,2)+"\n";
  if(destination){
    const temp=destination+"."+randomUUID()+".tmp";
    try{mkdirSync(path.dirname(destination),{recursive:true,mode:0o700});writeFileSync(temp,body,{mode:0o600});renameSync(temp,destination);}
    finally{rmSync(temp,{force:true});}
  }
  console.log(body.trimEnd());
}

async function main(){
  const opts=options(process.argv.slice(2)),config=assertionPgConfig();
  if(!config)throw Error("尚未配置论文研究数据只读连接。");
  const reader=assertionReader(config);
  const timer=Date.now();
  async function readComplete(){
    const started=Date.now();
    const records:PaperRecord[]=[],issues=new Map<string,number>();
    const source=await reader.snapshot((rows,loaded,total)=>{
      for(const row of rows){
        const {record,issues:rowIssues}=assertionDataset(row);
        if(!record||!validPaperRecord(record))throw Error("一个源元数据记录未通过发布校验，已保留原目录。");
        for(const issue of rowIssues)issues.set(issue,(issues.get(issue)||0)+1);
        records.push(record);
      }
      if(loaded===total||loaded%2500===0)console.error(`Read-only PostgreSQL snapshot: ${loaded}/${total} dataset metadata records.`);
    });
    if(!source.total||records.length!==source.total||
      (opts.expectedCount!==undefined&&source.total!==opts.expectedCount)||(opts.expectedSha&&source.metadataSha!==opts.expectedSha))
      throw Error("源快照的元数据条数或身份 SHA-256 与校验条件不一致，已保留原目录。");
    const linkedDatasets=records.filter(record=>record.assertionCatalogKind==="metadata-with-usage").length;
    return {records,summary:{...source,readMs:Date.now()-started,source:assertionCatalogSource,linkedDatasets,metadataOnly:source.total-linkedDatasets,
      namedDatasets:records.filter(record=>record.need.product!==record.dsKey).length,excluded:0,
      datasetsWithAreas:records.filter(record=>record.need.profile?.area).length,
      datasetsWithPoints:records.filter(record=>record.points.length).length,
      datasetsWithTime:records.filter(record=>record.need.profile?.utcWindow).length,
      researchQuestionExamples:records.reduce((n,record)=>n+(record.researchQuestions?.length||0),0),
      issues:Object.fromEntries(issues)}};
  }
  try{
    if(opts.verifySource){
      const {summary}=await readComplete();
      report({...summary,state:"verified",elapsedMs:Date.now()-timer},opts.report);
      return;
    }
    const pool=productDatabase("DISCOVERY");
    try{
      const outcome=await withPaperCatalogSync(pool,async()=>{
        const store=await postgresPaperCatalog(pool,{initializeSchema:false});
        await store.status();
        const {records,summary}=await readComplete();
        const publishStart=Date.now();
        const published=await store.publishAssertionMetadata(records,{metadataSha:summary.metadataSha,updatedAt:summary.checkedAt});
        return {...summary,...published,publishMs:Date.now()-publishStart,elapsedMs:Date.now()-timer};
      });
      if(!outcome.acquired){report({state:"already-running"});return;}
      report(outcome.value,opts.report);
    }finally{await pool.end();}
  }finally{await reader.close();}
}
main().catch(error=>{console.error("断言元数据同步未完成："+(error instanceof Error?error.message:String(error)));process.exitCode=1;});
