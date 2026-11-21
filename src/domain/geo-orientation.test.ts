import test from "node:test";
import assert from "node:assert/strict";
import { geoOrientation } from "../data/evidence/geo-orientation.mjs";

test("海域识别跨越日期变更线，细分邻海并优先标注陆地", () => {
  assert.match(geoOrientation([-175.36, 15.58]), /北太平洋/);
  assert.match(geoOrientation([175, 15]), /北太平洋/);
  assert.match(geoOrientation([117, 17]), /南海/);
  assert.match(geoOrientation([80, -30]), /印度洋/);
  assert.match(geoOrientation([116, 40]), /中国/);
});
