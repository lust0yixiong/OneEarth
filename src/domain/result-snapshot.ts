import { assetById, assetIdentity, loadRemoteAssetIds } from "./datasets";
import { validContext } from "./context-validation";
import { validBatch } from "./research-list";
import type { SearchState } from "./results";
import type { CandidateSet } from "./types";
import {validAccessSection} from "./data-access";

type Scope = Pick<
  CandidateSet,
  "caseId" | "filters" | "selection" | "gridSystem" | "layer" | "camera"
>;
export type ResultSnapshot = {
  version: 1;
  view: "earth" | "discover";
  batch: CandidateSet;
  scope: Scope;
  catalog: Omit<SearchState, "result">;
  editions: [string, string | null][];
};
export const resultIdPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
export const snapshotMaxBytes = 256 * 1024;
const object = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const fields = (v: unknown, keys: string) =>
  object(v) && Object.keys(v).every((k) => keys.split(" ").includes(k));
function scopeFields(scope: Scope) {
  return (
    fields(scope.filters, "need type source place period utcWindow depth maxDem") &&
    fields(scope.camera, "center zoom reason") &&
    (!scope.selection ||
      (fields(scope.selection, "id grid point simulated") &&
        fields(scope.selection.grid, "system n key label")))
  );
}
const subset = (v: unknown, ids: string[]) =>
  Array.isArray(v) &&
  new Set(v).size === v.length &&
  v.every((id) => ids.includes(id));

export function validResultSnapshot(v: unknown): v is ResultSnapshot {
  if (
    !object(v) ||
    !fields(v, "version view batch scope catalog editions") ||
    v.version !== 1 ||
    !["earth", "discover"].includes(String(v.view)) ||
    !validBatch(v.batch, true) ||
    !object(v.scope) ||
    !validContext({ ...v.scope, citation: null }) ||
    !object(v.catalog) ||
    !Array.isArray(v.editions)
  )
    return false;
  const batch = v.batch,
    c = v.catalog;
  const scopeKeys = "caseId filters selection layer gridSystem camera";
  if (
    !fields(
      batch,
      scopeKeys +
        " title originKind ids catalogConditions restoredFrom lookups metric sceneKey clusterOverlay answerId researchRecord",
    ) ||
    !fields(v.scope, scopeKeys) ||
    !scopeFields(batch) ||
    !scopeFields(v.scope as Scope) ||
    !validBatch({ ...v.scope, ids: [], title: "" }, true) ||
    (batch.restoredFrom !== undefined &&
      typeof batch.restoredFrom !== "string") ||
    (batch.lookups &&
      batch.lookups.some(
        (l) =>
          !fields(l, "assetId point years utcWindow matched url checkedAt items") ||
          l.items.some((i) => !fields(i, "id datetime cloud url")),
      )) ||
    !fields(
      c,
      "query type source savedOnly savedIds kind capability compare section",
    ) ||
    ![c.query, c.type, c.source].every((s) => typeof s === "string") ||
    (c.section!==undefined&&!validAccessSection(c.section)) ||
    !["all", "dataset", "clue", "requirement"].includes(String(c.kind)) ||
    ![undefined, "", "local", "map", "request"].includes(
      c.capability as string,
    ) ||
    typeof c.savedOnly !== "boolean" ||
    !subset(c.compare, batch.ids) ||
    (c.savedIds !== undefined && !subset(c.savedIds, batch.ids)) ||
    (c.savedOnly && !Array.isArray(c.savedIds)) ||
    v.editions.length !== batch.ids.length
  )
    return false;
  return v.editions.every(
    (row) =>
      Array.isArray(row) &&
      row.length === 2 &&
      typeof row[0] === "string" &&
      (row[1] === null || typeof row[1] === "string"),
  );
}

export function snapshotResult(
  view: ResultSnapshot["view"],
  batch: CandidateSet,
  scope: Scope,
  search: SearchState,
  saved: string[],
): ResultSnapshot {
  const { query, type, source, savedOnly, kind, capability, compare,section } = search;
  return {
    version: 1,
    view,
    batch,
    scope,
    catalog: {
      query,
      ...(section?{section}:{}),
      type,
      source,
      kind,
      savedOnly,
      capability,
      compare: compare.filter((id) => batch.ids.includes(id)),
      ...(savedOnly
        ? {
            savedIds: batch.ids.filter((id) =>
              search.savedIds
                ? search.savedIds.includes(id)
                : assetById.has(id) &&
                  saved.includes(assetIdentity(assetById.get(id)!)),
            ),
          }
        : {}),
    },
    editions: batch.ids.map((id) => {
      const a = assetById.get(id);
      if (!a) throw Error("当前目录缺少候选 " + id + "，无法生成结果链接。");
      return [assetIdentity(a), a.version ?? null];
    }),
  };
}

export async function loadResultSnapshot(
  id: string,
  signal: AbortSignal,
): Promise<ResultSnapshot> {
  if (!resultIdPattern.test(id)) throw Error("结果链接的编号无效。");
  for (let attempt = 0; ; attempt++) {
    const res = await fetch("/api/results/" + id, { signal });
    if (res.status === 404 && attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
      continue;
    }
    if (res.status === 404)
      throw Error("此服务没有该结果快照，可能已移除或链接来自另一实例。");
    if (!res.ok) throw Error("结果服务读取失败（HTTP " + res.status + "）。");
    if (!res.headers.get("content-type")?.includes("application/json"))
      throw Error("该服务未提供结果快照，请从生成链接的 OneEarth 实例打开。");
    const snapshot: unknown = await res.json();
    if (!validResultSnapshot(snapshot))
      throw Error("结果快照的格式或范围无效。");
    await loadRemoteAssetIds(snapshot.batch.ids);
    const missing = snapshot.batch.ids.filter((id, i) => {
      const asset = assetById.get(id),
        edition = snapshot.editions[i];
      return (
        !asset ||
        assetIdentity(asset) !== edition[0] ||
        (asset.version ?? null) !== edition[1]
      );
    });
    if (missing.length)
      throw Error("当前服务无法提供原批次的资料版本：" + missing.join("、"));
    return snapshot;
  }
}
