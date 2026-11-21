import { observationIntent, resetObservationQuery } from "../src/domain/observation-intent";
import type { constellationService } from "./constellations";
import type { Coordinate, DiscoveryContext, DiscoveryResponse, Selection } from "../src/domain/types";
import { cellAt, cellShape } from "../src/data/evidence/research-grid.mjs";
import { containsLocation, footprintInCell, pushId, observationGeometry, type Observation } from "../src/domain/push-observations";
import type { Polygon } from "geojson";

interface TimeWindow { start: string; end: string; label: string; }
export interface ObservationQuery {
  satellites: string[];
  time?: TimeWindow;
  point?: Coordinate;
  selection?: Selection;
  conditions: string[];
  unsupported: string[];
}

function dateWindow(token: string): TimeWindow | undefined {
  const parts = token.match(/\d+/g)?.map(Number);
  if (!parts?.length) return;
  const [year, month = 1, day = 1, hour = 0, minute = 0, second = 0] = parts;
  const start = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (start.getUTCFullYear() !== year || start.getUTCMonth() + 1 !== month ||
      start.getUTCDate() !== day || hour > 23 || minute > 59 || second > 59) return;
  const end = new Date(start);
  switch (parts.length) {
    case 1: end.setUTCFullYear(year + 1); break;
    case 2: end.setUTCMonth(month); break;
    case 3: end.setUTCDate(day + 1); break;
    case 5: end.setUTCMinutes(minute + 1); break;
    case 6: end.setUTCSeconds(second + 1); break;
    default: return;
  }
  return {start: start.toISOString(), end: end.toISOString(), label: token.trim()};
}

const datePattern = /(?<![\da-z])(?:[12]\d{3})(?:年\s*(?:\d{1,2}月\s*(?:\d{1,2}[日号])?)?|[-/]\d{1,2}(?!\d)(?:[-/]\d{1,2}(?!\d))?)?(?:[T ]\d\d?:\d\d(?::\d\d)?Z?)?(?![\da-z])/gi;
const rangeSeparator = /^\s*(?:到|至|[-–—~～]|to|through)\s*$/i;
const escapePattern = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function parseObservationQuery(query: string, selected: Selection | null, names: string[]): ObservationQuery {
  let rest = query.normalize("NFKC").replace(resetObservationQuery, "")
    .replace(/(\d)\s+([年月日号])/g, "$1$2")
    .replace(/(?:经度|longitude)\s*[:=]?\s*([+-]?\d+(?:\.\d+)?)\s*[, ]*\s*(?:纬度|latitude)\s*[:=]?\s*([+-]?\d+(?:\.\d+)?)/gi, "坐标($1,$2)")
    .replace(/(?:坐标|经纬度|coordinates?)?\s*\(\s*([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)\s*\)/gi, "坐标($1,$2)");
  const result: ObservationQuery = {satellites: [], conditions: ["星座直推"], unsupported: []};
  const point = /(?:坐标|经纬度|coordinates?)\s*[:=]?\s*\(?\s*([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)\s*\)?/i;
  rest = rest.replace(point, (_, lon, lat) => {
    if (Math.abs(+lon) > 180 || Math.abs(+lat) > 90) result.unsupported.push("坐标超出经纬度范围");
    else {
      result.point = [+lon, +lat];
      result.conditions.push("覆盖坐标 " + result.point.join(", "));
    }
    return " ";
  });
  const local = /(?:当前|这个|该|所选|选中|此)?(?:选区|选中的网格|网格|此格)|这里/g;
  rest = rest.replace(local, () => {
    if (selected && !selected.simulated) result.selection = selected;
    else if (!result.unsupported.length) result.unsupported.push("当前没有已选的实际网格");
    return " ";
  });
  if (result.selection) result.conditions.push("当前选区 " + result.selection.grid.label + " " + result.selection.id);
  // Match publisher names before dates so an identifier containing a year stays intact.
  for (const name of [...new Set(names)].sort((a,b) => b.length - a.length)) {
    const expr = new RegExp("(?<![a-z0-9_-])" + escapePattern(name.normalize("NFKC")) + "(?![a-z0-9_-])", "ig");
    if (expr.test(rest)) {
      result.satellites.push(name);
      rest = rest.replace(expr, " ");
    }
  }
  rest = rest.replace(/\b[A-Z][A-Z0-9]*(?:[-_][A-Z0-9]+)*\d[A-Z0-9_-]*\b/gi, name => {
    result.satellites.push(name);
    return " ";
  });
  if (result.satellites.length) result.conditions.push("卫星 " + result.satellites.join("、"));
  // Expand an omitted second year in Chinese month/day ranges.
  rest = rest.replace(/([12]\d{3})年(\d{1,2})月(\d{1,2}[日号])?\s*([至到~～–—-])\s*(\d{1,2})(月|[日号])/g,
    (_, y, m, d, separator, n, unit) => y+"年"+m+"月"+(d || "")+separator+y+"年"+(unit === "月" ? n+unit : m+"月"+n+unit));
  const dates = [...rest.matchAll(datePattern)];
  if (dates.length) {
    const ranges = dates.map(m => dateWindow(m[0]));
    const between = dates.length === 2 ? rest.slice(dates[0].index! + dates[0][0].length, dates[1].index) : "";
    if (ranges.some(w => !w) || dates.length > 2 || (dates.length === 2 && !rangeSeparator.test(between))) {
      result.unsupported.push("采集时间 " + dates.map(m => m[0]).join("、"));
    } else {
      const first = ranges[0]!, last = ranges.at(-1)!;
      if (first.start >= last.end) result.unsupported.push("采集时段的结束时间早于开始时间");
      else {
        result.time = {start:first.start, end:last.end, label: dates.map(m => m[0].trim()).join(" 至 ")};
        result.conditions.push("采集时间 " + result.time.label + "（UTC）");
      }
    }
    rest = rest.slice(0, dates[0].index) + " " + rest.slice(dates.at(-1)!.index! + dates.at(-1)![0].length);
  }
  if (/(?:或者|或|\bor\b)/i.test(query) &&
      !(result.satellites.length > 1 && !dates.length && !result.point && !result.selection))
    result.unsupported.push("跨条件的“或”查询");
  if (/(?:不要|不含|排除|除了|除外|不看|\bnot\b|\bexcept\b)/i.test(query))
    result.unsupported.push("排除或否定条件");
  // After consuming supported qualifiers, any other condition fails closed.
  const residual = rest
    .replace(/(?:勾选的(?:资料|观测|记录)?|勾选|已选资料|这组|上一轮|上一批|上轮|本批|当前批次|当前结果|请帮我|请给我|从这批(?:结果|观测|数据)?|在这批(?:结果|观测|数据)?|这批(?:结果|数据|观测)?|进一步|继续|再次|再|其中|只留下|检索|限定为|限定|只保留|仅保留|只显示|仅显示|只查|查询一下|查一下|一下|只返回|只需要|仅需要|仅限于|限制为|筛选出|查看|查找|查询|筛选|寻找|显示|列出|返回|只看|仅看|只要|仅限|想看|我想|看看|最新|最近的|最新的|接收库|接收|采集时间|采集|获取|推送|直推|合作|自有|卫星|星座|观测|影像|数据|产品|记录|范围内|范围|区域内|覆盖|相交|时间段|时段|期间|之内|以及|有没有|有哪些|有无|是否有|来自|仅|在|于|的|中|内|和|且|与|或|从|到|至|请|我|找|看|为|年|条|把|给|按|查|呢)/g," ")
    .replace(/\b(?:please|show|me|find|list|only|observations?|products?|records?|from|for|in|on|during|latest|satellites?|constellation|push|and|or|utc)\b/gi, " ")
    .replace(/[\s，,、。！？?!“”"'()（）.:：]+/g," ").trim();
  if (residual) result.unsupported.push(residual);
  return result;
}

export function observationMatches(r: Observation, query: ObservationQuery) {
  if (query.unsupported.length || (query.satellites.length && !query.satellites.some(s => s.toLowerCase() === r.satellite.toLowerCase()))) return false;
  if (query.time && (r.observedAt < query.time.start || r.observedAt >= query.time.end)) return false;
  if (query.point && !containsLocation(r, query.point)) return false;
  const sel = query.selection;
  if (!sel) return true;
  const g = observationGeometry(r);
  return g.type === "Point" ? cellAt(g.coordinates as Coordinate, sel.grid) === sel.id :
    footprintInCell(g, cellShape(sel.id, sel.grid).geometry as Polygon);
}

export function discoverObservations(query: string, context: DiscoveryContext,
  service: Pick<ReturnType<typeof constellationService>, "latest" | "satellites">): DiscoveryResponse | undefined {
  const intent = !context.citation && observationIntent(query, !!context.observationSource || context.filters.source === "constellation");
  if (!intent) return;
  const parent = intent === "refine" ? context.observationBatch : undefined;
  const filters = parseObservationQuery(query, context.selection, service.satellites());
  const timeScope = parent?.utcWindow || context.filters.utcWindow;
  if(!filters.time && intent==="refine" && timeScope){
    const [lo,hi]=timeScope;
    filters.time={start:new Date(lo).toISOString(),end:new Date(hi).toISOString(),label:"当前时间轴"};
    filters.conditions.push("当前时间轴 "+filters.time.start+" 至 "+new Date(hi-1).toISOString());
  }
  const feed = service.latest(filters, parent ? context.candidateIds : undefined);
  const first = feed.records[0];
  const ordering = "按采集时间排序，最多 50 条";
  const conditions = [...new Set([...(parent?.catalogConditions || []).filter(c => c !== ordering), ...filters.conditions,
    ...filters.unsupported.map(s => "未执行：" + s), ordering])];
  const summary = (parent ? "在上一批观测中筛选。" : "查询星座接收库。") + conditions.join(" · ") + "。";
  const message = filters.unsupported.length
    ? summary + "本轮保留零项。可在新问题中写明星座及调整后的条件，或输入“重新查全部星座”。"
    : first ? summary + "查到 " + feed.records.length + " 条推送产品。最新一条由 " + first.sourceName + " 的 " + first.satellite +
      " 观测于 " + first.observedAt + "，OneEarth 接收于 " + first.receivedAt + "。" + (first.test ? "这条记录来自联调来源。" : "")
    : summary + (feed.configured ? "已接收的星座观测中，符合全部条件的记录为零。" : "当前尚未配置自有或合作星座的推送源，暂无直推观测。");
  const years: [number,number] | null = filters.time
    ? [new Date(filters.time.start).getUTCFullYear(), new Date(Date.parse(filters.time.end) - 1).getUTCFullYear()] : null;
  let period = parent?.period || years;
  if (parent?.period && years) {
    const start = Math.max(parent.period[0], years[0]), end = Math.min(parent.period[1], years[1]);
    period = start <= end ? [start, end] : null;
  }
  return {pushFeed: feed, message, catalogMatch: {
    ...(filters.time?{utcWindow:[Date.parse(filters.time.start),Date.parse(filters.time.end)] as [number,number]}:{}),
    ids: feed.records.map(pushId), sampleWindow: false, conditions, rejected: [], period,
    selection: filters.selection || parent?.selection || null,
  }};
}
