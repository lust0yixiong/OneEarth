import test from "node:test";
import assert from "node:assert/strict";
import { geoContains } from "d3-geo";
import { normalizePaperSpace } from "../../server/earthnano";
import { paperIntent } from "../../server/paper-discovery";
import { emptyFilters } from "./spatial";
import type { DiscoveryContext } from "./types";

test("paper metadata keeps an Antarctic longitude band in the southern hemisphere", () => {
  const space = normalizePaperSpace({values:[{value:{bbox:[-180,-90,180,-60]}}]});
  assert.ok(space.area);
  assert.equal(geoContains(space.area,[12,-78]),true);
  assert.equal(geoContains(space.area,[12,48]),false);
});

test("paper metadata maps explicit DataCite points, never a place name or malformed coordinate", () => {
  const space = normalizePaperSpace({values:[{value:{raw_kind:"geoLocations",places:["Alaska"],points:[["69.251","-53.51"],[null,20],["",2],[130,40]]}}]});
  assert.deepEqual(space.points,[[-53.51,69.251]]);
  assert.equal(space.area,undefined);
  assert.equal(normalizePaperSpace({values:[{value:{places:["Alaska"]}}]}).points.length,0);
});

test("DataCite numeric-string bounds remain spatial evidence without coercing empty or null bounds",()=>{
  const space=normalizePaperSpace({values:[{value:{raw_kind:"geoLocations",bbox:["110","40","130","55"]}}]});
  assert.ok(space.area);assert.equal(geoContains(space.area,[120,50]),true);
  for(const west of ["",null,"unknown"])
    assert.equal(normalizePaperSpace({values:[{value:{bbox:[west,40,130,55]}}]}).area,undefined);
});

test("a selected grid does not silently expand a request into an unrestricted literature search", () => {
  const ctx = {caseId:null,filters:emptyFilters(),selection:null} as DiscoveryContext;
  assert.equal(paperIntent("哪些论文用过 ERA5？",ctx),"paper");
  assert.equal(paperIntent("有哪些数据可以参考",ctx),"mixed");
  assert.equal(paperIntent("哪些论文用过 ERA5？",{...ctx, filters:{...ctx.filters,period:[2010,2015]}}),undefined);
});
