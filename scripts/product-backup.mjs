import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, writeFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { GetObjectCommand, HeadBucketCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const [action,location]=process.argv.slice(2);
if(!["export","restore"].includes(action)||!location)throw Error("用法：product-backup.mjs export|restore <备份路径>");
const bin=process.env.ONEEARTH_PG_BIN_DIR;
if(!bin||!path.isAbsolute(bin))throw Error("请设置 ONEEARTH_PG_BIN_DIR。");
const bucket=process.env.ONEEARTH_OBJECT_BUCKET;
if(!bucket)throw Error("请设置独立图层对象桶。");
const bundle=path.resolve(location);
const prefix=(process.env.ONEEARTH_OBJECT_PREFIX || "oneearth/").replace(/\/?$/,"/");
const client=new S3Client({endpoint:process.env.ONEEARTH_OBJECT_ENDPOINT,region:process.env.AWS_REGION || "us-east-1",
  forcePathStyle:process.env.ONEEARTH_OBJECT_PATH_STYLE==="1"});
const databases=["runtime","discovery","spatial"];
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
const artifact=(name)=>path.join(bundle,name+".dump");
const marker=path.join(bundle,"manifest.json");
const command=(binary,args,db)=>{
  const dest=db&&new URL(process.env["ONEEARTH_"+db.toUpperCase()+"_DATABASE_URL"] || "");
  if(dest){
    assert.ok(dest.hostname&&dest.pathname.length>1);
    if(process.env.ONEEARTH_ASSERTION_PG_HOST===dest.hostname)
      throw Error("备份与恢复进程禁止连接论文断言库服务器。");
  }
  const auth=dest ? {PGHOST:dest.hostname,PGPORT:dest.port || "5432",PGUSER:decodeURIComponent(dest.username),
    PGPASSWORD:decodeURIComponent(dest.password),PGDATABASE:decodeURIComponent(dest.pathname.slice(1)),
    ...(dest.searchParams.has("sslmode")?{PGSSLMODE:dest.searchParams.get("sslmode")}:{})} : {};
  try{
    return execFileSync(path.join(bin,binary),args,{encoding:"utf8",env:{...process.env,...auth},
      stdio:["ignore","pipe","pipe"],maxBuffer:16*1024*1024});
  }catch(error){
    throw Error(binary+" "+(db??"")+" exited "+(error.status ?? error.code));
  }
};
async function parallel(values,run){
  let cursor=0;
  await Promise.all(Array.from({length:12},async()=>{
    for(;;){const index=cursor++;if(index>=values.length)return;await run(values[index]);}
  }));
}
async function objects(){
  const rows=[];
  let cursor;
  do{
    const result=await client.send(new ListObjectsV2Command({Bucket:bucket,Prefix:prefix,ContinuationToken:cursor}));
    for(const entry of result.Contents || []){
      if(!entry.Key)continue;
      const relative=entry.Key.slice(prefix.length);
      const digest=relative.split("/")[1];
      if(!/^[a-f0-9]{2}\/[a-f0-9]{64}$/.test(relative)||relative.slice(0,2)!==digest.slice(0,2))
        throw Error("备份只接受按内容哈希命名的图层对象。");
      rows.push({key:relative,hash:digest,bytes:entry.Size});
    }
    cursor=result.NextContinuationToken;
  }while(cursor);
  return rows;
}
async function fileHash(file){
  const hash=createHash("sha256");
  for await(const data of createReadStream(file))hash.update(data);
  return hash.digest("hex");
}
await client.send(new HeadBucketCommand({Bucket:bucket}));
if(action==="export"){
  await mkdir(bundle,{mode:0o700}); // Require a fresh backup directory.
  await mkdir(path.join(bundle,"objects"),{mode:0o700});
  const databaseFiles=[];
  for(const db of databases){
    command("pg_dump",["--format=custom","--no-owner","--no-privileges","--file",artifact(db)],db);
    databaseFiles.push({db,hash:await fileHash(artifact(db))});
  }
  const rows=await objects();
  assert.ok(rows.length,"图层对象备份不能为空。");
  await parallel(rows,async record=>{
    const response=await client.send(new GetObjectCommand({Bucket:bucket,Key:prefix+record.key}));
    const bytes=Buffer.from(await response.Body.transformToByteArray());
    assert.equal(bytes.length,record.bytes);
    assert.equal(sha(bytes),record.hash);
    await writeFile(path.join(bundle,"objects",record.hash),bytes,{mode:0o600,flag:"wx"});
  });
  await writeFile(marker,JSON.stringify({format:1,databases:databaseFiles,objects:rows},null,2)+"\n",{mode:0o600,flag:"wx"});
  console.log(JSON.stringify({action,databases:databaseFiles.length,objects:rows.length,verified:true}));
}else{
  const manifest=JSON.parse(await readFile(marker,"utf8"));
  assert.equal(manifest.format,1);
  assert.deepEqual(manifest.databases.map(entry=>entry.db),databases);
  for(const db of databases){
    const count=command("psql",["--no-psqlrc","--tuples-only","--no-align","--command",
      "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name <> 'spatial_ref_sys'"],db).trim();
    assert.equal(count,"0","目标数据库必须为空："+db);
  }
  assert.equal((await objects()).length,0,"目标对象前缀必须为空。");
  for(const record of manifest.databases)assert.equal(await fileHash(artifact(record.db)),record.hash);
  await parallel(manifest.objects,async record=>{
    assert.match(record.hash,/^[a-f0-9]{64}$/);
    assert.equal(record.key,record.hash.slice(0,2)+"/"+record.hash);
    const bytes=await readFile(path.join(bundle,"objects",record.hash));
    assert.equal(bytes.length,record.bytes);
    assert.equal(sha(bytes),record.hash);
    await client.send(new PutObjectCommand({Bucket:bucket,Key:prefix+record.key,Body:bytes,IfNoneMatch:"*"}));
  });
  for(const db of databases){
    const args=["--exit-on-error","--no-owner","--no-privileges","--single-transaction","--dbname",
      new URL(process.env["ONEEARTH_"+db.toUpperCase()+"_DATABASE_URL"]).pathname.slice(1)];
    if(db==="spatial"){
      const toc=command("pg_restore",["--list",artifact(db)]);
      const keep=toc.split("\n").filter(line=>!/(?:EXTENSION - postgis|COMMENT - EXTENSION postgis|TABLE DATA public spatial_ref_sys)/.test(line));
      const list=path.join(bundle,"spatial.restore-list");
      writeFileSync(list,keep.join("\n"),{mode:0o600});
      args.push("--use-list",list);
    }
    command("pg_restore",[...args,artifact(db)],db);
  }
  console.log(JSON.stringify({action,databases:databases.length,objects:manifest.objects.length,verified:true}));
}
