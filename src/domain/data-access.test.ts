import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {dataAccessIndex,dataAccessRouter} from "../../server/data-access";
import {accessDatasetKey,accessMembership,initialAccessSection,observationContent,type AccessQuery} from "./data-access";
import {assetIdentity,type Asset} from "./datasets";
import type {Observation} from "./push-observations";
import {readAccessPage} from "./data-access-client";

const query:AccessQuery={section:"clues",query:"",type:"",source:"",page:0,limit:30};
function asset(id:string,extra:Partial<Asset>={}):Asset{
 return {id,datasetId:id,caseId:"haina",needIndex:0,title:id,type:"栅格",categories:["栅格"],status:"来源目录",fit:"目录",why:"",source:"Publisher",origins:["public"],
  url:"https://example.org/"+id,description:"温度 temperature",profile:{role:"data",spatial:"coverage",extent:"world",coverage:"全球目录范围",access:"发布方入口",limitation:""},
  kind:"dataset",tabs:[{kind:"text",label:"预览",quote:"A quote is not ownership"}],...extra};
}
function observation(key:string,observedAt:string,receivedAt:string,file:Observation["file"]=null):Observation{
 return {key,sourceId:"source-a",sourceName:"验收星座",test:false,collection:"thermal",id:key,revision:1,title:key,satellite:"A",observedAt,receivedAt,publishedAt:null,
  geometry:{type:"Point",coordinates:[110,30]},measurements:[{variable:"temperature",value:280,unit:"K"}],file,productUrl:null};
}
test("access categories use explicit holdings and received observations, not evidence previews or provider names",()=>{
 const clue=asset("public-record");assert.deepEqual(accessMembership(clue),{entities:false,clues:true,timely:false});
 assert.deepEqual(accessMembership({...clue,holding:{channelId:"future-channel",channelName:"新接入",access:"restricted"}}),{entities:true,clues:false,timely:false});
 assert.deepEqual(accessMembership({...clue,origins:["constellation"]}),{entities:false,clues:false,timely:true});
 assert.equal(initialAccessSection({source:"haina",result:null}),"entities");
 assert.equal(initialAccessSection({source:"paper",result:null}),"clues");
 assert.equal(initialAccessSection({source:"constellation",result:null}),"timely");
});
test("index links declared dataset identities, keeps editions distinct and excludes full evidence from pages",()=>{
 const index=dataAccessIndex(":memory:");
 try{
  const entity=asset("owned",{canonicalId:"doi:10.1234/test",holding:{channelId:"haina",channelName:"海纳",access:"restricted"},origins:["haina"]});
  const clue=asset("clue",{url:"https://doi.org/10.1234/TEST",title:"同一数据集"});
  const editions=[asset("v1",{productId:"product",version:"1"}),asset("v2",{productId:"product",version:"2"})];
  index.replace([entity,clue,...editions]);
  const page=index.search(query);
  assert.equal(page.counts.entities,1);assert.equal(page.total,3);
  const linked=page.rows.find(r=>r.asset.id==="clue")!;
  assert.equal(linked.entityId,"owned");assert.deepEqual(new Set(linked.relatedIds),new Set(["owned","clue"]));
  assert.equal("tabs" in linked.asset,false);
  assert.notEqual(accessDatasetKey(editions[0]),accessDatasetKey(editions[1]));
  assert.equal(index.search({...query,section:"entities",savedIdentities:[assetIdentity(entity)]}).total,1);
  assert.equal(index.search({...query,section:"entities",savedIdentities:[]}).total,0);
 }finally{index.close();}
});
test("catalogue searches paginate on the server, support Chinese substrings and preserve frozen/saved scopes",()=>{
 const index=dataAccessIndex(":memory:");
 try{
  index.replace(Array.from({length:73},(_,i)=>asset("record-"+String(i).padStart(3,"0"),{title:"地表温度 "+i})));
  const first=index.search({...query,query:"地表温度"}),second=index.search({...query,page:1});
  assert.equal(first.total,73);assert.equal(first.rows.length,30);assert.equal(first.pages,3);
  assert.equal(second.rows.length,30);assert.equal(new Set([...first.rows,...second.rows].map(r=>r.asset.id)).size,60);
  assert.equal(index.search({...query,query:"温度"}).total,73);
  assert.equal(index.search({...query,query:"温度 Publisher"}).total,73);
  assert.equal(index.search({...query,query:"not found"}).total,0);
  assert.equal(index.search({...query,query:'" OR 1=1 --'}).total,0);
  assert.equal(index.search({...query,ids:["record-004"],savedIds:["record-005"]}).total,0);
  assert.deepEqual(index.search({...query,ids:["record-004"]}).rows.map(r=>r.asset.id),["record-004"]);
  index.replace([asset("new")]);assert.equal(index.search(query).total,1);
 }finally{index.close();}
});
test("received records keep acquisition and reception clocks, archive identity and genuine file state",()=>{
 const index=dataAccessIndex(":memory:");
 try{
  const earlier=observation("a".repeat(64),"2026-11-12T10:00:00Z","2026-11-12T11:00:00Z");
  const late=observation("b".repeat(64),"2026-10-01T10:00:00Z","2026-11-13T11:00:00Z",{name:"data.tif",bytes:10,sha256:"f".repeat(64)});
  index.replace([], [earlier,late,{...earlier,key:"c".repeat(64),test:true}]);
  const page=index.search({...query,section:"timely"});
  assert.equal(page.total,2);assert.equal(page.rows[0].observation?.key,late.key);
  assert.equal(page.channels.length,1);assert.equal(page.channels[0].count,2);
  assert.equal(page.rows[0].observation?.observedAt,late.observedAt);
  assert.equal(index.search({...query,section:"entities"}).rows[0].asset.id,page.rows[0].asset.id);
  assert.equal(page.rows[0].asset.version,"r1");
  assert.equal(observationContent(late),"原文件已接收");assert.equal(observationContent(earlier),"观测值已接收");
 }finally{index.close();}
});
test("updating a catalogue replaces old searchable text without stale FTS matches",()=>{
 const index=dataAccessIndex(":memory:");
 try{
  const records=Array.from({length:1000},(_,i)=>asset("updated-"+i,{title:"PreviousLabel "+i,description:"OldDescription"}));
  index.replace(records);assert.equal(index.search({...query,query:"PreviousLabel"}).total,1000);
  index.replace(records.map(a=>({...a,title:"CurrentLabel "+a.id,description:"NewDescription"})));
  assert.equal(index.search({...query,query:"PreviousLabel"}).total,0);
  const current=index.search({...query,query:"CurrentLabel"});assert.equal(current.total,1000);assert.equal(current.rows.length,30);
 }finally{index.close();}
});
test("the catalogue API rejects unsafe categories, excessive pages and invalid limits",async()=>{
 const index=dataAccessIndex(":memory:");index.replace([asset("one")]);
 const app=express();app.use(express.json());app.use("/",dataAccessRouter(index,()=>{}));
 const server=app.listen(0,"127.0.0.1");await new Promise(resolve=>server.once("listening",resolve));
 const address=server.address();assert.ok(address&&typeof address!=="string");
 const fetcher=((_url:RequestInfo|URL,init?:RequestInit)=>fetch("http://127.0.0.1:"+address.port+"/search",init)) as typeof fetch;
 try{
  const page=await readAccessPage(query,new AbortController().signal,fetcher);assert.equal(page.total,1);
  for(const changes of [{section:"clues;DROP TABLE"},{page:-1},{limit:1000},{savedIds:[false]}]){
   const r=await fetcher("/",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...query,...changes})});assert.equal(r.status,400);
  }
 }finally{server.closeAllConnections();server.close();index.close();}
});
