import {
  pointFromQuery,
  sceneDocument,
  type SceneLookup,
} from "../src/domain/earth-search";
import type { DiscoveryResponse } from "../src/domain/types";

const root = "https://earth-search.aws.element84.com/v1/";
export async function resolveSceneQuery(q: string, answer: DiscoveryResponse) {
  const match = answer.catalogMatch;
  if (!match) return answer;
  const point = pointFromQuery(q);
  if (!point || !match.period || !match.ids.length) return answer;
  const lookups: SceneLookup[] = [];
  const notices: string[] = [];
  const scopeNote =
    "本次按所选时段和坐标查询，云量、传感器型号及其他条件需逐景筛选。";
  await Promise.all(
    match.ids.map(async (assetId) => {
      const collection = assetId.replace("earth-search:", "");
      if (!["landsat-c2-l2", "sentinel-2-l2a"].includes(collection)) return;
      const url = new URL("search", root);
      const [start, end] = match.period!;
      url.search = new URLSearchParams({
        collections: collection,
        intersects: JSON.stringify({ type: "Point", coordinates: point }),
        datetime: match.utcWindow ? new Date(match.utcWindow[0]).toISOString()+"/"+new Date(match.utcWindow[1]-1).toISOString() : start + "-01-01T00:00:00Z/" + end + "-12-31T23:59:59Z",
        limit: "5",
      }).toString();
      try {
        const res = await fetch(url, {
          signal: AbortSignal.timeout(10000),
          redirect: "error",
        });
        if (!res.ok) throw Error("upstream status");
        const data = await res.json();
        const matched = data.numberMatched;
        if (
          !Number.isSafeInteger(matched) ||
          matched < 0 ||
          !Array.isArray(data.features) ||
          data.features.length !== Math.min(5, matched)
        )
          throw Error("incomplete page");
        const items = data.features.map(
          (f: {
            collection: string;
            id: string;
            properties: Record<string, unknown>;
          }) => {
            const date = f.properties.datetime,
              cloud = f.properties["eo:cloud_cover"];
            if (
              f.collection !== collection ||
              !f.id ||
              typeof date !== "string" ||
              !Number.isFinite(Date.parse(date))
            )
              throw Error("unexpected item");
            return {
              id: f.id,
              datetime: date,
              cloud: typeof cloud === "number" ? cloud : null,
              url:
                root +
                "collections/" +
                collection +
                "/items/" +
                encodeURIComponent(f.id),
            };
          },
        );
        if (
          new Set(items.map((i: { id: string }) => i.id)).size !== items.length
        )
          throw Error("duplicate item");
        lookups.push({
          assetId,
          point,
          years: match.period!,
          ...(match.utcWindow?{utcWindow:match.utcWindow}:{}),
          matched,
          items,
          url: url.href,
          checkedAt: new Date().toISOString(),
        });
      } catch {
        notices.push(collection + " 查询未完成，可通过发布方链接重查。");
        match.rejected.push({ title: collection + " 检索", url: url.href });
      }
    }),
  );
  lookups.sort(
    (a, b) => match.ids.indexOf(a.assetId) - match.ids.indexOf(b.assetId),
  );
  const summaries = lookups.map((l) => sceneDocument(l).scope);
  const rejected = match.conditions.filter(
    (c) => c.includes("与所问时段无交集") || c.includes("年限依据"),
  );
  match.lookups = lookups;
  match.conditions = [...rejected, ...summaries, ...notices, scopeNote];
  answer.message =
    [
      ...summaries,
      ...notices,
      ...rejected.filter((c) => !c.includes("年限依据")),
      scopeNote,
    ].join("\n") +
    (lookups.some((l) => l.matched > 0)
      ? "\n云量是整景统计，指定位置的像元质量还需核对。"
      : "");
  return answer;
}
