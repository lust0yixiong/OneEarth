import {literatureDisplay} from "./literature-label";
import {validResearchPath,validAssertionEvidenceLinks,type ResearchPath,type AssertionEvidenceLinks} from "./assertion-relations";
import type { CaseStudy, Coordinate, Need, SpatialModel } from "./types";

export interface PaperRecord {
  /** Catalogue transport omits reading tabs; fetch the exact id before opening details. */
  catalogSummary?: true;
  id: string;
  dsKey: string;
  papers: number;
  paperTitle: string;
  studyContext: string;
  points: Coordinate[];
  need: Need;
  researchQuestions?:{paperId:string;rqId:string;datasetId:string;paperTitle:string;question:string}[];
  researchPaths?:ResearchPath[];
  evidenceLinks?:AssertionEvidenceLinks[];
  questionSource?:"postgres-readonly";
}

export const paperRecords = new Map<string, PaperRecord>();
/** Preserve searchable identities, questions, methods and spatial/time constraints.
 * Reading tabs are fetched by the unchanged historical content id on demand. */
export function paperCatalogSummary(record:PaperRecord):PaperRecord {
  return {...record,catalogSummary:true,need:{...record.need,
    tabs:record.need.tabs.filter(t=>t.kind==="table" && t.label==="论文用法（本页）")}};
}
/** Map index only. Scientific reading and search use the full server records.
 * Keep exact identities and all spatial/time constraints; hydrate before reading. */
export function paperMapSummary(record:PaperRecord):PaperRecord {
  const usage=record.need.tabs.find(t=>t.kind==="table" && t.label==="论文用法（本页）");
  const row=usage?.rows?.find(r=>typeof r[4]==="string" && !!r[4].trim() && typeof r[5]==="string" && !!r[5].trim());
  const {researchQuestions:_,researchPaths:__,evidenceLinks:___,...index}=record;
  return {...index,catalogSummary:true,studyContext:"",need:{...record.need,
    detail:record.need.detail,
    tabs:usage&&row?[{kind:"table",label:usage.label,rows:[[row[0],"","","",row[4],row[5],...(row.length>6?[row[6]]:[])]]}]:[]}};
}
export const paperId = (id: string) => /^earthnano:[a-f0-9]{64}$/.test(id);
export function validPaperRecord(value: unknown): value is PaperRecord {
  const r = value as Partial<PaperRecord> | null;
  return !!r && typeof r.id === "string" && paperId(r.id) &&
    typeof r.dsKey === "string" && !!r.dsKey.trim() && Number.isInteger(r.papers) && r.papers! > 0 &&
    typeof r.need?.product === "string" && ["文献资料", "EarthNano 论文断言库"].includes(r.need.source) &&
    (r.researchQuestions===undefined || (Array.isArray(r.researchQuestions) && r.researchQuestions.every(q=>q && [q.paperId,q.rqId,q.datasetId,q.paperTitle,q.question].every(v=>typeof v==="string")))) &&
    (r.researchPaths===undefined || (Array.isArray(r.researchPaths) && r.researchPaths.every(validResearchPath))) &&
    (r.evidenceLinks===undefined || (Array.isArray(r.evidenceLinks) && r.evidenceLinks.every(validAssertionEvidenceLinks))) &&
    !!r.need.profile && typeof r.need.profile.coverage === "string" && ["data","index"].includes(r.need.profile.role) &&
    Array.isArray(r.points) && r.points.every(p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite) && Math.abs(p[0])<=180 && Math.abs(p[1])<=90) &&
    Array.isArray(r.need.tabs) && r.need.tabs.some(t => t.kind === "table" && t.label === "论文用法（本页）" &&
      t.rows?.some(row => typeof row[4] === "string" && !!row[4].trim() && typeof row[5] === "string" && !!row[5].trim()));
}
export const asksForPapers = (q: string) => /断言库|EarthNano|论文|文献/i.test(q);

export function paperGroup(record: PaperRecord): CaseStudy {
  return {
    id: record.id, title: record.need.product, paper: record.paperTitle,
    question: "", region: record.need.profile!.coverage, needs: [literatureDisplay(record.need)],
    gap: "", verified: false, spatial: "metadata", clues: [],
  };
}

const models=new WeakMap<PaperRecord,SpatialModel>();
export function paperModel(record: PaperRecord): SpatialModel {
  const cached=models.get(record);if(cached)return cached;
  const area = record.need.profile?.area;
  const model:SpatialModel={
    caption: "文献资料 · 数据集官方元数据",
    entries: record.points.map(center => ({
      center, need: 0, label: record.need.product, origin: "数据集官方元数据坐标",
    })),
    ...(area ? { area, areaNeed: 0, areaTitle: "数据集官方元数据边界框" } : {}),
  };
  models.set(record,model);return model;
}

export interface PaperDatasetEvidence {
  dataset: {
    title:string; description:string|null; publisher:string|null; version:string|null;
    spatialResolution:string|null; temporalResolution:string|null; resourceType:string|null;
  } | null;
  papers: {
    paperId:string; datasetId:string; title:string; abstract:string|null;
    usage:string|null; variables:string|null; context:string|null;
    methods?:{stepId:string;name:string;purpose:string|null;method:string|null;order:number}[];
    quotes:{blockId:string;section:string;quote:string;claims:string[]}[];
  }[];
}
