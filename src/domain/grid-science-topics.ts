import haina from "../data/evidence/haina.json";
import vocabulary from "../data/evidence/grid-science-topics.json";
import { assetById, distinctAssets, type Asset } from "./datasets";

const labels: Record<string, string[]> = vocabulary.paths;
const assignments: Record<string, string[]> = vocabulary.assets;
// Map source subjects only when a common first-level topic is unambiguous.
const hainaParents: Record<string, string> = {
  气候气象: "大气", 高程: "陆地表面", 内陆水域: "陆地水圈",
  生物群落: "生物圈", 社会: "人类因素", 交通: "人类因素",
};
const sourceSubjects = new Map(haina.records.map(record => [
  "haina:" + record.id,
  [...new Set(record.labels.filter(label => label.group === "1017").map(label => label.name))],
]));
export function sciencePaths(asset: Asset): string[][] {
  const subjects = sourceSubjects.get(asset.id);
  if (subjects?.length) {
    return subjects.map(name => [hainaParents[name] ?? name, name]);
  }
  const curated = assignments[asset.id];
  return curated?.length ? curated.map(key => labels[key]) : [["未标注主题", ""]];
}

export function gridData(ids: string[], includePaperEvidence = false) {
  return ids.flatMap(id => {
    const asset = assetById.get(id);
    if (!asset || asset.kind === "requirement") return [];
    const paperEvidence = includePaperEvidence && asset.origins.includes("paper");
    if (!paperEvidence && (vocabulary.materials.includes(id) || asset.profile?.spatial === "nonspatial")) return [];
    return [asset];
  });
}

export function dataForTopic(items: Asset[], topic: string, term = "") {
  return distinctAssets(topic === "全部" ? items : items.filter(asset =>
    sciencePaths(asset).some(([t, v]) => t === topic && (!term || term === v))
  ));
}
