import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,readFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {fetchHainaCatalog,hainaAuthorization,hainaConfig,hainaSignedPath,hainaDescription} from "../../server/haina-api";
import {hainaService} from "../../server/haina-search";
import {hainaRecord,validHainaCatalog} from "./haina-record";
import {loadHainaCatalog} from "./haina-catalog-client";
import {assets,assetById,registerHaina,relatedAssets} from "./datasets";
import snapshot from "../data/evidence/haina.json";

const row=(id:number,name="ERA5 temperature")=>({id,name,description:"atmospheric temperature and humidity",provider:"地学数据组",source:"ECMWF",version:"1",
  authorizationType:"Public",dataAddress:"opaque-storage-id",type:"objectStorageData",licenseName:"CC-BY-4.0",labelList:[{topLabelId:"1007",labelNameCn:"栅格"}]});
const page=(list:unknown[],total:number)=>Response.json({success:true,code:200,data:{list,total}});
const config={endpoint:"https://haina.example/api/data-network/openapi/data/area/datasetList",areaId:"2",ak:"",sk:""};
test("Haina signatures match the provider's exact JSON bytes and use the signed gateway path",()=>{
  const body='{"areaId":"2","pageIdx":1,"pageSize":100,"orderByKey":"update_time","orderByType":"desc"}';
  assert.equal(hainaAuthorization("test-ak","test-sk",hainaSignedPath,body,1700000000000),"eyJhbGciOiJNRDUiLCJhcHBLZXkiOiJ0ZXN0LWFrIiwidGltZXN0YW1wIjoiMTcwMDAwMDAwMDAwMCJ9.4296D71E6F2BBF69DE86652C4DF46F7D");
  assert.notEqual(hainaAuthorization("test-ak","test-sk",hainaSignedPath,body,1700000000000),hainaAuthorization("test-ak","test-sk",hainaSignedPath,body+" ",1700000000000));
  assert.ok(hainaConfig({HAINA_ACCESS_KEY_ID:"test-ak",HAINA_SECRET_ACCESS_KEY:"test-sk"}).endpoint.endsWith(hainaSignedPath));
  assert.throws(()=>hainaConfig({HAINA_ACCESS_KEY_ID:"test-ak"}),/不完整/);
});
test("Haina HTML descriptions become readable text without executing or displaying markup",()=>{
  assert.equal(hainaDescription('<p>Temperature &amp; humidity</p><a href="https://example.org">Product history</a><br>QC &lt; 2<script>bad()</script>'),"Temperature & humidity\nProduct history\nQC < 2");
  assert.equal(hainaDescription("temperature\npressure"),"temperature\npressure");
});
test("Haina reads all pages, deduplicates IDs and only sends verified list parameters",async()=>{
  const requests:Record<string,unknown>[]=[];
  const result=await fetchHainaCatalog({config,fetcher:(async(url,init)=>{
    assert.equal(String(url),config.endpoint);assert.equal(init?.method,"POST");
    const body=JSON.parse(String(init?.body));requests.push(body);
    return body.pageIdx===1?page([row(2),row(1)],3):page([row(2),row(3)],3);
  }) as typeof fetch});
  assert.deepEqual(result.rows.map(r=>r.id),[1,2,3]);
  assert.equal(result.total,3);assert.equal(result.pages,2);
  assert.deepEqual(requests[0],{areaId:"2",pageIdx:1,pageSize:100,orderByKey:"update_time",orderByType:"desc"});
  assert.equal(requests[1].pageIdx,2);assert.equal(requests[1].searchProperty,undefined);
});
test("Haina rejects repeated pages, changing totals, early empty pages and Apifox placeholders",async()=>{
  for(const second of [page([row(1)],2),page([],2),page([row(2)],3),Response.json({success:true,code:0,data:"string"})]){
    let n=0;
    await assert.rejects(()=>fetchHainaCatalog({config,fetcher:(async()=>++n===1?page([row(1)],2):second) as typeof fetch}));
  }
  await assert.rejects(()=>fetchHainaCatalog({config,maxPages:1,fetcher:(async()=>page([row(1)],2)) as typeof fetch}),/分页上限/);
});
test("Haina retries a transient connection failure but does not repeat a rejected request",async()=>{
  let n=0;
  await fetchHainaCatalog({config,fetcher:(async()=>{if(++n===1)throw Error("reset");return page([],0);}) as typeof fetch});
  assert.equal(n,2);n=0;
  await assert.rejects(()=>fetchHainaCatalog({config,fetcher:(async()=>{n++;return new Response("",{status:403});}) as typeof fetch}),/403/);
  assert.equal(n,1);
});
test("API catalogues replace Haina everywhere; failed refreshes preserve the last complete catalogue",async()=>{
  const dir=mkdtempSync(path.join(tmpdir(),"haina-api-")),file=path.join(dir,"catalog.json");
  let fail=false;
  const service=hainaService(file,{config,fetcher:(async()=>fail?Response.json({success:false,code:500}):page([row(999991),row(999992,"Argo float profiles")],2)) as typeof fetch});
  try{
    const c=await service.refresh();
    assert.ok(validHainaCatalog(c));
    assert.equal(assets.filter(a=>a.origins.includes("haina")).length,2);
    const a=assetById.get("haina:999991")!;
    assert.ok(a);assert.equal(relatedAssets(a)[0],a);
    assert.match(a.tabs[0].body!,/datasetList/);
    assert.equal(a.dataEntities,undefined,"An opaque storage address is not a downloadable GeoTIFF");
    assert.equal(a.url?.includes("opaque-storage-id"),false);
    const before=readFileSync(file,"utf8");fail=true;
    await assert.rejects(()=>service.refresh());
    assert.equal(readFileSync(file,"utf8"),before);
    const result=await service.search(["ERA5"],new AbortController().signal);
    assert.equal(result.assets[0].id,"haina:999991");assert.equal(result.total,2);assert.match(result.warning,/上次完整目录/);
    assert.equal((await service.page(0,1)).nextCursor,999991);
    assert.deepEqual((await service.page(999991,1)).records.map(r=>r.id),[999992]);
  }finally{registerHaina(snapshot.records,snapshot.synced,config.endpoint);rmSync(dir,{recursive:true,force:true});}
});
test("browser catalogue pagination is atomic and partial answer records do not erase other Haina products",async()=>{
  const records=[hainaRecord(row(999991)),hainaRecord(row(999992))];
  const fetched=await loadHainaCatalog(new AbortController().signal,(async url=>Response.json({records:String(url).endsWith("=0")?[records[0]]:[records[1]],total:2,nextCursor:String(url).endsWith("=0")?999991:null,
    complete:true,synced:"2026-11-13T00:00:00Z",endpoint:config.endpoint,areaId:"2",warning:""})) as typeof fetch);
  assert.deepEqual(fetched.records.map(r=>r.id),[999991,999992]);
  await assert.rejects(()=>loadHainaCatalog(new AbortController().signal,(async()=>Response.json({records:[],total:2,nextCursor:null,complete:true,synced:"2026-11-13T00:00:00Z",endpoint:config.endpoint,areaId:"2"})) as typeof fetch),/未载入完整/);
  try{
    registerHaina(records,fetched.synced,config.endpoint);
    registerHaina([hainaRecord(row(999991,"Updated ERA5"))],fetched.synced,config.endpoint,false);
    assert.equal(assets.filter(a=>a.origins.includes("haina")).length,2);
    assert.equal(assetById.get("haina:999991")?.title,"Updated ERA5");
    assert.equal(assetById.get("haina:999992")?.id,"haina:999992");
  }finally{registerHaina(snapshot.records,snapshot.synced,config.endpoint);}
});
test("a background Haina refresh does not delay searches against a complete index",async()=>{
  const dir=mkdtempSync(path.join(tmpdir(),"haina-background-"));
  let finish:((r:Response)=>void)|undefined,hold=false;
  const service=hainaService(path.join(dir,"catalog.json"),{config,fetcher:(async()=>hold?new Promise<Response>(resolve=>{finish=resolve;}):page([row(999991)],1)) as typeof fetch});
  try{
    await service.refresh();hold=true;
    const refreshing=service.refresh();
    try{
      const result=await Promise.race([service.search(["ERA5"],new AbortController().signal),new Promise<never>((_,reject)=>setTimeout(()=>reject(Error("search waited for background sync")),100))]);
      assert.equal(result.assets[0].id,"haina:999991");
    }finally{finish!(page([row(999991)],1));await refreshing;}
  }finally{registerHaina(snapshot.records,snapshot.synced,config.endpoint);rmSync(dir,{recursive:true,force:true});}
});
