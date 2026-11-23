import {catalogBatch} from "./batch-context";
import {caseById} from "./catalog";
import {assetById, assetIdentity} from "./datasets";
import {datasetLayers, globeCases} from "./regional-cases";
import {createResearchList, listKey, parseResearchList, persistResearchList, type SavedEvidence} from "./research-list";
import {makeCandidates} from "./results";
import type {State} from "./store";
import type {CandidateSet, Citation} from "./types";
import type {WorkspaceCandidateItem, WorkspaceOperationKind} from "./workspace-operations";

export function chatCandidateBatch(s:State):CandidateSet|null {
  const inspector=s.inspector;
  const inspected=inspector && ("batch" in inspector ? inspector.batch
    : "comparedBatch" in inspector ? inspector.comparedBatch
    : "parent" in inspector ? inspector.parent : null);
  if (inspected) return inspected;
  if (s.view==="discover")
    return catalogBatch(s.search,s.search.pageIds ?? s.search.result?.ids ?? [],s.camera,s.gridSystem);
  if (s.view!=="earth") return null;
  if (s.mapResult) return s.mapResult;
  if (s.fieldLayer) {
    const id=s.fieldLayer.id;
    return {title:globeCases[id].dataset,caseId:null,ids:[datasetLayers[id]],filters:s.filters,
      selection:s.selection,layer:s.layer,camera:s.camera,gridSystem:s.gridSystem};
  }
  return s.caseId ? makeCandidates({title:caseById(s.caseId)?.title || "当前资料",caseId:s.caseId,
    filters:s.filters,selection:s.selection,layer:s.layer,gridSystem:s.gridSystem,camera:s.camera}) : null;
}

export function chatCandidateItems(s:State,batch:CandidateSet|null,labels:WorkspaceCandidateItem[]=[]):WorkspaceCandidateItem[] {
  if (!batch || s.view==="cases" || (s.view==="earth" && !s.mapResult && !s.inspector)) return [];
  const known=new Map(labels.map(item=>[item.id,item.label]));
  const items:WorkspaceCandidateItem[]=[];
  for (const id of batch.ids.slice(0,16)) {
    const label=(known.get(id) || assetById.get(id)?.title || "").replace(/[\u0000-\u001f\u007f]/g," ").trim().slice(0,200);
    // Stop at an unresolved row so a later row keeps its original ordinal.
    if (!label || !/^[a-z0-9][a-z0-9:_.-]{0,159}$/i.test(id) || items.some(item=>item.id===id)) break;
    items.push({id,label});
  }
  return items;
}

export function chatCandidateKey(batch:CandidateSet|null) {
  return batch ? JSON.stringify([batch.ids,batch.caseId,batch.filters,batch.selection,batch.layer,
    batch.gridSystem,batch.sceneKey,batch.lookups]) : undefined;
}

type SaveTarget = {batch:CandidateSet;reference?:SavedEvidence;label:string};
export type ChatOperationTarget = {key:string;save?:SaveTarget};

function currentMaterial(s:State, batch:CandidateSet|null, citation:Citation|null):SaveTarget|undefined {
  const doc=s.evidence || citation?.excerpt;
  const inspector=s.inspector && "assetId" in s.inspector ? s.inspector : null;
  const locator=doc?.assetId || doc?.locator?.documentId || doc?.id;
  const id=doc ? (assetById.has(locator || "") ? locator : locator?.split("-excerpt-")[0].replace(/-source$|\/\d+$/g,""))
    : inspector?.assetId;
  const asset=id ? assetById.get(id) : undefined;
  if (!asset || (doc?.version!==undefined && doc.version!==(asset.version ?? null))) return;
  const original=doc?.sourceBatch;
  if (doc && (doc.locator || doc.id.includes("-excerpt-")) && !original?.ids.includes(asset.id)) return;
  const item=inspector?.assetId===asset.id ? inspector : null;
  const parent=original || item?.parent || (batch?.ids.includes(asset.id) ? batch : null);
  const selection=original ? original.selection : item ? item.selection : parent ? parent.selection : s.selection;
  return {
    label:"当前资料",
    batch:{...parent,ids:[asset.id],title:parent?.title || asset.title,
      caseId:parent ? parent.caseId : caseById(asset.caseId)?.id || null,
      filters:original?.filters || item?.filters || parent?.filters || s.filters,selection,
      layer:parent?.layer || s.layer,camera:parent?.camera || s.camera,
      gridSystem:selection?.grid.system || parent?.gridSystem || s.gridSystem},
    ...(doc?.locator ? {reference:{assetId:asset.id,title:doc.title,locator:doc.locator,url:doc.url}} : {}),
  };
}

export function availableChatOperations(s:State, batch:CandidateSet|null, citation=s.citation) {
  const operations=new Map<WorkspaceOperationKind,ChatOperationTarget>();
  operations.set("open-saved",{key:"open-saved"});
  operations.set("open-research-lists",{key:"open-research-lists"});
  if (s.origin) operations.set("return-to-results",{key:JSON.stringify(s.origin)});
  const addSave=(kind:WorkspaceOperationKind,save:SaveTarget)=>{
    const {batch,reference}=save;
    if (!batch.ids.length || batch.selection?.simulated) return;
    const assets=batch.ids.map(id=>assetById.get(id));
    if (assets.some(asset=>!asset)) return;
    const key=JSON.stringify([batch,assets.map(asset=>assetIdentity(asset!)),reference]);
    operations.set(kind,{key,save});
  };
  const current=currentMaterial(s,batch,citation);
  if (current) addSave("save-current",current);
  if (batch) addSave("save-batch",{batch,label:"当前批次"});
  if (batch && s.view==="discover") addSave("save-checked",{label:"勾选资料",
    batch:{...batch,ids:s.search.compare.filter(id=>batch.ids.includes(id))}});
  return operations;
}

export function saveChatResearchList(id:string,target:SaveTarget,storage:Storage) {
  const existing=storage.getItem(listKey(id));
  const list=existing ? parseResearchList(existing) : {...createResearchList(target.batch,target.reference),id};
  if (list.id!==id || JSON.stringify(list.batch.ids)!==JSON.stringify(target.batch.ids))
    throw Error("同一消息已有不同的保存记录，请保留原清单。");
  if (!existing) persistResearchList(list,storage);
  return "已保存 " + list.items.length + " 项资料（" + target.label + "）：" +
    list.items.map(item=>item.title).join("、") + "。可在数据触达的「研究清单」中导出或恢复。";
}
