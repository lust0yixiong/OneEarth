import {sourceExcerpts} from "./evidence-excerpts";
import {rankEvidence} from "./evidence-ranking";
import type {CatalogueEvidence} from "./research-answer";
import type {SourceReadResult} from "./discovery-materials-contract";
import {rememberAssertionEvidence,selectAssertionEvidence,type AssertionEvidenceMemory} from "../src/domain/assertion-evidence-memory";

export type CurrentAssertionReading=NonNullable<SourceReadResult["paperEvidence"]>[number];
type CurrentExcerpt=ReturnType<typeof sourceExcerpts>["excerpts"][number]&{readAt:string;currentAssertionRead:true};
/** Select literal windows from the separately acquired receipt; never alter its PaperRecord. */
export function currentAssertionView(readings:CurrentAssertionReading[],query:string){
  return readings.flatMap(reading=>{
    const allTabs=reading.evidence.papers.flatMap(paper=>(paper.quotes||[]).flatMap(block=>
      typeof block.quote==="string"&&block.quote.trim()&&typeof block.blockId==="string"&&typeof paper.paperId==="string"&&typeof paper.datasetId==="string"?
        [{kind:"text",label:("本轮断言节选 · "+paper.title+" · "+block.blockId).slice(0,360),quote:block.quote,block:block.blockId,
          source:{paperId:paper.paperId,datasetId:paper.datasetId}}]:[]));
    if(!allTabs.length)return [];
    const ranked=rankEvidence(allTabs,[query],()=>"",tab=>tab.quote),matched=ranked.filter(row=>row.rank.matchedTerms.length);
    const tabs=matched.length?matched.map(row=>row.item):allTabs;
    const selected=sourceExcerpts(tabs,query,3000,query);
    const excerpts:CurrentExcerpt[]=selected.excerpts.map(excerpt=>({...excerpt,block:tabs[excerpt.source.page].block,readAt:reading.readAt,currentAssertionRead:true,
      source:{...excerpt.source,block:tabs[excerpt.source.page].block}}));
    return [{id:reading.id,readAt:reading.readAt,stage:"assertion-excerpt" as const,excerpts,
      sourceTextChars:allTabs.reduce((n,tab)=>n+tab.quote.length,0),includedChars:selected.includedChars,omittedBlocks:selected.omittedBlocks+allTabs.length-tabs.length,
      notice:"本轮由发现服务按精确记录ID取得的断言原文窗口；block为断言块身份，page为返回quote数组索引，不是PDF页码。未装入和未引用的材料不是答复所据。"}];
  });
}

export function withCurrentAssertionReadings(rows:CatalogueEvidence[],readings:CurrentAssertionReading[],query:string):CatalogueEvidence[]{
  const views=currentAssertionView(readings,query);
  return rows.map(row=>{
    const current=views.filter(view=>view.id===row.id);if(!current.length)return row;
    return {...row,excerpts:[...row.excerpts,...current.flatMap(view=>view.excerpts)],
      sourceTextChars:row.sourceTextChars+current.reduce((n,v)=>n+v.sourceTextChars,0),includedChars:row.includedChars+current.reduce((n,v)=>n+v.includedChars,0),
      currentAssertionReadings:current.map(({excerpts,...view})=>({...view,blocks:excerpts.map(e=>({block:e.block,source:e.source,start:e.start,end:e.end,readAt:e.readAt}))}))};
  });
}

/** Only supplied windows on cited identities become cross-turn evidence. */
export function rememberCurrentAssertionReadings(previous:AssertionEvidenceMemory[],rows:CatalogueEvidence[],citedIds:string[],query:string){
  const fresh:AssertionEvidenceMemory[]=[],ordinary=rows.map(row=>({...row,excerpts:row.excerpts.filter(e=>!(e as Partial<CurrentExcerpt>).currentAssertionRead)}));
  for(const row of rows){
    const current=row.excerpts.filter((e):e is CurrentExcerpt=>(e as Partial<CurrentExcerpt>).currentAssertionRead===true);
    for(const readAt of new Set(current.map(e=>e.readAt))){
      const excerpts=current.filter(e=>e.readAt===readAt).map(e=>({...e,source:{paperId:e.source.paperId,datasetId:e.source.datasetId,dsKey:typeof row.dsKey==="string"?row.dsKey:undefined}}));
      fresh.push(...rememberAssertionEvidence([],[{id:row.id,excerpts}],citedIds,{query,assetIds:citedIds,recordedAt:readAt}));
    }
  }
  const saved=rememberAssertionEvidence(previous,ordinary,citedIds,{query,assetIds:citedIds});
  return selectAssertionEvidence([...fresh,...saved],{query,assetIds:citedIds});
}
