import test from "node:test";
import assert from "node:assert/strict";
import {caseObservationUrl, readCaseObservation, readCaseObservationRef} from "./case-observations";

test("a display reference carries only an exact snapshot, source identity and UTC epoch", () => {
  const ref={kind:"usgs-earthquake",snapshotId:"01a1db03-1200-4010-8001-12efa0e431fe",
    id:"us7000test",observedAt:Date.UTC(2024,3,10,12)};
  assert.deepEqual(readCaseObservationRef(ref),ref);
  assert.equal(readCaseObservationRef({...ref,magnitude:2}),undefined);
  assert.equal(readCaseObservationRef({...ref,kind:"goes-19"}),undefined);
  assert.equal(readCaseObservationRef({...ref,id:"/../unknown"}),undefined);
});

test("a saved observation retains original zero and missing values independently of current feed age", () => {
  const kind="awc-metar",id="ZSPD";
  const saved={kind,id,snapshotId:"01a1db03-1200-4010-8001-12efa0e431fe",
    observedAt:Date.UTC(2020,1,12,14),point:[121.8,31.1],stationName:"浦东",
    weather:"",temperatureC:null,windKnots:0,storm:false,sourceUrl:caseObservationUrl(kind,id)};
  assert.deepEqual(readCaseObservation(saved),saved);
  assert.equal(readCaseObservation({...saved,sourceUrl:"https://aviationweather.gov.example.com/"}),undefined);
  assert.equal(readCaseObservation({...saved,point:[121.8,101]}),undefined);
});
