import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const [address,root] = process.argv.slice(2);
const origin = new URL(address);
assert.ok(origin.protocol==="http:" && origin.hostname==="127.0.0.1" && ["8374","8476"].includes(origin.port),
  "Use the Haina isolated read-only entry");
const haina = "/visualizations/haina/";
const viirs = haina+"1835833/global-v1/";
const xuannv = haina+"1846104/coverage-v1/";
const sha = body=>createHash("sha256").update(body).digest("hex");
const get = (route, options)=>fetch(new URL(route,origin), {signal:AbortSignal.timeout(15000),...options});

async function asset(route, media, expected) {
  const response = await get(route);
  assert.equal(response.status,200,route);
  assert.ok(response.headers.get("content-type")?.startsWith(media),route);
  const body = Buffer.from(await response.arrayBuffer());
  const hash = sha(body);
  assert.equal(response.headers.get("etag"),'"'+hash+'"',route);
  if (expected) assert.equal(hash,expected,route);
  return {body,hash};
}
const lamp = JSON.parse((await asset(viirs+"manifest.json","application/json")).body);
const coverage = JSON.parse((await asset(xuannv+"manifest.json","application/json")).body);
assert.deepEqual(lamp.nativeSize,[86400,33600]);
assert.deepEqual(coverage.months,["2025-04","2025-06","2025-08","2025-09","2025-10"]);
assert.equal(new Set(coverage.patches.map(patch=>patch.id)).size,424);
const tiles = ["0/0/0","0/1/0","3/0/4","3/15/4","6/43/17","8/150/222"];
const tileRoute = index=>viirs+"tile/"+lamp.revision+"/"+index+".png";
const tileChecks = await Promise.all(tiles.map(async index=>[index,(await asset(tileRoute(index),"image/png")).hash]));
const sampleRoute = (lon,lat)=>viirs+"sample/"+lamp.revision+"?lon="+lon+"&lat="+lat;
const sample = async (lon,lat)=>JSON.parse((await asset(sampleRoute(lon,lat),"application/json")).body);
const samples = {};
for (const [name,lon,lat] of [
  ["NYC",-73.9875,40.75],["Tokyo",139.766666,35.68],["Nairobi",36.8172,-1.2864],
  ["Sydney",151.2093,-33.8688],["east",179.994,-16.5],["west",-179.994,-16.5],
  ["north",0,85],["south",0,-85],["longDecimal",0.1+0.2,-1.2345678901234567],["zeroRoundoff",-1e-7,60],
]) samples[name]=await sample(lon,lat);
assert.equal(samples.NYC.value,275.8699951171875);
assert.equal(samples.Nairobi.value,53.90999984741211);
assert.equal(samples.zeroRoundoff.status,"value");
assert.equal(samples.zeroRoundoff.value,0);
assert.equal(samples.north.status,"out-of-coverage");
assert.equal(samples.south.status,"out-of-coverage");
assert.notEqual(samples.east.column,samples.west.column);
assert.deepEqual(await sample(180,0),await sample(-180,0));
const revision404=await get(viirs+"tile/"+"0".repeat(64)+"/0/0/0.png");
assert.equal(revision404.status,404);
assert.equal((await get(tileRoute("3/16/4"))).status,400);
assert.equal((await get(sampleRoute("NaN",30))).status,400);
assert.equal((await get(sampleRoute(181,30))).status,400);
assert.equal((await get(tileRoute(tiles[0]),{headers:{"if-none-match":'"'+tileChecks[0][1]+'"'}})).status,304);
const concurrent = await Promise.all(Array.from({length:10},()=>asset(tileRoute("5/32/14"),"image/png")));
assert.equal(new Set(concurrent.map(row=>row.hash)).size,1);

const records = (await readFile(path.join(root,"frames.ndjson"),"utf8")).trim().split("\n").map(line=>JSON.parse(line));
assert.equal(records.length,2120);
const indexed = new Map(coverage.patches.map(row=>[row.id,row]));
const byMonth={};
let bytes=0;
let cursor=0;
await Promise.all(Array.from({length:12},async()=>{
  for (let row=records[cursor++];row;row=records[cursor++]) {
    const patch = indexed.get(row.patch);
    assert.ok(patch.months.includes(row.month));
    assert.deepEqual(patch.bounds,row.bounds);
    const s = await asset(xuannv+"frame/"+coverage.revision+"/"+row.patch+"/"+row.month+".png","image/png",row.sha256);
    assert.equal(s.body.length,row.bytes);
    byMonth[row.month]=(byMonth[row.month]||0)+1;
    bytes+=s.body.length;
  }
}));
assert.ok(coverage.months.every(month=>byMonth[month]===424));
assert.equal((await get(xuannv+"frame/"+coverage.revision+"/patch_000186/2025-07.png")).status,404);
const scope = coverage.patches.find(patch=>patch.id==="patch_000364").bounds;
const match = await get("/api/spatial/layers/haina-1846104-coverage/chunks?level=0&start=2025-10-01&end=2025-10-31&bbox="+scope.join(","));
assert.equal(match.status,200);
assert.ok((await match.json()).chunks.some(row=>row.route.endsWith("/patch_000364/2025-10.png")));
await asset(haina+"1835839/public-v1/manifest.json","application/json","284734a737442f36f0adde45fd1578a45fe3acc100da0c920fd0b1b020f73156");
console.log(JSON.stringify({origin:origin.origin,viirs:{revision:lamp.revision,tiles:tileChecks,samples,deduplicatedResult:concurrent[0].hash},xuannv:{revision:coverage.revision,patches:indexed.size,objects:records.length,bytes,byMonth}},null,2));
