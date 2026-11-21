import type { Asset } from "./datasets";
import { assetById } from "./datasets";
import { assetMaterials } from "./evidence";
import type { CandidateSet, EvidenceTab } from "./types";

// Report what is in the source. A table of archive fields, a measurement
// series, and a vertical profile have different units of evidence.
export function materialDetails(asset: Asset, tabs: EvidenceTab[]): string[] {
  const details: string[] = [];
  for (const tab of tabs) {
    if (tab.kind === "table" && tab.rows?.length) {
      const cols = tab.columns || [],
        rows = tab.rows;
      const station = cols.indexOf("站次");
      if (station >= 0 && cols.includes("采样深度 m")) {
        details.push(
          new Set(rows.map((r) => r[station])).size +
            " 个剖面站次，" +
            rows.length +
            " 层采样记录",
        );
      } else if (cols[0] === "月份") {
        details.push(
          new Set(rows.map((r) => r[0])).size +
            " 个月份的记录（" +
            cols.slice(1).join("、") +
            "）",
        );
      } else if (cols[0] === "日期 / 年份" && cols.includes("水位（米）")) {
        details.push(
          rows.length +
            " 条年报水位记录（" +
            rows.map((r) => r[0] + " " + r[1] + " 米").join("、") +
            "）",
        );
      } else {
        details.push(tab.label + " · " + rows.length + " 行");
      }
    } else if (tab.kind === "pdf" && tab.pages?.length) {
      details.push(
        tab.label +
          " · 第 " +
          tab.pages.map((p) => p.number).join("、") +
          " 页",
      );
    } else if (tab.kind === "text" && tab.quote) {
      details.push(tab.label + " · 来源摘录");
    }
  }
  if (asset.profile?.role === "request") details.push("申请条件与获取入口");
  return details;
}
export function summarizeBatchMaterials(batch: CandidateSet) {
  return batch.ids.flatMap((id) => {
    const a = assetById.get(id);
    if (!a) return [];
    const doc = assetMaterials(a, batch.filters, batch.selection, null);
    const facts = materialDetails(a, doc.tabs);
    return [
      {
        id,
        title: a.title,
        facts,
        access:
          a.profile?.role === "request"
            ? "受限资料申请入口"
            : a.kind === "clue"
              ? "来源线索"
              : "产品说明与获取入口",
      },
    ];
  });
}
export function materialAnswer(batch: CandidateSet) {
  const rows = summarizeBatchMaterials(batch);
  if (!rows.length) return "当前范围没有匹配的资料。";
  const sorted = [...rows].sort(
    (a, b) => Number(!!b.facts.length) - Number(!!a.facts.length),
  );
  return (
    sorted
      .slice(0, 6)
      .map(
        (r) =>
          r.title + "：" + (r.facts.length ? r.facts.join("；") : r.access),
      )
      .join("\n") +
    (rows.length > 6
      ? "\n另有 " + (rows.length - 6) + " 项，可展开本次结果逐项查看。"
      : "")
  );
}
