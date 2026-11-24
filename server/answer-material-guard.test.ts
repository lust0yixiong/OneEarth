import assert from "node:assert/strict";
import test from "node:test";
import {materialAccessEvidence,validateAnswerMaterialClaims,WebFileClaimError} from "./answer-material-guard";
import {SourceReadClaimError} from "./source-read-provenance";
import {assertModelContextSafe} from "./model-context-safety";
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

test("reported legal table/negation examples remain statements about document evidence, not raw-file receipts",()=>{
  // These are independent guard controls, not recovered real model drafts.
  const legal=[
    "| GPS 时间序列 | 已读取论文表2 | 原始数据文件：未找到 |",
    "原始数据文件：本轮已读取论文表4，未下载原始 GNSS 时间序列。〔1〕",
    "无法实际核实这个入口是否可下载原始数据文件。〔1〕",
    "| 原始数据文件未取得 | 本轮已读取《年度监测报告》中的资料 |",
    "并非本轮已下载原始数据文件〔1〕。",
    "不能据此认定本轮已读取原始数据文件〔1〕。",
    "没有证据表明本轮已下载原始数据文件〔1〕。",
    "没有实际测试该入口可下载原始数据文件。〔1〕",
    "如果本轮已下载原始数据文件，则应存在读取回执。〔1〕",
    "原始数据文件：若本轮已下载，应有读取回执。〔1〕",
    "只有本轮已下载原始数据文件，才可能有本地文件回执。〔1〕",
    "If we have downloaded the raw data files, a receipt would be required.〔1〕",
  ];
  for(const text of legal)assert.doesNotThrow(()=>validateAnswerMaterialClaims(reply(text),new Map()),text);
});

test("one cell or predicate's negation/condition cannot excuse another affirmative file claim",()=>{
  const assertions=[
    "本轮已下载原始数据文件〔1〕。",
    "原始 NetCDF 文件本轮已读取〔1〕。",
    "We have actually downloaded the raw data files〔1〕.",
    "尚未读取元数据，但本轮已下载原始数据文件。〔1〕",
    "如果后续需要，可以再核对，但本轮已下载原始数据文件。〔1〕",
    "| 已读取论文表2 | 本轮已下载原始数据文件 | 其他材料未找到 |",
    "| 原始数据文件 | 本轮已读取 | 尚未验证目录 |",
    "| 原始数据文件 | 已下载〔1〕 |",
    "| 原始数据文件未取得 | 已下载〔1〕 |",
    "| 原始数据文件未取得 | 本轮已读取《观测产品》 |",
    "| 原始数据文件 | 尚未找到 | 本轮已下载原始数据文件 |",
    "| 原始数据文件：本轮已读取论文表4 | 本轮已下载原始数据文件 |",
    "| 本轮已下载原始数据文件 | 不能声称已下载原始数据文件 |",
    "没有实际核验元数据，但本轮已核实入口可下载原始数据文件。〔1〕",
    "本轮实际测试该入口是否可下载原始数据文件。〔1〕",
    "原始数据文件：本轮已读取论文表4中的原始数据文件。〔1〕",
    "不能否认本轮已下载原始数据文件。〔1〕",
    "只有本轮已下载原始数据文件。〔1〕",
    "若干原始数据文件本轮已读取。〔1〕",
  ];
  for(const text of assertions)assert.throws(()=>validateAnswerMaterialClaims(reply(text),new Map()),WebFileClaimError,text);
});

test("the web reference gate still applies across cells and does not block independently backed local asset records",()=>{
  const asset:AnswerReference={kind:"asset",id:"fixture:observation",title:"Local verified observation",source:"受权观测"};
  const row="| 原始数据文件 | 本轮已读取 | 尚未核验元数据 | 〔2〕 |";
  assert.throws(()=>validateAnswerMaterialClaims(reply(row,[asset,ref]),new Map()),WebFileClaimError);
  assert.doesNotThrow(()=>validateAnswerMaterialClaims(reply("本轮已读取原始数据文件〔1〕。",[asset]),new Map()));
});

test("a typed file-claim diagnostic names the actual field and a sanitized bounded offending clause",()=>{
  for(const field of ["message","limitation","followUp"] as const){
    const answer={message:"正文只据已得文献节选。",limitation:"",followUp:"",references:[ref]};
    answer[field]="前文背景".repeat(160)+" 本轮已下载原始 NetCDF 文件〔1〕。";
    assert.throws(()=>validateAnswerMaterialClaims(answer,new Map()),error=>{
      assert.ok(error instanceof WebFileClaimError);assert.ok(error instanceof SourceReadClaimError);assert.equal(error.claim.field,field);assert.match(error.claim.clause,/本轮已下载原始 NetCDF 文件/);assert.ok(Array.from(error.claim.clause).length<=320);assertModelContextSafe(error.claim.clause);return true;
    });
  }
  const unsafe="Authorization: Bearer CONTROLLED_PRIVATE; https://example.org/data?sig=CONTROLLED_SIGNATURE "+"本轮已下载原始数据文件〔1〕。";
  const error=new WebFileClaimError("message",unsafe);
  assert.doesNotMatch(JSON.stringify(error.claim),/CONTROLLED_PRIVATE|CONTROLLED_SIGNATURE|[?&]sig=/);assertModelContextSafe(error.claim.clause);
  const incomplete=new WebFileClaimError("message","-----BEGIN PRIVATE KEY----- CONTROLLED_KEY 本轮已下载原始数据文件。");assert.doesNotMatch(JSON.stringify(incomplete.claim),/CONTROLLED_KEY|BEGIN PRIVATE KEY/);
});

test("negative wording cannot bypass the independent URL-role and access-evidence guards",()=>{
  const access=materialAccessEvidence([hit,directory],[]);
  assert.throws(()=>validateAnswerMaterialClaims(reply("尚未下载原始数据文件。 [直接下载]("+catalogue+")"),access),error=>error instanceof SourceReadClaimError&&!(error instanceof WebFileClaimError));
  assert.throws(()=>validateAnswerMaterialClaims(reply("若本轮已下载原始文件，应有回执。 [原始文件下载]("+file.replace("release","guessed")+")"),access),/材料未确认/);
});
