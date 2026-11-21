import test from "node:test";
import assert from "node:assert/strict";
import {basemapBbox, BASEMAPS, basemapStyle} from "../globe/basemaps";

test("the export box follows the camera scale and keeps the centre inside",()=>{
  const city = basemapBbox([120.15, 30.27], 45, 1388, 894);
  const [west, south, east, north] = city;
  assert.ok(west < 120.15 && east > 120.15 && south < 30.27 && north > 30.27);
  assert.ok(east - west < 8, "city view must not request half a continent: " + (east - west));
  assert.ok(north - south < 8);
  const regional = basemapBbox([120.15, 30.27], 10, 1388, 894);
  assert.ok(regional[2] - regional[0] > city[2] - city[0], "zooming out widens the box");
  const world = basemapBbox([0, 0], 1, 1440, 900);
  assert.ok(world[0] >= -180 && world[2] <= 180 && world[1] >= -85 && world[3] <= 85);
});

test("polar and dateline boxes stay inside the exportable world",()=>{
  const north = basemapBbox([100, 84], 3, 1200, 800);
  assert.ok(north[1] >= -85 && north[3] <= 85);
  const dateline = basemapBbox([179, 0], 2, 1200, 800);
  assert.ok(dateline[0] >= -180 && dateline[2] <= 180);
});

test("every offered basemap carries a provider and attribution",()=>{
  for(const style of BASEMAPS){
    assert.ok(style.name && style.service && style.attribution, style.id);
    assert.equal(basemapStyle(style.id)?.name, style.name);
  }
  assert.equal(basemapStyle(null), undefined);
});
