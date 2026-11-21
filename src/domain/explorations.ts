import { cases as stations } from "../data/evidence/station-cases.mjs";
import { sourceEvidence } from "../data/evidence/source-evidence.mjs";
import type { CaseStudy, Need } from "./types";
export const explorations: CaseStudy[] = [
  {
    id: "glacier",
    title: "研究冰川融化，先看数据在哪里",
    question: "研究冰川融化有哪些数据可用？",
    paper: "冰川数据发现演示",
    region: "全球 · 已核实的观测目录与两份冰川边界样本",
    verified: true,
    spatial: "glacier",
    clues: [],
    gap: "观测目录、轮廓样本与论文采样位置代表不同空间依据。具体研究期和变量仍需逐项核查；网页入口保留在清单。海纳与科学家推荐的身份关系待接入。",
    needs: [
      {
        name: "物质平衡观测",
        type: "站点、时间序列",
        product: "WGMS FoG · 质量平衡观测目录",
        status: "公开观测目录已核",
        detail:
          "目录列出有质量平衡记录的冰川及其位置。站点位置用于空间索引，具体时期及观测序列待提取。",
        source: "World Glacier Monitoring Service",
        url: "https://wgms.ch/data-exploration/",
        tabs: sourceEvidence("fog", "全球冰川目录")!.tabs,
      },
      {
        name: "冰川边界",
        type: "矢量",
        product: "RGI 6.0 · 阿尔卑斯与阿拉斯加边界样本",
        status: "两条真实轮廓已读",
        detail:
          "使用真实冰川轮廓相交网格。样本用于核查入口和局部覆盖，编目时期须与研究期配对。",
        source: "RGI 6.0 · OGGM 样本",
        url: "https://doi.org/10.7265/4M1F-GD79",
        tabs: sourceEvidence("rgi6", "边界样本")!.tabs,
      },
      {
        name: "冰雪吸光杂质",
        type: "观测表、论文",
        product: "APCC · 冰雪黑碳与有机碳",
        status: "论文原页与采样表已核",
        detail:
          "论文表 2 给出第三极采样冰川位置，第 5 节指向数据入口。同一 DOI 的公开入口与论文线索保留在同份材料。",
        source: "Kang 等 · ESSD 2022",
        url: "https://essd.copernicus.org/articles/14/683/2022/",
        tabs: sourceEvidence("apcc", "第三极采样位置")!.tabs,
      },
      {
        name: "继续检索轮廓",
        type: "网页入口",
        product: "GLIMS · 冰川资料检索页",
        status: "入口线索",
        detail: "当前入口尚未解析为具体产品，保留为未定位的资源。",
        source: "GLIMS",
        url: "https://www.glims.org/maps/textsearch/",
        tabs: sourceEvidence("portal", "未定位入口")!.tabs,
      },
    ] as Need[],
  },
  ...Object.entries(stations).map(([id, site]) => ({
    id,
    title:
      id === "dongting" ? "洞庭湖城陵矶站的丰枯变化" : "巴西马瑙斯港的低水位",
    question: site.question,
    paper: site.source,
    region:
      id === "dongting" ? "中国 · 湖南 · 洞庭湖" : "巴西 · 亚马孙 · 内格罗河",
    verified: true,
    spatial: "station",
    clues: [],
    gap: site.limit,
    needs: [
      {
        name: "站区水位记录",
        type: "观测表、时间序列",
        product: site.site + " · 年报水位",
        status: "年报极值已核",
        detail: site.answer + " " + site.basis + " 球面坐标为站区示意位置。",
        source: site.source,
        url: site.url,
        tabs: sourceEvidence(id, site.site + " · 站区示意位置")!.tabs,
      } as Need,
    ],
  })),
];
