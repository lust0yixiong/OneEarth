import {windowLabel as timeLabel, withinWindow, type UtcWindow,validWindow} from "./time-window";
import snapshot from "../data/evidence/earth-search.json";
import type { CaseStudy, DiscoveryResponse, Need, SpatialModel } from "./types";

export const earthSearchId = "earth-search";
export const sample = snapshot.sample;
const [west, south, east, north] = sample.bbox;
export const inventoryId = "earth-search:landsat-c2-l2:yangtze-1998";
const source = "Element 84 Earth Search";
const windowLabel =
  sample.label + "检索窗口（" + sample.bbox.join(", ") + "，西、南、东、北）";
const year = +sample.period[0].slice(0, 4);
const snapshotDate = snapshot.fetchedAt.slice(0, 10);
const quality = "云量为整景比例。窗口内是否有可用像元，还要读取像元质量掩膜。";
const collections: Need[] = snapshot.collections.map((c) => {
  const url = c.links.find((l) => l.rel === "self")!.href;
  const interval = c.intervals[0];
  return {
    name: "光学卫星影像",
    product: c.title,
    datasetId: "earth-search:" + c.id,
    type: "遥感影像",
    source,
    status: "已同步集合元数据",
    url,
    detail: "STAC 集合 " + c.id + "，目录快照 " + snapshotDate + "。",
    profile: {
      role: "data",
      spatial: "coverage",
      years: [
        +interval[0]!.slice(0, 4),
        interval[1] ? +interval[1].slice(0, 4) : null,
      ],
      coverage:
        "目录时间范围 " +
        interval[0]!.slice(0, 10) +
        " 至 " +
        (interval[1]?.slice(0, 10) || "开放结束日期") +
        "。集合外包框 " +
        c.bbox[0].join(", ") +
        "。",
      access:
        "可公开检索 STAC 元数据。具体波段文件的获取条件见条目与发布方许可。",
      limitation:
        "集合起止日期和外包框仅用于初筛。目标地点的影像、云掩膜和数据完整性需逐景核查。",
    },
    tabs: [
      {
        kind: "code",
        language: "json",
        label: "STAC 集合元数据选列",
        url,
        body: JSON.stringify(c, null, 2),
      },
    ],
  };
});
const count = sample.items.length;
const inventory: Need = {
  name: "影像目录清单",
  type: "影像索引",
  source,
  datasetId: inventoryId,
  product: sample.label + " · " + year + " 年 Landsat 影像清单",
  status: "逐景目录已核",
  url: sample.url,
  detail:
    "发布方在指定经纬度窗口返回 " +
    count +
    " 景。已保存编号、采集时间、整景云量及原始条目链接。",
  profile: {
    role: "data",
    spatial: "coverage",
    years: [year, year],
    coverage:
      windowLabel +
      "，UTC " +
      sample.period.map((s) => s.slice(0, 10)).join(" 至 ") +
      "。查询框用于检索，球面显示逐景足迹。",
    access:
      "影像索引可导出 CSV。逐景 STAC 条目列出波段和质量文件及其存储地址。",
    limitation: quality,
  },
  tabs: [
    {
      kind: "table",
      label: "逐景 STAC 索引",
      url: sample.url,
      columns: ["采集时间 UTC", "影像编号", "整景云量 %", "原始条目"],
      rows: sample.items.map((i) => [i.datetime, i.id, i.cloud, i.url]),
    },
  ],
};
// This group supplies catalog/evidence adapters. It is independent of research cases.
export const earthSearchGroup: Pick<CaseStudy, "id" | "title" | "needs"> = {
  id: earthSearchId,
  title: source,
  needs: [...collections, inventory],
};
export const sampleIndex = collections.length;
export const sampleModel: SpatialModel = {
  entries: [],
  areaNeed: sampleIndex,
  areaTitle: windowLabel,
  area: {
    type: "Polygon",
    coordinates: [
      [
        [west, south],
        [west, north],
        [east, north],
        [east, south],
        [west, south],
      ],
    ],
  },
  areaPoints: [
    [west, south],
    [east, north],
  ],
  caption: windowLabel,
};
export const sampleCamera = {
  center: [(west + east) / 2, (south + north) / 2] as [number, number],
  zoom: 1200,
  reason: windowLabel,
};

export function findOpticalData(q: string): DiscoveryResponse | undefined {
  const optical =
    /光学.{0,5}(?:影像|卫星图像)|(?:光学|历史)卫星影像|optical (?:satellite )?imagery/i.test(
      q,
    );
  const landsat = /\blandsat\b/i.test(q);
  const sentinel = /(?:\bsentinel[ -]?2\b|哨兵二号|哨兵2号)/i.test(q);
  if (
    !(optical || landsat || sentinel) ||
    !/(?:查|找|需要|有哪些|检索|推荐|获取|哪里|有没有|可用|可查|search|find|available|imagery for)/i.test(
      q,
    )
  )
    return;
  const years = [...q.matchAll(/(?<![\d.])(?:19|20)\d{2}(?![\d.])/g)].map(
    (m) => +m[0],
  );
  const first = years.length ? Math.min(...years) : undefined;
  const last = years.length ? Math.max(...years) : undefined;
  if (/坐标|coordinates?/i.test(q) && !pointFromQuery(q))
    return {
      message:
        "请按“坐标（经度, 纬度）”输入十进制度数，经度范围为 −180 至 180，纬度范围为 −90 至 90。",
    };
  const dates=[...q.matchAll(/((?:19|20)\d{2})\s*(?:年\s*|-)(\d{1,2})(?:月|(?=\b))/g)];
  let window:UtcWindow|undefined;
  if(dates.length){
    const start=dates[0],end=dates[dates.length-1];
    if(dates.some(d=>+d[2]<1||+d[2]>12)) return {message:"月份应在 1 至 12 之间。"};
    window=[Date.UTC(+start[1],+start[2]-1,1),Date.UTC(+end[1],+end[2],1)];
    if(window[1]<=window[0]) return {message:"结束月份早于起始月份。"};
  }
  const samplePlace = q.includes(sample.label) && !/坐标|coordinates?/i.test(q);
  const ids: string[] = [],
    notes: string[] = [],
    rejected: { title: string; url: string }[] = [];
  for (const n of collections) {
    const isLandsat = n.datasetId === "earth-search:" + sample.collection;
    if ((landsat || sentinel) && !(isLandsat ? landsat : sentinel)) continue;
    const [start, end] = n.profile!.years!;
    if (
      last !== undefined &&
      (last < start || (end !== null && first! > end))
    ) {
      notes.push(
        n.product +
          " 的目录年限为 " +
          start +
          " 年起" +
          (end === null ? "" : "至 " + end + " 年") +
          "，与所问时段无交集。",
      );
      rejected.push({ title: n.product, url: n.url! });
      continue;
    }
    // Only the bounded inventory has item evidence. Independent queries keep
    // the collection-level candidate with its unresolved spatial condition.
    if (isLandsat && samplePlace && first === year && last === year) {
      const hits=sample.items.filter(i=>withinWindow(i.datetime,window));
      if(hits.length) ids.push(inventoryId);
      notes.push(window ? timeLabel(window)+"，长江口检索窗口有 "+hits.length+" 景逐景记录。" : inventory.detail, inventory.profile!.coverage, quality);
    } else {
      ids.push(n.datasetId!);
      notes.push(
        n.product + " 可作集合级候选，所问范围、具体日期及有效像元待核。",
      );
    }
  }
  const conditions = [
    ...notes,
    ...rejected.map((r) => r.title + " 年限依据 " + r.url),
  ];
  return {
    message:
      (ids.includes(inventoryId) ? "找到 1 种产品（Landsat Collection 2 Level-2），所选窗口与时段中已核 "+sample.items.filter(i=>withinWindow(i.datetime,window)).length+" 景。\n" : ids.length ? "找到 "+ids.length+" 种候选产品，目标地点的逐景记录待核。\n":"") + notes.join("\n") +
      (!ids.includes(inventoryId) && ids.length
        ? "\n要查具体影像，请在问题中附年份和“坐标（经度, 纬度）”。"
        : ""),
    catalogMatch: {
      ids,
      conditions,
      rejected,
      sampleWindow: ids.includes(inventoryId),
      ...(window?{utcWindow:window}:{}),
      period: first !== undefined && last !== undefined ? [first, last] : null,
    },
  };
}

export type SceneLookup = {
  utcWindow?: UtcWindow;
  assetId: string;
  point: [number, number];
  years: [number, number];
  matched: number;
  url: string;
  checkedAt: string;
  items: { id: string; datetime: string; cloud: number | null; url: string }[];
};
export function pointFromQuery(q: string): [number, number] | undefined {
  const normalized = q.normalize("NFKC");
  const coords = normalized.match(
    /(?:坐标|coordinates?)\s*[:=]?\s*\(?\s*(-?\d+(?:\.\d+)?)\s*[,，]\s*(-?\d+(?:\.\d+)?)/i,
  );
  if (!coords) return;
  const point: [number, number] = [+coords[1], +coords[2]];
  if (Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90) return point;
}
export function sceneDocument(
  l: SceneLookup,
): import("./types").EvidenceDocument {
  const collection = l.assetId.replace("earth-search:", "");
  return {
    id: l.url,
    title: collection + " · 逐景检索",
    url: l.url,
    source: "Element 84 Earth Search",
    scope:
      collection +
      " · 坐标 " +
      l.point.join(", ") +
      " · " +
      (validWindow(l.utcWindow)?timeLabel(l.utcWindow):l.years.join("–")+" 年") +
      " · 命中 " +
      l.matched +
      " 景，已读取 " +
      l.items.length +
      " 条元数据。",
    tabs: [
      {
        kind: "table",
        label: "已读取的影像条目",
        url: l.url,
        columns: ["采集时间 UTC", "影像编号", "整景云量 %", "原始条目"],
        rows: l.items.map((i) => [i.datetime, i.id, i.cloud, i.url]),
      },
    ],
  };
}
