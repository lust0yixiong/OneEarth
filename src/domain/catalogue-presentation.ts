import type {DiscoveryResponse} from "./types";

export type CatalogueFrameObservation = {
  runId:string;batchId:string;renderer:"cesium";datasetIds:string[];observedAt:number;
};
type CatalogueOwner = {runId:string;conversationId:string;turnId:string};
type CatalogueIdentity = {datasetId:string;version:string};
type CatalogueBatchIdentity = Omit<CatalogueOwner,"runId"> & {batchId:string;coverageRevision:string};
export type CataloguePresentationTarget = CatalogueOwner & CatalogueBatchIdentity & {items:CatalogueIdentity[]};
export type CataloguePresentationState = "rendered" | "failed" | "superseded";
export type CataloguePresentationItem = CatalogueIdentity & {state:CataloguePresentationState;observedAt:number};
export type CataloguePresentationWrite = CatalogueBatchIdentity & {items:CataloguePresentationItem[]};
export type CataloguePresentation = {runId:string} & CataloguePresentationWrite;

const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu;
const revision=/^[a-f0-9]{64}$/u;
const dataset=/^haina:[1-9][0-9]{0,15}$/u;
const validText=(v:unknown,pattern:RegExp):v is string=>typeof v==="string"&&pattern.test(v);
const validVersion=(v:unknown):v is string=>typeof v==="string"&&v.length<=240&&!!v.trim()&&!/[\u0000-\u001f\u007f]/u.test(v);
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==="object"&&!Array.isArray(v);
const states=new Set<CataloguePresentationState>(["rendered","failed","superseded"]);
const writeFields=["conversationId","turnId","batchId","coverageRevision","items"];
const itemFields=["datasetId","version","state","observedAt"];

/** The native operation selects only the authoritative result built for this turn. */
export function boundCatalogueMapBatch(response:DiscoveryResponse,owner:CatalogueOwner){
  const batch=response.resultBatch,coverage=response.gridCoverage,operation=response.workspaceOperation;
  if(operation?.kind!=="present-catalogue"||!batch||batch.batchId!==operation.batchId||
    !validText(batch.batchId,uuid)||batch.taskId!==owner.runId||batch.conversationId!==owner.conversationId||
    batch.turnId!==owner.turnId||batch.kind!=="catalogue"||!(batch.status==="complete"||batch.status==="partial")||
    coverage?.status!=="ready"||!coverage.summary?.selection||!validText(coverage.revision,revision)||
    coverage.summary.selection.id!==coverage.cellId||coverage.summary.selection.grid.key!==coverage.gridKey||
    !Array.isArray(batch.conditions)||!batch.conditions.includes("权威覆盖修订："+coverage.revision)||
    !Array.isArray(batch.channels)||!batch.channels.some(channel=>channel.source==="authoritative-grid-catalogue"&&
      (channel.status==="done"||channel.status==="partial"))||
    !Array.isArray(batch.itemIds)||!batch.itemIds.length||!Array.isArray(coverage.sourceIds))return;
  const covered=new Set(coverage.sourceIds);
  if(batch.itemIds.every(id=>covered.has(id)))return batch;
}

export function readCataloguePresentationWrite(value:unknown):CataloguePresentationWrite|undefined{
  if(!object(value)||Object.keys(value).some(key=>!writeFields.includes(key)))return;
  const {conversationId,turnId,batchId,coverageRevision,items}=value;
  if(!validText(conversationId,uuid)||!validText(turnId,uuid)||!validText(batchId,uuid)||!validText(coverageRevision,revision)||
    !Array.isArray(items)||items.length<1||items.length>20)return;
  const seen=new Set<string>(),facts:CataloguePresentationItem[]=[];
  for(const item of items){
    if(!object(item)||Object.keys(item).some(key=>!itemFields.includes(key)))return;
    const {datasetId,version,state,observedAt}=item;
    if(!validText(datasetId,dataset)||!validVersion(version)||!states.has(state as CataloguePresentationState)||
      typeof observedAt!=="number"||!Number.isSafeInteger(observedAt)||observedAt<=0||seen.has(datasetId))return;
    seen.add(datasetId);
    facts.push({datasetId,version,state:state as CataloguePresentationState,observedAt});
  }
  return {conversationId,turnId,batchId,coverageRevision,items:facts};
}

/** The persisted original ready coverage, catalogue batch and exact versioned
 * records together authorize a presentation receipt for that run. */
export function cataloguePresentationTarget(response:DiscoveryResponse|undefined,owner:CatalogueOwner):CataloguePresentationTarget|undefined{
  const batch=response?.resultBatch,coverage=response?.gridCoverage,records=response?.hainaRecords;
  if(!batch||batch.kind!=="catalogue"||!(batch.status==="complete"||batch.status==="partial")||
    batch.taskId!==owner.runId||batch.conversationId!==owner.conversationId||batch.turnId!==owner.turnId||!validText(batch.batchId,uuid)||
    coverage?.status!=="ready"||!coverage.summary||!validText(coverage.revision,revision)||
    !Array.isArray(batch.itemIds)||!Array.isArray(coverage.sourceIds)||!Array.isArray(records))return;
  const covered=new Set(coverage.sourceIds);
  const items=[...new Set(batch.itemIds)].flatMap(datasetId=>{
    if(!validText(datasetId,dataset)||!covered.has(datasetId))return [];
    const matches=records.filter(record=>record&&"haina:"+record.id===datasetId);
    const version=matches[0]?.version;
    return validVersion(version)&&matches.every(record=>record.version===version)?[{datasetId,version}]:[];
  }).slice(0,20);
  if(items.length)return {...owner,batchId:batch.batchId,coverageRevision:coverage.revision,items};
}

export function readCataloguePresentation(value:unknown,target:CataloguePresentationTarget):CataloguePresentation|undefined{
  if(!object(value)||value.runId!==target.runId)return;
  const {runId:_run,...payload}=value;
  const receipt=readCataloguePresentationWrite(payload);
  if(!receipt||receipt.batchId!==target.batchId||receipt.conversationId!==target.conversationId||
    receipt.turnId!==target.turnId||receipt.coverageRevision!==target.coverageRevision||
    !receipt.items.every(item=>target.items.some(allowed=>allowed.datasetId===item.datasetId&&allowed.version===item.version)))return;
  return {runId:target.runId,...receipt};
}

export function mergeCataloguePresentation(previous:CataloguePresentation|undefined,incoming:CataloguePresentation|undefined){
  if(!previous||!incoming)return previous??incoming;
  if(previous.runId!==incoming.runId||previous.conversationId!==incoming.conversationId||
    previous.turnId!==incoming.turnId||previous.batchId!==incoming.batchId||previous.coverageRevision!==incoming.coverageRevision)return previous;
  const previousIds=new Set(previous.items.map(item=>item.datasetId));
  const added=incoming.items.filter(item=>!previousIds.has(item.datasetId));
  return added.length?{...previous,items:[...previous.items,...added]}:previous;
}
