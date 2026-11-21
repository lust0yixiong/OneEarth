import test from "node:test";
import assert from "node:assert/strict";
import { createCoverageClient } from "../globe/coverage-client";
import { emptyFilters, gridSpec } from "./spatial";

const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(done:()=>boolean) {
  for(let i=0;i<300;i++){if(done())return;await pause(5);}
  throw Error("Coverage client did not reach the expected state");
}
test("dragging defers coverage requests and an unfinished index is never cached as a zero match",async()=>{
  const grid=gridSpec("h3",2),filters=emptyFilters();
  let requests=0,cellRequests=0,updates=0;
  const fetcher=(async(url,options)=>{
    requests++;
    const body=JSON.parse(String(options?.body));
    if(String(url).endsWith("scopes"))return Response.json({id:"scope"});
    cellRequests++;
    return Response.json(cellRequests===1?{cells:[],ready:[],pending:2}:{cells:[["a",7]],ready:body.cells,pending:0});
  }) as typeof fetch;
  const client=createCoverageClient(()=>updates++,fetcher);
  try {
    client.read(grid,["a","b"],filters,null,0,true);
    await pause(100);assert.equal(requests,0);
    client.read(grid,["a","b"],filters,null,0);
    await until(()=>updates===1);
    const pending=client.read(grid,["a","b"],filters,null,0);
    assert.equal(pending.pending,true);assert.equal(pending.ready.size,0);
    await until(()=>updates>=2);
    const loaded=client.read(grid,["a","b"],filters,null,0);
    assert.equal(loaded.pending,false);assert.equal(loaded.cells.get("a"),7);
    assert.ok(loaded.ready.has("b"));assert.ok(!loaded.cells.has("b"));
    const before=requests;
    client.read(grid,["b","a"],filters,null,0);
    await pause(100);assert.equal(requests,before,"rotating back reads cached positive and empty cells");
  } finally {client.dispose();}
});

test("a late result cannot repaint a new source scope",async()=>{
  const grid=gridSpec("s2",2),all=emptyFilters(),haina={...all,source:"haina"};
  let release!:(response:Response)=>void,started=false,finished=false;
  const old=new Promise<Response>(resolve=>{release=resolve;});
  const fetcher=(async(url,options)=>{
    const body=JSON.parse(String(options?.body));
    if(String(url).endsWith("scopes"))return Response.json({id:body.filters.source||"all"});
    if(body.id==="all"){started=true;return old;}
    finished=true;return Response.json({cells:[["cell",3]],ready:["cell"],pending:0});
  }) as typeof fetch;
  const client=createCoverageClient(()=>{},fetcher);
  try {
    client.read(grid,["cell"],all,null,0);
    await until(()=>started);
    client.read(grid,["cell"],haina,null,0);
    release(Response.json({cells:[["cell",99]],ready:["cell"],pending:0}));
    await until(()=>finished);
    await pause(10);
    const result=client.read(grid,["cell"],haina,null,0);
    assert.equal(result.cells.get("cell"),3);
    assert.equal(result.pending,false);
  } finally {client.dispose();}
});

test("large view requests are split into bounded cell batches",async()=>{
  const grid=gridSpec("h3",3),filters=emptyFilters(),cells=Array.from({length:1100},(_,i)=>"cell-"+i);
  const sizes:number[]=[];let updates=0;
  const fetcher=(async(url,options)=>{
    const body=JSON.parse(String(options?.body));
    if(String(url).endsWith("scopes"))return Response.json({id:"scope"});
    sizes.push(body.cells.length);return Response.json({cells:[],ready:body.cells,pending:0});
  }) as typeof fetch;
  const client=createCoverageClient(()=>updates++,fetcher);
  try {
    client.read(grid,cells,filters,null,0);
    await until(()=>updates===3);
    assert.deepEqual(sizes,[512,512,76]);
    assert.equal(client.read(grid,cells,filters,null,0).pending,false);
  } finally {client.dispose();}
});


test("followups reuse indexed counts when only answer identity, title or camera changes",async()=>{
  const filters=emptyFilters(),grid=gridSpec("h3",2);
  const batch:import("./types").CandidateSet={title:"first",answerId:"a",ids:["Q02-0","Q02-2"],caseId:null,filters,selection:null,layer:"all",gridSystem:"h3",camera:{center:[0,0],zoom:1,reason:"first"}};
  let requests=0,updates=0;
  const client=createCoverageClient(()=>updates++,(async url=>{
    requests++;
    return String(url).endsWith("scopes")?Response.json({id:"same-data"}):Response.json({cells:[["a",2]],ready:["a"],pending:0});
  }) as typeof fetch);
  try {
    client.read(grid,["a"],filters,batch,0);await until(()=>updates>0);
    const before=requests;
    const next={...batch,title:"followup",answerId:"b",ids:[...batch.ids].reverse(),camera:{center:[40,50] as [number,number],zoom:5,reason:"moved"}};
    const result=client.read(grid,["a"],{...filters},next,0);
    assert.equal(result.pending,false);assert.equal(result.cells.get("a"),2);
    await pause(100);assert.equal(requests,before);
    const changed=client.read(grid,["a"],filters,{...next,ids:["Q02-0"]},0);
    assert.equal(changed.pending,true,"a changed dataset set remains a separate scope");
  } finally {client.dispose();}
});
