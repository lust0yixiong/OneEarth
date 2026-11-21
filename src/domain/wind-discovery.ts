import {
  defaultWindState,
  getWindData,
  windFrame,
  windTimeLabel,
  windVector,
} from "./wind";
import type { DiscoveryContext, DiscoveryResponse } from "./types";
export function discoverWind(
  q: string,
  context: DiscoveryContext,
): DiscoveryResponse | null {
  const active = context.visualization;
  const mentionsWind =
    /^(?:风场|全球风|大气环流|GFS|wind(?: field)?)$/i.test(q) ||
    /(?:展示|查看|探索|打开|显示|切换|可视化).{0,16}(?:风场|全球风|大气环流|GFS)|(?:风场|全球风|大气环流|GFS).{0,12}(?:可视化|原网格|分布|快照|流线)/i.test(
      q,
    ) ||
    /\b(?:show|display|open|visualize|explore)\b.{0,30}\b(?:wind(?: field)?|GFS)\b/i.test(
      q,
    );
  if (!active && context.caseId !== "wind" && !mentionsWind) return null;
  if (
    /返回.*(?:分布|全景)|退出.*可视化/.test(q) &&
    (active || context.caseId === "wind")
  )
    return {
      visualization: null,
      clearSelection: true,
      message: "已退出风场效果，回到数据集覆盖分布。仍可查看原网格内容和来源。",
    };
  if (/查看内容|原始数据|原网格|原表|数据表/.test(q))
    return {
      previewCaseId: "wind",
      previewNeed: 0,
      previewKind: "table",
      message:
        "已打开 GFS 原网格内容。表格包含经纬度、u/v 分量和风速，与球上风场使用同一数据快照。",
    };
  if (
    active &&
    /这里|所选|这个位置/.test(q) &&
    /风|数据|多少|依据/.test(q) &&
    context.selection
  ) {
    const data = getWindData(),
      point = context.selection.point;
    const vector = data && windVector(data, windFrame(active), ...point);
    return {
      message: vector
        ? `所选位置 ${point.map((v) => v.toFixed(3)).join(", ")}°：风速 ${vector.speed.toFixed(2)} m/s，u ${vector.u.toFixed(2)}、v ${vector.v.toFixed(2)} m/s，气象风向（来向）${vector.from.toFixed(0)}°。\n${windTimeLabel(windFrame(active))}，${active.level === "10m" ? "近地面 10 m" : "250 hPa"}。数值由相邻四个 1° 原网格双线性插值得到。`
        : "风场正在载入，可以稍后点选位置读值，或查看原始网格内容。",
    };
  }
  const control =
    /暂停|继续|播放|流线|风速|色彩|250|10\s*[m米]|近地面|高空|小时|时效|F00[06]|F012/i.test(
      q,
    );
  if (!mentionsWind && !control) return null;
  const pressure = q.match(/(\d+)\s*(?:hpa|百帕)/i);
  const horizon = q.match(/(\d+)\s*小时|F(\d{3})/i);
  if (
    (pressure && +pressure[1] !== 250) ||
    (horizon && ![0, 6, 12].includes(+(horizon[1] || horizon[2])))
  )
    return {
      message:
        "当前风场案例已接入近地面 10 m、250 hPa，以及 0、6、12 小时三个预报时效。可以在这些实际数据之间切换。",
    };
  const next = { ...(active || defaultWindState()) };
  if (/250|高空/.test(q)) next.level = "250hPa";
  if (/10\s*[m米]|近地面|地面风/.test(q)) next.level = "10m";
  if (/暂停|停止/.test(q)) next.playing = false;
  else if (/播放|继续|启动/.test(q)) next.playing = true;
  if (/12\s*小时|F012/i.test(q)) next.forecastHour = 12;
  else if (/6\s*小时|F006/i.test(q)) next.forecastHour = 6;
  else if (/0\s*小时|F000|分析场/.test(q)) next.forecastHour = 0;
  if (/关闭.*(?:着色|颜色)|只看流线/.test(q)) next.color = false;
  if (/打开.*(?:着色|颜色)|显示风速/.test(q)) next.color = true;
  return {
    caseId: "wind",
    visualization: next,
    dataView: null,
    filters: {
      need: -1,
      type: "",
      source: "",
      place: "",
      period: null,
      depth: null,
      maxDem: null,
    },
    ...(!active
      ? {
          camera: {
            center: [105, 20] as [number, number],
            zoom: 1,
            reason: "全球 GFS 风场",
          },
          mesh: false,
        }
      : {}),
    clearSelection: !active,
    message: `${active ? "已更新" : "已打开"}全球风场可视化：${next.level === "10m" ? "近地面 10 m" : "250 hPa"}，${windTimeLabel(windFrame(next))}。\n颜色表示风速，流线沿同一 u/v 场运动；可切换层次、时效，点选位置读值，或单独查看原网格内容。当前为已保存快照。`,
  };
}
