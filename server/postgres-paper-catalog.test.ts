import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {randomUUID,createHash} from "node:crypto";
import {once} from "node:events";
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from "node:fs";
import path from "node:path";
import {DatabaseSync} from "node:sqlite";
import test from "node:test";
import express from "express";
import {Pool} from "pg";
import type {PaperRecord} from "../src/domain/paper-record";
import {discoveryA2aRouter} from "./discovery-a2a-server";
import type {DiscoveryA2aStore} from "./discovery-a2a-store";
import {paperCatalogAccess} from "./paper-catalog-access";
import {paperCatalogRoutes} from "./paper-catalog";
import {readPaperCatalogSqlite,writePaperCatalogSqlite} from "./paper-catalog-sqlite";
import {paperProjectionQueryKind,paperProjectionResultKind,type PaperProjectionResult} from "./paper-projection-contract";
import {paperQueryKind} from "./discovery-materials-contract";
import {postgresPaperCatalog,withPaperCatalogSync} from "./postgres-paper-catalog";

const record = (key:string,tag:string):PaperRecord => ({
  id:"earthnano:"+tag.repeat(64),dsKey:key,papers:1,paperTitle:"fixture "+tag,studyContext:"",points:[[1,2]],
  need:{name:"数据集",product:"Fixture "+tag,type:"fixture",detail:"",status:"",source:"文献资料",
    profile:{role:"data",spatial:"coverage",coverage:"fixture",access:"fixture",limitation:""},
    tabs:[{kind:"table",label:"论文用法（本页）",columns:[],rows:[["","","","","paper-"+tag,"dataset-"+tag]]}]},
});
const A=record("doi:the-same","f"),B=record("doi:the-same","a"),C=record("doi:other","b");
const full={source:"fixture publication",sourceTotal:1,filteredOut:0,updatedAt:"2026-01-01T00:00:00.000Z"};
const cliPath = "scripts/migrate-paper-catalog.ts";
const pgBin = process.env.ONEEARTH_A2A_TEST_PG_BIN;
test("real discovery PostgreSQL migrates v2, preserves publication order, and serves bounded projection deltas",
  {skip:!pgBin && "set ONEEARTH_A2A_TEST_PG_BIN",timeout:45000}, async t=>{
  assert.ok(pgBin);
  const work=mkdtempSync("/tmp/oe-paper-pg-");
  const data=path.join(work,"db");
  const pg=(name:string,args:string[])=>execFileSync(path.join(pgBin,name),args,{encoding:"utf8",stdio:"pipe"});
  let started=false;
  let pool:Pool|undefined;
  let http:ReturnType<express.Express["listen"]>|undefined;
  t.after(async()=>{
    http?.closeAllConnections();
    if (http) await new Promise<void>(resolve=>http!.close(()=>resolve()));
    await pool?.end();
    if (started) pg("pg_ctl",["-D",data,"-m","fast","-w","stop"]);
    rmSync(work,{recursive:true,force:true});
  });
  pg("initdb",["-D",data,"-U","paper_fixture","-A","trust","--no-locale","--encoding=UTF8"]);
  pg("pg_ctl",["-D",data,"-l",path.join(work,"pg.log"),"-o",'-c listen_addresses= -k "'+work+'"',"-w","start"]);
  started=true;
  const database=(name="postgres")=>"postgresql://paper_fixture@localhost/"+name+"?host="+encodeURIComponent(work);
  pool=new Pool({connectionString:database()});
  function cli(args:string[],name="postgres",script=cliPath,variables:NodeJS.ProcessEnv={}) {
    const stdout=execFileSync(process.execPath,["--import","tsx",script,...args],{
      encoding:"utf8",stdio:"pipe",env:{...process.env,ONEEARTH_DISCOVERY_DATABASE_URL:database(name),ONEEARTH_STATE_DIR:work,...variables},
    });
    return JSON.parse(stdout.slice(stdout.indexOf("{")));
  }
  assert.deepEqual(cli(["--status"]),{initialized:false,revision:null,generation:null,publishedCount:0,versionCount:0});
  assert.equal((await pool.query("SELECT to_regclass('paper_catalog_head') AS table")).rows[0].table,null);
  const papers=await postgresPaperCatalog(pool);
  const tasks=new Proxy({} as DiscoveryA2aStore,{get(){assert.fail("Paper projection touched Task storage");}});
  const app=express(),catalog=paperCatalogAccess(papers);
  app.use(discoveryA2aRouter(tasks,async()=>assert.fail("Paper projection invoked discovery"),{paperProjection:papers,catalog}));
  app.use(express.json());
  app.use("/api/paper-records",paperCatalogRoutes(catalog));
  http=app.listen(0,"127.0.0.1");
  await once(http,"listening");
  const address=http.address();
  assert.ok(address && typeof address!=="string");
  const origin="http://127.0.0.1:"+address.port;
  const send=(input:object,kind=paperProjectionQueryKind)=>fetch(origin+"/message:send",{method:"POST",
    headers:{"A2A-Version":"1.0","Content-Type":"application/a2a+json"},
    body:JSON.stringify({message:{role:"ROLE_USER",messageId:randomUUID(),parts:[{data:{kind,input}}]}})});
  async function projection(input:object) {
    const response=await send(input);
    assert.equal(response.status,200,await response.clone().text());
    const receipt=await response.json();
    assert.equal(receipt.task,undefined);
    assert.equal(receipt.message.parts[0].data.kind,paperProjectionResultKind);
    return receipt.message.parts[0].data.value as PaperProjectionResult;
  }
  async function page(generation:string,baseGeneration?:string,cursor="",limit=250) {
    const view=await projection({operation:"page",generation,baseGeneration,cursor,limit});
    assert.equal(view.operation,"page");
    return view;
  }
  assert.equal((await send({operation:"head"})).status,503);
  assert.equal((await fetch(origin+"/api/paper-records")).status,503);

  const oldFile=path.join(work,"paper-evidence.sqlite");
  const snapshot={records:[B,C],published:[{dsKey:B.dsKey,id:B.id}],catalog:{...full,complete:true}};
  writePaperCatalogSqlite(oldFile,snapshot);
  assert.throws(()=>cli(["--initialize-empty"]),/旧 SQLite/);
  writeFileSync(oldFile+"-wal","uncheckpointed");
  assert.throws(()=>cli(["--sqlite",oldFile]),/非空 WAL/);
  assert.equal(cli(["--status"]).initialized,false);
  writeFileSync(oldFile+"-wal","");
  writeFileSync(oldFile+"-shm",Buffer.alloc(32768));
  const hash=(file:string)=>createHash("sha256").update(readFileSync(file)).digest("hex");
  const before=[oldFile,oldFile+"-wal",oldFile+"-shm"].map(hash);
  const imported=cli(["--sqlite",oldFile]);
  assert.equal(imported.publishedCount,1);
  assert.equal(imported.versionCount,2);
  assert.equal(cli(["--sqlite",oldFile]).alreadyImported,true);
  assert.deepEqual([oldFile,oldFile+"-wal",oldFile+"-shm"].map(hash),before);
  const initial=await projection({operation:"head"});
  assert.equal(imported.generation,initial.generation);
  const first=await page(initial.generation,undefined,"",1);
  assert.deepEqual(first.entries.map(r=>[r.id,r.published]),[[B.id,true]]);
  assert.ok(first.nextCursor);
  const second=await page(initial.generation,undefined,first.nextCursor,1);
  assert.deepEqual(second.entries.map(r=>[r.id,r.published]),[[C.id,false]]);
  assert.equal(second.nextCursor,null);
  assert.equal(first.entries[0].profile.coverage,"fixture");

  const stale=await papers.beginLookup(),fresh=await papers.beginLookup();
  await papers.publishLookup([B],fresh); // Even an unchanged selection fences older results for this dsKey.
  await papers.publishLookup([A],stale);
  const history=await projection({operation:"head"});
  assert.equal(history.revision,initial.revision);
  assert.notEqual(history.generation,initial.generation);
  const archived=await page(history.generation,initial.generation);
  assert.deepEqual(archived.entries.map(r=>[r.id,r.published]),[[A.id,false]]);
  assert.equal(archived.baseGeneration,initial.generation);
  assert.deepEqual((await papers.page("",10)).records.map(r=>r.id),[B.id]);
  assert.deepEqual((await papers.getMany([A.id,B.id,C.id,A.id])).map(r=>r.id),[A.id,B.id,C.id,A.id]);

  const inflight=await papers.beginLookup();
  await papers.replaceCatalog([],{...full,sourceTotal:0,updatedAt:"2026-01-02T00:00:00.000Z"});
  await papers.publishLookup([A,C],inflight);
  const removed=await projection({operation:"head"});
  assert.equal(removed.publishedCount,0);
  assert.equal(removed.versionCount,3);
  const withdrawal=await page(removed.generation,history.generation);
  assert.deepEqual(withdrawal.entries.map(r=>[r.id,r.published]),[[B.id,false]]);
  assert.equal((await papers.page("",10)).catalog.complete,true);
  assert.notEqual(initial.revision,removed.revision);
  assert.equal(cli(["--sqlite",oldFile]).generation,removed.generation);
  const failedStamp=await papers.beginLookup();
  await assert.rejects(papers.publishLookup([{...B,paperTitle:"conflicting content"}],failedStamp),/同一论文内容 ID/);
  assert.equal((await papers.status()).generation,removed.generation);
  assert.deepEqual((await papers.getMany([B.id]))[0],B);
  assert.deepEqual((await page(removed.generation,removed.generation)).entries,[]);
  const missingBase=await send({operation:"page",generation:removed.generation,baseGeneration:randomUUID(),cursor:"",limit:1});
  assert.equal((await missingBase.json()).error.details[0].reason,"CATALOG_BASE_UNAVAILABLE");
  const stalePage=await send({operation:"page",generation:initial.generation,cursor:"",limit:1});
  assert.equal((await stalePage.json()).error.details[0].reason,"CATALOG_GENERATION_CHANGED");
  const records=await send({operation:"records",ids:[A.id,B.id]},paperQueryKind);
  assert.deepEqual((await records.json()).message.parts[0].data.value.map((r:PaperRecord)=>r.id),[A.id,B.id]);
  const compressed=await fetch(origin+"/api/paper-records",{headers:{"Accept-Encoding":"gzip"}});
  assert.equal(compressed.headers.get("Content-Encoding"),"gzip");
  assert.equal((await compressed.json()).total,0);

  const bad=path.join(work,"broken.sqlite");
  writePaperCatalogSqlite(bad,snapshot);
  const sqlite=new DatabaseSync(bad);
  sqlite.prepare("UPDATE dataset_catalog SET id=?").run(A.id);
  sqlite.close();
  assert.throws(()=>cli(["--sqlite",bad]),/缺少对应的精确版本/);
  const changedFile=path.join(work,"different.sqlite");
  writePaperCatalogSqlite(changedFile,{...snapshot,published:[{dsKey:C.dsKey,id:C.id}]});
  assert.throws(()=>cli(["--sqlite",changedFile]),/不能覆盖当前发布/);
  assert.equal((await papers.status()).generation,removed.generation);

  const exportFile=path.join(work,"rollback.sqlite");
  const exported=cli(["--export-sqlite",exportFile]);
  assert.equal(exported.published,0);
  assert.equal(exported.versions,3);
  assert.equal(readPaperCatalogSqlite(exportFile).snapshot.catalog.complete,true);
  assert.throws(()=>cli(["--export-sqlite",exportFile]),/EEXIST/);

  const exportedJson=path.join(work,"catalog.json");
  writeFileSync(exportedJson,JSON.stringify({schema:"oneearth-assertion-dataset-catalog-v1",complete:true,source:"fixture export",
    exportedAt:"2026-01-03T00:00:00.000Z",totalDatasets:1,records:[C]}));
  const formal=cli(["--import",exportedJson],"postgres","scripts/sync-assertion-catalog.ts");
  assert.equal(formal.publishedCount,1);
  assert.equal(formal.versionCount,3);
  assert.deepEqual((await papers.page("",10)).records.map(r=>r.id),[C.id]);
  const restarted=await postgresPaperCatalog(pool);
  assert.equal((await restarted.status()).generation,formal.generation);

  await pool.query("CREATE DATABASE assertion_fixture");
  const upstream=new Pool({connectionString:database("assertion_fixture")});
  try {
    await upstream.query(`
      CREATE TABLE dataset_metadata(ds_key text,title text,version text,publisher text,abstract text,extent_geographic_bbox jsonb,
        extent_temporalelement text,online_resources jsonb,paper_id text,paper_doi text);
      CREATE TABLE ds_axis_meta(ds_key text,n_papers integer);
      CREATE TABLE ev_axis(ds_key text,dataset_id text,paper_id text,doc_id integer,paper_head text,role_function text,variables text,study_context text);
      CREATE TABLE rc_member(ds_key text,paper_id text,rq_id text,dataset_id text);
      CREATE TABLE rc_recipe(paper_id text,rq_id text,paper_title text,task_text text);
      CREATE TABLE ds_meta(ds_key text,source text,spatial text,temporal text,title text,publisher text,
        year integer,version text,resource_type text,landing text,description text);
      INSERT INTO dataset_metadata VALUES ('doi:pg-fixture','Fixture PostgreSQL dataset','v1','Fixture','description','[0,0,5,5]',
        '2020','[]','paper-one','10.0/paper');
      INSERT INTO ds_axis_meta VALUES('doi:pg-fixture',1);
      INSERT INTO ev_axis VALUES('doi:pg-fixture','dataset-one','paper-one',1,'Fixture research','used for measurements','temperature','fixture'),
        ('name:out-of-scope','local-term','paper-one',2,'A paper','another usage','temperature','fixture');
      INSERT INTO dataset_metadata VALUES ('doi:standalone','Metadata with no documented use','v1','Fixture','description',
        NULL,NULL,'[]','unverified-paper','10.0/unverified');
      INSERT INTO ds_meta(ds_key,source,title,version) VALUES
        ('doi:pg-fixture','datacite','Weaker title','indexed v0'),('doi:standalone','datacite','Standalone','v1'),
        ('doi:new-from-source','datacite','Additional source title','A'),('doi:new-from-source','publisher','Additional alternate title','B'),
        ('doi:new-from-source','publisher','Additional alternate title','B');
      INSERT INTO ds_axis_meta VALUES ('doi:new-from-source',1);
      INSERT INTO ev_axis VALUES ('doi:new-from-source','local-use','paper-extra',3,'Usage without richer catalogue','observed','wind','fixture');
    `);
    const sourceEnv={
      ONEEARTH_ASSERTION_PG_HOST:work,ONEEARTH_ASSERTION_PG_PORT:"5432",ONEEARTH_ASSERTION_PG_USER:"paper_fixture",
      ONEEARTH_ASSERTION_PG_DATABASE:"assertion_fixture",
    };
    const sync=(args:string[]=[])=>cli(args,"postgres","scripts/sync-assertion-postgres.ts",sourceEnv);
    const formalPg=sync(["--expected-count","3"]);
    assert.equal(formalPg.readOnly,true);
    assert.equal(formalPg.state,"published");
    assert.equal(formalPg.linkedDatasets,2);
    assert.equal(formalPg.source,"public.ds_meta");
    assert.equal(formalPg.sourceRows,5);
    assert.equal(formalPg.enriched,2);
    assert.equal(formalPg.dsMetaOnly,1);
    assert.equal(formalPg.metadataOnly,1);
    assert.equal(formalPg.preservedCurrent,1);
    assert.equal(formalPg.versionCount,6);
    assert.equal(formalPg.publishedCount,4);
    const current=(await papers.page("",10)).records;
    assert.ok(current.some(record=>record.id===C.id));
    assert.ok(!current.some(record=>record.dsKey==="name:out-of-scope"));
    const extra=current.find(record=>record.dsKey==="doi:new-from-source")!;
    assert.equal(extra.assertionCatalogKind,"metadata-with-usage");
    assert.equal(extra.need.tabs.find(tab=>tab.label==="断言源元数据（各来源原字段）")?.rows?.length,2);
    const quiet=current.find(record=>record.dsKey==="doi:standalone")!;
    assert.equal(quiet.assertionCatalogKind,"metadata-only");
    assert.equal(quiet.papers,0);
    assert.equal(quiet.paperTitle,"");
    const quietCatalog=paperCatalogAccess(papers,{assertion:()=>assert.fail("metadata-only triggered an upstream evidence call")});
    const quietEvidence=(await quietCatalog.evidence(quiet.id)).data;
    assert.equal(quietEvidence.dataset?.title,quiet.need.product);
    assert.equal(quietEvidence.dataset?.version,"v1");
    assert.deepEqual(quietEvidence.papers,[]);
    const paperCatalog=paperCatalogAccess(papers,{assertion:()=>({questions:async()=>({items:[],nextCursor:null}),
      evidence:async(_key,ids)=>({dataset:null,papers:ids.map(identity=>({...identity,title:"A real linked paper",
        abstract:null,usage:"reported use",variables:null,context:null,quotes:[]}))})})});
    const extraEvidence=(await paperCatalog.evidence(extra.id)).data;
    assert.equal(extraEvidence.dataset?.title,extra.need.product);
    assert.equal(extraEvidence.dataset?.version,"A");
    assert.equal(extraEvidence.papers[0].paperId,"paper-extra");
    assert.deepEqual(await quietCatalog.questions(quiet.id),{items:[],nextCursor:null});
    const noop=sync();
    assert.equal(noop.state,"unchanged");
    assert.equal(noop.revision,formalPg.revision);
    assert.equal(noop.generation,formalPg.generation);
    const guard=await withPaperCatalogSync(pool,async()=>sync());
    assert.ok(guard.acquired);
    assert.equal(guard.value.state,"already-running");

    const beganBeforeUpdate=await papers.beginLookup();
    await upstream.query("UPDATE dataset_metadata SET version='v2' WHERE ds_key='doi:pg-fixture'");
    await upstream.query("DELETE FROM ds_meta WHERE ds_key='doi:standalone'");
    await upstream.query("INSERT INTO ds_meta(ds_key,source,title) VALUES ('doi:new-metadata','new source','New metadata')");
    assert.throws(()=>sync(["--expected-count","4"]),/条数或身份 SHA-256/);
    assert.equal((await papers.status()).generation,formalPg.generation);
    assert.equal((await papers.getMany([quiet.id])).length,1);
    const updated=sync();
    assert.equal(updated.publishedCount,formalPg.publishedCount);
    assert.equal(updated.added,1);
    assert.equal(updated.retired,1);
    assert.equal(updated.changed,2);
    assert.equal(updated.preservedCurrent,1);
    assert.notEqual(updated.revision,formalPg.revision);
    const updatedPage=(await papers.page("",10)).records;
    assert.ok(updatedPage.every(record=>record.id!==quiet.id));
    assert.ok(updatedPage.some(record=>record.dsKey==="doi:new-metadata"));
    assert.ok(updatedPage.some(record=>record.id===C.id));
    const before=current.find(record=>record.dsKey==="doi:pg-fixture")!;
    assert.deepEqual((await papers.getMany([quiet.id,before.id,C.id])).map(record=>record.id),[quiet.id,before.id,C.id]);
    const delta=await page(updated.generation,formalPg.generation);
    assert.equal(delta.entries.find(record=>record.id===quiet.id)?.published,false);
    await papers.publishLookup([before],beganBeforeUpdate);
    assert.equal((await papers.status()).revision,updated.revision);
    assert.equal((await upstream.query("SELECT count(*) FROM dataset_metadata")).rows[0].count,"2");
    assert.equal((await upstream.query("SELECT to_regclass('paper_catalog_head') AS table")).rows[0].table,null);
  } finally {await upstream.end();}

  await pool.query("CREATE DATABASE legacy_fixture");
  const legacy=new Pool({connectionString:database("legacy_fixture")});
  try {
    await legacy.query(`
      CREATE TABLE discovery_papers(id text PRIMARY KEY,record jsonb NOT NULL);
      CREATE TABLE discovery_tasks(id text PRIMARY KEY,status text);
      CREATE TABLE discovery_events(id text,payload jsonb,seq bigint PRIMARY KEY);
      INSERT INTO discovery_tasks VALUES ('older','complete'),('newer','complete');
    `);
    await legacy.query("INSERT INTO discovery_papers VALUES($1,$2::jsonb),($3,$4::jsonb)",
      [A.id,JSON.stringify(A),B.id,JSON.stringify(B)]);
    await legacy.query("INSERT INTO discovery_events VALUES('older',$1::jsonb,1),('newer',$2::jsonb,2)",
      [JSON.stringify({result:{papers:[A]}}),JSON.stringify({result:{papers:[B]}})]);
    assert.throws(()=>cli(["--initialize-empty"],"legacy_fixture",cliPath,{ONEEARTH_STATE_DIR:path.join(work,"other-state")}),/旧论文/);
    const replay=cli(["--from-discovery-history"],"legacy_fixture");
    assert.equal(replay.versionCount,2);
    assert.equal(replay.publishedCount,1);
    assert.equal(cli(["--from-discovery-history"],"legacy_fixture").alreadyImported,true);
    const legacyPapers=await postgresPaperCatalog(legacy);
    const recovered=await legacyPapers.page("",10);
    assert.equal(recovered.records[0].id,B.id);
    assert.equal(recovered.catalog.complete,false);
    assert.match(recovered.catalog.source,/有限回放/);
  } finally {await legacy.end();}

  t.diagnostic(JSON.stringify({initial:initial.publishedCount,historyAdded:archived.entries.length,
    withdrawn:withdrawal.entries.length,stableHistoryRevision:true,retainedVersions:exported.versions}));
});
