import { observationPrompt } from "./push-observations";
import { identifyCase } from "./research-chat";
import { findOpticalData } from "./earth-search";
import { combinesSources, onlySource } from "./research-question";

// Named-source queries start a new search unless they refer to a previous result.
export const resetObservationQuery = /^(?:请)?(?:重新(?:查询|检索|查看|查)|重查|重置)(?:一下)?(?:全部|所有)(?:的)?星座(?:推送|直推|观测|数据|产品|记录)*(?:[，,。！!\s]|$)/i;
export function observationIntent(q: string, activeSource: boolean): "new" | "refine" | "reset" | null {
  const query = q.trim();
  if (resetObservationQuery.test(query)) return "reset";
  const source = onlySource(query);
  if (combinesSources(query) || (source && source !== "constellation")) return null;
  if (/(?:保存.*清单|导出|比较|对比|预览|速览|收藏)/.test(query)) return null;
  const referencesBatch = /勾选|已选资料|这批|这组|上一(?:轮|批)|上轮|本批|当前(?:批次|结果)|其中|进一步|继续筛选|再(?:限定|筛选)/.test(query);
  if (observationPrompt(query)) return activeSource && referencesBatch ? "refine" : "new";
  if (!activeSource || identifyCase(query) || findOpticalData(query) || /长江口|Landsat|Sentinel|Earth Search/i.test(query)) return null;
  const narrow = /^(?:在勾选|从勾选|勾选|已选资料|其中|这批|当前结果|这组|请|帮我|在这批(?:结果|数据|观测)?中?|从这批(?:结果|数据|观测)?中?|继续|进一步|再|只|仅|限定|限制|筛选|过滤|云量|分辨率|升轨|降轨|不含|不看|排除|不要|保留|按|采集|时间|卫星|覆盖|坐标|经纬度|经度|在(?:当前|所选|这个)|选中的网格|选区|网格|当前选区|所选网格|这个网格|此格|这里|\d{4}\s*(?:年|月|日|-)|[A-Za-z]+[-_]\d+|only\b|filter\b)/i;
  if (/(?:保存|导出|清单|对比|比较|下载|预览|速览|打开|收藏)/.test(query)) return null;
  return narrow.test(query) && /(?:只|仅|限定|限制|筛选|过滤|排除|不含|不看|不要|保留|采集|分辨率|升轨|降轨|卫星|坐标|经纬度|经度|选区|网格|此格|这里|\d|云量|only\b|filter\b)/i.test(query) ? "refine" : null;
}
