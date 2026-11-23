import {useEffect, useSyncExternalStore} from "react";
import {rainPublishedCoverage, rainTileRoot, readRainCatalog} from "../domain/rain-catalog";
import type {RainCatalog} from "../domain/rainfall";

type RainPublication = {status: "loading"} | {status: "unavailable"} | {status: "ready"; catalog: RainCatalog};
const loading = {status: "loading"} as const;
let snapshot: RainPublication = loading;
let request: Promise<void> | undefined;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function publish(next: RainPublication) {
  snapshot = next;
  listeners.forEach(listener => listener());
}

export function refreshRainCatalog() {
  if (!request) {
    if (snapshot.status === "unavailable") publish(loading);
    request = fetch(rainTileRoot + "/catalog.json", {
      cache: "no-cache",
      signal: AbortSignal.timeout(10000),
    }).then(async response => {
      if (!response.ok) throw Error("降水发布目录不可用");
      const catalog = readRainCatalog(await response.json());
      if (snapshot.status !== "ready" || JSON.stringify(snapshot.catalog) !== JSON.stringify(catalog)) {
        publish({status: "ready", catalog});
      }
    }).catch(() => publish({status: "unavailable"})).finally(() => { request = undefined; });
  }
  return request;
}

const getSnapshot = () => snapshot;
const getDisabled = () => loading;
const subscribeDisabled = () => () => {};

export function useRainCatalog(enabled = true) {
  const publication = useSyncExternalStore(enabled ? subscribe : subscribeDisabled, enabled ? getSnapshot : getDisabled);
  useEffect(() => { if (enabled) void refreshRainCatalog(); }, [enabled]);
  return publication;
}

export function rainCoverageLabel(publication: RainPublication) {
  if (publication.status === "loading") return "正在读取降水发布目录…";
  if (publication.status === "unavailable") return "降水发布目录暂不可用";
  const coverage = rainPublishedCoverage(publication.catalog);
  return coverage ? "已发布年月 · " + coverage : "暂无已发布的降水月份";
}
