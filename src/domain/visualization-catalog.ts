import { windForecastHours, windManifest, windReferenceLabel } from "./wind";
import type { CaseStudy, VisualizationState } from "./types";
/** Dataset capabilities are independent from research questions and content viewers. */
export const visualizationCatalog = [
  {
    id: "gfs-wind" as const,
    datasetId: "gfs-wind",
    caseId: "wind",
    needIndex: 0,
    title: "全球风场",
    preview: "/visualizations/gfs/globe-preview.webp",
    dataset: "NCEP GFS · 全球 1° 风矢量",
    level: "10 m / 250 hPa",
    referenceTime: windReferenceLabel,
    forecastHours: windForecastHours.map(hour=>"F"+String(hour).padStart(3,"0")).join(" / "),
  },
];
export const visualizationsFor = (datasetId: string) =>
  visualizationCatalog.filter((v) => v.datasetId === datasetId);
export const windCase: CaseStudy = {
  id: "wind",
  title: "全球风场 · 大气环流",
  question: "全球风场如何分布，地面风和高空风有什么不同？",
  paper: "NCEP GFS 风矢量可视化案例",
  region: "全球",
  verified: true,
  spatial: "global",
  clues: [],
  gap: "当前接入 2026-11-06 00 UTC 起报的 3 个时效、2 个层次快照。粒子表示所选时刻的流动方向，气团真实轨迹需时变风场积分。",
  needs: [
    {
      datasetId: "gfs-wind",
      name: "全球风矢量",
      type: "连续栅格、矢量场",
      product: "NCEP GFS · 全球 1° 风矢量",
      status: "6 幅真实风场已接入",
      source: "NOAA / NCEP NOMADS",
      url: windManifest.sourceUrl,
      detail:
        "全球 360 × 181 原始网格，含 u/v 风分量。已保存近地面 10 m 与 250 hPa、F000/F006/F012 的真实 GRIB2 数据，可查看原网格内容或进入风场可视化。",
      tabs: [
        {
          kind: "web",
          label: "NOAA 发布来源",
          body: `已保存快照，起报时间 ${windManifest.referenceTime}。原始文件、校验和、网格和变量参数均可追溯。${windManifest.sourceUrl}`,
        },
      ],
    },
  ],
};
export const validVisualization = (v: any): v is VisualizationState =>
  !!v &&
  v.id === "gfs-wind" &&
  ["10m", "250hPa"].includes(v.level) &&
  [0, 6, 12].includes(v.forecastHour) &&
  typeof v.playing === "boolean" &&
  typeof v.color === "boolean";
