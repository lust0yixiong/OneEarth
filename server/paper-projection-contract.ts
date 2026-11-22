import type { Coordinate, SourceProfile } from "../src/domain/types";

export const paperProjectionQueryKind = "oneearth.paper.projection.query.v1";
export const paperProjectionResultKind = "oneearth.paper.projection.result.v1";
export const paperProjectionPageLimit = 250;

export type PaperMapProfile = Pick<SourceProfile,
  "area" | "areaBasis" | "coverage" | "extent" | "role" | "spatial" | "utcWindow" | "years">;

export interface PaperMapEntry {
  id: string;
  dsKey: string;
  title: string;
  type: string;
  source: string;
  points: Coordinate[];
  profile: PaperMapProfile;
  published: boolean;
}

export interface PaperProjectionHead {
  revision: string;
  generation: string;
  publishedCount: number;
  versionCount: number;
}

export type PaperProjectionQuery =
  | { operation: "head" }
  | { operation: "page"; generation: string; cursor: string; limit: number; baseGeneration?: string };

export type PaperProjectionResult =
  | (PaperProjectionHead & { operation: "head" })
  | (PaperProjectionHead & { operation: "page"; entries: PaperMapEntry[]; nextCursor: string | null; baseGeneration?: string });
