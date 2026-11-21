import {writeFile,rename} from "node:fs/promises";
import {existsSync} from "node:fs";
import {randomUUID} from "node:crypto";
import {fetchHainaCatalog} from "../server/haina-api";
import {hainaRecord,type HainaRecord} from "../src/domain/haina-record";
import {hainaThumbnail} from "./haina-thumbnail.mjs";
const envFile=new URL("../.env",import.meta.url);
if(existsSync(envFile))process.loadEnvFile(envFile);
const result=await fetchHainaCatalog();
const records:HainaRecord[]=[];
for(let i=0;i<result.rows.length;i+=8){
  records.push(...await Promise.all(result.rows.slice(i,i+8).map(async row=>hainaRecord(row,await hainaThumbnail(row.browseGraph)))));
}
const dest=new URL("../src/data/evidence/haina.json",import.meta.url),tmp=new URL(dest.href+"."+randomUUID());
await writeFile(tmp,JSON.stringify({synced:new Date().toISOString(),total:result.total,endpoint:result.endpoint,areaId:result.areaId,records})+"\n");
await rename(tmp,dest);
console.log("海纳专区接口：",records.length,"条，",result.pages,"页，完整同步；含缩略图",records.filter(r=>r.card.thumbnailUrl).length,"条。");
