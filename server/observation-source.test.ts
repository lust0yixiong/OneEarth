import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdtemp,rm,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import test from "node:test";
import express from "express";
import type {AddressInfo} from "node:net";
import {observationArtifact,observationModelMaterials} from "./observation-artifacts";
import {modelObservationEvidence,validModelObservationEvidence} from "./observation-research-contract";
import {observationMaterialsRoutes} from "./runtime-observation-authority";
import {observationSourceUrl,provenanceForBinding,validObservationSourceBinding} from "../src/domain/observation-source";

const source={
  dataUrl:"https://catalog.example.org/files/ocean.nc",
  catalogUrl:"https://catalog.example.org/item?path=ocean.nc",
  versionLabel:"2026-10-27T02:00:56Z",
  referenceUrls:["https://catalog.example.org/iso/ocean.nc"],
};
const target={artifactId:"registered-ocean-file",version:"frozen-version",variable:"water_temperature"};

test("a source binding preserves the exact reference and accepts only safe public HTTPS links",()=>{
  const binding={...source,artifactId:target.artifactId,version:target.version};
  assert.ok(validObservationSourceBinding(binding));
  assert.equal(observationSourceUrl(source.referenceUrls[0]+"#metadata"),source.referenceUrls[0]);
  assert.notEqual(observationSourceUrl(source.referenceUrls[0]+"?dataset=other"),source.referenceUrls[0]);
  for(const invalid of [
    {...binding,referenceUrls:[...binding.referenceUrls,binding.referenceUrls[0]+"#same-resource"]},
    {...binding,catalogUrl:"https://user:password@catalog.example.org/item"},
    {...binding,dataUrl:"file:///private/original.nc"},
    {...binding,referenceUrls:["javascript:alert(1)"]},
    {...binding,unexpectedPath:"private-file.nc"},
  ]) assert.equal(validObservationSourceBinding(invalid),false);
});

test("the material list publishes only authorized registry associations without exposing the path or digest",async t=>{
  const registryDir=await mkdtemp(path.join(tmpdir(),"oe-source-binding-"));
  const registry=path.join(registryDir,"registry.json");
  const beforeRegistry=process.env.ONEEARTH_SKILL_REGISTRY;
  const beforeToken=process.env.ONEEARTH_SKILL_SERVICE_TOKEN;
  process.env.ONEEARTH_SKILL_REGISTRY=registry;
  process.env.ONEEARTH_SKILL_SERVICE_TOKEN="controlled-token".repeat(3);
  t.after(async()=>{
    if(beforeRegistry===undefined)delete process.env.ONEEARTH_SKILL_REGISTRY;
    else process.env.ONEEARTH_SKILL_REGISTRY=beforeRegistry;
    if(beforeToken===undefined)delete process.env.ONEEARTH_SKILL_SERVICE_TOKEN;
    else process.env.ONEEARTH_SKILL_SERVICE_TOKEN=beforeToken;
    await rm(registryDir,{recursive:true,force:true});
  });
  const file=JSON.stringify({schema:"oneearth.observations.v1",variables:{}});
  const sha256=createHash("sha256").update(file).digest("hex");
  await writeFile(path.join(registryDir,"operator-private-file.json"),file);
  const entry={id:target.artifactId,version:target.version,title:"Authorized file",variables:[target.variable],
    path:"operator-private-file.json",sha256,source,modelVisible:true};
  const set=(artifacts:unknown[])=>writeFile(registry,JSON.stringify({artifacts}));
  await set([entry]);
  const [material]=await observationModelMaterials();
  const grant=await observationArtifact(target,registry,true);
  assert.deepEqual(grant?.sourceBinding,material.sourceBinding);
  assert.equal(provenanceForBinding(grant?.sourceBinding)?.dataUrl,source.dataUrl);

  const app=express().use(observationMaterialsRoutes());
  const server=app.listen(0,"127.0.0.1");
  await new Promise<void>(resolve=>server.once("listening",resolve));
  t.after(()=>new Promise<void>(resolve=>server.close(()=>resolve())));
  const read=async()=>{
    const response=await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/observation-materials`);
    assert.equal(response.status,200);
    return response.json();
  };
  const visible=await read();
  assert.deepEqual(visible,{materials:[{artifactId:target.artifactId,version:target.version,title:entry.title,variables:[target.variable]}],
    sourceBindings:[{...source,artifactId:target.artifactId,version:target.version}]});
  assert.ok(!JSON.stringify(visible).includes(sha256));
  assert.ok(!JSON.stringify(visible).includes(entry.path));
  await set([{...entry,modelVisible:false}]);
  assert.deepEqual(await read(),{materials:[]});
  assert.equal(await observationArtifact(target,registry,true),undefined);
  await set([entry,entry]);
  assert.deepEqual(await read(),{materials:[]});
  await set([{...entry,source:{...source,referenceUrls:["http://localhost/source"]}}]);
  assert.deepEqual(await read(),{materials:[]});
});

test("the model evidence projection leaves file provenance and the digest in trusted archives",()=>{
  const raw={
    ...target,sha256:"a".repeat(64),unit:"K",count:1,first:"2020-01-01",last:"2020-01-01",
    artifactSource:{dataUrl:source.dataUrl,catalogUrl:source.catalogUrl,versionLabel:source.versionLabel},
  };
  const projected=modelObservationEvidence(raw);
  assert.equal(Object.hasOwn(projected,"sha256"),false);
  assert.equal(Object.hasOwn(projected,"artifactSource"),false);
  assert.ok(validModelObservationEvidence(projected));
  assert.equal(validModelObservationEvidence({...projected,artifactSource:raw.artifactSource}),false);
});
