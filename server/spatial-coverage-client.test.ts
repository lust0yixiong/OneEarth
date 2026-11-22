import test from "node:test";
import assert from "node:assert/strict";
import {createServer} from "node:http";
import type {AddressInfo} from "node:net";
import {emptyFilters,gridSpec} from "../src/domain/spatial";
import {verifiedGridContext} from "./question-grid";
import type {DiscoveryContext} from "../src/domain/types";
import {spatialCoverageClient} from "./spatial-coverage-client";

test("coverage reads bind the attached scope and distinguish known zero from an unknown result",async()=>{
  const cell = {id:"874cc5cceffffff",grid:gridSpec("h3",7)};
  const selection={...cell,point:[-66.9,18.4] as [number,number]};
  const summary={selection,filters:{...emptyFilters(),source:"paper",type:"radar",period:[2003,2003] as [number,number]},
    candidateCount:1,candidateIdentity:"a".repeat(64),caseId:null,layer:"all" as const,metric:"products" as const};
  let requests=0;
  const server = createServer(async(req,res)=>{
    requests++;
    const buffers: Uint8Array[] = [];
    for await (const chunk of req) buffers.push(chunk);
    const {id,revision,grid,cells,includeProducts,includeReferences,requireSelection} = JSON.parse(Buffer.concat(buffers).toString());
    if (req.method!=="POST" || req.url!=="/api/coverage/cells" || revision!=="snapshot-a" ||
        grid.key!==cell.grid.key || cells[0]!==cell.id || !includeProducts || !includeReferences || !requireSelection) {
      res.writeHead(400).end();
      return;
    }
    if (id==="expired") {res.writeHead(410).end();return;}
    if (id==="unavailable") {res.writeHead(503).end();return;}
    const count = id==="subset" ? 1 : 0;
    res.setHeader("Content-Type","application/json");
    res.end(JSON.stringify({
      revision:id==="different-revision"?"snapshot-b":revision,
      scope:id==="no-summary"?undefined:summary,
      ready:id==="pending"?[]:[cell.id],cells:count ? [[cell.id,count]] : [],
      members:[[cell.id,count ? ["product:1"] : []]],
      sourceIds:[[cell.id,count ? ["source:1"] : []]],
    }));
  });
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  try {
    const origin = "http://127.0.0.1:"+(server.address() as AddressInfo).port;
    const read = spatialCoverageClient(origin);
    const request = (id: string) => read({scope:{id,revision:"snapshot-a"},cell},new AbortController().signal);
    assert.deepEqual(await request("subset"),{
      cellId:cell.id,gridKey:cell.grid.key,status:"ready",scopeId:"subset",revision:"snapshot-a",
      count:1,members:["product:1"],sourceIds:["source:1"],summary,
    });
    assert.deepEqual(await request("empty"),{
      cellId:cell.id,gridKey:cell.grid.key,status:"ready",scopeId:"empty",revision:"snapshot-a",
      count:0,members:[],sourceIds:[],summary,
    });
    for (const [scope,reason] of [["expired","expired"],["different-revision","expired"],["unavailable","unavailable"],["no-summary","unavailable"]]){
      assert.deepEqual(await request(scope),{
        cellId:cell.id,gridKey:cell.grid.key,status:"unknown",reason,revision:"snapshot-a",
      });
    }
    const current=await request("pending");
    assert.deepEqual(current,{cellId:cell.id,gridKey:cell.grid.key,status:"unknown",reason:"pending",revision:"snapshot-a",summary});
    assert.equal(requests,7);
    const attachment={kind:"dataset" as const,id:"explicit",title:"Explicit file",version:"v1",source:"test"};
    const context:DiscoveryContext={filters:{...emptyFilters(),source:"public",period:[2020,2020]},selection,
      caseId:null,layer:"all",gridSystem:"h3",camera:{center:[-60,15],zoom:1,reason:"test"},citation:null,
      candidateIds:["forged"],candidateVersions:{forged:"v0"},
      attachedScope:[attachment,{kind:"grid",place:"wrong address",selection,
        coverageScope:{id:"pending",revision:"snapshot-a",summary:{...summary,filters:emptyFilters()}}}]};
    const effective=verifiedGridContext(context,current);
    assert.deepEqual(effective.filters,summary.filters);
    assert.deepEqual(effective.attachedScope?.find(item=>item.kind==="grid")?.coverageScope?.summary,summary);
    assert.deepEqual(effective.attachedScope?.[0],attachment);
    assert.deepEqual(effective.candidateIds,["explicit"]);
    assert.deepEqual(effective.candidateVersions,{explicit:"v1"});
  } finally {
    await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  }
});
