import type {TaskStore} from "./task-store";
import {taskIdPattern} from "./task-store";
import {isWorkspaceDiscoveryArchiveResult} from "./workspace-discovery-archive";
import {paperId,validPaperRecord,type PaperRecord} from "../src/domain/paper-record";
import type {SearchRun,ReadEvidence} from "../src/domain/types";
import {validReadEvidence,compactManifestIndex} from "../src/domain/read-evidence";
import type {SourceReadResult} from "./discovery-materials-contract";
import {validHainaRecord,type HainaRecord} from "../src/domain/haina-record";
import type {RuntimeHainaMaterials} from "./runtime-turn-haina";

export type RuntimeMaterialReceipt=SourceReadResult&RuntimeHainaMaterials;
export type RuntimeMaterials={papers:PaperRecord[];searches:SearchRun[];paperEvidence:NonNullable<SourceReadResult["paperEvidence"]>}&RuntimeHainaMaterials;
/** Only explicitly bound, same-conversation task records authorize private history. */
export async function runtimeMaterialHistory(tasks:TaskStore,conversationId:string,parentIds:(string|undefined)[],options:{paperIds?:string[];includeSources?:boolean}={}):Promise<RuntimeMaterials>{
  const papers=new Map<string,PaperRecord>(),searches:SearchRun[]=[],paperEvidence:RuntimeMaterials["paperEvidence"]=[];
  const hainaRecords=new Map<number,HainaRecord>();let hainaCatalog:RuntimeHainaMaterials["hainaCatalog"];
  function consume(row:Record<string,any>,at:number){
    if(isWorkspaceDiscoveryArchiveResult(row.result))return;
    const result=row.result as ({paperRecords?:PaperRecord[];runTrace?:{searches?:SearchRun[]}}&RuntimeHainaMaterials)|undefined;
    const material=row.researchMaterials as Partial<RuntimeMaterialReceipt>|undefined;
    for(const record of [...(material?.papers||[]),...(result?.paperRecords||[])]){
      if(validPaperRecord(record)&&!record.catalogSummary&&!papers.has(record.id))papers.set(record.id,record);
    }
    const trace=result?.runTrace??(row.runTrace as {searches?:SearchRun[]}|undefined);
    for(const run of material?.searches||trace?.searches||[]){
      if(!run||typeof run.engine!=="string"||!Array.isArray(run.hits))continue;
      searches.push({...run,cacheStoredAt:run.cacheStoredAt||new Date(at).toISOString(),hits:run.hits.map(hit=>({...hit,previousRead:true}))});
    }
    for(const item of material?.paperEvidence||[]){
      if(paperId(item.id)&&typeof item.readAt==="string"&&item.evidence)paperEvidence.push(item);
    }
    for(const record of material?.hainaRecords||result?.hainaRecords||[])if(validHainaRecord(record)&&!hainaRecords.has(record.id))hainaRecords.set(record.id,record);
    hainaCatalog??=result?.hainaCatalog||material?.hainaCatalog;
  }
  for(const id of new Set(parentIds)){
    if(!id||!taskIdPattern.test(id))continue;
    const parent=await tasks.get(id);
    if(!parent||JSON.parse(parent.body).conversationId!==conversationId)continue;
    if(await tasks.workspaceDiscoveryArchive?.(id))continue;
    const terminal=await tasks.terminal(id);
    if(isWorkspaceDiscoveryArchiveResult(terminal?.result))continue;
    if(terminal)consume(terminal,parent.updated);
    const missing=options.paperIds?.some(id=>!papers.has(id));
    if(options.includeSources===false&&options.paperIds!==undefined&&!missing)continue;
    if(tasks.materialEvents){
      for(const row of await tasks.materialEvents(id)){
        if(row.result&&terminal)continue;
        consume(row,typeof row.at==="number"?row.at:parent.updated);
      }
      continue;
    }
    // Explicit compatibility for older TaskStore adapters; production PostgreSQL
    // uses its targeted material query and never sends progress rows to Node.
    let after=0;
    for(;;){
      const rows=await tasks.events(id,after);
      for(const row of rows){if(row.result&&terminal)continue;consume(row,row.at);}
      if(rows.length<128)break;
      const next=rows.at(-1)?.seq;if(typeof next!=="number"||next<=after)throw Error("历史材料无法按序重开。");after=next;
    }
  }
  return {papers:[...papers.values()],searches,paperEvidence,...(hainaRecords.size?{hainaRecords:[...hainaRecords.values()]}:{}),...(hainaCatalog?{hainaCatalog}:{})};
}

/** Keep the original receipt time and bounded literal content; never create a new read. */
export function archivedReadEvidence(material:RuntimeMaterials):ReadEvidence[]{
  const records:ReadEvidence[]=[],seen=new Set<string>();
  for(const run of material.searches)for(const hit of run.hits){
    if(run.status!=="done"||!hit.pageExcerpt||!["abstract","page-excerpt","pdf-excerpt"].includes(hit.stage||"")||seen.has(hit.url))continue;
    const readAt=hit.readAt||run.startedAt||run.cacheStoredAt;
    if(!readAt)continue;
    const record:ReadEvidence={url:hit.url,title:hit.title.slice(0,360),excerpt:hit.pageExcerpt.slice(0,1600),readAt,
      stage:hit.stage as ReadEvidence["stage"],referenceType:hit.referenceType,excerptTruncated:hit.pageExcerpt.length>1600,
      sourceExcerptLength:hit.pageExcerpt.length,discoveredBy:hit.discoveredBy,readBy:hit.readBy||"platform",
      ...(hit.manifestIndex?{manifestIndex:compactManifestIndex(hit.manifestIndex)}:{})};
    if(validReadEvidence([...records,record])){records.push(record);seen.add(hit.url);}
    if(records.length===6)return records;
  }
  return records;
}
