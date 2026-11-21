import { asksForPapers } from "./paper-record";

const sourceNames = "论文(?:研究数据|断言库|线索|数据)?|文献(?:资料)?|断言库(?:数据集)?|EarthNano|海纳(?:专区|数据|目录)?|星座(?:及时数据|直推|推送|观测|数据)?";
const restrictionBody = "(?:只|仅仅?)(?:从|在)?(?:查询|查|检索|搜索|使用|用|看)?\\s*("+sourceNames+")";
const sourceRestriction = new RegExp("(?<![不非])"+restrictionBody, "i");
const negation = "(?:不要|不是|别|不想|不希望|不应(?:该)?|不能|不必|不建议|并非|避免|无需|不)(?:再|继续)?";
const negationBefore = new RegExp(negation+"\\s*$", "i");
const negatedRestriction = new RegExp(negation+"\\s*"+restrictionBody,"i");
const anotherSource = new RegExp("^\\s*(?:和|与|及|、|以及|或)\\s*(?:"+sourceNames+")", "i");

export function onlySource(q:string): "paper" | "haina" | "constellation" | undefined {
  for(const match of q.matchAll(new RegExp(sourceRestriction.source,"gi"))){
    if(negationBefore.test(q.slice(0,match.index)))continue;
    if(anotherSource.test(q.slice(match.index+match[0].length)))return;
    return /海纳/.test(match[1]) ? "haina" : /星座/.test(match[1]) ? "constellation" : "paper";
  }
}

// Any pair of evidence sources can contribute to the same scientific answer.
export function combinesSources(q:string) {
  if (onlySource(q)) return false;
  const sources = [/论文|文献|断言库|EarthNano/i, /海纳/, /星座|卫星.{0,12}(?:直推|推送)/,
    /大模型|模型推理|模型建议/, /公开目录|发布方|官网|网络|联网|网上/];
  return sources.filter(source=>source.test(q)).length>1;
}
export function expandsSources(q:string) {
  return !onlySource(q) && (negatedRestriction.test(q) || combinesSources(q) || /(?:全部|所有)来源|不限来源|不(?:只|仅)(?:用|看|查)(?:论文|海纳|星座)|也(?:加入|看看|查查|用)(?:海纳|论文|星座|网络)/.test(q));
}
export const refersToBatch = (q:string) => /这批|这些|当前选|已选|仅用|只用|当前资料|当前结果/.test(q);

export function asksResearchQuestion(q:string) {
  const interpretation = /能否|为什么|为何|怎样|如何|是否足以|原因|机制/.test(q) && /冰川|径流|降水|积雪|海冰|观测|遥感|卫星|生态|气候|流域|DEM|ERA5/i.test(q);
  return interpretation || /(?:哪些|查找|寻找|推荐|需要|参考|比较).{0,18}(?:数据|资料)|(?:数据|资料).{0,10}(?:获取|可用|参考)|如何.{0,14}(?:估算|评估|重建|分析|量化|验证|估计|解释)|(?:怎样|怎么).{0,12}(?:估算|研究|验证)|(?:观测|气温|降水|冰川|径流|海冰).{0,16}(?:趋势|差异|成因|归因|变化原因)/.test(q) || combinesSources(q);
}

export function asksPaperUsageOnly(q:string) {
  const source = onlySource(q);
  if (source) return source === "paper";
  if (!asksForPapers(q) || combinesSources(q)) return false;
  return /只(?:查|用|看)|仅(?:查|用|看)|哪些(?:论文|文献)|(?:论文|文献)(?:中|里)|这篇|该篇|断言库|EarthNano/i.test(q) || !asksResearchQuestion(q);
}

/** Explicit workspace operations act locally; other turns use goal/object routing. */
export function isWorkspaceCommand(query:string) {
  const q=query.trim();
  if(/[？?]|为什么|为何|如何|怎么|是否|能否|有没有|哪些|多少|原因|区别|\b(?:why|how|what|whether)\b/i.test(q))return false;
  return /^(?:请|请求|帮我|麻烦)?\s*(?:打开|查看|预览|显示|展示|切换|收起|展开|放大|缩小|返回|回到|保存|收藏|定位|导航|飞到|飞往|前往|移动到|移到|带我去|带我到|高亮|取消高亮|在球上|在地图上)/.test(q)
    || /^(?:请|请求|帮我|麻烦)?\s*(?:把|将)(?:地图|地球|球|视图|视角)?\s*(?:定位|移到|移动到|切换到|放大|缩小)/.test(q)
    || /^(?:比较|对比)第[一二三四五六七八九十\d]+份(?:和|与)第[一二三四五六七八九十\d]+份[。！!]*$/.test(q);
}
