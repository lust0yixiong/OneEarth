import { paperRecords } from "./paper-record";
import { observationById, observationURL } from "./push-observations";
import { earthSearchId, inventoryId, sample } from "./earth-search";
import { caseById } from "./catalog";
import { assetIdentity, relatedAssets, type Asset } from "./datasets";

export interface LineageRecord {
  assetId: string;
  caseId: string;
  study: string;
  paper?: string;
  source: string;
  url?: string;
  relation: string;
  studyContext?: string;
  actualRegion: string;
  actualPeriod: string;
  materials: { label: string; url?: string; sourceUrl?: string }[];
}

interface Finding {
  relation: string;
  region?: string;
  period?: string;
  paperUrl?: string;
}
// Each finding is limited to what the bundled source extracts, original-page
// images or archive tables show. Catalog coverage is kept out of actual use.
const greenlandPaper = "https://www.nature.com/articles/s41467-018-05180-x";
const alaskaPaper = "https://doi.org/10.1017/jog.2025.37";
const findings: Record<string, Finding> = {
  "Q02-0": {
    relation: "本应用已读两个原始高程像元",
    region: "Hintereisferner 与 Columbia Glacier",
    period:
      "瓦片源时段分别为 2011-05 至 2014-08、2011-01 至 2014-09；取样像元日期待核",
  },
  "Q19-0": {
    relation: "原论文列出产品入口，实际使用版次待核",
    paperUrl: greenlandPaper,
  },
  "Q19-1": {
    relation: "原论文记载以 Landsat 跟踪表面脊迁移",
    region: "79 North Glacier · Midgardsormen",
    paperUrl: greenlandPaper,
  },
  "Q19-2/pangaea:891368": {
    relation: "发布方归档，应用已读主测点位置",
    region: "格陵兰东北 · 79 North Glacier 地震主测点",
  },
  "Q19-2/pangaea:890982": {
    relation: "发布方归档，应用已读测线原表",
    region: "格陵兰东北 · MGO 地震测线",
  },
  "Q19-2/bedmachine-greenland-v3": {
    relation: "原论文使用 BedMachine v3，局部文件待核",
    region: "格陵兰东北 · 79 North Glacier",
    paperUrl: greenlandPaper,
  },
  "Q19-3/ATM": {
    relation: "原论文记载使用 ATM 测高",
    region: "格陵兰东北 · 79 North Glacier",
    period: "2012、2014 年；论文示例 2012-05-14",
    paperUrl: greenlandPaper,
  },
  "Q19-3/TanDEM-X": {
    relation: "原论文记载使用 TanDEM-X 测高",
    region: "格陵兰东北 · 79 North Glacier",
    period: "2011-01-08、2012-11-14、2014-12-08、2016-09-28",
    paperUrl: greenlandPaper,
  },
  "Q19-4": {
    relation: "PANGAEA 归档，应用已读 CTD 剖面",
    region: "格陵兰东北 · 10 个剖面事件，含 Gla01-1",
    period: "1997 年 7–8 月与 1998-08-12",
  },
  "Q20-0": {
    relation: "作者归档使用 RGI60 标识，应用已读质心表",
    region: "阿拉斯加及加拿大西北部 · 55 条研究冰川",
    paperUrl: alaskaPaper,
  },
  "Q20-1": {
    relation: "作者归档，应用已读 4 条冰川前缘线",
    region: "Mendenhall Glacier、Alsek Glacier",
    period: "Mendenhall 1984-04-11、2020-09-05；Alsek 1984-07-28、2021-03-28",
    paperUrl: alaskaPaper,
  },
  "Q20-2": {
    relation: "原论文使用 Rick 清单，作者表列有湖面积",
    region: "Mendenhall；Alsek 对应结果为空",
    period: "2016–2019 平均作为 2018 有效湖面积",
    paperUrl: alaskaPaper,
  },
  "Q20-3": {
    relation: "原论文推算潜在水深，应用已读作者结果字段",
    region: "Mendenhall、Alsek 末端 2 km",
    paperUrl: alaskaPaper,
  },
  "Q20-4": {
    relation: "原论文使用 Millan 速度与估计冰厚",
    region: "阿拉斯加及加拿大西北部研究冰川",
    period: "2017–2018 平均速度",
    paperUrl: alaskaPaper,
  },
  "glacier-0": { relation: "公开观测目录，应用已索引冰川位置" },
  "glacier-2": {
    relation: "作者发布采样资料，论文表 2 与第 5 节可核",
    region: "第三极 · 表 2 节选的 9 个冰川采样位置",
  },
  "Q07-0": { relation: "研究问题推荐的替代产品；原文使用另一种 25 km 周产品" },
  "Q07-2": {
    relation: "论文 §2.1 给出研究范围",
    region: "60–80°E、30–40°N 论文描述框",
    period: "原文几处时段不一致，实际输入年份待核",
  },
  "Q14-1": {
    relation: "原论文使用聚落点核密度；具体输入资料待核",
    region: "土耳其 Bartın 省",
    paperUrl: "https://dergipark.org.tr/en/pub/jaes/article/1659880",
  },
  "Q14-2": {
    relation: "原论文记载 TurkStat 登记人口与聚落多边形的匹配方法",
    region: "土耳其 Bartın 省",
    paperUrl: "https://dergipark.org.tr/en/pub/jaes/article/1659880",
  },
  "Q14-3": {
    relation: "原论文使用 OSM 道路计算加权线密度；历史文件版本待核",
    region: "土耳其 Bartın 省",
    paperUrl: "https://dergipark.org.tr/en/pub/jaes/article/1659880",
  },
  "Q14-4": {
    relation: "原论文引用 Esri Sentinel-2 土地覆盖；实际年度文件待核",
    region: "土耳其 Bartın 省",
    paperUrl: "https://dergipark.org.tr/en/pub/jaes/article/1659880",
  },
  "Q14-5": {
    relation: "原论文使用 Landsat 9 的 B5、B4 计算 NDVI；场景编号待核",
    region: "土耳其 Bartın 省",
    paperUrl: "https://dergipark.org.tr/en/pub/jaes/article/1659880",
  },
  "Q14-6": {
    relation: "原论文使用 25 m EU-DEM，具体版次待核",
    region: "土耳其 Bartın 省",
    paperUrl: "https://dergipark.org.tr/en/pub/jaes/article/1659880",
  },
  "Q14-0": {
    relation: "公开归档，应用已读取简化省界；论文用版待核",
    region: "土耳其 Bartın 省 ADM1",
    period: "边界代表年份 2021",
  },
  "Q08-0": {
    relation: "应用已读 NSIDC 原始月表",
    region: "北半球海冰范围汇总",
    period: "1979–2025 年，每年 9 月",
  },
  "Q08-1": {
    relation: "应用已读 NOAA PSL 月表；原论文采用 JISAO PDO",
    region: "北太平洋 PDO 时间指数",
    period: "1979–2025 年，每年 9 月",
  },
  "Q15-3": {
    relation: "原论文表 1 与 §2.3 记载队列、地址与暴露赋值",
    region: "瑞典及荷兰的四个队列",
  },
  "wind-0": {
    relation: "应用已读取并可视化原始 GRIB2 文件",
    region: "全球 1° 网格",
    period: "2026-11-06 00、06、12 UTC 有效时刻",
  },
  "dongting-0": {
    relation: "年报记载，应用已摘录站点极值",
    region: "洞庭湖城陵矶站",
    period: "2022-06-09、2022-11-12",
  },
  "manaus-0": {
    relation: "年报记载，应用已摘录站点极值",
    region: "内格罗河马瑙斯港站",
    period: "2023、2024 年；2024 年最低值为 11 月 2 日",
  },
};
const rgiFinding: Finding = {
  relation: "应用已读取 RGI 6.0 样本轮廓",
  region: "Hintereisferner、Columbia Glacier",
  period: "Hintereisferner 编目于 2003 年 7–9 月；Columbia 于 2009-09-06",
};

export function documentedFinding(a: Asset): Finding | undefined {
  return findings[a.id] || (a.datasetId === "rgi:6.0" ? rgiFinding : undefined);
}

function lineageRecord(a: Asset): LineageRecord {
  const paper = paperRecords.get(a.id);
  if (paper) return {
    assetId:a.id,caseId:a.caseId,study:paper.paperTitle,source:a.source,url:a.url,
    relation:a.description,studyContext:paper.studyContext,actualRegion:"论文研究区域未单独核实",actualPeriod:"论文研究时段未单独核实",
    materials:a.tabs.map(tab=>({label:tab.label,url:tab.url})),
  };
  const r = observationById(a.id);
  if(r) return {
    assetId:a.id,caseId:a.caseId,study:r.test?"星座联调推送":"星座观测直推",source:r.sourceName,url:a.url,
    relation:r.satellite+" · "+r.collection+" · "+r.id+" · r"+r.revision+" · OneEarth 接收 "+r.receivedAt,
    actualRegion:JSON.stringify(r.geometry),actualPeriod:r.observedAt,
    materials:[
      {label:"接收记录与足迹",url:observationURL(r.key)},
      ...(r.file?[{label:r.file.name+" · SHA-256 "+r.file.sha256,url:observationURL(r.key)+"/file"}]:[]),
      ...(r.productUrl?[{label:"提供方产品",url:r.productUrl}]:[]),
    ],
  };
  if(a.caseId==="earth-layers")return {
    assetId:a.id,caseId:a.caseId,study:"已接入的专题数据",source:a.source,url:a.url,
    relation:a.description,actualRegion:a.profile!.coverage,actualPeriod:"2024 年",
    materials:a.tabs.map(tab=>({label:tab.label,url:tab.url})),
  };
  if (a.caseId === "haina") return {
    assetId:a.id, caseId:a.caseId, study:"海纳地学专区", source:a.source, url:a.url,
    relation:"海纳地学目录公开记录", actualRegion:a.profile!.coverage, actualPeriod:"见发布方记录",
    materials:a.tabs.map(t=>({label:t.label,url:t.url})),
  };
  if (a.caseId === earthSearchId) {
    const inventory = a.id === inventoryId;
    return {
      assetId: a.id, caseId: a.caseId, study: inventory ? "影像检索记录" : "发布方集合记录",
      source: a.source, url: a.url, relation: inventory ? a.description : "发布方公开 STAC 集合",
      actualRegion: inventory ? sample.label + "查询框 " + sample.bbox.join(", ") : "局地影像待核",
      actualPeriod: inventory ? sample.period.join(" 至 ") : "逐景采集时间待核",
      materials: inventory ? sample.items.map(i => ({label: i.id + " · " + i.datetime, url: i.url})) :
        a.tabs.map(t => ({label: t.label, url: t.url})),
    };
  }
  const c = caseById(a.caseId)!;
  const finding = documentedFinding(a);
  const relation =
    finding?.relation ||
    (a.profile?.role === "request"
      ? "论文或机构提供申请线索；实际获取待核"
      : a.origins.includes("paper")
        ? "论文引用或方法线索；具体版本的使用待核"
        : "研究问题匹配的公开目录候选；论文实际使用待核");
  const materials: LineageRecord["materials"] = [];
  if (finding?.paperUrl)
    materials.push({ label: "研究原文", url: finding.paperUrl });
  for (const tab of a.tabs) {
    if (tab.pages?.length)
      for (const page of tab.pages)
        materials.push({
          label: tab.label + " · PDF 第 " + page.number + " 页",
          url: "/evidence/" + page.image,
          sourceUrl: tab.url
            ? tab.url.split("#")[0] + "#page=" + page.number
            : undefined,
        });
    else materials.push({ label: tab.label, url: tab.url || a.url });
  }
  return {
    assetId: a.id,
    caseId: c.id,
    study: c.title,
    paper: finding?.paperUrl ? c.paper : undefined,
    source: a.source,
    url: a.url,
    relation,
    actualRegion: finding?.region || "实际使用区域待核",
    actualPeriod: finding?.period || "实际使用时段待核",
    materials,
  };
}
export function datasetLineage(asset: Asset) {
  return {
    identity: assetIdentity(asset),
    datasetId: asset.productId || asset.datasetId,
    version: asset.version ?? null,
    records: relatedAssets(asset).map(lineageRecord),
  };
}
