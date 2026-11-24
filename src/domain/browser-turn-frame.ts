import type {State} from "./store";
import type {CandidateSet,Message} from "./types";
import type {BrowserTurnFrame,ResultBatch,TurnRelation} from "./turn-context";
import type {WorkspaceSurfaceReading} from "./workspace-view-projection";
import type {GlobeDatasetLayer} from "./globe-dataset-layers";
import {researchRecordId} from "./runtime-client";
import {assetById} from "./datasets";

const safeId = (value:string) => /^[a-z0-9][a-z0-9:_.-]{0,159}$/i.test(value);
const text = (value:string,max:number) =>
  value.replace(/https?:\/\/\S+/gi,"").replace(/[\u0000-\u001f\u007f]/g," ").trim().slice(0,max);

export function previousChatAnswer(messages:Message[]) {
  // Concurrent completions may arrive out of submission order.
  const order=new Map(messages.flatMap((m,index)=>m.role==="user" ? [[m.id,index]] : []));
  return messages.reduce<Message|undefined>((best,m)=>{
    if(m.role!=="assistant" || m.failed || !researchRecordId.test(m.id) ||
      (!m.chatMessage && !m.answerNotes && !m.questionCheck && !m.discoveryClarification))return best;
    return !best || (order.get(m.replyTo ?? "") ?? -1)>=(order.get(best.replyTo ?? "") ?? -1) ? m : best;
  },undefined);
}

export function validResultBatchReference(value:unknown):value is ResultBatch {
  if(!value || typeof value!=="object" || Array.isArray(value))return false;
  const batch=value as ResultBatch;
  return Object.keys(batch).every(key=>["batchId","conversationId","turnId","taskId","kind","status","query","conditions","channels","itemIds"].includes(key)) &&
    [batch.batchId,batch.conversationId,batch.turnId,batch.taskId].every(id=>typeof id==="string" && researchRecordId.test(id)) &&
    ["research","catalogue"].includes(batch.kind) && ["complete","partial","failed"].includes(batch.status) &&
    typeof batch.query==="string" && (batch.conditions===undefined || Array.isArray(batch.conditions) && batch.conditions.every(v=>typeof v==="string")) &&
    Array.isArray(batch.itemIds) && batch.itemIds.length<=512 && new Set(batch.itemIds).size===batch.itemIds.length &&
    batch.itemIds.every(item=>typeof item==="string" && item.length>0 && item.length<=2300) &&
    Array.isArray(batch.channels) && batch.channels.length<=12 && batch.channels.every(channel=>channel && typeof channel==="object" &&
      Object.keys(channel).every(key=>["source","status","count"].includes(key)) && typeof channel.source==="string" &&
      ["done","partial","failed","not_requested","unavailable"].includes(channel.status) &&
      (channel.count===undefined || Number.isSafeInteger(channel.count) && channel.count>=0));
}

export function boundResultBatch(batch:ResultBatch|undefined,taskId:string,turnId:string,conversationId:string) {
  return validResultBatchReference(batch) && batch.taskId===taskId && batch.turnId===turnId &&
    batch.conversationId===conversationId ? batch : undefined;
}

/** The same batch may also contain web evidence, which belongs in source cards. */
export function resultBatchCandidates(batch:ResultBatch, preferred:readonly string[] = []) {
  const members=batch.itemIds.filter(id=>safeId(id) && assetById.has(id));
  const visible=[...new Set(preferred)].filter(id=>members.includes(id));
  return visible.length ? visible : members;
}

function layerSelection(layer:GlobeDatasetLayer) {
  switch(layer.kind){
    case "public": return [layer.selection.view,layer.selection.month,layer.selection.point];
    case "field": return [layer.selection.date,layer.selection.year,layer.selection.city,layer.selection.frame];
    case "wind": return [layer.selection.level,"F"+layer.selection.forecastHour,layer.selection.playing?"播放":"暂停",
      layer.selection.color?"着色":"无着色"];
    case "data": return layer.selection.kind==="ctd"
      ? [layer.selection.stationId,layer.selection.variable,layer.selection.depth]
      : [layer.selection.glacier,layer.selection.epoch];
  }
}

export function readBrowserBatch(s:State,reading?:WorkspaceSurfaceReading) {
  const item=s.inspector;
  const inspected=item && ("batch" in item ? item.batch : "comparison" in item ? item.comparedBatch : null);
  if(inspected && reading?.panels?.inspector==="expanded")return {batch:inspected,expanded:true};
  if(reading?.candidateBatch && reading.candidateListExpanded)return {batch:reading.candidateBatch,expanded:true};
  const batch=inspected || (item && "assetId" in item ? item.parent : null) ||
    (s.view==="earth" ? s.mapResult : s.view==="discover" ? s.search.result : null);
  return {batch:batch || null,expanded:false};
}

export function browserTurnFrame(
  s:State, reading:WorkspaceSurfaceReading|undefined, batch:CandidateSet|null, expanded:boolean, localBatchId:string|undefined,
):BrowserTurnFrame {
  const capturedAt=Date.now(),panels:NonNullable<BrowserTurnFrame["panels"]>=[];
  if(s.chatOpen)panels.push("chat");
  if(reading?.panels?.inspector)panels.push("inspector");
  if(reading?.panels?.evidence)panels.push("evidence");
  if(reading?.panels?.researchLists)panels.push("research-lists");
  if(reading?.panels?.layerMenu)panels.push("layer-menu");
  const layers=s.globeLayers.filter(layer=>safeId(layer.id)).slice(0,16).map(layer=>{
    const selection=text(layerSelection(layer).filter(v=>v!==undefined).join(" · "),160);
    const actual=layer.visible && reading?.rasterPresentations?.find(item=>item.datasetId===layer.id);
    const presentation=actual ? {valueId:actual.valueId,publicationRevision:actual.publicationRevision,
      state:actual.state,observedAt:actual.observedAt} : undefined;
    return {id:layer.id,label:text(layer.label,200)||layer.id,visible:layer.visible,
      ...(selection?{selection}:{}),...(presentation?{presentation}:{})};
  });
  const origin=batch?.resultBatch?.kind ?? (batch?.originKind==="catalog" ? "catalogue" :
    batch?.originKind==="research"||batch?.researchRecord ? "research" : "workspace");
  const answerId=batch?.resultBatch?.taskId ?? batch?.answerId ?? batch?.researchRecord?.messageId;
  return {version:1,capturedAt,panels,
    ...(s.view==="earth" ? {globe:{layers,focusId:layers.some(layer=>layer.id===s.globeLayerFocus && layer.visible)
      ? s.globeLayerFocus : null}} : {}),
    ...(batch ? {batch:{...(batch.resultBatch ? {batchId:batch.resultBatch.batchId} : localBatchId ? {localBatchId} : {}),
      ...(answerId && researchRecordId.test(answerId)?{answerId}:{}),title:text(batch.title,240)||"当前资料",
      origin,expanded,visibleIds:expanded?[...new Set(batch.ids.filter(safeId))].slice(0,32):[]}} : {})};
}

export function browserTurnRelations(
  s:State, batch:CandidateSet|null, parentId:string|undefined, inFlight:Iterable<{id:string;userMessageId:string}>,
) {
  const related:TurnRelation[]=[];
  const append=(taskId:string|undefined,relation:TurnRelation["relation"],turnId?:string)=>{
    if(!taskId || !researchRecordId.test(taskId) || related.length>=8 ||
      related.some(entry=>entry.taskId===taskId && entry.relation===relation))return;
    const actualTurn=turnId ?? s.messages.find(m=>m.id===taskId && m.role==="assistant")?.replyTo;
    related.push({taskId,relation,...(actualTurn && researchRecordId.test(actualTurn)?{turnId:actualTurn}:{})});
  };
  const previous=previousChatAnswer(s.messages);
  append(parentId ?? previous?.id,"reply");
  // Transport and terminal failures retain the original task identity. The
  // server checks the actual outcome instead of trusting the browser label.
  const turns=new Map(s.messages.flatMap((m,index)=>m.role==="user"?[[m.id,index]]:[]));
  const completed=new Set(s.messages.flatMap(m=>m.role==="assistant"&&!m.failed&&m.replyTo?[m.replyTo]:[]));
  const lastSuccess=turns.get(previous?.replyTo??"")??-1;
  let latestFailure:Message|undefined,failedTurn=lastSuccess;
  for(const m of s.messages){
    if(m.role!=="assistant"||!m.failed||!m.replyTo||!researchRecordId.test(m.id)||completed.has(m.replyTo))continue;
    const submitted=turns.get(m.replyTo);
    if(submitted===undefined||submitted<=lastSuccess)continue;
    if(submitted>failedTurn||submitted===failedTurn&&!latestFailure?.runTrace&&!!m.runTrace){
      latestFailure=m;failedTurn=submitted;
    }
  }
  append(latestFailure?.id,"recent-outcome",latestFailure?.replyTo);
  for(const attachment of s.draftScope ?? [])
    if(attachment.kind==="reference")append(attachment.messageId,"reference");
  const citation=s.citation?.excerpt?.sourceBatch;
  const sourceTask=(candidate:CandidateSet|null|undefined)=>
    candidate?.resultBatch?.conversationId===s.sessionId ? candidate.resultBatch.taskId
    : candidate?.researchRecord?.sessionId===s.sessionId ? candidate.researchRecord.messageId
    : s.messages.some(m=>m.role==="assistant" && m.id===candidate?.answerId) ? candidate?.answerId : undefined;
  append(sourceTask(citation),"reference");
  append(sourceTask(batch),"visible-batch");
  const controls=s.messages.filter(m=>m.role==="assistant" && m.workspaceReceipt && m.workspaceEffect).slice(-2).reverse();
  for(const item of controls)append(item.id,"workspace-action",item.replyTo);
  for(const active of inFlight)append(active.id,"in-flight",active.userMessageId);
  return related;
}

export function browserPanelKey(reading:WorkspaceSurfaceReading|undefined) {
  return JSON.stringify([reading?.panels,reading?.candidateListExpanded,
    reading?.candidateListExpanded ? reading.candidateBatch?.ids : undefined]);
}
