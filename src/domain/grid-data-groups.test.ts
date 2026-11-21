import test from "node:test";
import assert from "node:assert/strict";
import {assetById,type Asset} from "./datasets";
import {emptyFilters} from "./spatial";
import {groupGridData} from "./grid-data-groups";
import {products} from "./product-distribution";
import {dataForTopic,sciencePaths} from "./grid-science-topics";
const base=assetById.get("Q02-0")!;
const record=(id:string,key:string,world=false):Asset=>({...base,id,productId:key,datasetId:key,version:null,profile:{...base.profile!,extent:world?"world":undefined}});

test("grid lists partition indexed local products from global coverage and range descriptions",()=>{
  const local=record("local","a"),localEnvelope=record("local-envelope","a",true),global=record("global","b",true),globalEnvelope=record("global-envelope","b"),range=record("range","c");
  const rows=[local,localEnvelope,global,globalEnvelope,range],groups=groupGridData(rows,new Set(["a"]),emptyFilters());
  assert.deepEqual(groups.local,[local,localEnvelope]);
  assert.deepEqual(groups.global,[global,globalEnvelope]);
  assert.deepEqual(groups.coverage,[range]);
  assert.equal(products(groups.local).size,1);
  assert.equal(products(groups.global).size,1);
  assert.equal(products(groups.coverage).size,1);
  assert.equal(products(groups.all).size,3);
  assert.equal(new Set([...groups.local,...groups.global,...groups.coverage]).size,rows.length,"rows are not repeated between spatial categories");
});

test("an empty authoritative membership keeps coverage-only cells out of the local list",()=>{
  const global=record("global","b",true),range=record("range","c");
  const groups=groupGridData([global,range],new Set(),emptyFilters());
  assert.deepEqual(groups.local,[]);
  assert.deepEqual(groups.global,[global]);assert.deepEqual(groups.coverage,[range]);
});

test("source editions and topic filters stay within the chosen spatial category",()=>{
  const edition1={...base,productId:"shared",version:"v1"},edition2={...base,id:"another-edition",productId:"shared",version:"v2"};
  const other={...base,id:"other-region",productId:"other"};
  const groups=groupGridData([edition1,edition2,other],new Set(["shared"]),emptyFilters());
  assert.equal(groups.local.length,2);assert.equal(products(groups.local).size,1,"dataset counts differ from edition/source record counts");
  const topic=sciencePaths(edition1)[0][0],filtered=dataForTopic(groups.local,topic);
  assert.ok(filtered.includes(edition1));assert.ok(!filtered.includes(other));
  assert.equal(groups.all.length,3);
});
