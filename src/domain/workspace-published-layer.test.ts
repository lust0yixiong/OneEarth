import assert from "node:assert/strict";
import {test} from "node:test";
import {validWorkspacePublishedLayerAction} from "./workspace-published-layer";
import {validWorkspaceViewContext} from "./workspace-view-context";

const revision="a".repeat(64);

test("opening a published layer accepts a stable city or exact calendar date",()=>{
  const city={kind:"open-published-layer",datasetId:"haina:1846639",valueId:"shanghai-chn",publicationRevision:revision};
  const day={kind:"open-published-layer",datasetId:"haina:1846764",valueId:"2024-03-26",publicationRevision:revision};
  assert(validWorkspacePublishedLayerAction(city));
  assert(validWorkspacePublishedLayerAction(day));
  assert(!validWorkspacePublishedLayerAction({...city,valueId:"上海"}));
  assert(!validWorkspacePublishedLayerAction({...day,valueId:"2024-02-30"}));
  assert(!validWorkspacePublishedLayerAction({...day,publicationRevision:"latest"}));
  assert(!validWorkspacePublishedLayerAction({...city,center:[121,31]}));
  assert(!validWorkspacePublishedLayerAction({...city,datasetId:"haina:1835833"}));
});

test("old workbench snapshots remain valid and new clients advertise support with a typed capability",()=>{
  const legacy={version:1,surface:"earth"};
  assert(validWorkspaceViewContext(legacy));
  assert(validWorkspaceViewContext({...legacy,publishedLayerActions:true}));
  assert(!validWorkspaceViewContext({...legacy,publishedLayerActions:"true"}));
});
