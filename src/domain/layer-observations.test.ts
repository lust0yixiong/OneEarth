import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import test from "node:test";
import {
  layerObservationMatchesView, layerObservationSources, localLayerObservationRevisions,
  readLayerObservation, readLayerObservationRef, validRainObservationSource,
} from "./layer-observations";
import type {WorkspaceViewContext} from "./workspace-view-context";

const rainRef={kind:"imerg-cell",datasetId:"nasa:imerg-monthly",revision:"a".repeat(64),
  month:"2024-07",row:650,column:2850,tileRevision:"b".repeat(64)} as const;
const exactSource="https://osdf-director.osg-htc.org/ncar/gdex/d736000/gpm_3imergm_v07/2024/3B-MO.MS.MRG.3IMERG.20240701-S000000-E235959.07.V07B.HDF5";
const ctdRef={kind:"ctd",datasetId:"pangaea:891386",revision:localLayerObservationRevisions.ctd,
  stationId:"346",sampledAt:"1997-07-22T17:45",variable:"temperature",depthM:52} as const;
const frontRef={kind:"glacier-front",datasetId:"zenodo:15241675:fronts",revision:localLayerObservationRevisions.front,
  objectId:"front-0",observedOn:"1984-04-11"} as const;

test("frozen local observations carry the revisions of their published input files",()=>{
  const digest=(files:string[])=>{
    const hash=createHash("sha256");
    for(const file of files)hash.update(readFileSync(new URL("../data/evidence/"+file,import.meta.url))).update("\0");
    return hash.digest("hex");
  };
  assert.equal(localLayerObservationRevisions.ctd,digest(["research-polar.mjs","research-tables.json"]));
  assert.equal(localLayerObservationRevisions.front,digest(["research-shapes.json"]));
});

test("a layer reference supplies its identity without browser measurements or sources",()=>{
  for(const ref of [rainRef,ctdRef,frontRef]){
    assert.deepEqual(readLayerObservationRef(ref),ref);
    assert.equal(readLayerObservationRef({...ref,value:4.42}),undefined);
    assert.equal(readLayerObservationRef({...ref,sourceUrl:"https://example.invalid"}),undefined);
  }
  assert.equal(readLayerObservationRef({...rainRef,row:1800}),undefined);
  assert.equal(readLayerObservationRef({...rainRef,column:3600}),undefined);
  assert.equal(readLayerObservationRef({...ctdRef,sampledAt:"1997-02-29T17:45"}),undefined);
  assert.equal(readLayerObservationRef({...frontRef,objectId:"compare"}),undefined);
});

test("a saved rain reading preserves original publication, zero, and missing data",()=>{
  const saved={...rainRef,point:[105.05,24.95],sourceUrl:exactSource,value:0,
    unit:"mm/day",run:"Final",productVersion:"V07B",complete:true,through:"2024-07-31"} as const;
  assert.deepEqual(readLayerObservation(saved),saved);
  assert.equal(readLayerObservation({...saved,value:null})?.kind,"imerg-cell");
  assert.equal(readLayerObservation({...saved,sourceUrl:layerObservationSources["imerg-cell"]}),undefined);
  assert.equal(readLayerObservation({...saved,sourceUrl:exactSource.replace("20240701","20240801")}),undefined);
  assert.equal(readLayerObservation({...saved,through:"2024-08-01"}),undefined);
  assert.equal(validRainObservationSource("https://climateserv.servirglobal.net/","Late","2024-07"),true);
  assert.equal(validRainObservationSource("https://nasa-power.s3.us-west-2.amazonaws.com/imerg/spatial/power_imerg_monthly_spatial_utc.zarr/IMERG_PRECTOT/318.0.0","Derived","2024-07"),true);
});

test("only the visible ready layer can supply the selected reference",()=>{
  const control={id:"time",label:"降水月份",current:{id:rainRef.month,label:rainRef.month},options:[],ordered:true};
  const view:WorkspaceViewContext={version:1,surface:"earth",activeLayer:{id:"rain",title:"降水",status:"ready",datasetId:rainRef.datasetId,controls:[control]}};
  assert.equal(layerObservationMatchesView(rainRef,view),true);
  assert.equal(layerObservationMatchesView(ctdRef,view),false);
  assert.equal(layerObservationMatchesView(rainRef,{...view,surface:"cases"}),false);
  assert.equal(layerObservationMatchesView({...rainRef,month:"2024-08"},view),false);
  assert.equal(layerObservationMatchesView(rainRef,{...view,activeLayer:{...view.activeLayer!,status:"loading"}}),false);
});
