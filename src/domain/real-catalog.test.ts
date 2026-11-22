import {literatureDisplay} from "./literature-label";
import test from "node:test";
import { gunzipSync } from "node:zlib";
import assert from "node:assert/strict";
import express from "express";
import { IncomingMessage, ServerResponse } from "node:http";
import { Duplex } from "node:stream";
import type { Socket } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { assets, assetById, registerPapers, registerObservations, discoverableAsset } from "./datasets";
import { catalogResults, catalogGrid, canMapAsset, type SearchState } from "./results";
import { gridSpec, cellAt, emptyFilters } from "./spatial";
import { productKey } from "./product-distribution";
import { loadPaperCatalog } from "./paper-catalog-client";
import { validPaperRecord, type PaperRecord } from "./paper-record";
import { pushId, type Observation } from "./push-observations";
import { paperCatalog } from "../../server/paper-catalog";
import { paperCache } from "../../server/earthnano";
import { constellationService } from "../../server/constellations";

const record: PaperRecord = {
  id:"earthnano:"+"a".repeat(64),dsKey:"doi:10.1234/record",papers:1,paperTitle:"Archived usage",studyContext:"",points:[],
  need:{name:"论文中的数据使用",product:"Recorded dataset",type:"论文抽取线索",detail:"用法来自断言库。",status:"有论文用法记录",source:"EarthNano 论文断言库",datasetId:"doi:10.1234/record",
    profile:{role:"data",spatial:"nonspatial",coverage:"未提供坐标",access:"见断言库",limitation:""},
    tabs:[{kind:"table",label:"论文用法（本页）",columns:["论文","角色","变量","研究背景","论文 ID","数据集 ID"],rows:[["Archived usage","input","temperature","","paper-1","data-1"]]}]},
};
const search: SearchState = {query:"",type:"",source:"",savedOnly:false,kind:"all",result:null,compare:[]};

async function request(app: express.Express, url: string, body?: unknown, acceptsGzip = false) {
  const chunks: Buffer[]=[];
  const wire=new Duplex({read(){},write(chunk,_encoding,callback){chunks.push(Buffer.from(chunk));callback();}});
  const req=new IncomingMessage(wire as Socket);
  req.method=body===undefined?"GET":"POST";req.url=url;
  const payload=body===undefined?null:JSON.stringify(body);
  req.headers={host:"localhost",...(acceptsGzip?{"accept-encoding":"gzip"}:{}),
    ...(payload?{"content-type":"application/json","content-length":String(Buffer.byteLength(payload))}:{})};
  Object.assign(req,{body});
  const res=new ServerResponse(req);res.assignSocket(wire as Socket);
  await new Promise<void>((resolve,reject)=>{res.once("finish",resolve);res.once("error",reject);app(req,res);});
  const bytes=Buffer.concat(chunks), payloadBytes=bytes.subarray(bytes.indexOf("\r\n\r\n")+4);
  const contentEncoding=res.getHeader("content-encoding");
  const text=(contentEncoding==="gzip"?gunzipSync(payloadBytes):payloadBytes).toString();
  wire.destroy();
  return {status:res.statusCode,contentEncoding,body:text.startsWith("{")||text.startsWith("[")?JSON.parse(text):text};
}

test("data discovery includes only actual records; static cases cannot impersonate assertion-library paper clues", () => {
  assert.equal(assets.some(a=>a.origins.includes("paper")),false);
  assert.equal(catalogResults({...search,source:"paper"},[]).length,0);
  assert.ok(catalogResults(search,[]).length>0);
  assert.ok(catalogResults(search,[]).every(a=>a.kind==="dataset"));
  registerPapers([{...record,id:"earthnano:"+"b".repeat(64),papers:0}]);
  assert.equal(assetById.has("earthnano:"+"b".repeat(64)),false);
  registerPapers([record]);
  assert.equal(validPaperRecord(record),true);
  assert.deepEqual(catalogResults({...search,source:"paper"},[]).map(a=>a.id),[record.id]);
  assert.equal(catalogResults({...search,source:"paper",query:"no-such-dataset"},[]).length,0);
  assert.equal(catalogResults({...search,kind:"requirement"},[]).length,0);
  const observation:Observation={key:"c".repeat(64),sourceId:"fixture",sourceName:"Fixture",test:true,collection:"observations",id:"scene-1",revision:1,title:"Test only",satellite:"TEST",observedAt:"2025-01-01T00:00:00Z",publishedAt:null,receivedAt:"2025-01-01T01:00:00Z",geometry:{type:"Point",coordinates:[0,0]},measurements:[{variable:"temperature",value:1,unit:"K"}],productUrl:null,file:null};
  registerObservations([observation],true);
  assert.equal(discoverableAsset(assetById.get(pushId(observation))!),false);
  assert.equal(catalogResults({...search,source:"constellation"},[]).length,0);
  const actual={...observation,key:"d".repeat(64),test:false};
  registerObservations([observation,actual],true);
  assert.deepEqual(catalogResults({...search,source:"constellation"},[]).map(a=>a.id),[pushId(actual)]);
  registerObservations([],true);
});

test("assertion catalog separates cached records, live misses, failed queries and invalid evidence", async () => {
  const cache=paperCache(":memory:");
  const appFor=(lookup: Parameters<typeof paperCatalog>[1])=>{const app=express();app.use("/papers",paperCatalog(cache,lookup));return app;};
  try {
    cache.save(record);
    const cacheReply=await request(appFor(async()=>({records:[],tools:[],incomplete:[]})),"/papers");
    assert.equal(cacheReply.status,200);assert.equal(cacheReply.body.cached,true);assert.equal(cacheReply.body.records[0].id,record.id);
    const app=appFor(async plan=>{assert.equal(plan.name,"missing");return {records:[],tools:[],incomplete:[]};});
    const miss=await request(app,"/papers/search",{query:"missing"});
    assert.equal(miss.status,200);assert.deepEqual(miss.body.records,[]);assert.equal(miss.body.cached,false);
    const failure=await request(appFor(async()=>{throw Error("offline");}),"/papers/search",{query:"missing"});
    assert.equal(failure.status,503);assert.deepEqual(failure.body.records,[]);
    const invalid=await request(appFor(async()=>({records:[{...record,papers:0}],tools:[],incomplete:[]})),"/papers/search",{query:"missing"});
    assert.equal(invalid.status,503);assert.deepEqual(invalid.body.records,[]);
    const found=await request(appFor(async()=>({records:[record],tools:[],incomplete:[]})),"/papers/search",{query:"Recorded dataset"});
    assert.equal(found.status,200);assert.equal(found.body.records[0].id,record.id);
    assert.equal((await request(app,"/papers/search",{query:" "})).status,400);
    assert.equal((await request(app,"/papers?ids=invalid")).status,400);
    assert.deepEqual((await request(app,"/papers?ids="+record.id)).body,literatureDisplay([record]));
    assert.equal(validPaperRecord({...record,need:{...record.need,tabs:[]}}),false);
  } finally {cache.close();}
});

test("gzip paper pages refresh when another SQLite connection publishes to the same catalogue", async () => {
  const dir=mkdtempSync(path.join(tmpdir(),"oneearth-paper-gzip-"));
  const file=path.join(dir,"papers.sqlite");
  const cache=paperCache(file),writer=paperCache(file);
  const app=express();
  app.use("/papers",paperCatalog(cache));
  const url="/papers?view=catalog&limit=2";
  const updated={...record,id:"earthnano:"+"c".repeat(64)};
  try {
    cache.save(record);
    const before=await request(app,url,undefined,true);
    assert.equal(before.contentEncoding,"gzip");
    assert.deepEqual(before.body.records.map((r:PaperRecord)=>r.id),[record.id]);

    writer.replaceCatalog([updated],{source:"other connection",sourceTotal:1,filteredOut:0,updatedAt:"2026-11-22T00:00:00Z"});
    const after=await request(app,url,undefined,true);
    assert.equal(after.contentEncoding,"gzip");
    assert.deepEqual(after.body.records.map((r:PaperRecord)=>r.id),[updated.id]);
    assert.equal(after.body.catalog.complete,true);
    assert.equal(after.body.catalog.source,"other connection");

    writer.replaceCatalog([],{source:"empty publication",sourceTotal:0,filteredOut:0,updatedAt:"2026-11-22T01:00:00Z"});
    const empty=await request(app,url,undefined,true);
    assert.equal(empty.contentEncoding,"gzip");
    assert.deepEqual(empty.body.records,[]);
    assert.equal(empty.body.catalog.complete,true);
    assert.equal(empty.body.total,0);
  } finally {writer.close();cache.close();rmSync(dir,{recursive:true,force:true});}
});

test("production constellation feed, satellite names and configured counts exclude test sources and records", () => {
  const dir=mkdtempSync(path.join(tmpdir(),"oneearth-real-feed-")),file=path.join(dir,"obs.sqlite");
  const service=constellationService(file,{test:{name:"test",token:"x".repeat(24),test:true},real:{name:"real",token:"y".repeat(24)}});
  let db:DatabaseSync|undefined;
  try {
    assert.equal(service.latest().configured,1);
    db=new DatabaseSync(file);
    const insert=db.prepare("INSERT INTO observations (key,source,collection,scene,rev,observed,hash,payload) VALUES (?,?,?,?,?,?,?,?)");
    for(const [key,isTest] of [["e".repeat(64),true],["f".repeat(64),false]] as const){
      const row={key,sourceId:isTest?"test":"real",test:isTest,satellite:isTest?"TEST":"REAL",observedAt:"2025-01-01T00:00:00Z"};
      insert.run(key,row.sourceId,"collection",key,1,row.observedAt,key,JSON.stringify(row));
    }
    assert.deepEqual(service.latest().records.map(r=>r.satellite),["REAL"]);
    assert.deepEqual(service.satellites(),["REAL"]);
    assert.equal(service.latest(undefined,["constellation:"+"e".repeat(64)]).records.length,0);
  } finally {db?.close();service.close();rmSync(dir,{recursive:true,force:true});}
});

test("all assertion datasets load beyond 200 rows, deduplicate canonically, and retain historical evidence", async () => {
  const cache=paperCache(":memory:");
  const records=Array.from({length:601},(_,i):PaperRecord=>({...record,id:"earthnano:"+(i+100).toString(16).padStart(64,"0"),dsKey:"dataset:"+String(i).padStart(4,"0")}));
  try {
    cache.replaceCatalog(records,{source:"assertion export",sourceTotal:603,filteredOut:2,updatedAt:"2026-11-11T00:00:00Z"});
    assert.equal(cache.status().complete,true);assert.equal(cache.list().length,601);
    const pages:number[]=[],loaded:PaperRecord[]=[];
    await loadPaperCatalog(new AbortController().signal,(items,status)=>{pages.push(items.length);loaded.push(...items);assert.equal(status.complete,true);},async url=>{
      const parsed=new URL(String(url),"http://localhost");
      return Response.json(cache.page(parsed.searchParams.get("cursor")||"",Number(parsed.searchParams.get("limit"))));
    });
    assert.deepEqual(pages,[500,101]);assert.equal(new Set(loaded.map(r=>r.dsKey)).size,601);
    assert.throws(()=>cache.replaceCatalog([record],{source:"bad export",sourceTotal:99,filteredOut:0,updatedAt:"2026-11-11T00:00:00Z"}));
    assert.equal(cache.list().length,601);
    cache.replaceCatalog([records[1]],{source:"next export",sourceTotal:1,filteredOut:0,updatedAt:"2026-11-11T01:00:00Z"});
    assert.equal(cache.list().length,1);assert.equal(cache.get(records[0].id)?.dsKey,records[0].dsKey);
    await assert.rejects(()=>loadPaperCatalog(new AbortController().signal,()=>{},async()=>Response.json({records:[],nextCursor:null,total:301,catalog:{complete:true}})),/总数/);
  } finally {cache.close();}
});

test("assertion catalogue joins all sources and the globe only where official spatial evidence exists", () => {
  const grid=gridSpec("h3",2),filters={...emptyFilters(),source:"paper"};
  catalogGrid(grid,filters); // Warm the prior revision: importing new papers must invalidate it.
  const point:PaperRecord={...record,id:"earthnano:"+"1".repeat(64),dsKey:"dataset:official-point",points:[[116,40]],need:{...record.need,product:"Official point dataset",profile:{...record.need.profile!,spatial:"coverage"}}};
  const unknown:PaperRecord={...record,id:"earthnano:"+"2".repeat(64),dsKey:"dataset:no-spatial-evidence",need:{...record.need,product:"No-location dataset",profile:{...record.need.profile!,spatial:"coverage"}}};
  registerPapers([point,unknown]);
  const all=catalogResults(search,[]);
  assert.ok(all.some(a=>a.id===point.id));assert.ok(all.some(a=>a.id===unknown.id));
  assert.equal(canMapAsset(assetById.get(point.id)!),true);
  assert.equal(canMapAsset(assetById.get(unknown.id)!),false);
  assert.equal(productKey(assetById.get(point.id)!),point.dsKey);
  assert.ok(catalogGrid(grid,filters).get(cellAt([116,40],grid))?.has(point.dsKey));
  const revised={...point,id:"earthnano:"+"3".repeat(64)};
  registerPapers([revised]);
  assert.equal(catalogResults({...search,source:"paper"},[]).filter(a=>a.datasetId===point.dsKey).length,1);
  assert.ok(assetById.has(point.id),"old shared evidence remains addressable");
});
