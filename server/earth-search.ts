import { pointFromQuery, sceneDocument } from "../src/domain/earth-search";
import type { DiscoveryResponse } from "../src/domain/types";
import { querySceneCatalogue } from "./discovery-a2a-client";
import { sceneCatalogAssets, type SceneCatalogAsset, type SceneCatalogResult } from "./discovery-materials-contract";

export async function resolveSceneQuery(q: string, answer: DiscoveryResponse, signal: AbortSignal) {
  const match = answer.catalogMatch;
  const point = pointFromQuery(q);
  if (!match || !point || !match.period) return answer;
  const assetIds = [...new Set(match.ids.filter((id): id is SceneCatalogAsset =>
    sceneCatalogAssets.some(asset => asset === id)))];
  if (!assetIds.length) return answer;

  let result: SceneCatalogResult;
  try {
    result = await querySceneCatalogue({
      assetIds, point, years: match.period, ...(match.utcWindow ? { utcWindow: match.utcWindow } : {}),
    }, signal);
  } catch {
    signal.throwIfAborted();
    result = { lookups: [], failures: assetIds.map(assetId => ({
      assetId, url: "https://earth-search.aws.element84.com/v1/collections/" + assetId.slice("earth-search:".length),
    })) };
  }

  const notices = result.failures.map(({ assetId, url }) => {
    const collection = assetId.slice("earth-search:".length);
    match.rejected.push({ title: collection + " 检索", url });
    return collection + " 查询未完成，匹配数未知，可通过发布方链接重查。";
  });
  const lookups = result.lookups.sort((a, b) => match.ids.indexOf(a.assetId) - match.ids.indexOf(b.assetId));
  const summaries = lookups.map(lookup => sceneDocument(lookup).scope);
  const rejected = match.conditions.filter(condition => condition.includes("与所问时段无交集") || condition.includes("年限依据"));
  const scopeNote = "本次按所选时段和坐标查询，云量、传感器型号及其他条件需逐景筛选。";
  match.lookups = lookups;
  match.conditions = [...rejected, ...summaries, ...notices, scopeNote];
  answer.message = [...summaries, ...notices, ...rejected.filter(condition => !condition.includes("年限依据")), scopeNote].join("\n") +
    (lookups.some(lookup => lookup.matched > 0) ? "\n云量是整景统计，指定位置的像元质量还需核对。" : "");
  return answer;
}
