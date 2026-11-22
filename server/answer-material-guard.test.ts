import assert from "node:assert/strict";
import test from "node:test";
import {materialAccessEvidence,validateAnswerMaterialClaims} from "./answer-material-guard";
import {webMaterial,materialLinkDisplay} from "../src/domain/web-material";
import {citationDetails} from "../src/domain/answer-sources";
import {assetById} from "../src/domain/datasets";
import {emptyFilters} from "../src/domain/spatial";
import type {AnswerReference,DiscoveryContext,WebHit} from "../src/domain/types";
import type {DataSearchResult} from "./data-search";
import type {researchExecutor} from "./research-executor";
import {modelReply} from "./research-answer";

const file="https://fixtures.example/thredds/fileServer/series/release";
const iso="https://fixtures.example/thredds/iso/series/observations.nc";
const service="https://fixtures.example/thredds/dodsC/series/release";
const catalogue="https://fixtures.example/thredds/catalog/series/catalog.html";
const unknown="https://fixtures.example/storage/catalog-page.nc";
const ref:AnswerReference={kind:"web",url:iso,title:"Hourly observations",sourceChannel:"web"};
const hit:WebHit={url:iso,title:ref.title,snippet:"Data description",stage:"page-excerpt",pageExcerpt:"ISO 19115-2 metadata: time bounds and variables."};
const directory:WebHit={url:catalogue,title:"Publisher directory",snippet:"File services",stage:"page-excerpt",
  pageExcerpt:"HTTPServer: "+file+"\nOPeNDAP: "+service};
const reply=(message:string,references:AnswerReference[]=[ref])=>({message,limitation:"",followUp:"",references});

test("THREDDS material follows service semantics independently of the URL suffix or source channel",()=>{
  assert.equal(webMaterial(iso)?.kind,"metadata");
  assert.equal(webMaterial(catalogue)?.kind,"catalogue");
  assert.equal(webMaterial(service)?.kind,"data-service");
  assert.equal(webMaterial(file)?.kind,"file-access");
  assert.equal(webMaterial(unknown),undefined);
  assert.equal(citationDetails(ref,{webSources:[hit]}).type,"web");
  assert.match(citationDetails(ref,{webSources:[hit]}).material!,/ISO 19115 元数据/);
});

test("misleading links are withheld during synthesis and accurately labeled when older replies reopen",()=>{
  const evidence=materialAccessEvidence([hit,directory],[]);
  const bad="**原始文件入口**：[小时级 NetCDF 文件]("+iso+")。〔1〕";
  assert.throws(()=>validateAnswerMaterialClaims(reply(bad),evidence),/ISO 19115 元数据/);
  assert.equal(materialLinkDisplay(bad),"[THREDDS ISO 19115 元数据]("+iso+")。〔1〕");
  assert.throws(()=>validateAnswerMaterialClaims(reply("[直接下载]("+catalogue+")"),evidence),/数据目录/);
  assert.throws(()=>validateAnswerMaterialClaims(reply("[原始文件下载]("+service+")"),evidence),/数据服务/);
  const literal="\x60"+bad+"\x60";
  assert.equal(materialLinkDisplay(literal),literal);
  assert.doesNotThrow(()=>validateAnswerMaterialClaims(reply(literal),evidence));
});

test("explicit directory links and published data entities remain usable without implying a raw file was read",()=>{
  const entity="https://fixtures.example/resources/asset?id=42";
  const evidence=materialAccessEvidence([hit,directory], [entity]);
  const good="ISO 元数据记录了变量〔1〕。 [原始文件下载]("+file+")、[OPeNDAP 数据服务]("+service+") 和 [数据下载]("+entity+") 均为材料列出的入口，尚未确认可用性，也未读取原始数据文件。";
  assert.doesNotThrow(()=>validateAnswerMaterialClaims(reply(good),evidence));
  assert.equal(materialLinkDisplay(good),good);
  const genericPublished="https://fixtures.example/downloads?edition=7";
  const genericEvidence=materialAccessEvidence([{...directory,pageExcerpt:"[下载文件]("+genericPublished+")"}],[]);
  assert.doesNotThrow(()=>validateAnswerMaterialClaims(reply("[原始文件下载]("+genericPublished+")"),genericEvidence));
  const serviceOnly=materialAccessEvidence([{...directory,pageExcerpt:"[OPeNDAP]("+genericPublished+")"}],[]);
  assert.doesNotThrow(()=>validateAnswerMaterialClaims(reply("[OPeNDAP]("+genericPublished+")"),serviceOnly));
  assert.throws(()=>validateAnswerMaterialClaims(reply("[原始文件下载]("+genericPublished+")"),serviceOnly),/材料未确认/);
  const guessed=file.replace("release","different-release");
  assert.throws(()=>validateAnswerMaterialClaims(reply("[原始文件下载]("+guessed+")"),evidence),/材料未确认/);
  const fromNameOnly=materialAccessEvidence([{...directory,stage:"search-snippet",url:unknown}],[]);
  assert.throws(()=>validateAnswerMaterialClaims(reply("[原始文件下载]("+file+")"),fromNameOnly),/材料未确认/);
  const plain200=materialAccessEvidence([{...hit,url:unknown,pageExcerpt:"HTTP 200, file name observations.nc"}],[]);
  assert.throws(()=>validateAnswerMaterialClaims(reply("[NetCDF 文件]("+unknown+")"),plain200),/材料未确认/);
  assert.throws(()=>validateAnswerMaterialClaims(reply("本轮已下载 NetCDF 文件〔1〕。"),evidence),/没有原始数据文件读取回执/);
  assert.throws(()=>validateAnswerMaterialClaims(reply("原始 NetCDF 文件本轮已读取〔1〕。"),evidence),/没有原始数据文件读取回执/);
  assert.throws(()=>validateAnswerMaterialClaims(reply("We downloaded the raw data file〔1〕."),evidence),/没有原始数据文件读取回执/);
  assert.throws(()=>validateAnswerMaterialClaims(reply("本轮已核实此链接可下载〔1〕。"),evidence),/没有原始数据文件读取回执/);
  assert.doesNotThrow(()=>validateAnswerMaterialClaims(reply("论文作者已读取 NetCDF 文件〔1〕。"),evidence));
  assert.doesNotThrow(()=>validateAnswerMaterialClaims(reply("本轮读取了 NetCDF 文件元数据，尚未读取原始文件。〔1〕"),evidence));
});

test("real reply assembly bounds file evidence and repairs false download claims",async(t)=>{
  const original=assetById.get("Q02-0")!;
  const publicFile=original.dataEntities![0].url;
  const signed="https://private.example/object?X-Amz-Signature=FIXTURE_SECRET";
  const internal="https://private.example/opaque-internal-object";
  assetById.set(original.id,{...original,dataEntities:[
    ...original.dataEntities!,
    {label:"Fixture internal evidence object",url:signed,format:"GeoTIFF"},
    {label:"Unlisted resource",url:internal,format:"GeoTIFF"},
  ]});
  t.after(()=>assetById.set(original.id,original));
  const context:DiscoveryContext={caseId:null,filters:emptyFilters(),selection:null,gridSystem:"h3",layer:"all",
    citation:null,candidateIds:[original.id],inCandidateScope:true,camera:{center:[105,25],zoom:1,reason:"fixture"}};
  const query="请核对已给出的观测数据链接类型";
  const retrieved:DataSearchResult={plan:{questionMode:"preserve",dataQuestion:query,dataNeed:null,hainaQueries:[],
    paper:{name:"",facets:[],region:[],scenario:[]},web:[]},papers:[],haina:[],
    searches:[{engine:"DeepSeek Fetch",status:"done",query,requestUrl:iso,hits:[hit,directory]}],issues:[],sourceStatus:[]};
  let asked=0,sourceToken="";
  const draft=(message:string)=>JSON.stringify({message,sections:[],limitation:"",followUp:"",researchNotes:[],calculationRequests:[]});
  const executor:ReturnType<typeof researchExecutor>={
    name:"codex",
    async model(prompt) {
      if (++asked===1) {
        const input=JSON.parse(prompt.slice(prompt.lastIndexOf("\n{")+1));
        assert.doesNotMatch(prompt,/FIXTURE_SECRET|opaque-internal-object|Fixture internal evidence object|dataEntities/);
        assert.ok(input.documentedDataAccessLinks.some((link:{url:string})=>link.url===publicFile));
        const link=input.webResults.find((row:{url:string})=>row.url===iso);
        sourceToken=link.ref;
        assert.equal(link.linkMaterial.kind,"metadata");
        assert.ok(input.documentedDataAccessLinks.some((link:{url:string;kinds:string[]})=>link.url===file&&link.kinds.includes("file-access")));
        return draft("原始文件入口：[NetCDF 文件]("+iso+")。["+sourceToken+"]");
      }
      assert.match(prompt,/指向THREDDS ISO 19115 元数据/);
      return draft("已取得 [ISO 19115 元数据]("+iso+")，原始 NetCDF 文件尚未读取。["+sourceToken+"]");
    },
    async discover(){throw Error("no external research");},
    async read(){throw Error("no external source read");},
    async close(){},
  };
  const result=await modelReply(query,context,{message:""},[],executor,new AbortController().signal,
    undefined,[],"",undefined,retrieved);
  assert.equal(asked,2);
  assert.match(result.message,/ISO 19115 元数据/);
  assert.ok(!result.message.includes("原始文件入口"));
  assert.deepEqual(result.answerNotes?.webSources?.map(source=>source.url),[iso]);
  assert.equal(result.answerNotes?.webSources?.[0].pageExcerpt,hit.pageExcerpt);
});
