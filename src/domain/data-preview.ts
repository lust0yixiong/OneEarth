import type { DataView, EvidenceDocument, Filters } from "./types";
import {
  ctdRows,
  ctdSamples,
  frontsFor,
  selectedStation,
  variableInfo,
} from "./visualization";

/** Snapshot the actual content and parameters used by the current map and chart. */
export function dataRecipeFor(
  view: DataView,
  filters: Filters,
): EvidenceDocument {
  const rows = view.kind === "ctd" ? ctdRows[view.stationId] || [] : [];
  const station = view.kind === "ctd" ? selectedStation(view) : null;
  const shapes = view.kind === "front" ? frontsFor(view, filters) : [];
  const samples = view.kind === "ctd" ? ctdSamples(view, filters) : [];
  const code =
    view.kind === "ctd"
      ? [
          "// 当前站次最近实测层取值；null 为缺测。",
          `const depthRange = ${JSON.stringify(filters.depth)};`,
          `const targetDepth = ${view.depth};`,
          `const valueColumn = ${view.variable === "temperature" ? 1 : 2};`,
          "",
          "function sampleAtDepth(rows) {",
          "  const selected = rows.filter(row => row[0] !== null &&",
          "    (!depthRange || (row[0] >= depthRange[0] && row[0] <= depthRange[1])));",
          "  const nearest = selected.reduce((best, row) =>",
          "    !best || Math.abs(row[0] - targetDepth) < Math.abs(best[0] - targetDepth) ? row : best, null);",
          "  const mapValue = nearest && Math.abs(nearest[0] - targetDepth) <= 5",
          "    ? nearest[valueColumn] : null;",
          "  return { nearest, mapValue };",
          "}",
          "",
          "// 当前站次原始层值：[采样深度 m, 温度 °C, 实用盐度]。",
          `const rows = [\n${rows.map((row) => "  " + JSON.stringify(row)).join(",\n")}\n];`,
          "const { nearest, mapValue } = sampleAtDepth(rows);",
          "console.log({ nearest, mapValue });",
        ].join("\n")
      : JSON.stringify({ view, filters, features: shapes }, null, 2);
  return {
    id: "data-recipe-" + JSON.stringify(view) + JSON.stringify(filters),
    title:
      view.kind === "ctd"
        ? "温盐剖面 · 数据处理说明"
        : "冰川前缘 · 数据处理说明",
    scope: station
      ? station.name + " · " + station.date
      : "当前冰川、时相与筛选条件",
    source: station
      ? "PANGAEA 891386 · 已载入原始观测"
      : "作者归档的实际前缘几何",
    tabs: [
      {
        kind: "trace",
        label: "处理说明",
        steps:
          station && view.kind === "ctd"
            ? [
                {
                  title: "读取原始站次",
                  detail: `${station.name} · ${station.date}\n${rows.length} 条原始层值，坐标 ${station.center.join(", ")}。`,
                },
                {
                  title: "按当前条件取值",
                  detail:
                    `${variableInfo(view.variable).label} · 目标深度 ${view.depth} m。` +
                    (filters.depth
                      ? `\n深度筛选 ${filters.depth.join("–")} m。`
                      : "\n保留该站次全部实测层。"),
                },
                {
                  title: "映射到球面",
                  detail: `同一采样日，在目标深度 ±5 m 内取最近的实测层；取定层缺值时留空。当前 ${samples.length} 个站次有有效值，所在显示网格内按算术均值着色。`,
                },
                {
                  title: "生成局部剖面",
                  detail:
                    "左下图显示当前站次的原始层值；深度向下增加，缺测处断线。下方代码复现当前站次的深度筛选与最近层取值。",
                },
              ]
            : [
                {
                  title: "读取实际前缘",
                  detail:
                    `${shapes.length} 条符合当前条件的前缘线。\n` +
                    shapes.map((s) => s.label).join("\n"),
                },
                {
                  title: "按时相显示",
                  detail:
                    "按当前冰川和时相选择作者提供的几何，首期为棕色，末期为绿色。坐标和日期保持归档口径。",
                },
                {
                  title: "保留原始参数",
                  detail:
                    "数据参数页包含当前视图、筛选条件与实际几何，可复制或下载核查。",
                },
              ],
      },
      {
        kind: "code",
        label: view.kind === "ctd" ? "取值代码" : "数据参数",
        language: view.kind === "ctd" ? "javascript" : "json",
        body: code,
      },
    ],
  };
}
