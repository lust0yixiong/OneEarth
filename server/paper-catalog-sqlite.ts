import {createHash,randomUUID} from "node:crypto";
import {closeSync,copyFileSync,linkSync,lstatSync,mkdtempSync,openSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {DatabaseSync} from "node:sqlite";
import {validPaperRecord,type PaperRecord} from "../src/domain/paper-record";
import type {CatalogStatus,PaperCatalogSnapshot} from "./postgres-paper-catalog";

function validateCatalog(value:unknown,published:number):CatalogStatus {
  const v=value as CatalogStatus|null;
  if (!v || typeof v.complete!=="boolean" || typeof v.source!=="string" || !v.source.trim() ||
    (v.sourceTotal!==null && (!Number.isSafeInteger(v.sourceTotal) || v.sourceTotal<0)) ||
    !Number.isSafeInteger(v.filteredOut) || v.filteredOut<0 ||
    (v.updatedAt!==null && (typeof v.updatedAt!=="string" || !Number.isFinite(Date.parse(v.updatedAt)))) ||
    (v.complete && (v.sourceTotal!==published+v.filteredOut || v.updatedAt===null)))
    throw Error("旧论文快照的发布元数据无效。");
  const {complete,source,sourceTotal,filteredOut,updatedAt}=v;
  return {complete,source,sourceTotal,filteredOut,updatedAt};
}

function sourceIdentity(file:string) {
  const main=lstatSync(file,{bigint:true});
  if (!main.isFile()) throw Error("请提供独立、一致的 SQLite v2 备份文件。");
  const sidecar=(suffix:string)=>{
    try {return lstatSync(file+suffix,{bigint:true});}
    catch (error) {if ((error as NodeJS.ErrnoException).code!=="ENOENT") throw error;}
  };
  const wal=sidecar("-wal"),journal=sidecar("-journal");
  if (journal || (wal && (!wal.isFile() || wal.size!==0n)))
    throw Error("旧论文快照有非空 WAL 或 rollback journal，请重新生成一致备份。");
  const identity=(stat:typeof main)=>[stat.dev,stat.ino,stat.size,stat.mtimeNs,stat.ctimeNs].join(":");
  return identity(main)+"|"+(wal ? identity(wal) : "");
}

export function readPaperCatalogSqlite(file:string) {
  // Open a disposable copy so SQLite cannot create WAL sidecars beside the original.
  const before=sourceIdentity(file);
  const directory=mkdtempSync(path.join(tmpdir(),"oneearth-paper-import-"));
  try {
    const backup=path.join(directory,"snapshot.sqlite");
    copyFileSync(file,backup);
    if (sourceIdentity(file)!==before)
      throw Error("复制期间旧论文快照发生变化，请重新生成一致备份。");
    const db=new DatabaseSync(backup,{readOnly:true});
    try {
      if (db.prepare("PRAGMA quick_check").all().map(row=>row.quick_check).join()!=="ok")
        throw Error("旧论文 SQLite 快照未通过一致性校验。");
      const records:PaperRecord[]=[];
      const byId=new Map<string,PaperRecord>();
      for (const row of db.prepare("SELECT id,payload FROM evidence ORDER BY id").iterate()) {
        const record:unknown=JSON.parse(String(row.payload));
        if (!validPaperRecord(record) || record.catalogSummary || row.id!==record.id)
          throw Error("旧论文快照包含无效或不完整的精确版本。");
        records.push(record);
        byId.set(record.id,record);
      }
      const published=db.prepare("SELECT ds_key,id FROM dataset_catalog ORDER BY ds_key").all().map(row=>{
        const id=String(row.id),dsKey=String(row.ds_key);
        if (byId.get(id)?.dsKey!==dsKey) throw Error("旧论文快照发布头缺少对应的精确版本。");
        return {dsKey,id};
      });
      const row=db.prepare("SELECT payload FROM dataset_catalog_state WHERE key='current'").get();
      if (!row) throw Error("旧论文快照缺少 v2 发布头。");
      const catalog=validateCatalog(JSON.parse(String(row.payload)),published.length);
      const snapshot={records,published,catalog};
      return {snapshot,digest:createHash("sha256").update(JSON.stringify(snapshot)).digest("hex")};
    } finally {db.close();}
  } finally {rmSync(directory,{recursive:true,force:true});}
}

export function writePaperCatalogSqlite(file:string,snapshot:PaperCatalogSnapshot) {
  const temporary=file+".tmp-"+randomUUID();
  closeSync(openSync(temporary,"wx",0o600));
  try {
    const db=new DatabaseSync(temporary);
    try {
      db.exec(`BEGIN;
        CREATE TABLE evidence(id TEXT PRIMARY KEY,payload TEXT NOT NULL);
        CREATE TABLE dataset_catalog(ds_key TEXT PRIMARY KEY,id TEXT NOT NULL);
        CREATE TABLE dataset_catalog_state(key TEXT PRIMARY KEY,payload TEXT NOT NULL);`);
      const evidence=db.prepare("INSERT INTO evidence VALUES(?,?)");
      const published=db.prepare("INSERT INTO dataset_catalog VALUES(?,?)");
      for (const row of snapshot.records) evidence.run(row.id,JSON.stringify(row));
      for (const row of snapshot.published) published.run(row.dsKey,row.id);
      db.prepare("INSERT INTO dataset_catalog_state VALUES('current',?)").run(JSON.stringify(snapshot.catalog));
      db.exec("COMMIT");
    } finally {db.close();}
    // Link without replacing an existing target, even if it appeared during export.
    linkSync(temporary,file);
  } finally {rmSync(temporary,{force:true});}
  return {published:snapshot.published.length,versions:snapshot.records.length};
}
