import { createHash } from "node:crypto";
import { rename, writeFile } from "node:fs/promises";

// A bounded, reproducible query. Keep upstream collection IDs, item identities
// and observation times. Only replace the snapshot after every request succeeds.
const root = "https://earth-search.aws.element84.com/v1";
const bbox = [121.89, 31.39, 121.91, 31.41];
const period = ["1998-01-01T00:00:00Z", "1998-12-31T23:59:59Z"];
const output = new URL(
  "../src/data/evidence/earth-search.json",
  import.meta.url,
);
async function read(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw Error("Earth Search HTTP " + res.status);
  return res.json();
}
const ids = ["landsat-c2-l2", "sentinel-2-l2a"];
const directory = await read(root + "/collections");
const collections = ids.map((id) => {
  const c = directory.collections.find((c) => c.id === id);
  if (!c?.extent?.temporal?.interval?.length)
    throw Error("Missing collection " + id);
  return {
    id,
    title: c.title.trim(),
    intervals: c.extent.temporal.interval,
    bbox: c.extent.spatial.bbox,
    license: c.license,
    links: c.links
      .filter((l) => ["self", "license", "items", "cite-as"].includes(l.rel))
      .map(({ rel, href }) => ({ rel, href })),
  };
});
const searchUrl = new URL(root + "/search");
searchUrl.search = new URLSearchParams({
  collections: ids[0],
  bbox: bbox.join(","),
  datetime: period.join("/"),
  limit: "100",
}).toString();
const data = await read(searchUrl.href);
const items = data.features.map((f) => {
  if (
    f.collection !== ids[0] ||
    !f.properties.datetime ||
    !f.id ||
    f.geometry?.type !== "Polygon"
  )
    throw Error("Unexpected item in upstream search");
  return {
    id: f.id,
    datetime: f.properties.datetime,
    cloud: f.properties["eo:cloud_cover"] ?? null,
    geometry: f.geometry,
    url: f.links.find((l) => l.rel === "self").href,
  };
});
if (
  !Number.isInteger(data.numberMatched) ||
  new Set(items.map((i) => i.id)).size !== data.numberMatched ||
  items.length !== data.numberMatched
)
  throw Error("Incomplete STAC inventory. Previous snapshot retained.");
const revision = createHash("sha256")
  .update(JSON.stringify(items))
  .digest("hex");
const snapshot = {
  fetchedAt: new Date().toISOString(),
  collections,
  sample: {
    revision,
    label: "长江口",
    bbox,
    period,
    collection: ids[0],
    url: searchUrl.href,
    items,
  },
};
const staged = new URL(output.href + "." + process.pid + ".tmp");
await writeFile(staged, JSON.stringify(snapshot, null, 2) + "\n");
await rename(staged, output);
console.log(
  collections.length + " collections, " + items.length + " distinct items",
);
