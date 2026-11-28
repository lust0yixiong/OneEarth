import assert from "node:assert/strict";
import {test} from "node:test";
import {latLngToCell} from "h3-js";
import {flightCatalogueIntent,flightCataloguePlace,matchesFlightGround,validFlightMapReceipt} from "./flight-catalogue";
import {validBrowserWorkspaceReceipt} from "./turn-context";
import {gridSpec} from "./spatial";

test("the supported compound request establishes a flight dependency",()=>{
  assert.equal(flightCataloguePlace("飞到祁连山，再查这里"),"祁连山");
  assert.equal(flightCataloguePlace("不要飞到祁连山，再查这里"),undefined);
  assert.equal(flightCataloguePlace("飞到祁连山，再查敦煌"),undefined);
  assert.equal(flightCataloguePlace("飞到祁连山，再查当前视野"),undefined);
  assert.deepEqual(flightCatalogueIntent("飞到祁连山，再查这里，把结果上球"),{place:"祁连山",present:true});
  assert.deepEqual(flightCatalogueIntent("飞到祁连山，再查中心地面网格"),{place:"祁连山",present:false});
});

test("flight receipt distinguishes actual ground, cancelled, unavailable and superseded outcomes",()=>{
  const point:[number,number]=[99.869,38.362],level=7,id=latLngToCell(point[1],point[0],level);
  const ground={id,level,point};
  const arrived={state:"arrived",observedAt:1,ground};
  assert.ok(validFlightMapReceipt(arrived));
  assert.equal(validFlightMapReceipt({...arrived,ground:{...ground,point:[0,0]}}),false);
  assert.ok(matchesFlightGround(ground,{id,point,grid:gridSpec("h3",level)}));
  assert.equal(matchesFlightGround(ground,{id,point:[0,0],grid:gridSpec("h3",level)}),false);
  const owner={effectId:"workspace:31385cd1-2b9e-45ba-b759-0eb6a13693ff",conversationId:"d15f7065-896b-4916-bdac-9c2ae3e508cc",
    turnId:"4d930b39-18bd-4177-9987-c5acd5a3f8ce"};
  assert.ok(validBrowserWorkspaceReceipt({...owner,state:"applied",flight:arrived}));
  for(const flight of ["cancelled","ground-unavailable","coverage-unavailable","superseded"]){
    const fact={state:flight,observedAt:1};
    assert.equal(validBrowserWorkspaceReceipt({...owner,state:"applied",flight:fact}),false);
    assert.ok(validBrowserWorkspaceReceipt({...owner,state:flight==="superseded"?"stale":"failed",flight:fact}));
  }
});
