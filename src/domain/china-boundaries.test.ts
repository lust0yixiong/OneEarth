import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {chinaBoundary,clearChinaBoundaryCache} from "../../server/china-boundaries";

const square = (west: number, south: number, east: number, north: number) => ({
  type: "Polygon" as const,
  coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]],
});
const national = {features: [
  {properties: {name: "浙江省", adcode: 330000, level: "province"}, geometry: square(118, 29, 121, 31)},
  {properties: {name: "北京市", adcode: 110000, level: "province"}, geometry: square(116, 39.5, 116.9, 40.2)},
]};
const zhejiang = {features: [
  {properties: {name: "杭州市", adcode: 330100, level: "city"}, geometry: square(119.9, 30.0, 120.5, 30.6)},
  {properties: {name: "宁波市", adcode: 330200, level: "city"}, geometry: square(121.1, 29.5, 122.1, 30.5)},
]};
const hangzhou = {features: [
  {properties: {name: "上城区", adcode: 330102, level: "district"}, geometry: square(120.1, 30.2, 120.4, 30.4)},
]};
const fetcher = async (url: string) => {
  if (url.includes("/100000_full.json")) return national;
  if (url.includes("/330000_full.json")) return zhejiang;
  if (url.includes("/330100_full.json")) return hangzhou;
  throw Error("unexpected boundary url " + url);
};

async function withDirectory(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(path.join(tmpdir(), "oneearth-cn-"));
  try { await run(directory); } finally { await rm(directory, {recursive: true, force: true}); }
}

test("a city name resolves to its real prefecture outline, not a point", async () => {
  await withDirectory(async directory => {
    const hit = await chinaBoundary("杭州市", [120.2, 30.25], {province: "浙江省", level: "city"}, directory, fetcher);
    assert.equal(hit?.name, "杭州市");
    assert.equal(hit?.adcode, "330100");
    assert.equal(hit?.geometry.type, "Polygon");
    const again = await chinaBoundary("杭州", [120.2, 30.25], {province: "浙江省", level: "city"}, directory, fetcher);
    assert.equal(again?.name, "杭州市");
  });
});

test("a district resolves through its city; municipalities match the national outline", async () => {
  await withDirectory(async directory => {
    const district = await chinaBoundary("上城区", [120.17, 30.25], {province: "浙江省", city: "杭州市", level: "district"}, directory, fetcher);
    assert.equal(district?.name, "上城区");
    const municipality = await chinaBoundary("北京市", [116.4, 39.9], {level: "city"}, directory, fetcher);
    assert.equal(municipality?.name, "北京市");
  });
});

test("a non-administrative feature stays a point, and service failures fall back quietly", async () => {
  await withDirectory(async directory => {
    assert.equal(await chinaBoundary("西湖", [120.15, 30.25], {province: "浙江省", level: null}, directory, fetcher), null);
    clearChinaBoundaryCache();
    assert.equal(await chinaBoundary("杭州市", [120.2, 30.25], {province: "浙江省", level: "city"}, directory,
      async () => { throw Error("offline"); }), null);
  });
});
