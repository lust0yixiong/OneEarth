import test from "node:test";
import assert from "node:assert/strict";
import {createHash,randomUUID} from "node:crypto";
import {mkdtemp,rm,writeFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {observationCheckSkill,parseObservationCheck,parseObservationRequest,observationResultMatchesRequest,
  validObservationResult,type ObservationEvidence} from "./observation-check-contract";
import {modelObservationEvidence,parseObservationResearchRequest,parseObservationResearchResult} from "./observation-research-contract";
import {observationArtifact,readObservationArtifact} from "./observation-artifacts";

const describe={skill:observationCheckSkill,purpose:"describe",artifactId:"test-buoy",version:"r1",variable:"wind_speed"} as const;
const check={skill:observationCheckSkill,artifactId:describe.artifactId,version:describe.version,variable:describe.variable,
  unit:"kn",start:"2022-10-31",end:"2022-11-12"} as const;
const evidence:ObservationEvidence={artifactId:describe.artifactId,version:describe.version,variable:describe.variable,
  unit:"kn",count:2,first:"2022-10-31",last:"2022-11-12",sha256:"a".repeat(64)};
const material={artifactId:describe.artifactId,version:describe.version,title:"外海气象记录",variables:["wind_speed"]};

test("description and comparison use different criteria and verified outcome shapes",()=>{
  assert.deepEqual(parseObservationRequest(describe),describe);
  assert.equal(parseObservationCheck(describe),undefined);
  assert.equal(parseObservationRequest({...describe,unit:"kn"}),undefined);
  assert.equal(parseObservationRequest({...describe,start:"1900-01-01",end:"2100-01-01"}),undefined);
  assert.deepEqual(parseObservationRequest(check),check);
  assert(validObservationResult({status:"verified",evidence}));
  assert(validObservationResult({status:"verified",matches:true,evidence}));
  assert(observationResultMatchesRequest({status:"verified",evidence},describe));
  assert(!observationResultMatchesRequest({status:"verified",matches:true,evidence},describe));
  assert(!observationResultMatchesRequest({status:"verified",evidence},check));
  assert(observationResultMatchesRequest({status:"verified",matches:true,evidence},check));
  assert(!observationResultMatchesRequest({status:"verified",matches:false,evidence},check));
});

test("planning receives only authorized stable identities and permitted archived variables",()=>{
  const archived=modelObservationEvidence(evidence);
  const request={researchTaskId:randomUUID(),question:"原记录的单位是什么？",materials:[material],evidence:[archived]};
  assert.deepEqual(parseObservationResearchRequest(request),request);
  assert.equal(parseObservationResearchRequest({...request,materials:[{...material,sha256:evidence.sha256}]}),undefined);
  assert.equal(parseObservationResearchRequest({...request,evidence:[evidence]}),undefined);
  assert.equal(parseObservationResearchRequest({...request,evidence:[{...archived,version:"latest"}]}),undefined);
  assert.equal(parseObservationResearchRequest({...request,materials:[material,material]}),undefined);

  const outcome={action:"answer",basedOn:"archive",evidence:archived};
  assert.deepEqual(parseObservationResearchResult(outcome),outcome);
  assert.equal(parseObservationResearchResult({...outcome,evidence}),undefined);
});

test("operator can authorize manual reading without authorizing a model, and C rechecks policy",async t=>{
  const folder=await mkdtemp(path.join(os.tmpdir(),"oneearth-natural-registry-"));
  t.after(()=>rm(folder,{recursive:true,force:true}));
  const registry=path.join(folder,"registry.json"),file="weather.json";
  const document=JSON.stringify({schema:"oneearth.observations.v1",variables:{wind_speed:{unit:"kn",records:[
    {at:"2022-10-28",value:null},{at:"2022-10-31",value:2},{at:"2022-11-12",value:5}
  ]}}});
  const sha256=createHash("sha256").update(document).digest("hex");
  await writeFile(path.join(folder,file),document);
  const entry={id:describe.artifactId,version:describe.version,path:file,sha256,variables:[describe.variable]};
  await writeFile(registry,JSON.stringify({artifacts:[{...entry,modelVisible:true}]}));
  assert.equal((await readObservationArtifact(describe,registry,sha256,true)).first,evidence.first);
  await writeFile(registry,JSON.stringify({artifacts:[{...entry,modelVisible:false}]}));
  assert.equal(await observationArtifact(describe,registry,true),undefined);
  await assert.rejects(readObservationArtifact(describe,registry,sha256,true),/authorization_changed/);
  assert.equal((await readObservationArtifact(check,registry,sha256)).last,evidence.last);
});

test("an all-empty registered variable still provides a unit and an explicit zero count",async t=>{
  const folder=await mkdtemp(path.join(os.tmpdir(),"oneearth-empty-observation-"));
  t.after(()=>rm(folder,{recursive:true,force:true}));
  const registry=path.join(folder,"registry.json"),file="weather.json";
  const text=JSON.stringify({schema:"oneearth.observations.v1",variables:{wind_speed:{unit:"kn",records:[
    {at:"2022-10-28",value:null},{at:"2022-11-12",value:null}
  ]}}});
  const sha256=createHash("sha256").update(text).digest("hex");
  await writeFile(path.join(folder,file),text);
  await writeFile(registry,JSON.stringify({artifacts:[{id:describe.artifactId,version:describe.version,path:file,
    sha256,variables:[describe.variable],modelVisible:true}]}));
  const result=await readObservationArtifact(describe,registry,sha256,true);
  assert.deepEqual([result.unit,result.count,result.first,result.last],["kn",0,null,null]);
  const candidate={artifactId:describe.artifactId,version:describe.version,title:"无非空记录",variables:[describe.variable]};
  assert(parseObservationResearchRequest({researchTaskId:randomUUID(),question:"最晚哪天？",materials:[candidate],
    evidence:[modelObservationEvidence(result)]}));
});
