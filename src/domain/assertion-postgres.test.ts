import test from "node:test";
import assert from "node:assert/strict";
import type pg from "pg";
import { assertionPgConfig, assertionReader, type AssertionDatasetRow } from "../../server/assertion-postgres";
import { assertionDataset, datasetWindow } from "../../server/assertion-dataset";
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
    if(sql.includes("count(*)"))return {rows:[{n:"0"}]};
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
  assert.ok(!statements.some(sql=>sql.includes("FROM public.dataset_metadata")),"a failed read-only check prevents source access");
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
  assert.equal(assertionDataset({...row,usage_paper_id:null}).record,undefined,"metadata without a verified usage cannot claim a paper link");
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
