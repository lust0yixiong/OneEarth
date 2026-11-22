import { createHash } from "node:crypto";
import { cases } from "../src/domain/catalog";
import { assetById, assets, registerCoverageOnlyPapers } from "../src/domain/datasets";
import { sample } from "../src/domain/earth-search";
import { paperId, type CoverageOnlyPaperRecord } from "../src/domain/paper-record";
import { getModel } from "../src/domain/spatial";
import { windManifest } from "../src/domain/wind";
import type { PaperMapEntry, PaperProjectionHead } from "./paper-projection-contract";
import type { SpatialPaperSnapshot, SpatialPaperUpdate, spatialPaperStore } from "./spatial-paper-store";
import { discoveryPaperProjection, fetchSpatialPaperUpdate, type ProjectionQuery } from "./spatial-paper-sync";

function digest(input: unknown) {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

/** Adapt the minimal map projection to the existing in-process spatial catalogue model. */
export function projectedCoverageRecords(entries: Iterable<PaperMapEntry>): CoverageOnlyPaperRecord[] {
  return Array.from(entries, ({ id, dsKey, title, type, points, profile }) => ({
    id, dsKey, coverageOnly: true, catalogSummary: true, paperTitle: "", studyContext: "", papers: 0, points,
    need: {
      datasetId: dsKey, name: title, product: title, type, source: "文献资料", status: "", detail: "",
      profile: { ...profile, access: "", limitation: "" }, tabs: [],
    },
  }));
}

/** Shared with precompute; historical records remain available only to explicitly named batches. */
export function registerPublishedPaperProjection(entries: PaperMapEntry[]) {
  registerCoverageOnlyPapers(projectedCoverageRecords(entries.filter(entry => entry.published)), true);
}

export function coveragePublication() {
  // Keep the existing revision identity for the same current heads and bundled inputs.
  const bundled = digest([
    "oneearth.coverage.v1",
    assets.filter(asset => !paperId(asset.id) && !asset.origins.includes("constellation"))
      .map(({ id, caseId, needIndex, datasetId, productId, version, kind, profile, origins, categories }) =>
      [id, caseId, needIndex, datasetId, productId, version, kind, profile, origins, categories]),
    cases.map(({ id }) => [id, getModel(id)]),
    sample.revision,
    windManifest.frames.map(frame => frame.validTime),
  ]);
  let current: PaperProjectionHead | null = null;
  let rows = new Map<string, PaperMapEntry>();
  let published = new Map<string, PaperMapEntry>();
  let paperIdentity = "";
  let lastYear: number | undefined;
  let revision = "";

  function activate(update: SpatialPaperUpdate) {
    const oldIds = update.baseGeneration === undefined ? undefined : new Set<string>();
    if (update.baseGeneration === undefined) {
      rows = new Map();
      published = new Map();
    } else {
      // Remove changed memberships before assigning new heads, regardless of their content ID order.
      for (const row of update.entries) {
        const existing = rows.get(row.id);
        if (existing?.published) oldIds!.add(existing.dsKey);
        if (row.published) oldIds!.add(row.dsKey);
      }
    }
    const before = oldIds && Array.from(oldIds, key => [key, published.get(key)?.id] as const);
    for (const row of update.entries) {
      if (rows.get(row.id)?.published) published.delete(row.dsKey);
    }
    for (const row of update.entries) {
      rows.set(row.id, row);
      if (row.published) published.set(row.dsKey, row);
    }
    if (!before || before.some(([key, id]) => published.get(key)?.id !== id)) {
      const heads = [...published.values()].sort((a, b) => a.dsKey < b.dsKey ? -1 : a.dsKey > b.dsKey ? 1 : 0);
      const nextIdentity = digest(heads.map(row => [row.dsKey, row.id]));
      if (nextIdentity !== paperIdentity) {
        registerPublishedPaperProjection(heads);
        paperIdentity = nextIdentity;
        lastYear = undefined;
      }
    }
    const { generation, revision, publishedCount, versionCount } = update;
    current = { generation, revision, publishedCount, versionCount };
  }

  return {
    activate,
    head: () => current,
    generation: () => current?.generation,
    revision() {
      if (!current) return null;
      const year = new Date().getUTCFullYear();
      if (lastYear !== year) {
        revision = digest([bundled, year, paperIdentity]);
        lastYear = year;
      }
      return revision;
    },
    batchAvailable(ids: string[]) {
      return ids.every(id => !paperId(id) || rows.has(id));
    },
    hydrateBatch(ids: string[]) {
      registerCoverageOnlyPapers(projectedCoverageRecords(ids.flatMap(id => {
        const row = assetById.has(id) ? undefined : rows.get(id);
        return row ? [row] : [];
      })));
    },
  };
}

type Store = Pick<Awaited<ReturnType<typeof spatialPaperStore>>, "publish" | "readCurrent">;
type Publication = ReturnType<typeof coveragePublication>;

export async function loadSpatialPaperPublication(store: Store, publication: Publication) {
  const snapshot: SpatialPaperSnapshot | null = await store.readCurrent();
  if (snapshot) publication.activate(snapshot);
}

export async function synchronizeSpatialPaperPublication(
  store: Store, publication: Publication, query: ProjectionQuery, signal: AbortSignal,
) {
  const current = publication.head();
  const update = await fetchSpatialPaperUpdate(query, current, signal);
  if (!update) return false;
  signal.throwIfAborted();
  if (await store.publish(update, current?.generation ?? null)) {
    // Apply synchronously after commit so a request sees either whole generation.
    publication.activate(update);
  } else {
    await loadSpatialPaperPublication(store, publication);
  }
  return true;
}

/** Poll head on its own timer. Request handlers never call discovery. */
export function pollSpatialPaperPublication(
  store: Store, publication: Publication, query = discoveryPaperProjection(), intervalMs = 5000,
) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  let failed = false;
  const run = async () => {
    try {
      await synchronizeSpatialPaperPublication(store, publication, query, controller.signal);
      failed = false;
    } catch (error) {
      if (!controller.signal.aborted && !failed) {
        console.warn("OneEarth paper coverage projection could not synchronize:", error instanceof Error ? error.message : String(error));
        failed = true;
      }
    } finally {
      if (!controller.signal.aborted) timer = setTimeout(run, intervalMs).unref();
    }
  };
  timer = setTimeout(run, 0).unref();
  return () => { controller.abort(); clearTimeout(timer); };
}
