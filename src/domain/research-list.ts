import {inventoryId,sample} from "./earth-search";
import { randomId } from "./id";
import {checkedScenes} from "./product-distribution";
import { sceneDocument } from "./earth-search";
import { caseById, catalogGroupById } from "./catalog";
import { assetById, assetIdentity } from "./datasets";
import { datasetLineage } from "./lineage";
import { evaluateBatch } from "./research-assessment";
import { originLabel, scopeTerms } from "./batch-context";
import { cellAt } from "./spatial";
import { validContext } from "./context-validation";
import type { CandidateSet, EvidenceLocator } from "./types";
import {validResearchIntent,type ResearchIntent} from "./research-intent";

export interface ResearchRecord {
  question: string;
  intent?: ResearchIntent;
  sessionId: string;
  messageId: string;
  notes: {id:string;note:string}[];
}

export function validResearchRecord(v:unknown): v is ResearchRecord {
  if(!v || typeof v!=="object")return false;
  const r=v as ResearchRecord;
  return typeof r.question==="string" && r.question.length<=8000 &&
    typeof r.sessionId==="string" && r.sessionId.length<=160 &&
    typeof r.messageId==="string" && r.messageId.length<=160 &&
    (r.intent===undefined || validResearchIntent(r.intent)) &&
    Array.isArray(r.notes) && r.notes.length<=100 && r.notes.every(n=>n &&
      typeof n.id==="string" && n.id.length<=500 && typeof n.note==="string" && n.note.length<=2400);
}

const prefix = "oneearth.research-list.v1.";
export interface SavedEvidence {
  assetId: string;
  title: string;
  url?: string;
  locator: EvidenceLocator;
}
export function createResearchList(batch: CandidateSet, reference?: SavedEvidence) {
  if (!batch.ids.length || batch.selection?.simulated)
    throw Error("当前范围没有可保存的真实候选。");
  const items = batch.ids.map((id) => {
    const a = assetById.get(id);
    if (!a) throw Error("当前目录缺少清单中的资料，请重新选择。");
    const lineage = datasetLineage(a);
    if(id===inventoryId && (batch.filters.period||batch.sceneKey||batch.selection)) {
      const scoped=checkedScenes(batch).filter(r=>r.asset.id===id);
      for(const record of lineage.records){
        record.materials=scoped.map(r=>({label:r.id+" · "+r.date,url:r.url}));
        record.actualPeriod=scoped.map(r=>r.date).join("、");
      }
    }
    const lookup = batch.lookups?.find(l => l.assetId === id);
    if (lookup) lineage.records.push({
      assetId: id, caseId: a.caseId, study: "STAC 实时检索", source: a.source, url: lookup.url,
      relation: sceneDocument(lookup).scope, actualRegion: lookup.point.join(", "),
      actualPeriod: lookup.years.join("–"), materials: lookup.items.filter(i=>!batch.sceneKey || i.id===batch.sceneKey).map(i => ({label: i.id + " · " + i.datetime, url: i.url})),
    });
    return {
      id,
      datasetId: a.datasetId,
      identity: assetIdentity(a),
      version: lineage.version,
      ...(reference?.assetId === id ? {reference:structuredClone(reference)} : {}),
      title: a.title,
      role: catalogGroupById(a.caseId)!.needs[a.needIndex].name,
      source: a.source,
      url: a.url || "",
      status: a.status,
      access:
        a.profile?.access ||
        (a.url ? "通过发布方入口核对获取条件" : "获取入口待核"),
      coverage: a.profile?.coverage || a.description,
      limitation: a.profile?.limitation || a.why,
      records: lineage.records,
    };
  });
  return {
    format: "oneearth-research-list" as const,
    schemaVersion: 1 as const,
    id: randomId(),
    createdAt: new Date().toISOString(),
    question: batch.researchRecord?.question || batch.title,
    ...(batch.researchRecord ? {researchRecord:structuredClone(batch.researchRecord)} : {}),
    batch: structuredClone({ ...batch, ...(batch.lookups ? {lookups: batch.lookups.filter(l => batch.ids.includes(l.assetId))} : {}) }),
    items,
    assessment: evaluateBatch(batch),
  };
}
export type ResearchList = ReturnType<typeof createResearchList>;

const obj = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === "string";
const texts = (v: unknown): v is string[] => Array.isArray(v) && v.every(str);
const safeURL = (v: unknown) =>
  v == null || v === "" || (str(v) && (/^https?:\/\//i.test(v) || /^\/api\/constellations\/observations\/[a-f0-9]{64}(?:\/file)?$/.test(v)));
const textFields = (v: Record<string, unknown>, keys: string[]) =>
  keys.every((k) => str(v[k]));
const every = (v: unknown, check: (row: Record<string, unknown>) => boolean) =>
  Array.isArray(v) && v.every((row) => obj(row) && check(row));
function validLookups(value: unknown, ids: string[]) {
  const trusted = (url: unknown) => str(url) && url.startsWith("https://earth-search.aws.element84.com/v1/");
  return Array.isArray(value) && value.length <= 2 && every(value, l =>
    str(l.assetId) && ids.includes(l.assetId) && trusted(l.url) &&
    str(l.checkedAt) && Number.isFinite(Date.parse(l.checkedAt)) &&
    Array.isArray(l.point) && l.point.length === 2 && l.point.every(Number.isFinite) &&
    Math.abs(l.point[0]) <= 180 && Math.abs(l.point[1]) <= 90 &&
    Array.isArray(l.years) && l.years.length === 2 && l.years.every(Number.isInteger) && l.years[0] <= l.years[1] &&
    Number.isSafeInteger(l.matched) && Number(l.matched) >= 0 &&
    Array.isArray(l.items) && l.items.length === Math.min(5, Number(l.matched)) &&
    every(l.items, i => str(i.id) && str(i.datetime) && Number.isFinite(Date.parse(i.datetime)) &&
      trusted(i.url) && (i.cloud === null || Number.isFinite(i.cloud)))
  );
}
export function validBatch(v: unknown, allowEmpty = false): v is CandidateSet {
  if (
    !obj(v) ||
    (v.researchRecord !== undefined && !validResearchRecord(v.researchRecord)) ||
    (v.answerId!==undefined && (!str(v.answerId) || !v.answerId.length || v.answerId.length>160)) ||
    (v.sceneKey!==undefined && (typeof v.sceneKey!=="string" || v.sceneKey.length>500)) ||
    (v.metric!==undefined && v.metric!=="products" && v.metric!=="scenes") ||
    !obj(v.filters) ||
    !str(v.title) ||
    !(v.caseId === null || str(v.caseId)) ||
    !texts(v.ids) ||
    (!v.ids.length && !allowEmpty) ||
    (v.lookups !== undefined && !validLookups(v.lookups, v.ids)) ||
    new Set(v.ids).size !== v.ids.length ||
    !Number.isInteger(v.filters.need) ||
    Number(v.filters.need) < -1 ||
    (v.clusterOverlay !== undefined && typeof v.clusterOverlay !== "boolean") ||
    (v.catalogConditions !== undefined && !texts(v.catalogConditions)) ||
    (v.originKind !== undefined &&
      !["chat", "research", "grid", "catalog"].includes(String(v.originKind)))
  )
    return false;
  if (
    !validContext({
      ...v,
      caseId: null,
      filters: { ...v.filters, need: -1 },
      citation: null,
    })
  )
    return false;
  if (
    (v.caseId === null || caseById(v.caseId)) &&
    !validContext({ ...v, citation: null })
  )
    return false;
  const selection = v.selection;
  if (!selection) return true;
  if (!obj(selection) || selection.simulated || !obj(selection.grid))
    return false;
  const g = selection.grid;
  return (
    g.system === v.gridSystem &&
    g.key === (g.system === "h3" ? "h" : "s") + g.n &&
    cellAt(selection.point as [number, number], g) === selection.id
  );
}
function validAssessment(v: unknown) {
  if (!obj(v) || !textFields(v, ["summary", "status"])) return false;
  if (!Array.isArray(v.evidence)) return false;
  const refs = new Set(v.evidence.filter(obj).map((e) => e.id));
  const finding = (r: Record<string, unknown>) =>
    textFields(r, ["id", "title", "status", "detail"]) &&
    texts(r.evidenceIds) &&
    r.evidenceIds.every((id) => refs.has(id));
  return (
    every(v.findings, finding) &&
    every(
      v.roles,
      (r) => finding(r) && typeof r.required === "boolean" && texts(r.assetIds),
    ) &&
    every(
      v.evidence,
      (r) =>
        textFields(r, ["id", "title", "source", "detail"]) && safeURL(r.url),
    )
  );
}
function validReference(v: unknown, id: unknown) {
  if (v === undefined) return true;
  if (!obj(v) || v.assetId !== id || !str(v.title) || !safeURL(v.url) || !obj(v.locator)) return false;
  const loc = v.locator;
  const positions = (value: unknown) => Array.isArray(value) && value.length > 0 &&
    value.every(n => Number.isSafeInteger(n) && Number(n) > 0);
  return textFields(loc, ["documentId","documentTitle","material","source"]) &&
    (loc.version === null || str(loc.version)) && ["table","pdf","text","code","trace"].includes(String(loc.kind)) &&
    (loc.page === undefined || (Number.isSafeInteger(loc.page) && Number(loc.page) > 0)) &&
    (loc.rows === undefined || positions(loc.rows)) &&
    (loc.lines === undefined || (positions(loc.lines) && Array.isArray(loc.lines) && loc.lines.length === 2));
}
export function parseResearchList(raw: string): ResearchList {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw Error("文件不是有效的 JSON 研究清单。");
  }
  if (
    !obj(value) ||
    value.format !== "oneearth-research-list" ||
    value.schemaVersion !== 1
  )
    throw Error("无法识别研究清单格式或版本。");
  if (
    !str(value.id) ||
    !/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(value.id) ||
    !str(value.createdAt) ||
    !Number.isFinite(Date.parse(value.createdAt)) ||
    !str(value.question) ||
    (value.researchRecord !== undefined && !validResearchRecord(value.researchRecord)) ||
    !validBatch(value.batch) ||
    !validAssessment(value.assessment)
  )
    throw Error("研究清单的范围或判断记录不完整。");
  const batch = value.batch;
  const validRecord = (r: Record<string, unknown>) =>
    textFields(r, [
      "assetId",
      "caseId",
      "study",
      "source",
      "relation",
      "actualRegion",
      "actualPeriod",
    ]) &&
    safeURL(r.url) &&
    every(
      r.materials,
      (m) =>
        str(m.label) &&
        safeURL(m.sourceUrl) &&
        (safeURL(m.url) ||
          (str(m.url) &&
            /^\/evidence\/[\w./%-]+$/.test(m.url) &&
            !m.url.includes(".."))),
    );
  if (
    !every(
      value.items,
      (r) =>
        textFields(r, [
          "id",
          "title",
          "identity",
          "datasetId",
          "role",
          "source",
          "status",
          "access",
          "coverage",
          "limitation",
        ]) &&
        (r.version === null || str(r.version)) &&
        safeURL(r.url) &&
        validReference(r.reference, r.id) && every(r.records, validRecord),
    ) ||
    !Array.isArray(value.items) ||
    value.items.length !== batch.ids.length ||
    value.items.some((r, i) => r.id !== batch.ids[i])
  )
    throw Error("清单的候选顺序、版本或来源记录不完整。");
  return value as unknown as ResearchList;
}
export function unavailableItems(list: ResearchList) {
  return list.items.filter((item) => {
    const a = assetById.get(item.id);
    return (
      !a ||
      assetIdentity(a) !== item.identity ||
      (a.version ?? null) !== item.version ||
      a.datasetId !== item.datasetId
    );
  });
}
export function listKey(id: string) {
  return prefix + id;
}
export function readResearchLists(storage: Storage): ResearchList[] {
  const lists = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key?.startsWith(prefix)) continue;
    const raw = storage.getItem(key);
    if (raw) lists.push(parseResearchList(raw));
  }
  return lists.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export function persistResearchList(list: ResearchList, storage: Storage) {
  const key = listKey(list.id),
    raw = JSON.stringify(list);
  const existing = storage.getItem(key);
  if (existing && existing !== raw)
    throw Error("同一清单编号已有不同内容，请保留原文件并重新导出。");
  try {
    storage.setItem(key, raw);
  } catch {
    throw Error("浏览器未能保存清单。请检查本地存储空间或权限。");
  }
}

/** Saved batches remain portable. The library groups their products for browsing. */
export function researchProducts(lists:ResearchList[]) {
  const products=new Map<string,{key:string;item:ResearchList["items"][number];versions:(string|null)[];entries:{list:ResearchList;item:ResearchList["items"][number]}[]}>();
  for(const list of lists)for(const item of list.items){
    let key=item.datasetId;
    try{const identity=JSON.parse(item.identity);if(Array.isArray(identity) && typeof identity[0]==="string")key=identity[0];}catch{/* Legacy identities use the dataset ID. */}
    if(!products.has(key))products.set(key,{key,item,versions:[],entries:[]});
    const product=products.get(key)!;
    product.entries.push({list,item});
    if(!product.versions.includes(item.version))product.versions.push(item.version);
  }
  return [...products.values()];
}

export function researchNote(list:ResearchList,id:string) {
  const record=list.researchRecord;
  return record?.notes.find(n=>n.id===id)?.note ||
    [record?.intent?.purpose,record?.intent?.task].filter(Boolean).join("。") || list.question;
}

export function updateResearchNote(list:ResearchList,id:string,note:string,storage:Storage) {
  // Read the current value to retain edits made in another tab or product row.
  const current=parseResearchList(storage.getItem(listKey(list.id)) || JSON.stringify(list));
  if(!current.items.some(item=>item.id===id) || note.length>2400)throw Error("研究备注无效。");
  const record=current.researchRecord || {question:current.question,sessionId:"",messageId:"",notes:[]};
  const notes=record.notes.filter(n=>n.id!==id);
  const researchRecord={...record,notes:[...notes,{id,note:note.trim()}]};
  const updated={...current,researchRecord,batch:{...current.batch,researchRecord}};
  storage.setItem(listKey(list.id),JSON.stringify(updated));
}

function plain(s: string) {
  return s
    .replace(/[\r\n]+/g, " ")
    .replace(/[\\`*_<>\[\]#|]/g, (c) => "\\" + c)
    .trim();
}
export function listMarkdown(list: ResearchList) {
  const { assessment: a, batch } = list;
  const lines = [
    "# " + plain(batch.title),
    "",
    plain(list.question),
    "",
    "保存时间 " + list.createdAt,
    "",
    "资料范围 · " +
      originLabel(batch) +
      " · " +
      (scopeTerms(batch).map(plain).join(" · ") || "无附加筛选"),
    "",
    "## 联合使用判断",
    "",
    plain(a.status) + " · " + plain(a.summary),
    "",
    ...a.findings.map(
      (f) =>
        "- " +
        plain(f.title) +
        " · " +
        plain(f.status) +
        "。" +
        plain(f.detail) +
        "（" +
        f.evidenceIds.map(plain).join("、") +
        "）",
    ),
    "",
    "## 研究需求",
    "",
    ...a.roles.map(
      (r) =>
        "- " +
        plain(r.title) +
        " · " +
        plain(r.status) +
        "。" +
        plain(r.detail),
    ),
    "",
    "## 已选资料",
    "",
  ];
  for (const item of list.items) {
    lines.push(
      "### " + plain(item.title),
      "",
      plain(item.role) +
        " · " +
        plain(item.version || "版次待核") +
        " · " +
        plain(item.status),
      "",
      "- 获取方式 · " + plain(item.access),
      "- 覆盖 · " + plain(item.coverage),
      "- 使用限制 · " + plain(item.limitation),
      "- 来源 · " + plain(item.source) + (item.url ? " " + item.url : ""),
      "",
    );
    if(list.researchRecord){
      const intent=list.researchRecord.intent;
      lines.push("- 当时的问题 · "+plain(list.researchRecord.question),
        "- 关注区域 · "+plain(intent?.region || "未指定"),
        "- 研究时段 · "+plain(intent?.time || "未指定"),
        "- 研究备注 · "+plain(researchNote(list,item.id)),"");
    }
    if (item.reference)
      lines.push("- 引用原件 · " + plain(item.reference.title) + (item.reference.url ? " " + item.reference.url : ""), "");
    for (const record of item.records) {
      lines.push(
        "- " +
          plain(record.study) +
          " · " +
          plain(record.relation) +
          " · " +
          plain(record.actualRegion) +
          " · " +
          plain(record.actualPeriod) +
          (record.url ? " " + record.url : ""),
      );
      for (const m of record.materials) {
        const link =
          m.sourceUrl || (m.url?.startsWith("/evidence/") ? undefined : m.url);
        lines.push("  - " + plain(m.label) + (link ? " " + link : ""));
      }
    }
    lines.push("");
  }
  lines.push(
    "## 判断依据",
    "",
    ...a.evidence.map(
      (e) =>
        "- " +
        plain(e.id) +
        " · " +
        plain(e.title) +
        " · " +
        plain(e.source) +
        "。" +
        plain(e.detail) +
        (e.url ? " " + e.url : ""),
    ),
  );
  return lines.join("\n") + "\n";
}
