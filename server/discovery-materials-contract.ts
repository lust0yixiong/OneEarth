import type { PaperDatasetEvidence, PaperRecord } from "../src/domain/paper-record";
import type { HainaCatalog, HainaRecord } from "../src/domain/haina-record";
import type { SearchRun } from "../src/domain/types";
import type { SceneLookup } from "../src/domain/earth-search";
import type { UtcWindow } from "../src/domain/time-window";

export const paperQueryKind = "oneearth.paper.query.v1";
export const paperResultKind = "oneearth.paper.result.v1";
export const sourceReadKind = "oneearth.source.read.v1";
export const hainaCatalogQueryKind = "oneearth.haina.catalog.query.v1";
export const hainaCatalogResultKind = "oneearth.haina.catalog.result.v1";
export const sceneCatalogQueryKind = "oneearth.scene.catalog.query.v1";
export const sceneCatalogResultKind = "oneearth.scene.catalog.result.v1";

export const sceneCatalogAssets = ["earth-search:landsat-c2-l2", "earth-search:sentinel-2-l2a"] as const;
export type SceneCatalogAsset = typeof sceneCatalogAssets[number];
export interface SceneCatalogQuery {
  assetIds: SceneCatalogAsset[];
  point: [number, number];
  years: [number, number];
  utcWindow?: UtcWindow;
}
export interface SceneCatalogResult {
  lookups: SceneLookup[];
  failures: { assetId: SceneCatalogAsset; url: string }[];
}

export type HainaCatalogPage = Omit<HainaCatalog, "records"> & {
  records: HainaRecord[];
  complete: true;
  nextCursor: number | null;
  warning: string;
  refreshing: boolean;
};

type PaperQuestion = NonNullable<PaperRecord["researchQuestions"]>[number];
export interface PaperQueryOutput {
  records: PaperRecord[];
  list: {
    records: PaperRecord[];
    nextCursor: string | null;
    total: number;
    catalog: {
      complete: boolean;
      source: string;
      sourceTotal: number | null;
      filteredOut: number;
      updatedAt: string | null;
      revision?: string;
    };
    cached: boolean;
  };
  questions: { items: PaperQuestion[]; nextCursor: string | null };
  evidence: PaperDatasetEvidence;
  search: { records: PaperRecord[]; cached: boolean; incomplete?: string[] };
}

export type PaperQuery =
  | { operation: "records"; ids: string[] }
  | { operation: "list"; view: "full" | "catalog" | "map"; cursor: string; limit: number }
  | { operation: "questions"; id: string; cursor: string }
  | { operation: "evidence"; id: string }
  | { operation: "search"; query: string };

export type SourceReadTarget =
  | { kind: "web"; url: string; title: string; discoveredBy?: "user" | "assistant" }
  | { kind: "paper"; id: string };

export interface SourceReadInput {
  runtimeWebToolGrant?:string;
  question: string;
  targets: SourceReadTarget[];
  deepseekFetch?: boolean;
}

export interface SourceReadResult {
  searches: SearchRun[];
  papers: PaperRecord[];
  issues: string[];
  paperEvidence?: { id: string; evidence: PaperDatasetEvidence; readAt: string }[];
}
