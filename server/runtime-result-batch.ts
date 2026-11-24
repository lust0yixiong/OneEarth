import type {ResultBatch} from "../src/domain/turn-context";
import type {DataSearchResult} from "./data-search";
import {modelSafeText,modelSafeValue,modelUrlLocator} from "./model-context-safety";
import {discoverySourceNames} from "../src/domain/discovery-source-policy";

type Owner={batchId:string;taskId:string;turnId:string;conversationId:string};
/** Only a returned service result, never carried records or answer prose, creates this batch. */
export function discoveryResultBatch(owner:Owner,query:string,material:DataSearchResult):ResultBatch{
  const channels=material.sourceStatus.map(({source,status,count})=>({source,status,count}));
  const requested=channels.filter(channel=>channel.status!=="not_requested"),itemIds=[...new Set([
    ...material.papers.map(paper=>paper.id),...material.haina.map(asset=>asset.id),
    ...material.searches.filter(run=>run.status==="done").flatMap(run=>run.hits.map(hit=>"web:"+modelUrlLocator(hit.url))),
  ])].slice(0,512);
  const status=material.clarification||material.questionCheck||!requested.length?"partial":
    requested.every(channel=>channel.status==="failed")&&!itemIds.length?"failed":
    requested.some(channel=>channel.status!=="done")||material.issues.length?"partial":"complete";
  const plan=material.plan,conditions=[
    plan.dataQuestion&&"受托方归一目标："+plan.dataQuestion,
    plan.researchIntent?.region&&"受托地区："+plan.researchIntent.region,
    plan.researchIntent?.time&&"受托时间："+plan.researchIntent.time,
    plan.sourcePolicy&&"采用的来源策略："+plan.sourcePolicy.mode+" "+plan.sourcePolicy.sources.join(","),
    ...(material.sourceStatus.some(channel=>channel.source===discoverySourceNames.haina&&channel.status!=="not_requested")?
      plan.hainaQueries.slice(0,4).map(query=>"海纳委托查询词（渠道已尝试）："+query):[]),
    ...material.searches.filter(run=>["Bing","DuckDuckGo","DataCite","Codex Web","DeepSeek Search"].includes(run.engine)&&run.status!=="running")
      .slice(0,8).map(run=>"网页查询回执（"+run.status+"）："+run.query),
  ].filter((value):value is string=>!!value).map(value=>modelSafeText(value).slice(0,240));
  return modelSafeValue({...owner,kind:"research",status,query:modelSafeText(query).slice(0,1200),conditions,channels,itemIds});
}

/** A direct authoritative coverage/records operation is a catalogue result, not a new discovery or a full-text read. */
export function gridCatalogueBatch(owner:Owner,query:string,itemIds:string[],revision:string|undefined,complete:boolean):ResultBatch{
  return modelSafeValue({...owner,kind:"catalogue",status:complete?"complete":"partial",query:query.slice(0,1200),
    conditions:["权威覆盖修订："+(revision||"未知"),"目录定位；没有新发现委托或原文读取"],
    channels:[{source:"authoritative-grid-catalogue",status:complete?"done":"partial",count:itemIds.length}],itemIds:[...new Set(itemIds)]});
}
