export const strictCesiumMode = import.meta.env.VITE_ONEEARTH_CESIUM_STRICT === "1";

export const cesiumLimitLabels: Readonly<Record<string, string>> = {
  "grid-mesh": "网格线",
  "grid-distribution": "整球逐格着色",
  heatmap: "整球热力图",
  contours: "等值线",
  gfs: "GFS 风场",
  "public-raster-picking": "公开栅格绘制与点读",
  "public-point-picking": "公开点图层绘制与拾取",
  "field-raster": "专题栅格",
  "layer-stack-picking": "图层叠加与拾取",
  "data-picking": "测站拾取",
  "regional-case": "区域案例",
  simulation: "模拟观测",
  constellation: "星座观测",
  "observation-scenes": "逐景观测",
};
