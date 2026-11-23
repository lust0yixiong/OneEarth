export const discoverySources = ["paper","haina","web","constellation"] as const;
export type DiscoverySource = typeof discoverySources[number];
export const discoverySourceNames = {paper:"文献资料检索",haina:"海纳专区检索",web:"网络检索"} as const;
export type DiscoverySourcePolicy =
  | {mode:"restricted";sources:DiscoverySource[];fallback?: "no_match"}
  | {mode:"preferred";sources:DiscoverySource[]};

export function parseDiscoverySourcePolicy(value:unknown):DiscoverySourcePolicy|undefined {
  if (!value || typeof value!=="object" || Array.isArray(value)) return;
  const {mode,sources,fallback} = value as {mode?:unknown;sources?:unknown;fallback?:unknown};
  if (Object.keys(value).some(key=>!["mode","sources","fallback"].includes(key)) || (mode!=="restricted"&&mode!=="preferred") ||
      !Array.isArray(sources) || !sources.length || sources.length>discoverySources.length ||
      !sources.every((source):source is DiscoverySource=>discoverySources.some(allowed=>source===allowed)) ||
      new Set(sources).size!==sources.length) return;
  if(fallback!==undefined){
    if(mode!=="restricted" || fallback!=="no_match" || sources.length<2)return;
    return {mode,sources,fallback};
  }
  return {mode,sources};
}

export function allowsDiscoverySource(policy:DiscoverySourcePolicy|undefined, source:DiscoverySource) {
  return policy?.mode!=="restricted" || policy.sources.includes(source);
}

const names = [
  ["haina","(?:海纳(?:专区|目录|数据)?|Haina)"],
  ["paper","(?:论文(?:研究数据|断言库|线索|数据)?|文献(?:资料)?|断言库(?:数据集)?|EarthNano)"],
  ["web","(?:公开网络|网络|网上|发布方(?:官网)?|官网|Web)"],
  ["constellation","(?:星座(?:及时数据|直推|推送|观测|数据)?)"],
] as const;
const name = "(?:"+names.map(([,pattern])=>pattern).join("|")+")";
const separator = "(?:和|与|及|、|以及|或)";
const namedList = name+"(?:\\s*"+separator+"\\s*"+name+")*";
const negated = /(?:不要|不是|别|不想|不希望|不应(?:该)?|不能|不必|并非|避免|无需|不)(?:再|继续)?\s*$/u;
const noMatch = /(?:找不到|查不到|搜不到|没找到|没查到|没有(?:匹配|结果|命中|合适)|无(?:匹配|结果|命中)|零命中)/u;

export function releasesDiscoverySourcePolicy(question:string) {
  return /(?:不限|不限制)来源|(?:恢复|允许|使用|看看|查查)(?:全部|所有|其他|其它)来源|(?:不要|别|不必)只(?:看|查|用)?|不(?:只|单|仅|限于)(?:看|查|用|从|在)?\s*(?:论文|文献|海纳|星座|网络)/u.test(question);
}

function namedSources(text:string):DiscoverySource[] {
  return [...new Set([...text.matchAll(new RegExp(name,"giu"))].flatMap(([label])=>
    names.filter(([,pattern])=>new RegExp("^"+pattern+"$","iu").test(label)).map(([source])=>source)))];
}

/** Backstop for source instructions evident in the original wording. A bare source mention is left to planning. */
export function explicitDiscoverySourcePolicy(question:string):DiscoverySourcePolicy|undefined {
  const q=question.normalize("NFKC");
  const commands = [
    ["restricted",new RegExp("(?:只|仅限|仅仅?)(?:从|在)?(?:查询|查|检索|搜索|使用|用|看|找)?\\s*("+namedList+")","giu")],
    ["preferred",new RegExp("(?:优先|首选|优先考虑)\\s*(?:从|在)?(?:查询|查|检索|搜索|使用|用|看|找)?\\s*("+namedList+")","giu")],
  ] as const;
  for (const [mode,pattern] of commands) for (const match of q.matchAll(pattern)) {
    if (negated.test(q.slice(0,match.index))) continue;
    const sources=namedSources(match[1]);
    if(mode==="preferred"){
      const more=new RegExp("(?:再|然后|接着)\\s*(?:查询|查|检索|搜索|使用|用|看|找)?\\s*("+namedList+")","iu")
        .exec(q.slice(match.index+match[0].length));
      if(more){
        const later=[...new Set([...sources,...namedSources(more[1])])];
        return {mode:"restricted",sources:later,...(later.length>1&&noMatch.test(q.slice(match.index+match[0].length,match.index+match[0].length+more.index))?{fallback:"no_match"}:{})};
      }
    }
    return {mode,sources};
  }
  const sequence=new RegExp("先\\s*(?:从|在)?(?:查询|查|检索|搜索|使用|用|看|找)?\\s*("+namedList+")"+
    "([^。！？\\n]{0,100}?)(?:再|然后|接着)\\s*(?:从|在)?(?:查询|查|检索|搜索|使用|用|看|找)?\\s*("+namedList+")","iu").exec(q);
  if(sequence && !negated.test(q.slice(0,sequence.index))){
    const sources=[...new Set([...namedSources(sequence[1]),...namedSources(sequence[3])])];
    return {mode:"restricted",sources,...(sources.length>1&&noMatch.test(sequence[2])?{fallback:"no_match"}:{})};
  }
  if (releasesDiscoverySourcePolicy(q)) return;
  const comparison = new RegExp("(?:比较|对照|对比|分别(?:查找|查询|查看|查|检索|搜索))\\s*("+name+"(?:\\s*"+separator+"\\s*"+name+")+)","iu").exec(q);
  if (comparison && !negated.test(q.slice(0,comparison.index))) return {mode:"restricted",sources:namedSources(comparison[1])};
  const lookup = "(?:能(?:找到|查到)|(?:都)?(?:有|能提供)(?:没有|哪些|什么|这类|此类|的)?|能否|可以|可查|查找|查看|查|找|搜|检索|收录)";
  const inside = new RegExp("(?:在|从)\\s*"+name+"\\s*(?:内(?:部)?|里(?:面|边)?|中|之中)?\\s*"+lookup+
    "|"+name+"\\s*(?:(?:内(?:部)?|里(?:面|边)?|中|之中)\\s*"+lookup+"|(?:都)?(?:有哪些|有什么|有没有|收录了哪些))","giu");
  const mentioned = namedSources(q);
  if (mentioned.length!==1) return;
  for (const match of q.matchAll(inside)) {
    if (!negated.test(q.slice(0,match.index))) return {mode:"restricted",sources:mentioned};
  }
}
