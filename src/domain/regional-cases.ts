import forestManifest from "../data/evidence/haina-forest.json";
import c40Manifest from "../data/evidence/haina-c40.json";

export const hainaForestManifest = forestManifest;
export const hainaC40Manifest = c40Manifest;
const forestMonth = Math.max(0, forestManifest.frames.findIndex(frame => frame.date === "2023-07-15"));

export const regionalCases = {
  rain: {
    title:"全球降水 · 雨带迁移", dataset:"NASA GPM IMERG V07B Final", period:"2024 年",
    unit:"mm/天", variable:"月平均日降水量", intro:"点选月份查看全球海陆雨带，放大查看 0.1° 原始格点。",
    method:"IMERG 2024 年月平均降水率，mm/hr 乘 24 换算为 mm/天，点选使用 0.1° 原始格点。概览按有效格面积加权，缺测留空。",
    source:"https://gdex.ucar.edu/datasets/d736000/", reference:"https://mapped.earth/rainfall/china",
    extent:[73,18,135,54], ceiling:15, initial:6
  },
  rivers: {
    title:"巴西河网 · 流量的季节变化",dataset:"GloFAS 河流流量再分析",period:"2024 年",
    unit:"m³/s",variable:"河段日流量",intro:"河段的高度随当日流量变化，宽度按该河段的全年平均流量绘制。",
    method:"从 Natural Earth 主河道截取 55 段，以中点向 Open-Meteo 查询附近河流格点。整段显示该代表格点的估算值，高度采用平方根尺度。",
    source:"https://open-meteo.com/en/docs/flood-api",reference:"https://mapped.earth/river-pulse/brazil",
    extent:[-74,-34,-34,6],ceiling:240000,initial:105
  },
  lightning: {
    title:"美国本土 · 一年的闪电",dataset:"NOAA NCEI · Vaisala NLDN 地闪日汇总",period:"2024 年",
    unit:"次",variable:"年内累计地闪",intro:"逐日累加年初以来的云地闪电。点选格子可以读取截至当天的累计次数。",
    method:"将 SWDI 的 0.1° 日汇总按原格中心裁至美国本土，再聚合为 0.5° 网格。卫星半小时视图另用 GLM，两个视图独立计数。",
    source:"https://www.ncei.noaa.gov/products/lightning-products",reference:"https://mapped.earth/lightning/conus",
    extent:[-125,24,-66,50],ceiling:18000,initial:195
  },
  forest: {
    title:"大兴安岭森林 · 时空嵌入",dataset:"OneEarth/大兴安岭森林时空嵌入数据集 · 64 维",period:"2023 年 12 个月",
    unit:"嵌入通道",variable:"64 维时空嵌入（PCA 三通道）",intro:"颜色表示森林像元嵌入向量的相对位置，切换月份查看同一片森林的季节变化。",
    method:"海纳数据集 1846764 的逐日分区，取 2023 年 1–12 月每月 15 日，共 12 个日期。303×370 网格，0.03°；对 30,419 个有效森林像元统一拟合 64 维向量的前三个主成分，按 12 个日期的全局 2%–98% 分位拉伸为 RGB。颜色是嵌入的可视化，不是物理量。",
    source:"https://cn.zero2x.org/data-hub/portal/dataset?id=1846764",reference:"",
    extent:[119.09,46.34,127.04,53.57],ceiling:1,initial:forestMonth
  },
  c40: {
    title:"C40 城市 · landuse 嵌入",dataset:"C40 landuse 嵌入数据集 · 1024 维",period:"2026-10 数据集快照",
    unit:"嵌入通道",variable:"1024 维 polygon embedding（PCA 三通道）",intro:"上海、北京、广州三个城市的 379,717 个多边形中心，切换城市查看不同的城市嵌入。",
    method:"海纳数据集 1846639 的上海、北京、广州分片（10+8+6 个 geom2ind 分片），共 379,717 个多边形中心（上海 162,604 / 北京 121,404 / 广州 95,709）。每个 1024 维 int16 向量逐行 L2 归一化，三城市共用一套约 12,000 样本拟合的前三个主成分，并映射为 R/G/B；点为多边形投影中心，不表示完整轮廓，颜色不是土地利用类别。",
    source:"https://cn.zero2x.org/data-hub/portal/dataset?id=1846639",reference:"",
    extent:[112.88442874917307,22.479279145720177,121.82036240493447,40.20231070471998],ceiling:1,initial:0
  }
} as const;
export const stormWindow = {
    title:"美国本土 · 半小时闪电",dataset:"NOAA GOES-16 GLM 闪电观测",period:"2024-05-29 · 21:00–21:30 UTC",
    unit:"次",variable:"窗口内累计闪电",intro:"逐分钟累加探测到的闪电。颜色越亮，该格自 21:00 UTC 起记录的闪电越多。",
    method:"连续 90 个 20 秒 LCFA 文件，按闪电中心位置筛选美国本土和质量标记为 0 的记录，按 0.25° 网格聚合。",
    source:"https://registry.opendata.aws/noaa-goes/",reference:"https://mapped.earth/lightning/conus",
    extent:[-125,24,-66,50],ceiling:90,initial:12
  } as const;
export type RegionalId=keyof typeof regionalCases;
export type XY=[number,number];
export interface RegionalData {
  outline:XY[][]; network?:XY[][]; points:{xy:XY;line?:XY[];mean?:number;name?:string}[];
  dates:string[];frames:(number|null)[][];
}

export const globeCases={
  rain:{title:"全球降水",dataset:"NASA GPM IMERG · 全球海陆 0.1° 网格",unit:"mm/天",max:15,center:[104,26] as XY,month:6,zoom:1},
  rivers:{title:"巴西河网 · 丰枯交替",dataset:"GloFAS · 巴西 55 个代表河段",effect:"河段流量着色 × 逐日回放",unit:"m³/s",max:240000,center:[-53,-12] as XY,month:105,zoom:1},
  lightning:{title:"美国地闪 · 雷暴足迹",dataset:"NOAA NCEI · 美国本土 0.5° 网格",effect:"累计地闪着色 × 逐日回放",unit:"次",max:18000,center:[-96,36] as XY,month:195,zoom:1},
  forest:{title:"大兴安岭森林 · 时空嵌入",dataset:"海纳 1846764 · 64 维森林时空嵌入",effect:"PCA 三通道着色 × 2023 年 12 个月",unit:"嵌入通道",max:1,center:[123.06,49.95] as XY,month:forestMonth,zoom:8},
  c40:{title:"C40 城市 · landuse 嵌入",dataset:"海纳 1846639 · 1024 维 polygon embedding",effect:"PCA 三通道着色 × 上海/北京/广州点云",unit:"嵌入通道",max:1,center:[121.427283,31.195936] as XY,month:0,zoom:110}
};

export const datasetLayers={rain:"nasa:imerg-monthly",rivers:"glofas:brazil-55-2024",lightning:"noaa:nldn-conus-2024",forest:"haina:1846764",c40:"haina:1846639"} as const;
export const regionalIds:RegionalId[]=["rain"];
export const regionalForDataset=(datasetId:string)=>datasetLayers.forest===datasetId?"forest":datasetLayers.c40===datasetId?"c40":["noaa:cpc-global-land-precip-2024","nasa:imerg-final-v07b-2024"].includes(datasetId)?"rain":regionalIds.find(id=>datasetLayers[id]===datasetId);
export function layerFrameCount(id:RegionalId){return id==="rain"?12:id==="forest"?hainaForestManifest.frames.length:id==="c40"?hainaC40Manifest.cities.length:366;}
export const regionalGroup={id:"earth-layers",title:"数据地球图层",
  needs:regionalIds.map((id):import("./types").Need=>{
    const info=globeCases[id],regional=regionalCases[id];
    const detail=id==="rain"?"NASA GPM IMERG 月度降水。可用年月以 OneEarth 发布目录为准，逐月标明产品来源。海陆 0.1° 原始格点，多级数值瓦片按视野加载，统一为 mm/天，缺测保留。":regional.method;
    const source=id==="rain"?"https://gdex.ucar.edu/datasets/d736000/":regional.source;
    return {name:info.title,datasetId:datasetLayers[id],product:info.dataset,type:id==="rivers"?"河网、时间序列":"栅格、时间序列",
      status:id==="rain"?"可浏览已发布月份":"已接入 2024 年切片",source:info.dataset.split(" · ")[0],detail,url:source,card:{thumbnailUrl:"/visualizations/regional/"+id+"-globe.webp",tags:id==="rain"?["月度",info.unit]:["2024",info.unit]},
      profile:{role:"data",spatial:"coverage",...(id==="rain"?{}:{years:[2024,2024] as [number,number]}),coverage:info.title,access:"可在 OneEarth 数据地球查看",limitation:detail},
      tabs:[{kind:"web",label:"数据来源与处理方法",url:source,body:detail}]};
  })};

/** Manifest written by scripts/prepare-haina-forest.mjs. */
export interface HainaForestFrame {
  date:string; partition:string; image:string; validPixels:number; sourceSha256:string;
}
export interface HainaForestManifest {
  version:1; datasetId:string; name:string; description:string;
  grid:{width:number;height:number;resolution:number;bounds:[number,number,number,number]};
  embedding:{dimensions:number;method:string;components:string[];variance:number[];stretch:[number,number];note:string};
  frames:HainaForestFrame[];
  source:{datasetId:string;url:string;license:string;licenseUrl:string;provider:string;files:string[]};
}

/** Manifest written by scripts/prepare-haina-c40.mjs. */
export interface C40City {
  id:string; name:string; bounds:[number,number,number,number]; center:[number,number];
  projection:{type:string;lat0:number;lon0:number;radius:number};
  zoom:number; image:string; width:number; height:number; samples:number; shards:number; layers:Record<string,number>;
}
export interface C40Manifest {
  version:1; datasetId:string; name:string; snapshot:string; defaultCity:string;
  embedding:{dimensions:number;method:string;components:string[];variance:number[];stretch:[number,number];note:string};
  cities:C40City[];
  source:{datasetId:string;url:string;license:string;licenseUrl:string;provider:string;source:string;files:string[]};
}
