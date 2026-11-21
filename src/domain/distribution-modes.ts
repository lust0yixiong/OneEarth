export type DistributionContext = "catalog" | "fixed-cell" | "scenes";
type Definition = {
  label:string;
  description:string;
  caption:string;
  legendTitle:string;
  smoothed:boolean;
  contexts:readonly DistributionContext[];
};
// The menu, persisted preference and renderer share this catalogue. A new key
// also requires its painter and legend through their typed dispatch tables.
export const distributionModes = {
  grid: {
    label:"网格分布",description:"原有网格着色，逐格对比数据集数量",
    caption:"绿色表示格内可定位数据集数；元数据覆盖另列",legendTitle:"格内可定位数据集数",
    smoothed:false,contexts:["catalog","fixed-cell","scenes"],
  },
  heatmap: {
    label:"热力图",description:"平滑展示资料聚集程度，点选查看精确数量",
    caption:"黄至红表示资料聚集热度；元数据覆盖另列",legendTitle:"资料聚集热度",
    smoothed:true,contexts:["catalog"],
  },
  contours: {
    label:"等值线",description:"用等值线展示资料热度的梯度与聚集边界",
    caption:"等值线表示资料聚集热度的梯度；元数据覆盖另列",legendTitle:"资料热度等值线",
    smoothed:true,contexts:["catalog"],
  },
} as const satisfies Record<string,Definition>;
export type DistributionMode = keyof typeof distributionModes;
export const distributionModeIds = Object.keys(distributionModes) as DistributionMode[];
export const defaultDistributionMode:DistributionMode = "heatmap";
export const distributionPreferenceKey = "oneearth.distribution-mode.v1";
export function parseDistributionMode(value:unknown):DistributionMode {
  return typeof value==="string" && Object.hasOwn(distributionModes,value) ? value as DistributionMode : defaultDistributionMode;
}
export function supportsDistributionMode(mode:DistributionMode,context:DistributionContext) {
  return (distributionModes[mode].contexts as readonly DistributionContext[]).includes(context);
}
export function resolveDistributionMode(preferred:DistributionMode,context:DistributionContext):DistributionMode {
  return supportsDistributionMode(preferred,context) ? preferred : "grid";
}
export function distributionModeRestriction(context:DistributionContext) {
  return context==="fixed-cell" ? "原选单格保留网格分布，解除原选格后可切换" : context==="scenes" ? "逐景结果按原网格展示观测数量" : "";
}
