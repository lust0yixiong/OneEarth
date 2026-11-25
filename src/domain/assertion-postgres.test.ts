import test from "node:test";
import assert from "node:assert/strict";
import type pg from "pg";
import { assertionPgConfig, assertionReader, type AssertionDatasetRow } from "../../server/assertion-postgres";
import { assertionDataset, datasetWindow } from "../../server/assertion-dataset";
import { paperCatalogAccess } from "../../server/paper-catalog-access";
import { validPaperRecord } from "./paper-record";
import { registerPapers } from "./datasets";
import { emptyFilters, spatialEntries } from "./spatial";

const row:AssertionDatasetRow={ds_key:"doi:10.test/dataset",title:"A dataset",version:"v2",publisher:"Publisher",abstract:"Data description",
  extent_geographic_bbox:[120,30,122,32],extent_temporalelement:"2013-06-01/2021-09-30",online_resources:[],paper_id:"paper-1",paper_doi:"10.test/paper",n_papers:2,
  dataset_id:"D1",usage_paper_id:"paper-1",paper_title:"Scientific study",role_function:"Observed variable",variables:"temperature",study_context:"A study in Alaska",
  questions:[{paperId:"paper-1",rqId:"RQ1",datasetId:"D1",paperTitle:"Scientific study",question:"How does the observed variable change?"}],official:[]};

test("PostgreSQL source reads enforce session and transaction read-only mode and roll back on failure",async()=>{
  const config=assertionPgConfig({ONEEARTH_ASSERTION_PG_HOST:"example.test",ONEEARTH_ASSERTION_PG_PORT:"5433",ONEEARTH_ASSERTION_PG_DATABASE:"source",ONEEARTH_ASSERTION_PG_USER:"reader"});
  assert.ok(config);assert.equal(config.ssl,false);assert.match(config.options!,/default_transaction_read_only=on/);
  const statements:string[]=[];let released=0;
  const client={query:async(sql:string)=>{
    statements.push(sql);
    if(sql.includes("current_setting"))return {rows:[{transaction_read_only:"on",default_transaction_read_only:"on"}]};
    if(sql.includes("txid_current_snapshot"))return {rows:[{checkedAt:new Date("2026-01-01T00:00:00Z"),snapshot:"1:1:"}]};
    return {rows:[]};
  },release:()=>released++};
  const pool={connect:async()=>client,end:async()=>{}} as unknown as Pick<pg.Pool,"connect"|"end">;
  const reader=assertionReader(config,pool);
  const snapshot=await reader.snapshot(()=>assert.fail("An empty source must not manufacture datasets"));
  assert.equal(snapshot.readOnly,true);
  assert.equal(statements[0],"BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  assert.equal(statements.at(-1),"ROLLBACK");assert.equal(released,1);
  assert.ok(statements.every(sql=>/^(?:SELECT|BEGIN|ROLLBACK)/.test(sql)));
  statements.length=0;
  client.query=async(sql:string)=>{statements.push(sql);if(sql.includes("current_setting"))return {rows:[{transaction_read_only:"off",default_transaction_read_only:"on"}]};return {rows:[]};};
  await assert.rejects(reader.snapshot(()=>{}),/只读/);
  assert.equal(statements.at(-1),"ROLLBACK");
  assert.ok(!statements.some(sql=>sql.includes("FROM public.ds_meta")),"a failed read-only check prevents source access");
});

test("dataset coverage, version and real research-question identifiers remain independent of study context",()=>{
  const mapped=assertionDataset(row);
  assert.ok(mapped.record && validPaperRecord(mapped.record));
  assert.deepEqual(mapped.record.researchQuestions,row.questions);
  assert.equal(mapped.record.need.type,"论文研究数据");
  assert.deepEqual(mapped.record.need.profile?.years,[2013,2021]);
  assert.deepEqual(mapped.record.need.profile?.utcWindow,[Date.UTC(2013,5,1),Date.UTC(2021,9,1)]);
  assert.ok(mapped.record.need.tabs.some(tab=>tab.label.includes("研究问题") && tab.rows?.[0]?.[0]===row.questions[0].question));
  const missing=assertionDataset({...row,extent_geographic_bbox:null,official:[]});
  assert.equal(missing.record?.need.profile?.area,undefined);
  assert.deepEqual(missing.record?.points,[],"the Alaska study-context label cannot supply dataset geometry");
  const standalone=assertionDataset({...row,usage_paper_id:null}).record!;
  assert.ok(validPaperRecord(standalone));
  assert.equal(standalone.assertionCatalogKind,"metadata-only");assert.equal(standalone.papers,0);
  assert.equal(standalone.paperTitle,"");assert.deepEqual(standalone.researchQuestions,[]);
  assert.ok(standalone.need.tabs.every(tab=>tab.label!=="论文用法（本页）"));
  const located=assertionDataset({...row,extent_geographic_bbox:null,official:[{source:"datacite",spatial:JSON.stringify([{raw_kind:"geoLocations",points:[[31,121]]}]),temporal:null}]}).record!;
  registerPapers([located]);
  assert.equal(spatialEntries(located.id,{...emptyFilters(),period:[2015,2015]},"all").length,1);
  assert.equal(spatialEntries(located.id,{...emptyFilters(),period:[2012,2012]},"all").length,0);
  assert.equal(spatialEntries(located.id,{...emptyFilters(),utcWindow:[Date.UTC(2020,0,1),Date.UTC(2020,1,1)]},"all").length,1);
});

test("conflicting axis ranges are withheld while official points survive, and issue dates are not observation dates",()=>{
  const official=[{source:"datacite",spatial:JSON.stringify([{raw_kind:"geoLocations",points:[[45.762439,-122.330317]]}]),temporal:null}];
  const mapped=assertionDataset({...row,extent_geographic_bbox:[17.9696,-89.7048,46.2339,-66.7987],official});
  assert.equal(mapped.record?.need.profile?.area,undefined);
  assert.deepEqual(mapped.record?.points,[[-122.330317,45.762439]]);
  assert.ok(mapped.issues.some(issue=>issue.includes("不一致")));
  assert.equal(datasetWindow("2025-01-28",[{source:"datacite",spatial:null,temporal:JSON.stringify([{begin:"2025-01-28",date_type:"Issued"}])}]),undefined);
  assert.equal(datasetWindow("2021-09-30/2013-06-01",[]),undefined);
  assert.equal(datasetWindow("2025-02-30",[]),undefined);
  assert.deepEqual(datasetWindow("2021-03-01T00:00:00Z/2021-03-01T01:00:00Z",[]),[Date.UTC(2021,2,1),Date.UTC(2021,2,1,1)+1]);
});

test("paper evidence binds the dataset and paper identities inside a read-only transaction",async()=>{
  const statements:{sql:string;values?:unknown[]}[]=[];
  const client={query:async(sql:string,values?:unknown[])=>{
    statements.push({sql,values});
    if(sql.includes("current_setting"))return {rows:[{transaction_read_only:"on",default_transaction_read_only:"on"}]};
    if(sql.includes("dataset_metadata"))return {rows:[{title:"Argo",description:"Dataset description"}]};
    if(sql.includes("ev_quote_link"))return {rows:[
      {paperId:"p1",datasetId:"d1",blockId:"b1",quote:"Method evidence",section:"Methods",claims:["method"]},
    ]};
    if(sql.includes("rc_member_step"))return {rows:[]};
    if(sql.includes("ev_axis"))return {rows:[{paperId:"p1",datasetId:"d1",title:"Paper",abstract:"Paper abstract"}]};
    return {rows:[]};
  },release(){}};
  const reader=assertionReader({}, {connect:async()=>client,end:async()=>{}} as unknown as Pick<pg.Pool,"connect"|"end">);
  const data=await reader.evidence("doi:10.example/argo",[{paperId:"p1",datasetId:"d1"}]);
  assert.equal(data.dataset?.description,"Dataset description");
  assert.equal(data.papers[0].abstract,"Paper abstract");
  assert.equal(data.papers[0].quotes[0].blockId,"b1");
  assert.equal(statements[0].sql,"BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  assert.equal(statements.at(-1)?.sql,"ROLLBACK");
  assert.ok(statements.every(s=>/^(SELECT|BEGIN|ROLLBACK)/.test(s.sql)));
  for(const statement of statements.filter(s=>s.sql.includes("jsonb_to_recordset"))){
    assert.deepEqual(statement.values,["doi:10.example/argo",'[{"paperId":"p1","datasetId":"d1"}]']);
    assert.match(statement.sql,/e.ds_key=\$1/);
  }
});

test("a fixed source key without its metadata row aborts the read-only snapshot",async()=>{
  const statements:string[]=[];
  const client={query:async(sql:string)=>{
    statements.push(sql);
    if(sql.includes("current_setting"))return {rows:[{transaction_read_only:"on",default_transaction_read_only:"on"}]};
    if(sql.includes("txid_current_snapshot"))return {rows:[{checkedAt:new Date("2026-01-01T00:00:00Z"),snapshot:"1:1:"}]};
    if(sql.includes("FROM public.ds_meta GROUP BY"))return {rows:[{ds_key:row.ds_key,source_rows:1}]};
    return {rows:[]};
  },release(){}};
  const reader=assertionReader({}, {connect:async()=>client,end:async()=>{}} as unknown as Pick<pg.Pool,"connect"|"end">);
  await assert.rejects(reader.snapshot(()=>assert.fail("an incomplete page must not be accepted")),/分页/);
  assert.equal(statements.at(-1),"ROLLBACK");
});

test("ds_meta-only records retain conflicting source descriptions without inventing coverage or usage",()=>{
  const spatial=(lon:number)=>JSON.stringify([{raw_kind:"geoLocations",points:[[45,lon]]}]);
  const collected=(year:string)=>JSON.stringify([{date_type:"Collected",begin:year,end:year}]);
  const sourceA={source:"repository-a",title:"Original metadata title",version:"V1",publisher:"Research archive",
    year:2025,landing:"https://example.org/catalogue",spatial:spatial(110),temporal:collected("2022")};
  const sourceB={source:"repository-b",title:"Alternate wording",version:"V2",publisher:"Another index",
    year:2026,landing:"https://example.org/archive?signature=private",spatial:spatial(111),temporal:collected("2023")};
  const raw={...row,rich_metadata:false,title:null,abstract:null,version:null,publisher:null,usage_paper_id:null,dataset_id:null,
    extent_geographic_bbox:null,extent_temporalelement:null,official:[sourceB,sourceA,sourceB]};
  const result=assertionDataset(raw);
  const record=result.record!;
  assert.ok(validPaperRecord(record));
  assert.equal(record.assertionCatalogKind,"metadata-only");
  assert.equal(record.need.product,sourceA.title);
  assert.deepEqual(record.points,[]);
  assert.equal(record.need.profile?.utcWindow,undefined);
  assert.ok(result.issues.some(issue=>issue.includes("时间覆盖声明不一致")));
  assert.ok(result.issues.some(issue=>issue.includes("空间范围不一致")));
  const notes=record.need.tabs.find(tab=>tab.label==="断言源元数据（各来源原字段）")!;
  assert.deepEqual(notes.rows?.map(cells=>[cells[0],cells[3]]),[["repository-a","V1"],["repository-b","V2"]]);
  assert.doesNotMatch(JSON.stringify(notes),/signature=private/);
  assert.equal(assertionDataset({...raw,official:[sourceA,sourceB]}).record?.id,record.id);
  const timing=assertionDataset({...raw,official:[sourceA]}).record!;
  assert.deepEqual(timing.need.profile?.years,[2022,2022]);
  assert.deepEqual(timing.points,[[110,45]]);
  const noTitle=assertionDataset({...raw,official:[{...sourceA,title:null,temporal:JSON.stringify([{date_type:"Issued",begin:"2025"}])}]}).record!;
  assert.equal(noTitle.need.product,row.ds_key);
  assert.equal(noTitle.need.profile?.utcWindow,undefined);
});

test("published richer metadata still takes its title, version and scope from dataset_metadata",()=>{
  const alternative={source:"source-index",title:"Different indexed title",version:"2024-copy",
    spatial:null,temporal:JSON.stringify([{date_type:"Issued",begin:"2024"}])};
  const rich=assertionDataset({...row,rich_metadata:true,official:[alternative]}).record!;
  const old=assertionDataset({...row,official:[{source:"source-index",spatial:null,temporal:alternative.temporal}]}).record!;
  assert.equal(rich.id,old.id);
  assert.equal(rich.need.product,row.title);
  assert.deepEqual(rich.need.profile?.years,[2013,2021]);
});


test("published ds_meta evidence returns stored metadata and reads papers only for real usage",async()=>{
  const metadata={source:"original-archive",title:"Dataset at its repository",publisher:"Public archive",version:"v3",
    resourceType:"Dataset",description:"Repository summary.",spatial:null,temporal:null};
  const raw={...row,rich_metadata:false,official:[metadata]};
  const linked=assertionDataset(raw).record!;
  const quiet=assertionDataset({...raw,usage_paper_id:null,dataset_id:null}).record!;
  const records=new Map([[linked.id,linked],[quiet.id,quiet]]);
  let reads=0;
  const catalog=paperCatalogAccess({
    async getMany(ids){return ids.flatMap(id=>records.get(id)||[]);},
    async page(){assert.fail("direct lookup must not page the catalog");},
    async beginLookup(){assert.fail("direct lookup must not search");},
    async publishLookup(){assert.fail("direct lookup must not publish");},
  },{
    assertion:()=>({
      async evidence(dsKey,identities){
        reads++;
        assert.equal(dsKey,linked.dsKey);
        assert.deepEqual(identities,[{paperId:"paper-1",datasetId:"D1"}]);
        return {dataset:null,papers:[{paperId:"paper-1",datasetId:"D1",title:"Scientific study",abstract:null,usage:null,variables:null,context:null,quotes:[]}]};
      },
      async questions(){assert.fail("quick preview must not read questions");},
    }),
  });
  const stored={title:metadata.title,description:metadata.description,publisher:metadata.publisher,version:metadata.version,
    resourceType:metadata.resourceType,spatialResolution:null,temporalResolution:null};
  assert.deepEqual((await catalog.evidence(quiet.id)).data,{dataset:stored,papers:[]});
  assert.equal(reads,0);
  const evidence=(await catalog.evidence(linked.id)).data;
  assert.deepEqual(evidence.dataset,stored);
  assert.deepEqual(evidence.papers.map(paper=>paper.paperId),["paper-1"]);
  assert.equal(reads,1);
});
