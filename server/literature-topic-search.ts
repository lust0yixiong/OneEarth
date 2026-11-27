import {publicResearchLabel,type ResearchProgressEvidence} from "../src/domain/native-agui-research-progress";
import {validPaperRecord,type PaperRecord} from "../src/domain/paper-record";
import {searchPapers,type PaperPlan,type PaperSearchResult,type PaperTopicLookup} from "./earthnano";
import type {PaperCatalogStorage} from "./postgres-paper-catalog";
import type {ToolCall} from "../src/domain/types";
import {isResearchTimeout,type ResearchProgressFact} from "./research-progress";

type Topic = {facet:PaperPlan["facets"][number];label:string};
export type PaperBranchResult = Omit<PaperSearchResult,"incomplete"|"tools">&{incomplete:string[];tools:string[]};
export type PaperLookup = (plan:PaperPlan,topic?:PaperTopicLookup)=>Promise<PaperBranchResult>;
export type LiteratureTopicTiming = {totalMs:number;minimumMs:number;maximumMs:number;now?:()=>number};
const defaultTiming:LiteratureTopicTiming = {totalMs:30_000,minimumMs:11_000,maximumMs:13_000};

/** Return an existing lookup batch only once its immutable record IDs can be read. */
export function publishedPaperLookup(papers:Pick<PaperCatalogStorage,"beginLookup"|"publishLookup">,signal:AbortSignal,
  stage:(message:string)=>void,report:(call:ToolCall)=>void):PaperLookup {
  return async (plan,topic)=>{
    const stamp=await papers.beginLookup();
    signal.throwIfAborted();
    const batch=await searchPapers(plan,signal,stage,report,topic);
    signal.throwIfAborted();
    await papers.publishLookup(batch.records,stamp);
    return batch;
  };
}

export function literatureTopics(plan:PaperPlan):Topic[]|undefined {
  if(plan.name || plan.facets.length<2)return;
  const seen=new Set<string>();
  const topics:Topic[]=[];
  for(const facet of plan.facets){
    const key=JSON.stringify([...new Set(facet.queries.map(q=>q.toLowerCase().replace(/\s+/gu," ")))].sort());
    if(seen.has(key))continue;
    seen.add(key);
    const label=facet.need.trim();
    topics.push({facet,label:publicResearchLabel(label,100)?label:"主题 "+(topics.length+1)});
  }
  return topics.length>1?topics:undefined;
}

/** The paper count is based only on the named, matched usage rows available
 * to read. The upstream catalogue total is a different quantity. */
function verifiedMaterials(records:PaperRecord[]){
  const accepted:PaperRecord[]=[];
  const papers=new Set<string>();
  const evidence=new Map<string,ResearchProgressEvidence>();
  for(const record of records){
    if(!validPaperRecord(record) || record.catalogSummary || record.assertionCatalogKind==="metadata-only")continue;
    const rows=record.need.tabs.find(tab=>tab.kind==="table"&&tab.label==="论文用法（本页）")?.rows??[];
    const usages=rows.flatMap(([name,,,,paperId,datasetId])=>
      typeof name==="string" && name.trim() && typeof paperId==="string" && paperId.trim() &&
      typeof datasetId==="string" && datasetId.trim() ? [{name:name.trim(),paperId:paperId.trim()}] : []);
    if(!usages.length)continue;
    accepted.push(record);
    for(const usage of usages)papers.add(usage.paperId);
    const display=usages.find(usage=>publicResearchLabel(usage.name,180));
    if(display && evidence.size<4) evidence.set(record.id,{assetId:record.id,title:display.name});
  }
  return {accepted,count:papers.size,evidence:[...evidence.values()]};
}

export async function searchLiteratureTopics(
  plan:PaperPlan,topics:Topic[],signal:AbortSignal,lookup:PaperLookup,
  progress?: (fact:ResearchProgressFact)=>void,timing=defaultTiming,
):Promise<PaperBranchResult> {
  const records=new Map<string,PaperRecord>(),notices=new Set<string>(),tools=new Set<string>(),incomplete=new Set<string>();
  let timedOut=false,truncated=false,skipped=0;
  const now=timing.now??(()=>performance.now());
  const endsAt=now()+timing.totalMs;
  const actions=topics.map(({label},index)=>({id:"source-paper-"+(index+1),area:"literature" as const,topic:label}));
  signal.throwIfAborted();
  for(const action of actions)progress?.({...action,status:"queued"});
  for(const [index,{facet,label}] of topics.entries()){
    signal.throwIfAborted();
    const action=actions[index],remaining=Math.floor(endsAt-now());
    if(remaining<timing.minimumMs){
      skipped++;
      progress?.({...action,status:"not_started"});
      incomplete.add("主题「"+label+"」在本轮总时限内未启动");
      continue;
    }
    const timeout=Math.min(remaining,timing.maximumMs);
    const deadline=AbortSignal.timeout(timeout);
    progress?.({...action,status:"running"});
    try {
      // Topic search terms are scoped to this facet. The same broad scenario
      // would otherwise add the same unrelated candidates to each request.
      const result=await lookup({...plan,facets:[facet],scenario:[]},{deadline});
      signal.throwIfAborted();
      const {accepted,count,evidence}=verifiedMaterials(result.records);
      for(const record of accepted)if(!records.has(record.id))records.set(record.id,record);
      for(const notice of result.notices??[])notices.add(notice);
      for(const tool of result.tools)tools.add(tool);
      timedOut ||= !!result.timedOut;
      truncated ||= !!result.truncated;
      const incompleteLookup=!!result.incomplete.length || !!result.truncated || accepted.length!==result.records.length;
      const reason=result.timedOut ? "查询超时"
        : result.truncated ? "达到候选核对上限"
        : incompleteLookup ? "部分查询或论文用法未核实" : undefined;
      if(reason)incomplete.add("主题「"+label+"」"+reason);
      const status=result.timedOut && !count ? "timeout" : reason ? "partial" : "done";
      // A lookup only returns after its accepted exact IDs have been published.
      // There are no positive counts or buttons for an unverified candidate.
      progress?.({...action,status,...(status==="done" || count ? {count} : {}),...(evidence.length?{evidence}:{})});
    }catch(error){
      signal.throwIfAborted();
      const timeout=isResearchTimeout(error);
      timedOut ||= timeout;
      incomplete.add("主题「"+label+"」"+(timeout?"查询超时":"查询或论文记录发布失败"));
      progress?.({...action,status:timeout?"timeout":"failed"});
    }
  }
  if(skipped)notices.add("本轮文献主题共享一次检索时限。有 "+skipped+" 个主题未启动，不能视为查无结果。");
  return {records:[...records.values()],tools:[...tools],incomplete:[...incomplete],notices:[...notices],timedOut,truncated};
}
