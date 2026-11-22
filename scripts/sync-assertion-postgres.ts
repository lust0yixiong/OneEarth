import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertionReader, assertionPgConfig } from "../server/assertion-postgres";
import { assertionDataset } from "../server/assertion-dataset";
import {postgresPaperCatalog} from "../server/postgres-paper-catalog";
import {productDatabase} from "../server/product-database";
import { validPaperRecord, type PaperRecord } from "../src/domain/paper-record";

const root=fileURLToPath(new URL("..",import.meta.url));
try{process.loadEnvFile(path.join(root,".env"));}catch{/* Environment variables may provide the configuration. */}
const config=assertionPgConfig();if(!config)throw Error("尚未配置论文研究数据只读连接。");
const reader=assertionReader(config),records=new Map<string,PaperRecord>(),issues=new Map<string,number>();
const local=path.join(root,".local");mkdirSync(local,{recursive:true});
const pool=productDatabase("DISCOVERY");
try {
  const store=await postgresPaperCatalog(pool);
  await store.status();
  const result=await reader.snapshot((rows,loaded,total)=>{
    for(const row of rows) {
      const mapped=assertionDataset(row);
      for(const issue of mapped.issues)issues.set(issue,(issues.get(issue)||0)+1);
      if(mapped.record && validPaperRecord(mapped.record))records.set(row.ds_key,mapped.record);
    }
    if(loaded===total || loaded%2500===0)console.log(`Read-only PostgreSQL snapshot: ${loaded}/${total} dataset metadata records.`);
  });
  const publication=await store.replaceCatalog([...records.values()],{source:"PostgreSQL dataset_metadata → 数据集用法与论文研究问题（只读快照）",
    sourceTotal:result.total,filteredOut:result.total-records.size,updatedAt:result.checkedAt});
  const report={...result,...publication,source:"public.dataset_metadata",linkedDatasets:records.size,excluded:result.total-records.size,
    datasetsWithAreas:[...records.values()].filter(record=>record.need.profile?.area).length,
    datasetsWithPoints:[...records.values()].filter(record=>record.points.length).length,
    datasetsWithTime:[...records.values()].filter(record=>record.need.profile?.utcWindow).length,
    researchQuestionExamples:[...records.values()].reduce((n,record)=>n+(record.researchQuestions?.length||0),0),issues:Object.fromEntries(issues)};
  writeFileSync(path.join(local,"assertion-postgres-sync-report.json"),JSON.stringify(report,null,2)+"\n");
  console.log(JSON.stringify(report,null,2));
} finally {await Promise.all([reader.close(),pool.end()]);}
