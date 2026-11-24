import assert from "node:assert/strict";
import test from "node:test";
import {randomUUID} from "node:crypto";
import type {WebHit} from "../src/domain/types";
import type {SourceReadLocator} from "../src/domain/source-read-locator";
import {validSourceReadLocatorResult} from "../src/domain/source-read-locator";
import {prepareSourceRead} from "./discovery-material-operations";
import {readTurnSource} from "./turn-reading";
import {runWebTool} from "./runtime-web-tool-adapter";
import type {DiscoveryWebTools} from "./discovery-web-tools";
import type {SourceRequest} from "./source-fetch";
import {parseWebToolCall,type WebFetchProvider,type WebToolOperation} from "./web-tool-contract";

const signal=()=>new AbortController().signal;
const target=(url:string):WebHit=>({url,title:"Fixture article",snippet:""});
const locator=(kind:SourceReadLocator["kind"],value:string):SourceReadLocator=>({kind,value});
function source(url:string,mime:string,data:Buffer|string){
  const requests:string[]=[];
  const request:SourceRequest=async(address)=>{
    requests.push(address.href);
    assert.equal(address.href,url);
    return {url:address.href,status:200,headers:{"content-type":mime},bytes:Buffer.from(data),truncated:false};
  };
  return {requests,request};
}
function operation(hit:WebHit,provider:WebFetchProvider,locators?:SourceReadLocator[]):WebToolOperation{
  return {kind:"fetch",provider,url:hit.url,hit,...(locators?{locators}:{})};
}

test("one HTML read preserves table headers and cells, section body, formula source and figure limits",async()=>{
  const hit=target("https://evidence.example.org/article");
  const html=`<html><head><title>Fixture article</title></head><body><article>
  ${Array.from({length:25},(_,i)=>`<h2 id="background-${i}">Background ${i}</h2><p>Prior notes on sediment measurements.</p>`).join("")}
  <h2 id="calibration">Calibration</h2><p>We calibrated before sampling.</p>
  <h2 id="results">Results</h2><p>Body from a different section.</p>
  <table id="table-20"><caption>Table 20. Different run.</caption><tr><td>999</td></tr></table>
  <table id="table-2"><caption>Table 2. Sediment rates.</caption><thead><tr><th>Site</th><th>Rate (cm/yr)</th></tr></thead>
  <tbody><tr><td>West</td><td>−0.04</td></tr><tr><td>East</td><td>0.08</td></tr></tbody></table>
  <figure id="fig-1"><figcaption>Figure 1. Map of stations.</figcaption><img src="/unapproved.png" alt="Not extracted image values 777"></figure>
  <div id="eq-4"><math alttext="r = d / t"></math></div></article></body></html>`;
  const f=source(hit.url,"text/html",html);
  const first=(await runWebTool(operation(hit,"原站读取"),signal(),{sourceRequest:f.request})).hits[0];
  assert.ok(!first.locatorResults);
  assert.ok(first.availableLocators?.length&&first.availableLocators.length<=20);
  assert.ok(first.availableLocators.some(x=>x.kind==="table"&&x.value==="2"));
  assert.ok(first.availableLocators.some(x=>x.kind==="figure"));
  assert.ok(first.availableLocators.some(x=>x.kind==="equation"));
  f.requests.length=0;
  const locators=[locator("table","2"),locator("section","Calibration"),locator("figure","1"),locator("equation","4")];
  const result=(await runWebTool(operation(hit,"原站读取",locators),signal(),{sourceRequest:f.request})).hits[0];
  assert.deepEqual(f.requests,[hit.url]);
  assert.deepEqual(result.locatorResults?.map(x=>x.status),["found","found","partial","found"]);
  assert.ok(result.locatorResults?.every((x,i)=>validSourceReadLocatorResult(x,locators[i],hit.url)));
  assert.match(result.locatorResults![0].excerpt!,/"kind":"header","cells":\["Site","Rate \(cm\/yr\)"\]/);
  assert.match(result.locatorResults![0].excerpt!,/"cells":\["West","−0.04"\]/);
  assert.equal(result.locatorResults![0].href,hit.url+"#table-2");
  assert.match(result.locatorResults![1].excerpt!,/calibrated before sampling/);
  assert.doesNotMatch(result.locatorResults![1].excerpt!,/different section/);
  assert.match(result.locatorResults![2].excerpt!,/Map of stations/);
  assert.doesNotMatch(result.pageExcerpt!,/777|999/);
  assert.equal(result.locatorResults![3].excerpt,"r = d / t");
});

test("exact .xml octet-stream requires actual JATS, returns a first-read directory and never follows links",async()=>{
  const hit=target("https://evidence.example.org/open/article.xml");
  const xml=`<?xml version="1.0" encoding="UTF-8"?>
  <!DOCTYPE article SYSTEM "https://evidence.example.org/no-network.dtd">
  <article><front><article-meta><article-id pub-id-type="doi">10.1234/fixture</article-id></article-meta></front>
  <body><sec id="methods"><title>Sampling methods</title><p>We sampled nitrate weekly at three stations and cleaned the probe after collection. Sampling dates were verified in the field notebook before import.</p>
  <table-wrap id="T3"><label>Table 3</label><caption><p>Monthly nitrate.</p></caption><table><thead><tr><th>Station</th><th>NO3 (mg/L)</th></tr></thead>
  <tbody><tr><td>Lake</td><td>2.7</td></tr></tbody></table></table-wrap>
  <fig id="F3"><label>Fig. 3</label><caption><p>Plot of readings.</p></caption><graphic href="https://evidence.example.org/unapproved.png"/></fig>
  <disp-formula id="E5"><label>(5)</label><tex-math><![CDATA[C = m / V]]></tex-math></disp-formula></sec></body></article>`;
  const f=source(hit.url,"binary/octet-stream",xml);
  const service={sourceRequest:f.request};
  const first=(await runWebTool(operation(hit,"原站读取"),signal(),service)).hits[0];
  assert.equal(first.doi,"10.1234/fixture");
  assert.ok(first.availableLocators?.some(x=>x.kind==="table"&&x.value==="3"));
  assert.ok(first.availableLocators?.some(x=>x.kind==="equation"&&x.value==="5"));
  const locators=[locator("table","3"),locator("table","30"),locator("equation","5"),locator("page","2")];
  const got=(await runWebTool(operation(hit,"原站读取",locators),signal(),service)).hits[0];
  assert.deepEqual(got.locatorResults?.map(x=>x.status),["found","not_found","found","unsupported"]);
  assert.match(got.locatorResults![0].excerpt!,/"cells":\["Lake","2.7"\]/);
  assert.match(got.locatorResults![2].excerpt!,/C = m \/ V/);
  assert.equal(got.locatorResults![1].excerpt,undefined);
  assert.deepEqual(f.requests,[hit.url,hit.url]);
  await assert.rejects(runWebTool(operation(hit,"原站读取",locators),signal(),
    {sourceRequest:source(hit.url,"binary/octet-stream","<?xml version='1.0'?><other/>").request}),/JATS/);
  const unknown=target("https://evidence.example.org/archive");
  await assert.rejects(runWebTool(operation(unknown,"原站读取",locators),signal(),
    {sourceRequest:source(unknown.url,"binary/octet-stream",xml).request}),/未取得 HTML/);
});

function pdfFixture(){
  const line=(x:number,y:number,value:string)=>`BT /F1 12 Tf ${x} ${y} Td (${value}) Tj ET`;
  const stream=[
    line(20,750,"Table 2. Groundwater monitoring results"),
    line(20,725,"Well"),line(180,725,"Rate ppm"),
    line(20,705,"South"),line(180,705,"2.75"),
    line(20,685,"North"),line(180,685,"3.22"),
    line(20,635,"Figure 1. Water level by station"),
    line(20,610,"This document reports field conditions and monthly sampling for all monitored wells."),
  ].join("\n");
  const objects=[
    "<< /Type /Catalog /Pages 2 0 R >>","<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    "<< /Length "+stream.length+" >>\nstream\n"+stream+"\nendstream",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body="%PDF-1.4\n";const offsets:number[]=[];
  for(const [index,obj] of objects.entries()){offsets.push(body.length);body+=(index+1)+" 0 obj\n"+obj+"\nendobj\n";}
  return Buffer.from(body+"xref\n0 6\n0000000000 65535 f \n"+offsets.map(i=>String(i).padStart(10,"0")+" 00000 n \n").join("")+
    "trailer\n<< /Root 1 0 R /Size 6 >>\nstartxref\n"+body.length+"\n%%EOF\n");
}

test("PDF locators share one byte snapshot, retain aligned table cells and mark figure caption-only as partial",async()=>{
  const hit=target("https://evidence.example.org/wells.pdf");
  const f=source(hit.url,"application/pdf",pdfFixture());
  const service={sourceRequest:f.request};
  const ordinary=(await runWebTool(operation(hit,"PDF 原文"),signal(),service)).hits[0];
  assert.ok(ordinary.availableLocators?.some(x=>x.kind==="table"&&x.value==="2"));
  assert.ok(ordinary.availableLocators?.some(x=>x.kind==="page"&&x.value==="1"));
  f.requests.length=0;
  const locators=[locator("page","1"),locator("table","2"),locator("figure","1"),locator("page","99")];
  const got=(await runWebTool(operation(hit,"PDF 原文",locators),signal(),service)).hits[0];
  assert.deepEqual(f.requests,[hit.url]);
  assert.deepEqual(got.locatorResults?.map(x=>x.status),["found","partial","partial","not_found"]);
  assert.match(got.locatorResults![1].excerpt!,/"cells":\["South","2.75"\]/);
  assert.equal(got.locatorResults![1].href,hit.url+"#page=1");
  assert.equal(got.locatorResults![2].excerpt,"Figure 1. Water level by station");
  assert.equal(got.locatorResults![3].excerpt,undefined);
});

test("scoped routing keeps a single granted identity, rejects invalid locator requests and skips provider snippets",async()=>{
  const hit=target("https://evidence.example.org/observations");
  const locators=[locator("section","Methods"),locator("table","2")];
  const selected={kind:"web" as const,url:hit.url,title:hit.title,locators};
  const valid=prepareSourceRead({question:"Check the observations",targets:[selected]},true);
  assert.ok("body" in valid);
  assert.deepEqual(valid.body.input.targets[0],{...selected,discoveredBy:undefined});
  for(const bad of [[locator("table","https://example.org/file")],[locator("page","02")],[...locators,...locators],[...locators,...locators,locator("section","Other")]]){
    assert.ok("issue" in prepareSourceRead({question:"Check the observations",targets:[{...selected,locators:bad}]},true));
  }
  const id=()=>randomUUID(), call={taskId:id(),messageId:id(),callId:id()};
  assert.ok(parseWebToolCall({...call,operation:operation(hit,"原站读取",locators)}));
  assert.equal(parseWebToolCall({...call,operation:operation(hit,"DeepSeek Fetch",locators)}),undefined);
  assert.equal(parseWebToolCall({...call,operation:operation(hit,"Zenodo 索引",locators)}),undefined);
  const tools:Pick<DiscoveryWebTools,"originRead"|"pdfRead"|"fetchPage">={
    originRead:async(h,url,_signal,requested)=>{
      assert.equal(url,hit.url);assert.deepEqual(requested,locators);
      return {requestUrl:url,hits:[h],warning:"fixture"};
    },
    fetchPage:async()=>assert.fail("scoped read must not use an unstructured snippet"),
    pdfRead:async()=>assert.fail("no PDF was returned"),
  };
  await readTurnSource(selected,"Check the observations",signal(),true,tools);
});

test("locators match source letter and appendix labels and read a nested, namespaced JATS equation",async()=>{
  const hit=target("https://evidence.example.org/open/lettered.xml");
  const xml=`<article xmlns:mml="http://www.w3.org/1998/Math/MathML">
    <front><article-meta/></front><body><sec id="section-c"><label>II-C.</label><title>Uncertainty analysis</title>
    <p>Calibrated estimates use the same sensor at each station.
    <disp-formula id="eq7"><label>(7)</label><mml:math><mml:mfrac><mml:mi>C</mml:mi><mml:mi>V</mml:mi></mml:mfrac></mml:math></disp-formula></p>
    <table-wrap id="t-b"><label>表 B</label><table><tr><th>Station</th><th>Value</th></tr><tr><td>West</td><td>4.5</td></tr></table></table-wrap>
    <table-wrap id="t-r3"><label>附表 R-3</label><table><tr><td>Trace</td><td>2.6</td></tr></table></table-wrap>
    </sec></body></article>`;
  const f=source(hit.url,"application/xml",xml);
  const locators=[locator("table","表 B"),locator("table","附表 R-3"),locator("section","II-C."),locator("equation","7")];
  const read=(await runWebTool(operation(hit,"原站读取",locators),signal(),{sourceRequest:f.request})).hits[0];
  assert.deepEqual(read.locatorResults?.map(item=>item.status),["found","found","found","found"]);
  assert.match(read.locatorResults![0].excerpt!,/4\.5/);
  assert.match(read.locatorResults![1].excerpt!,/2\.6/);
  assert.match(read.locatorResults![2].excerpt!,/Calibrated estimates/);
  assert.match(read.locatorResults![3].excerpt!,/<mml:mfrac><mml:mi>C<\/mml:mi><mml:mi>V/);
  assert.equal(read.locatorResults![3].href,hit.url+"#eq7");
});

test("complete source bytes can be reused only by a new authorized read of the same URL and research task",async()=>{
  const hit=target("https://evidence.example.org/cached.html");
  const html='<html><title>Field report</title><body><article><h2>Methods</h2><p>Fixture article explains actual collected samples for the same field report. Readings were recorded every hour with calibrated devices.</p><table id="table-2"><caption>Table 2.</caption><tr><th>Site</th><th>Value</th></tr><tr><td>South</td><td>62</td></tr></table></article></body></html>';
  const f=source(hit.url,"text/html",html);
  const opts={sourceSnapshotScope:randomUUID(),sourceRequest:f.request};
  const first=await runWebTool(operation(hit,"原站读取"),signal(),opts);
  assert.equal(first.cacheStoredAt,undefined);
  const focused=operation(hit,"原站读取",[locator("table","2")]);
  const second=await runWebTool(focused,signal(),opts);
  assert.ok(second.cacheStoredAt);
  assert.match(second.hits[0].locatorResults![0].excerpt!,/"cells":\["South","62"\]/);
  assert.deepEqual(f.requests,[hit.url]);
  const other=await runWebTool(focused,signal(),{...opts,sourceSnapshotScope:randomUUID()});
  assert.equal(other.cacheStoredAt,undefined);
  const open=await runWebTool(operation(hit,"原站读取"),signal(),{sourceRequest:f.request});
  assert.equal(open.cacheStoredAt,undefined);
  assert.deepEqual(f.requests,[hit.url,hit.url,hit.url]);
});

test("actual article landing tags return candidate format links without reading or granting those links",async()=>{
  const hit=target("https://evidence.example.org/landing");
  const html=`<html><head><title>Landing</title>
    <meta name="citation_pdf_url" content="/linked.pdf">
    <link rel="alternate" type="application/jats+xml" href="https://archive.example.org/source.xml">
    <link rel="alternate" type="text/xml" href="http://127.0.0.1/internal.xml">
    <link rel="alternate" type="application/pdf" href="https://archive.example.org/source.pdf?signature=temporary">
    </head><body><main>Preview</main></body></html>`;
  const f=source(hit.url,"text/html",html);
  const got=(await runWebTool(operation(hit,"原站读取"),signal(),
    {sourceRequest:f.request,sourceSnapshotScope:randomUUID()})).hits[0];
  assert.equal(got.pageExcerpt,undefined);
  assert.deepEqual(got.sourceAlternates,[
    {url:"https://evidence.example.org/linked.pdf",mediaType:"application/pdf",relation:"citation_pdf_url"},
    {url:"https://archive.example.org/source.xml",mediaType:"application/xml",relation:"alternate"},
  ]);
  assert.deepEqual(f.requests,[hit.url]);
});

test("a bounded JATS index keeps real wrapped tables once and samples late section and equation labels",async()=>{
  const hit=target("https://evidence.example.org/open/long-paper.xml");
  const headings=Array.from({length:28},(_,i)=>`<sec id="section-${i}"><title>Survey section ${i}</title><p>Reported sampling from the published station archive.</p></sec>`).join("");
  const tables=Array.from({length:7},(_,i)=>`<table-wrap id="wrap-${i}"><label>Table ${i+1}</label><caption><p>Measured concentration</p></caption>
    <table id="tbl-${i+31}"><caption>Layout copy ${i+1}</caption><tr><th>Station</th><th>ppb</th></tr><tr><td>West</td><td>${i}</td></tr></table></table-wrap>`).join("");
  const equations=Array.from({length:15},(_,i)=>`<disp-formula id="eq-${i+1}"><label>(${i+1})</label><tex-math>m = c / v</tex-math></disp-formula>`).join("");
  const figures=Array.from({length:12},(_,i)=>`<fig id="fig-${i+1}"><label>Figure ${i+1}</label><caption><p>Source map.</p></caption></fig>`).join("");
  const xml=`<article><front><article-meta/></front><body>${headings}${tables}${equations}${figures}</body></article>`;
  const f=source(hit.url,"binary/octet-stream",xml),opts={sourceRequest:f.request,sourceSnapshotScope:randomUUID()};
  const initial=await runWebTool(operation(hit,"原站读取"),signal(),opts);
  const index=initial.hits[0].availableLocators!;
  assert.equal(index.length,20);
  assert.match(initial.warning!,/位置索引仅列出已识别的有界样本/);
  assert.ok(index.some(entry=>entry.kind==="section"&&entry.label==="Survey section 27"));
  assert.ok(index.some(entry=>entry.kind==="equation"&&entry.value==="15"));
  assert.deepEqual(index.filter(entry=>entry.kind==="table").map(entry=>entry.value),["1","2","3","4","5","6","7"]);
  const omitted=Array.from({length:28},(_,i)=>"Survey section "+(27-i))
    .find(label=>!index.some(entry=>entry.label===label))!;
  const read=await runWebTool(operation(hit,"原站读取",[locator("table","7"),locator("equation","15"),
    locator("section","Survey section 27"),locator("section",omitted)]),signal(),opts);
  assert.ok(read.cacheStoredAt);
  assert.deepEqual(read.hits[0].locatorResults?.map(entry=>entry.status),["found","found","found","found"]);
  assert.deepEqual(f.requests,[hit.url]);
});
