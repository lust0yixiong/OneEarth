import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { PaperRecord } from "../src/domain/paper-record";
import { paperCache } from "./earthnano";
import { restoreDiscoveryPaperCache } from "./paper-cache-restore";

function record(hash: string, dsKey: string): PaperRecord {
  return {id:"earthnano:"+hash.repeat(64),dsKey,papers:1,paperTitle:"Fixture paper "+hash,studyContext:"",points:[],
    need:{name:"论文中的数据使用",product:"Fixture dataset "+dsKey,type:"论文抽取线索",detail:"Fixture paper usage.",
      status:"有论文用法记录",source:"文献资料",datasetId:dsKey,
      profile:{role:"data",spatial:"nonspatial",coverage:"未提供坐标",access:"见断言库",limitation:""},
      tabs:[{kind:"table",label:"论文用法（本页）",rows:[["Fixture paper","input","","","paper-1","data-1"]]}]}};
}

const old=record("f","doi:10.1234/retained");
const newer=record("a",old.dsKey);
const removed=record("e","doi:10.1234/removed");
const published=record("b",old.dsKey);
const unsequenced=record("c","doi:10.1234/unsequenced");
const full=(sourceTotal: number)=>({source:"Fixture full publication",sourceTotal,filteredOut:0,updatedAt:"2026-11-22T00:00:00Z"});

async function withHistory(run: (query: Parameters<typeof restoreDiscoveryPaperCache>[1])=>Promise<void>) {
  const db=new PGlite();
  try {
    await db.exec(`
      CREATE TABLE discovery_tasks (id text PRIMARY KEY, status text NOT NULL);
      CREATE TABLE discovery_events (seq bigint PRIMARY KEY, id text NOT NULL, at bigint NOT NULL, payload jsonb NOT NULL);
      CREATE TABLE discovery_papers (id text PRIMARY KEY, task_id text NOT NULL, record jsonb NOT NULL);
      INSERT INTO discovery_tasks VALUES ('earlier','complete'), ('later','complete'), ('stopped','failed');
    `);
    const event=(seq:number,id:string,papers:PaperRecord[])=>db.query("INSERT INTO discovery_events VALUES ($1,$2,100,$3::jsonb)",
      [seq,id,JSON.stringify({result:{papers}})]);
    // Row insertion order, task ID and wall time cannot determine publication order.
    await event(70,"later",[newer]);
    await event(25,"earlier",[old,removed]);
    await event(14,"earlier",[published]);
    await event(90,"stopped",[published]);
    for(const [p,id] of [[newer,"later"],[old,"earlier"],[removed,"earlier"],[unsequenced,"earlier"]] as const)
      await db.query("INSERT INTO discovery_papers VALUES ($1,$2,$3::jsonb)",[p.id,id,JSON.stringify(p)]);
    await run(sql=>db.query<Record<string,unknown>>(sql));
  } finally {await db.close();}
}

test("fresh recovery uses the final event sequence even when a newer content ID sorts first", async () => {
  const dir=mkdtempSync(path.join(tmpdir(),"oneearth-paper-replay-"));
  const file=path.join(dir,"papers.sqlite");
  const reader=paperCache(file); // A different role can initialise the SQLite file first.
  const cache=paperCache(file);
  try {
    assert.equal(cache.needsCatalogRecovery(),true);
    await withHistory(query=>restoreDiscoveryPaperCache(cache,query));
    assert.ok(newer.id<old.id);
    assert.equal(reader.list().find(p=>p.dsKey===old.dsKey)?.id,newer.id);
    assert.deepEqual(new Set(reader.list().map(p=>p.id)),new Set([newer.id,removed.id]));
    assert.equal(reader.get(old.id)?.id,old.id);
    assert.equal(reader.get(unsequenced.id)?.id,unsequenced.id);
    assert.equal(reader.get(published.id),undefined);
    assert.equal(reader.status().complete,false);
    assert.match(reader.status().source,/发现任务恢复/);
  } finally {cache.close();reader.close();rmSync(dir,{recursive:true,force:true});}
});

test("startup keeps the published version and does not resurrect items removed by a full publication", async () => {
  const cache=paperCache(":memory:");
  try {
    cache.saveBatch([old,removed]);
    cache.replaceCatalog([published],full(1));
    const prior=cache.status();
    await withHistory(query=>restoreDiscoveryPaperCache(cache,query));
    assert.deepEqual(cache.list().map(p=>p.id),[published.id]);
    assert.deepEqual(cache.status(),prior);
    assert.equal(cache.get(newer.id)?.id,newer.id);
    assert.equal(cache.get(old.id)?.id,old.id);
    assert.equal(cache.get(removed.id)?.id,removed.id);
  } finally {cache.close();}
});

test("startup preserves a deliberately empty full publication", async () => {
  const cache=paperCache(":memory:");
  try {
    cache.replaceCatalog([],full(0));
    const prior=cache.status();
    await withHistory(query=>restoreDiscoveryPaperCache(cache,query));
    assert.deepEqual(cache.status(),prior);
    assert.equal(cache.status().complete,true);
    assert.deepEqual(cache.list(),[]);
    assert.equal(cache.get(old.id)?.id,old.id);
    assert.equal(cache.get(newer.id)?.id,newer.id);
  } finally {cache.close();}
});

test("startup rechecks the publication under lock after reading PostgreSQL", async () => {
  const dir=mkdtempSync(path.join(tmpdir(),"oneearth-paper-publication-"));
  const file=path.join(dir,"papers.sqlite");
  const cache=paperCache(file);
  const publisher=paperCache(file);
  try {
    await withHistory(query=>restoreDiscoveryPaperCache(cache,async sql=>{
      const rows=await query(sql);
      if(sql.includes("ORDER BY terminal.seq")) publisher.replaceCatalog([],full(0));
      return rows;
    }));
    assert.deepEqual(cache.list(),[]);
    assert.equal(cache.status().complete,true);
    assert.equal(cache.get(newer.id)?.id,newer.id);
  } finally {publisher.close();cache.close();rmSync(dir,{recursive:true,force:true});}
});

test("a failed batch rolls back exact records, current heads and catalogue state together", () => {
  const dir=mkdtempSync(path.join(tmpdir(),"oneearth-paper-batch-"));
  const file=path.join(dir,"papers.sqlite");
  const cache=paperCache(file);
  const db=new DatabaseSync(file);
  try {
    cache.replaceCatalog([published],full(1));
    const prior=cache.status();
    db.exec(`
      CREATE TRIGGER reject_head BEFORE INSERT ON dataset_catalog
      WHEN NEW.ds_key='doi:10.1234/removed'
      BEGIN SELECT RAISE(ABORT,'fixture publish failure'); END
    `);
    assert.throws(()=>cache.saveBatch([newer,removed]),/fixture publish failure/);
    assert.deepEqual(cache.status(),prior);
    assert.deepEqual(cache.list().map(r=>r.id),[published.id]);
    assert.equal(cache.get(newer.id),undefined);
    assert.equal(cache.get(removed.id),undefined);
  } finally {db.close();cache.close();rmSync(dir,{recursive:true,force:true});}
});
