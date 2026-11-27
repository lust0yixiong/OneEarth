import type {AnswerDelivery,AnswerReference,DiscoveryResponse,WebHit} from "./types";
import type {ResearchProgress} from "./native-agui-research-progress";
import {validPaperRecord} from "./paper-record";
import {hasReadWebExcerpt,webUrl} from "./web-preview";

export function answerDeliveryLabel(delivery:AnswerDelivery){
  const reason=delivery.reason==="timeout"?"回答整理超时":"回答整理未完成";
  return delivery.status==="partial"?"部分交付 · "+reason:reason+" · 暂无可交付依据";
}

function traceOutput(output:string|undefined){
  try{return JSON.parse(output ?? "null") as {mode?:unknown;budgetExhausted?:unknown}|null;}
  catch{return null;}
}

function savedWebReadings(result:DiscoveryResponse){
  const hits=new Map<string,WebHit>();
  for(const hit of [...(result.answerNotes?.webSources??[]),
    ...(result.runTrace?.searches??[]).flatMap(search=>search.hits)]){
    if(hit.previousRead || !hasReadWebExcerpt(hit))continue;
    const url=webUrl(hit.url);
    if(url && !hits.has(url.href))hits.set(url.href,hit);
  }
  return hits;
}

/** Historic fallback is recognised from the archived delivery receipt. Only
 * materials explicitly recorded by this run's progress or reads are surfaced. */
export function archivedAnswerDelivery(result:DiscoveryResponse,progress?:ResearchProgress):AnswerDelivery|undefined {
  if(result.answerDelivery)return result.answerDelivery;
  const calls=result.runTrace?.calls??[];
  const delivery=calls.find(c=>c.id==="answer-delivery" && c.status==="partial");
  const mode=traceOutput(delivery?.output)?.mode;
  if(mode!=="evidence-retained" && mode!=="no-direct-evidence" && mode!=="validated-checkpoint")return;
  const generation=calls.find(c=>c.id==="answer-generation" && c.status==="failed");
  const reason=traceOutput(generation?.output)?.budgetExhausted===true?"timeout":"incomplete";
  const paperRecords=new Map((result.paperRecords??[]).filter(validPaperRecord).map(record=>[record.id,record]));
  const materials=new Map<string,AnswerReference>();
  for(const action of progress?.actions??[])for(const evidence of action.evidence??[]){
    const paper=paperRecords.get(evidence.assetId);
    if(!paper || paper.catalogSummary || paper.assertionCatalogKind==="metadata-only")continue;
    materials.set(paper.id,{kind:"asset",id:paper.id,title:paper.need.product,source:paper.need.source,sourceChannel:"assertion"});
  }
  for(const [href,hit] of [...savedWebReadings(result)].slice(0,3))
    materials.set(href,{kind:"web",url:href,title:hit.title,sourceChannel:"web"});
  const saved=[...materials.values()].slice(0,12);
  return {status:saved.length || result.answerNotes?.references?.length?"partial":"unavailable",reason,materials:saved};
}

export function retainedWebReadings(result:DiscoveryResponse,delivery?:AnswerDelivery){
  if(!delivery?.materials.some(ref=>ref.kind==="web"))return [];
  const hits=savedWebReadings(result);
  const retained=delivery.materials.flatMap(ref=>{
    const hit=ref.kind==="web" ? hits.get(webUrl(ref.url)?.href??"") : undefined;
    return hit?[hit]:[];
  });
  if(!retained.length)return [];
  return [...new Map([...(result.answerNotes?.webSources??[]),...retained]
    .map(hit=>[webUrl(hit.url)?.href??hit.url,hit])).values()];
}
