import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertionReader, assertionPgConfig } from "../server/assertion-postgres";
import { assertionDataset } from "../server/assertion-dataset";
import { paperCache } from "../server/earthnano";
import { validPaperRecord, type PaperRecord } from "../src/domain/paper-record";
import { productPath } from "./product-path.mjs";

const root=fileURLToPath(new URL("..",import.meta.url));
try{process.loadEnvFile(path.join(root,".env"));}catch{/* Environment variables may provide the configuration. */}
const config=assertionPgConfig();if(!config)throw Error("尚未配置论文研究数据只读连接。");
const reader=assertionReader(config),records=new Map<string,PaperRecord>(),issues=new Map<string,number>();
const local=path.join(root,".local");mkdirSync(local,{recursive:true});
const file=productPath(root,path.join(process.env.ONEEARTH_STATE_DIR || ".local","paper-evidence.sqlite"));
try {
  const result=await reader.snapshot((rows,loaded,total)=>{
    for(const row of rows) {
      const mapped=assertionDataset(row);
      for(const issue of mapped.issues)issues.set(issue,(issues.get(issue)||0)+1);
      if(mapped.record && validPaperRecord(mapped.record))records.set(row.ds_key,mapped.record);
    }
    if(loaded===total || loaded%2500===0)console.log(`Read-only PostgreSQL snapshot: ${loaded}/${total} dataset metadata records.`);
  });
  mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
  // Back up through SQLite so committed WAL pages are included, without touching the source database.
  if(existsSync(file)) {
    const {DatabaseSync}=await import("node:sqlite");const db=new DatabaseSync(file);
    try{db.exec(`VACUUM INTO '${file.replaceAll("'","''")}.before-postgres-${Date.now()}'`);}finally{db.close();}
  }
  const cache=paperCache(file);
  try{cache.replaceCatalog([...records.values()],{source:"PostgreSQL dataset_metadata → 数据集用法与论文研究问题（只读快照）",sourceTotal:result.total,filteredOut:result.total-records.size,updatedAt:result.checkedAt});}finally{cache.close();}
  const report={...result,source:"public.dataset_metadata",linkedDatasets:records.size,excluded:result.total-records.size,
    datasetsWithAreas:[...records.values()].filter(record=>record.need.profile?.area).length,
    datasetsWithPoints:[...records.values()].filter(record=>record.points.length).length,
    datasetsWithTime:[...records.values()].filter(record=>record.need.profile?.utcWindow).length,
    researchQuestionExamples:[...records.values()].reduce((n,record)=>n+(record.researchQuestions?.length||0),0),issues:Object.fromEntries(issues)};
  writeFileSync(path.join(local,"assertion-postgres-sync-report.json"),JSON.stringify(report,null,2)+"\n");
  console.log(JSON.stringify(report,null,2));
} finally {await reader.close();}
