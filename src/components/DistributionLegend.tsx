import type {ReactNode} from "react";
import {countBands,heatGradient} from "../domain/distribution-heat";
import type {DistributionMode} from "../domain/distribution-modes";
const legends:Record<DistributionMode,ReactNode>={
  grid:<span className="distribution-ramp" role="img" aria-label="数据集数量由少到多" title="由浅至深表示格内可定位数据集数量，点选网格查看精确数量。"><span>少</span><i style={{background:`linear-gradient(to right, ${countBands.map(band=>band.color).join(",")})`}}/><span>多</span></span>,
  heatmap:<span className="distribution-ramp" role="img" aria-label="资料聚集热度由低到高" title="由格内可定位数据集数平滑生成，点选网格查看精确数量。"><span>低</span><i style={{background:heatGradient}}/><span>高</span></span>,
  contours:<span className="distribution-ramp contour-ramp" role="img" aria-label="资料热度等值线由低到高" title="线条连接相同资料热度的位置，点选网格查看精确数量。"><span>低</span><i/><span>高</span></span>,
};
export function DistributionLegend({mode}:{mode:DistributionMode}) {
  return legends[mode];
}
