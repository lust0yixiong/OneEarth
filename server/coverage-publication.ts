import { createHash } from "node:crypto";
import { cases } from "../src/domain/catalog";
import { assets, replacePublishedPapers } from "../src/domain/datasets";
import { sample } from "../src/domain/earth-search";
import { paperId } from "../src/domain/paper-record";
import { getModel } from "../src/domain/spatial";
import { windManifest } from "../src/domain/wind";
import type { paperCache } from "./earthnano";

function digest(input: unknown) {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

export function coveragePublication(papers: Pick<ReturnType<typeof paperCache>, "list" | "dataVersion" | "publishedIds">) {
  // Bump the schema marker when changing what counts as coverage for the same inputs.
  const bundled = digest([
    "oneearth.coverage.v1",
    assets.filter(asset => !paperId(asset.id) && !asset.origins.includes("constellation"))
      .map(({ id, caseId, needIndex, datasetId, productId, version, kind, profile, origins, categories }) =>
      [id, caseId, needIndex, datasetId, productId, version, kind, profile, origins, categories]),
    cases.map(({ id }) => [id, getModel(id)]),
    sample.revision,
    windManifest.frames.map(frame => frame.validTime),
  ]);
  let lastDiskVersion: number | undefined;
  let lastYear: number | undefined;
  let headsIdentity: string | undefined;
  let paperIdentity = "";
  let revision = "";
  return () => {
    const diskVersion = papers.dataVersion();
    const year = new Date().getUTCFullYear();
    if (diskVersion !== lastDiskVersion) {
      const nextHeads = digest(papers.publishedIds());
      if (headsIdentity !== nextHeads) {
        const snapshot = papers.list();
        // The full list is a single committed read. Hash only the records actually published.
        const nextIdentity = digest(snapshot.map(record => [record.dsKey, record.id]));
        if (paperIdentity !== nextIdentity) {
          replacePublishedPapers(snapshot);
          paperIdentity = nextIdentity;
          revision = digest([bundled, year, paperIdentity]);
        }
        headsIdentity = nextHeads;
      }
      lastDiskVersion = diskVersion;
    }
    // Open-ended coverage filters compare inclusive years against the current UTC year.
    if (lastYear !== year) {
      revision = digest([bundled, year, paperIdentity]);
      lastYear = year;
    }
    return revision;
  };
}
